const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const ppt=require('../core/presentations.cjs'),{ProjectStore,hash}=require('../core/storage.cjs'),{exportPresentation}=require('../core/presentation-export.cjs'),JSZip=require('jszip');
test('rectangle radius persists and duplicates; old rectangles stay square and resized radii clamp',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-round-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new ProjectStore(root);await store.init();const r=await store.create('圆角'),deck=ppt.create(),rect=ppt.element('rect',{w:240,h:120,cornerRadius:32.5});deck.slides[0].elements=[rect];
  await store.save(r.id,{...r.document,presentations:[deck]},r.revision);assert.equal((await store.read(r.id)).document.presentations[0].slides[0].elements[0].cornerRadius,32.5);
  assert.equal(ppt.duplicate(rect).cornerRadius,32.5);assert.equal(ppt.rectangleRadius(ppt.element('rect')),0);assert.equal(ppt.rectangleRadius(rect),32.5);
  rect.h=24;assert.equal(ppt.rectangleRadius(rect),12);rect.h=120;assert.equal(ppt.rectangleRadius(rect),32.5);
  for(const cornerRadius of [-1,2501,NaN,Infinity,null,'12']){rect.cornerRadius=cornerRadius;assert.throws(()=>ppt.validate([deck]));}rect.cornerRadius=2500;assert.doesNotThrow(()=>ppt.validate([deck]));
  for(const kind of ['text','ellipse','image']){deck.slides[0].elements=[ppt.element(kind,{cornerRadius:0,assetId:'image'})];assert.throws(()=>ppt.validate([deck],[{id:'image',kind:'image'}]));}
});

