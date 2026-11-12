const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const R=require('../core/rich-text.cjs'),P=require('../core/presentations.cjs'),L=require('../core/layers.cjs'),{exportPresentation}=require('../core/presentation-export.cjs');
const runs=[{text:'普通'},{text:'重点',fontFamily:'Georgia',fontSize:56,fontWeight:700,color:'#c72446'},{text:'结尾'}];
const element=()=>P.element('text',{text:'普通重点结尾',fontFamily:'Arial',fontSize:32,textRuns:structuredClone(runs)});
test('rich runs validate their contents, numeric limits and font resource paths',()=>{
  const e=element();R.validateTextRuns(e,8,240,10000);
  for(const bad of [{textRuns:[{text:'wrong'}]},{textRuns:[{text:e.text,fontSize:Infinity}]},{textRuns:[{text:e.text,fontSize:241}]},{textRuns:[{text:e.text,color:'red;url(x)'}]},{textRuns:[{text:e.text,fontResource:{resource:'../../x.ttf',projectId:'p',jobId:'j'}}]},{textRuns:[{text:e.text,html:'<script>'}]}])assert.throws(()=>R.validateTextRuns({...e,...bad},8,240,10000));
  assert.throws(()=>R.validateTextRuns({...e,kind:'image'}));
  assert.equal(R.styledRuns(e)[0].fontSize,32);assert.equal(R.styledRuns(e)[1].fontSize,56);
});
test('plain content edits retain unaffected styles; whole-object styles replace overrides only for that property',()=>{
  const e=element(),changed=R.patchText(e,{text:'普通重点结尾加字'});R.validateTextRuns(changed);assert.equal(changed.textRuns[1].fontSize,56);
  const deleted=R.patchText(e,{text:'普通结尾'});R.validateTextRuns(deleted);assert.equal(deleted.textRuns.length,1);
  const color=R.patchText(e,{color:'#0000ff'});assert.ok(color.textRuns.every(r=>r.color===undefined));assert.equal(color.textRuns[1].fontFamily,'Georgia');
  const font=R.patchText(e,{fontFamily:'Arial'});assert.ok(font.textRuns.every(r=>r.fontFamily===undefined));assert.equal(font.textRuns[1].fontSize,56);
  const empty=R.patchText(e,{text:''});R.validateTextRuns(empty);assert.deepEqual(empty.textRuns,[]);
});
test('saved projects reopen exact rich runs and include nested custom font resources',async t=>{
  const {ProjectStore,resourcesIn}=require('../core/storage.cjs'),root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-rich-'));
  t.after(async()=>{assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(os.tmpdir()));assert.ok(path.basename(root).startsWith('tugou-rich-'));await fs.rm(root,{recursive:true,force:true});});
  const store=new ProjectStore(root);await store.init();const deck=P.create('选区测试');deck.slides[0].elements=[element()];
  const doc={name:'选区测试',width:1000,height:720,background:'#ffffff',assets:[],layers:[L.createLayer('text',{text:'普通重点结尾',textRuns:runs})],modules:[],recipes:[],jobs:[],presentations:[deck]};
  const created=await store.create(doc.name),saved=await store.save(created.id,{...doc,id:created.id},created.revision);const opened=await store.read(saved.id);assert.deepEqual(opened.document.presentations[0].slides[0].elements[0].textRuns,runs);assert.deepEqual(opened.document.layers[0].textRuns,runs);
  const resource='a'.repeat(64)+'.ttf';assert.ok(resourcesIn({textRuns:[{text:'字',fontResource:{resource,projectId:'p',jobId:'j'}}]}).has(resource));
});
test('PPTX exports editable runs with independent font, size, color and bold',async()=>{
  const deck=P.create('选区导出');deck.slides[0].elements=[element()];
  const zip=await require('jszip').loadAsync(await exportPresentation(deck,[],os.tmpdir())),xml=await zip.file('ppt/slides/slide1.xml').async('string');
  const {DOMParser}=require('@xmldom/xmldom'),doc=new DOMParser().parseFromString(xml,'text/xml'),out=Array.from(doc.getElementsByTagName('a:r'));
  assert.deepEqual(out.map(r=>r.getElementsByTagName('a:t')[0].textContent),runs.map(r=>r.text));
  const middle=out[1].getElementsByTagName('a:rPr')[0];assert.equal(middle.getAttribute('sz'),'4200');assert.equal(middle.getAttribute('b'),'1');assert.equal(out[1].getElementsByTagName('a:latin')[0].getAttribute('typeface'),'Georgia');assert.equal(out[1].getElementsByTagName('a:srgbClr')[0].getAttribute('val'),'C72446');
  assert.equal(out[0].getElementsByTagName('a:rPr')[0].getAttribute('sz'),'2400');
});
test('existing MCP updates and content application keep rich text coherent',()=>{
  const {batch}=require('../core/automation-commands.cjs'),C=require('../core/presentation-content.cjs'),deck=P.create('选区 API');deck.slides[0].elements=[element()];
  const layer=L.createLayer('text',{text:'普通重点结尾',fontFamily:'Arial',textRuns:runs}),doc={id:'p',name:'选区 API',width:800,height:600,assets:[],layers:[layer],modules:[],recipes:[],jobs:[],presentations:[deck]};
  const next=batch(doc,[{name:'p',command:'ppt.element.update',args:{presentationId:deck.id,slideId:deck.slides[0].id,id:deck.slides[0].elements[0].id,patch:{text:'普通重点结尾加字'}}},{name:'l',command:'layer.update',args:{id:layer.id,patch:{color:'#0000ff'}}}]).document;
  R.validateTextRuns(next.presentations[0].slides[0].elements[0]);assert.equal(next.presentations[0].slides[0].elements[0].textRuns[1].fontSize,56);assert.equal(next.layers[0].textRuns[1].fontSize,56);assert.equal(next.layers[0].textRuns[1].color,undefined);
  const s=deck.slides[0],content=C.contentOf(s),changed=C.setContent(s,{blocks:content.blocks.map(b=>({...b,text:b.text+'新增'}))});
  const applied=C.applyContent(changed,1280);R.validateTextRuns(applied.elements[0]);assert.equal(applied.elements[0].textRuns[1].fontSize,56);
});
