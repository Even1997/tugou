const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const ppt=require('../core/presentations.cjs'),{ProjectStore,hash}=require('../core/storage.cjs'),{exportPresentation}=require('../core/presentation-export.cjs'),JSZip=require('jszip');
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