test('PPTX retains native rounded geometry, exact radius and effects with short-side clamping',async()=>{
  const {DOMParser}=require('@xmldom/xmldom'),{defaults}=require('../core/effects.cjs'),deck=ppt.create();
  const effects=['shadow','innerShadow','stroke'].map(type=>({...defaults(type),...(type==='stroke'?{position:'center'}:{})}));
  deck.slides[0].elements=[ppt.element('rect'),ppt.element('rect',{cornerRadius:0}),ppt.element('rect',{w:240,h:120,cornerRadius:30,rotation:35,effects}),ppt.element('rect',{w:80,h:160,cornerRadius:2500}),ppt.element('ellipse')];
  const zip=await JSZip.loadAsync(await exportPresentation(deck,[],'.')),doc=new DOMParser().parseFromString(await zip.file('ppt/slides/slide1.xml').async('string'),'application/xml'),shapes=Array.from(doc.getElementsByTagName('p:sp'));
  assert.deepEqual(shapes.map(s=>s.getElementsByTagName('a:prstGeom')[0].getAttribute('prst')),['rect','rect','roundRect','roundRect','ellipse']);
  assert.equal(shapes[2].getElementsByTagName('a:gd')[0].getAttribute('fmla'),'val 25000');assert.equal(shapes[3].getElementsByTagName('a:gd')[0].getAttribute('fmla'),'val 50000');
  assert.equal(shapes[2].getElementsByTagName('a:xfrm')[0].getAttribute('rot'),'2100000');
  for(const tag of ['a:innerShdw','a:outerShdw','a:ln'])assert.equal(shapes[2].getElementsByTagName(tag).length,1);assert.equal(doc.getElementsByTagName('p:pic').length,0);
});
test('percentage rounding preserves four corners across resize, save and duplicate',async t=>{
  const e=ppt.element('rect',{w:400,h:200,cornerRounding:{topLeft:100,topRight:50,bottomRight:25,bottomLeft:0}}),d=ppt.create();d.slides[0].elements=[e];
  assert.deepEqual(ppt.rectangleRadii(e),[100,50,25,0]);e.h=80;assert.deepEqual(ppt.rectangleRadii(e),[40,20,10,0]);assert.equal(ppt.rectangleRadii({...e,cornerRounding:100})[0],40);
  assert.deepEqual(ppt.rectangleRadii(ppt.element('rect',{w:200,h:100,cornerRadius:25})),[25,25,25,25]);
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-corners-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new ProjectStore(root);await store.init();const record=await store.create('四角');await store.save(record.id,{...record.document,presentations:[d]},record.revision);assert.deepEqual((await store.read(record.id)).document.presentations,[d]);assert.deepEqual(ppt.duplicate(e).cornerRounding,e.cornerRounding);
  for(const v of [-1,101,NaN,null,'50',[],{}, {topLeft:20}, {...e.cornerRounding,topLeft:101},{...e.cornerRounding,extra:0}]){e.cornerRounding=v;assert.throws(()=>ppt.validate([d]));}
  for(const kind of ['text','ellipse']){d.slides[0].elements=[ppt.element(kind,{cornerRounding:50})];assert.throws(()=>ppt.validate([d]));}
});
test('PPTX exports asymmetric corners as one native editable vector with circular arcs and effects',async()=>{
  const {DOMParser}=require('@xmldom/xmldom'),{defaults}=require('../core/effects.cjs'),d=ppt.create();d.slides[0].elements=[ppt.element('rect',{w:400,h:200,rotation:30,cornerRounding:{topLeft:100,topRight:50,bottomRight:25,bottomLeft:0},effects:[{...defaults('stroke'),position:'center'},defaults('shadow'),defaults('innerShadow')]}),ppt.element('rect',{cornerRounding:100})];
  const zip=await JSZip.loadAsync(await exportPresentation(d,[],'.')),doc=new DOMParser().parseFromString(await zip.file('ppt/slides/slide1.xml').async('string'),'application/xml');assert.equal(doc.getElementsByTagName('p:sp').length,2);assert.equal(doc.getElementsByTagName('p:pic').length,0);assert.equal(doc.getElementsByTagName('a:custGeom').length,1);
  assert.deepEqual(Array.from(doc.getElementsByTagName('a:arcTo')).map(a=>[a.getAttribute('wR'),a.getAttribute('stAng'),a.getAttribute('swAng')]),[['476250','16200000','5400000'],['238125','0','5400000'],['952500','10800000','5400000']]);assert.equal(doc.getElementsByTagName('p:sp')[0].getElementsByTagName('a:xfrm')[0].getAttribute('rot'),'1800000');assert.equal(doc.getElementsByTagName('a:gd')[0].getAttribute('fmla'),'val 50000');assert.equal(doc.getElementsByTagName('a:innerShdw').length,1);
});
test('multiple presentations persist independently and reject stale saves',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-ppt-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new ProjectStore(root);await store.init();const r=await store.create('演示测试');
  const a=ppt.create('第一份'),b=ppt.create('第二份','4:3');const d={...r.document,presentations:[a,b]};await store.save(r.id,d,r.revision);assert.deepEqual((await store.read(r.id)).document.presentations,[a,b]);await assert.rejects(()=>store.save(r.id,d,r.revision));
});
test('duplicating a presentation generates independent slide and element identifiers',()=>{
  const a=ppt.create(),b=ppt.duplicate(a);b.slides[0].elements[1].text='修改副本';assert.notEqual(a.slides[0].elements[1].text,b.slides[0].elements[1].text);ppt.validate([a,b]);
});
test('presentation validation rejects malformed content, nonfinite dimensions and missing images',()=>{
  for(const mutate of [d=>d.slides=[],d=>d.slides[0].elements[0].w=Infinity,d=>d.ratio='__proto__',d=>d.slides[0].background='url(https://invalid)',d=>d.slides[0].elements.push(ppt.element('image',{assetId:'missing'})),d=>d.slides.push(d.slides[0]),d=>d.name=' ',d=>d.slides[0].elements[1].fontSize=999]){const d=ppt.create();mutate(d);assert.throws(()=>ppt.validate([d]));}
  assert.throws(()=>ppt.validate(Array.from({length:101},()=>ppt.create())));assert.doesNotThrow(()=>ppt.validate(undefined));
});
test('PPTX exports native text and shapes, notes and correct slide size/order',async()=>{
  const d=ppt.create('中文 & 测试','4:3');d.slides[0].elements[1].text='你好 <世界> & 土狗';d.slides[0].notes='仅备注可见';d.slides.push(ppt.slide('content',960));const zip=await JSZip.loadAsync(await exportPresentation(d,[],'.'));
  const xml=await zip.file('ppt/slides/slide1.xml').async('string');assert.match(xml,/你好 &lt;世界&gt; &amp; 土狗/);assert.match(xml,/a:prstGeom prst="rect"/);assert.match(xml,/<p:sp>/);assert(zip.file('ppt/slides/slide2.xml'));assert.match(await zip.file('ppt/presentation.xml').async('string'),/cx="9144000" cy="6858000"/);assert.match(await zip.file('ppt/notesSlides/notesSlide1.xml').async('string'),/仅备注可见/);
});
test('export embeds local image bytes and rejects path traversal',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-ppt-img-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'resources'));const png=await require('sharp')({create:{width:80,height:40,channels:4,background:'#1765d1'}}).png().toBuffer(),resource=hash(png)+'.png';await fs.writeFile(path.join(root,'resources',resource),png);
  const d=ppt.create(),a={id:'photo',kind:'image',resource};d.slides[0].elements.push(ppt.element('image',{assetId:a.id}));const zip=await JSZip.loadAsync(await exportPresentation(d,[a],root));assert(Object.keys(zip.files).some(n=>n.startsWith('ppt/media/')&&n.endsWith('.png')));assert.match(await zip.file('ppt/slides/slide1.xml').async('string'),/<p:pic>/);await assert.rejects(()=>exportPresentation(d,[{...a,resource:'../outside.png'}],root));
  await fs.writeFile(path.join(root,'resources',resource),'tampered');await assert.rejects(()=>exportPresentation(d,[a],root),/校验失败/);
});
test('export rejects excessive image budgets before creating a PPTX',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-ppt-budget-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'resources'));
  const png=await require('sharp')({create:{width:1000,height:1000,channels:4,background:'#ffffff'}}).png().toBuffer(),resource=hash(png)+'.png',file=path.join(root,'resources',resource);await fs.writeFile(file,png);
  const d=ppt.create(),a={id:'photo',kind:'image',resource};d.slides[0].elements=Array.from({length:65},()=>ppt.element('image',{assetId:a.id}));await assert.rejects(()=>exportPresentation(d,[a],root),/6400 万像素/);
  d.slides[0].elements=d.slides[0].elements.slice(0,1);await fs.truncate(file,128*1024*1024+1);await assert.rejects(()=>exportPresentation(d,[a],root),/128 MiB/);
});
test('PPT font resources and layer flags are validated and retained with the project',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-ppt-font-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new ProjectStore(root);await store.init();const r=await store.create('字体和图层'),d=ppt.create();
  const bytes=Buffer.from([0,1,0,0,0,0,0,0,0,0,0,0]),resource=hash(bytes)+'.ttf';await fs.writeFile(path.join(root,'resources',resource),bytes);
  const e=d.slides[0].elements[1];Object.assign(e,{fontFamily:'发布字体',fontWeight:500,fontResource:{resource,projectId:'font-project',jobId:'font-job'},visible:false,locked:true});
  await store.save(r.id,{...r.document,presentations:[d]},r.revision);assert.deepEqual((await store.read(r.id)).document.presentations,[d]);assert(require('../core/storage.cjs').resourcesIn({presentations:[d]}).has(resource));
  for(const patch of [{locked:'yes'},{visible:0},{fontWeight:NaN},{fontWeight:1001},{fontResource:{...e.fontResource,resource:'../font.ttf'}},{fontResource:{...e.fontResource,jobId:''}}]){const bad=structuredClone(d);Object.assign(bad.slides[0].elements[1],patch);assert.throws(()=>ppt.validate([bad]));}
});
test('PPTX follows layer visibility, stacking order and shared font weight',async()=>{
  const d=ppt.create();d.slides[0].elements=[ppt.element('text',{text:'Bottom',fontFamily:'Arial',fontWeight:700,bold:false,locked:true}),ppt.element('text',{text:'Hidden',visible:false}),ppt.element('text',{text:'Top',fontFamily:'Custom Font',fontWeight:400,bold:true})];
  const zip=await JSZip.loadAsync(await exportPresentation(d,[],'.')),xml=await zip.file('ppt/slides/slide1.xml').async('string');assert(!xml.includes('Hidden'));assert(xml.indexOf('Bottom')<xml.indexOf('Top'));assert.match(xml,/typeface="Custom Font"/);assert.match(xml,/b="1"/);assert.doesNotMatch(xml.slice(xml.lastIndexOf('<p:sp>')),/b="1"/);
  assert.equal(ppt.presentationFont(ppt.element('text',{bold:true})).fontWeight,700);assert.equal(ppt.presentationFont(d.slides[0].elements[2]).fontWeight,400);
});
