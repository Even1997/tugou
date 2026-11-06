const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const ppt=require('../core/presentations.cjs'),{defaults}=require('../core/effects.cjs'),{exportPresentation}=require('../core/presentation-export.cjs');
const {ProjectStore,hash}=require('../core/storage.cjs'),JSZip=require('jszip'),{DOMParser}=require('@xmldom/xmldom');
const effects=()=>[defaults('shadow'),defaults('innerShadow'),{...defaults('stroke'),position:'center',size:6,color:'#ef4526'}];
const xml=async d=>new DOMParser().parseFromString(await(await JSZip.loadAsync(await exportPresentation(d,[],'.'))).file('ppt/slides/slide1.xml').async('string'),'application/xml');

test('PPT shadows and border persist, duplicate independently and validate bounded parameters',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-style-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new ProjectStore(root);await store.init();const r=await store.create('样式'),d=ppt.create();d.slides[0].elements[0].effects=effects();
  await store.save(r.id,{...r.document,presentations:[d]},r.revision);assert.deepEqual((await store.read(r.id)).document.presentations,[d]);
  const copy=ppt.duplicate(d);copy.slides[0].elements[0].effects[0].radius=3;assert.equal(d.slides[0].elements[0].effects[0].radius,12);
  for(const patch of [{radius:101},{distance:201},{radius:NaN},{angle:Infinity},{opacity:101},{color:'url(x)'},{enabled:'yes'},{spread:1},{blend:'multiply'},{type:'unknown'}]){const bad=structuredClone(d);Object.assign(bad.slides[0].elements[0].effects[0],patch);assert.throws(()=>ppt.validate([bad]));}
  const badId=structuredClone(d);badId.slides[0].elements[0].effects[1].id=badId.slides[0].elements[0].effects[0].id;assert.throws(()=>ppt.validate([badId]));
  d.slides[0].elements[0].effects.push(defaults('shadow'));assert.throws(()=>ppt.validate([d]));d.slides[0].elements[0].effects=null;assert.throws(()=>ppt.validate([d]));
});
test('native PPTX includes simultaneous shadows and editable coloured borders with exact units',async()=>{
  const d=ppt.create();d.slides[0].elements=['text','rect','ellipse'].map(kind=>ppt.element(kind,{effects:effects(),rotation:35}));
  d.slides[0].elements[0].effects[0]={...defaults('shadow'),angle:-90,distance:0,radius:0,opacity:25};
  const doc=await xml(d),shapes=Array.from(doc.getElementsByTagName('p:sp'));assert.equal(shapes.length,3);assert.equal(doc.getElementsByTagName('p:pic').length,0);
  for(const shape of shapes){const props=shape.getElementsByTagName('p:spPr')[0],list=props.getElementsByTagName('a:effectLst')[0];assert.deepEqual(Array.from(list.childNodes).filter(n=>n.nodeType===1).map(n=>n.tagName),['a:innerShdw','a:outerShdw']);const line=props.getElementsByTagName('a:ln')[0];assert.equal(line.getAttribute('w'),'57150');assert.equal(line.getElementsByTagName('a:srgbClr')[0].getAttribute('val'),'ef4526');}
  const shadow=doc.getElementsByTagName('a:outerShdw')[0];assert.equal(shadow.getAttribute('dir'),'16200000');assert.equal(shadow.getAttribute('blurRad'),'0');assert.equal(shadow.getAttribute('dist'),'0');assert.equal(shadow.getElementsByTagName('a:alpha')[0].getAttribute('val'),'25000');
  assert(doc.getElementsByTagName('a:t').length>0);assert.equal(shapes[0].getElementsByTagName('a:xfrm')[0].getAttribute('rot'),'2100000');
});
test('disabled and invisible effects are omitted, including zero width and opacity',async()=>{
  const d=ppt.create();d.slides[0].elements=[ppt.element('rect',{effects:effects().map(e=>({...e,enabled:false}))}),ppt.element('rect',{visible:false,effects:effects()}),ppt.element('rect',{effects:effects().map(e=>({...e,opacity:0}))}),ppt.element('rect',{effects:[{...effects()[2],size:0}]})];
  const doc=await xml(d);assert.equal(doc.getElementsByTagName('a:outerShdw').length,0);assert.equal(doc.getElementsByTagName('a:innerShdw').length,0);assert.equal(doc.getElementsByTagName('p:sp').length,3);
});
test('styled transparent images keep native image, full border box, aspect fit and rotation centre',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-style-img-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));await fs.mkdir(path.join(root,'resources'));
  const bytes=await require('sharp')({create:{width:200,height:100,channels:4,background:'#1765d180'}}).png().toBuffer(),resource=hash(bytes)+'.png';await fs.writeFile(path.join(root,'resources',resource),bytes);
  const d=ppt.create(),asset={id:'image',kind:'image',resource};d.slides[0].elements=[ppt.element('image',{assetId:'image',x:100,y:120,w:300,h:300,rotation:30,effects:effects()})];
  const zip=await JSZip.loadAsync(await exportPresentation(d,[asset],root)),doc=new DOMParser().parseFromString(await zip.file('ppt/slides/slide1.xml').async('string'),'application/xml');
  assert.equal(doc.getElementsByTagName('p:pic').length,1);const transform=doc.getElementsByTagName('p:pic')[0].getElementsByTagName('a:xfrm')[0];assert.equal(transform.getElementsByTagName('a:off')[0].getAttribute('y'),'1143000');assert.equal(transform.getElementsByTagName('a:ext')[0].getAttribute('cy'),'2857500');assert.equal(transform.getAttribute('rot'),'1800000');
  const fit=doc.getElementsByTagName('a:fillRect')[0];assert.equal(fit.getAttribute('t'),'25000');assert.equal(fit.getAttribute('b'),'25000');assert.equal(fit.getAttribute('l'),'0');assert.equal(doc.getElementsByTagName('a:innerShdw').length,1);
});
