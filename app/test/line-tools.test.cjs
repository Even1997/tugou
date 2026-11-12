const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const S=require('../core/shapes.cjs'),L=require('../core/layers.cjs'),P=require('../core/presentations.cjs');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`),samePoint=(a,b)=>{near(a.x,b.x);near(a.y,b.y);};
const ends=b=>S.lineEndpoints(b.width,b.height,b.linePoints).map(p=>({x:p.x+b.x,y:p.y+b.y}));

test('line drawing preserves both endpoints in every direction, including perfectly horizontal and vertical lines',()=>{
  const start={x:120,y:190};
  for(const dx of [-80,0,80])for(const dy of [-60,0,60]){
    const end={x:start.x+dx,y:start.y+dy},b=S.lineBounds(start,end);
    assert.ok(S.validLinePoints(b.linePoints));assert.ok(b.width>=1&&b.height>=1);samePoint(ends(b)[0],start);samePoint(ends(b)[1],end);
  }
  const large=S.lineBounds(start,{x:1e6,y:-1e6});assert.ok(large.width<=30000&&large.height<=30000);
});
test('Shift snaps lines to all eight directions without moving the start',()=>{
  for(let i=0;i<8;i++){
    const a={x:12,y:35},angle=i*Math.PI/4+.1,b=S.lineBounds(a,{x:a.x+100*Math.cos(angle),y:a.y+100*Math.sin(angle)},true),[p,q]=ends(b);
    samePoint(p,a);near(Math.hypot(q.x-p.x,q.y-p.y),100);near(Math.sin(Math.atan2(q.y-p.y,q.x-p.x)-i*Math.PI/4),0);
  }
});
test('fractional and zoom-derived coordinates stay valid after floating point normalization',()=>{
  for(let i=1;i<=2000;i++){
    const a={x:Math.sin(i)*1300.1,y:Math.cos(i)*600.3},b={x:Math.cos(i*2)*1100.7,y:Math.sin(i*3)*700.9};
    for(const snap of [false,true]){const box=S.lineBounds(a,b,snap);assert.ok(S.validLinePoints(box.linePoints));samePoint(ends(box)[0],a);if(!snap)samePoint(ends(box)[1],b);}
  }
});
test('editing either layer endpoint preserves the fixed endpoint with rotated parents, scaling, skew and flips',()=>{
  const parent=L.createLayer('group',{x:450,y:-220,rotation:32,scaleX:1.4,scaleY:.6});
  for(const flipX of [false,true])for(const flipY of [false,true])for(const index of [0,1]){
    const line=L.createLayer('shape',{...S.lineBounds({x:100,y:80},{x:220,y:80}),shape:'line',parentId:parent.id,rotation:-26,scaleX:1.3,scaleY:2,skewX:12,flipX,flipY});
    const layers=[parent,line],world=e=>S.lineEndpoints(e.width,e.height,e.linePoints).map(p=>L.point(L.worldMatrix([parent,e],e),p.x,p.y)),before=world(line),target={x:before[index].x-96,y:before[index].y+57};
    const next=L.moveLineEndpoint(layers,line,index,target);L.validateLayers([parent,next]);samePoint(world(next)[index],target);samePoint(world(next)[1-index],before[1-index]);
  }
});
test('both editors save and reopen real line data; malformed endpoints and strokes are rejected',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-lines-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const {ProjectStore}=require('../core/storage.cjs'),store=new ProjectStore(root);await store.init();const r=await store.create('直线测试'),deck=P.create();
  deck.slides[0].elements=[P.element('line',{...P.presentationLine({x:400,y:80},{x:100,y:220}),stroke:'#cc2200',strokeWidth:4})];
  const layer=L.createLayer('shape',{shape:'line',...S.lineBounds({x:60,y:50},{x:60,y:250}),stroke:'#2255cc',strokeWidth:3});
  await store.save(r.id,{...r.document,layers:[layer],presentations:[deck]},r.revision);const saved=(await store.read(r.id)).document;
  assert.deepEqual(saved.layers,[layer]);assert.deepEqual(saved.presentations,[deck]);assert.deepEqual(P.duplicate(deck).slides[0].elements[0].linePoints,deck.slides[0].elements[0].linePoints);
  for(const linePoints of [[],[0,0,1],[-1,0,1,1],[0,0,Infinity,1],[0,0,NaN,1],'line']){
    assert.throws(()=>L.validateLayers([{...layer,linePoints}]));assert.throws(()=>P.validate([{...deck,slides:[{...deck.slides[0],elements:[{...deck.slides[0].elements[0],linePoints}]}]}]));
  }
  for(const strokeWidth of [0,-1,501,NaN])assert.throws(()=>P.validate([{...deck,slides:[{...deck.slides[0],elements:[P.element('line',{strokeWidth})]}]}]));
  assert.throws(()=>P.validate([{...deck,slides:[{...deck.slides[0],elements:[P.element('rect',{h:1})]}]}]));
  assert.throws(()=>P.validate([{...deck,slides:[{...deck.slides[0],elements:[P.element('line',{effects:[require('../core/effects.cjs').defaults('shadow')]})]}]}]),/不支持外框与阴影/);
});
test('PPTX exports native editable lines with exact endpoints, color and thickness',async()=>{
  const {exportPresentation}=require('../core/presentation-export.cjs'),JSZip=require('jszip'),{DOMParser}=require('@xmldom/xmldom'),deck=P.create();
  deck.slides[0].elements=[[[80,100],[400,100]],[[180,80],[180,440]],[[400,90],[100,300]],[[100,300],[400,90]]].map(([a,b])=>P.element('line',{...P.presentationLine({x:a[0],y:a[1]},{x:b[0],y:b[1]}),stroke:'#1276ab',strokeWidth:4}));
  deck.slides[0].elements.push({...deck.slides[0].elements[0],id:crypto.randomUUID(),rotation:37});
  const zip=await JSZip.loadAsync(await exportPresentation(deck,[],'.')),xml=new DOMParser().parseFromString(await zip.file('ppt/slides/slide1.xml').async('string'),'application/xml'),shapes=Array.from(xml.getElementsByTagName('p:sp'));
  assert.equal(shapes.length,5);assert.equal(xml.getElementsByTagName('p:pic').length,0);
  for(const [i,shape] of shapes.entries()){
    assert.equal(shape.getElementsByTagName('a:prstGeom')[0].getAttribute('prst'),'line');
    const xfrm=shape.getElementsByTagName('a:xfrm')[0],off=xfrm.getElementsByTagName('a:off')[0],ext=xfrm.getElementsByTagName('a:ext')[0],[a,b]=P.presentationLineEndpoints(deck.slides[0].elements[i]);
    const close=(v,n)=>assert.ok(Math.abs(Number(v)-n*9525)<=1);
    close(off.getAttribute('x'),Math.min(a.x,b.x));close(off.getAttribute('y'),Math.min(a.y,b.y));close(ext.getAttribute('cx'),Math.abs(b.x-a.x));close(ext.getAttribute('cy'),Math.abs(b.y-a.y));
    assert.equal(xfrm.getAttribute('flipH')==='1',b.x<a.x);assert.equal(xfrm.getAttribute('flipV')==='1',b.y<a.y);
    const stroke=shape.getElementsByTagName('a:ln')[0];assert.equal(Number(stroke.getAttribute('w')),4*9525);assert.equal(stroke.getElementsByTagName('a:srgbClr')[0].getAttribute('val'),'1276AB');
  }
});
test('MCP creates, updates, duplicates and protects locked lines without weakening other shapes',()=>{
  const {batch}=require('../core/automation-commands.cjs'),base={id:'p',name:'lines',width:128,height:128,modules:[],recipes:[],assets:[],layers:[],jobs:[]},run=(d,command,args)=>batch(d,[{name:'r',command,args}]);
  let result=run(base,'ppt.create',{layout:'blank'}),doc=result.document;const deck=doc.presentations[0],page={presentationId:deck.id,slideId:deck.slides[0].id};
  result=run(doc,'ppt.element.create',{...page,kind:'line',properties:{w:320,h:1,stroke:'#aabbcc',strokeWidth:3,linePoints:[1,.5,0,.5]}});doc=result.document;const target={...page,id:result.results.r.id};
  doc=run(doc,'ppt.element.update',{...target,patch:{strokeWidth:8}}).document;doc=run(doc,'ppt.element.duplicate',target).document;assert.equal(doc.presentations[0].slides[0].elements.length,2);
  for(const patch of [{linePoints:[0,2,1,0]},{strokeWidth:0},{fill:'#ffffff'}])assert.throws(()=>run(doc,'ppt.element.update',{...target,patch}));
  assert.throws(()=>run(doc,'ppt.element.create',{...page,kind:'rect',properties:{w:1}}));
  doc=run(doc,'ppt.element.update',{...target,patch:{locked:true}}).document;assert.throws(()=>run(doc,'ppt.element.update',{...target,patch:{x:40}}),e=>e.code==='LOCKED');
});
