const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const pages=require('../core/pages.cjs'),{batch}=require('../core/automation-commands.cjs'),{ProjectStore,validateDocument}=require('../core/storage.cjs');
const {stageOutputs}=require('../core/generation-output.cjs'),{mergeResults}=require('../core/results.cjs');
const doc=()=>({name:'多页面',width:1024,height:1536,background:'#fff',modules:[],recipes:[],assets:[],layers:[],jobs:[]});
test('legacy project, independent pages, clone IDs and atomic validation',()=>{
  const old=doc();assert.equal(pages.list(old,'canvas')[0].id,'canvas-main');assert.equal(old.pages,undefined);
  let d=batch(old,[{name:'n',command:'canvas.create',args:{type:'text',position:{x:8,y:9},properties:{text:'第一页'}}}]).document;const node=d.tugouCanvas.nodes[0].id;
  const created=pages.create(d,'canvas','第二页');d=created.document;assert.equal(d.tugouCanvas.nodes.length,0);assert.equal(pages.content(d,'canvas','canvas-main').tugouCanvas.nodes[0].id,node);validateDocument(d);
  const copied=pages.duplicate(d,'canvas','canvas-main');assert.notEqual(copied.document.tugouCanvas.nodes[0].id,node);assert.equal(copied.document.tugouCanvas.nodes[0].data.text,'第一页');validateDocument(copied.document);
  d=pages.remove(copied.document,'canvas',copied.id);assert.equal(pages.list(d,'canvas').length,2);assert.throws(()=>pages.rename(d,'canvas',created.id,' '));
  const corrupt=structuredClone(d);corrupt.pages.canvas.items.push({...corrupt.pages.canvas.items[0]});assert.throws(()=>validateDocument(corrupt));
  assert.throws(()=>pages.remove(old,'layers','composition-main'));assert.throws(()=>batch(d,[{name:'bad',command:'page.rename',args:{kind:'canvas',id:created.id,name:' '}}]));
});
test('composition content and views survive switching and save/reopen',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-pages-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const store=new ProjectStore(root);await store.init();const record=await store.create('页面保存');
  let d=batch(record.document,[{name:'b',command:'artboard.create',args:{name:'海报',width:800,height:1200}},{name:'l',command:'layer.create',args:{kind:'text',artboardId:{$ref:'b.id'},properties:{text:'你好'}}}]).document;
  d.compositionView={x:31,y:42,zoom:.7};const first=structuredClone(d.layers),created=pages.create(d,'layers','邀请函');d=created.document;assert.equal(d.layers.length,0);assert.equal(d.width,1024);
  const copy=pages.duplicate(d,'layers','composition-main');assert.notEqual(copy.document.layers[0].id,first[0].id);assert.ok(copy.document.layers.some(l=>l.text==='你好'));validateDocument(copy.document);
  d=pages.activate(d,'layers','composition-main');assert.deepEqual(d.layers,first);assert.equal(d.compositionView.zoom,.7);
  const saved=await store.save(record.id,d,record.revision),opened=await store.read(saved.id);assert.deepEqual(opened.document,JSON.parse(JSON.stringify(d)));assert.equal(pages.list(opened.document,'layers').length,2);
});
test('background generation stays on its page and does not dirty idle pages',()=>{
  let d=batch(doc(),[{name:'n',command:'canvas.create',args:{type:'config',position:{x:0,y:0}}}]).document;const nodeId=d.tugouCanvas.nodes[0].id,created=pages.create(d,'canvas','另一页');d=created.document;
  assert.equal(stageOutputs(d,[]),d);const task={id:'task',status:'running',context:{kind:'workflow',nodeId,mode:'image',count:1,outputNodes:true}};d=stageOutputs(d,[task]);assert.equal(d.tugouCanvas.nodes.length,0);assert.equal(pages.content(d,'canvas','canvas-main').tugouCanvas.nodes.length,2);
  const result={id:'task',kind:'workflow',nodeId,mode:'image',assets:[{id:'task-0',name:'完成'}]};d=mergeResults(d,[result]);assert.equal(d.tugouCanvas.nodes.length,0);assert.equal(d.assets.length,1);assert.ok(pages.content(d,'canvas','canvas-main').tugouCanvas.nodes.some(n=>n.data.assetId==='task-0'));assert.equal(mergeResults(d,[result]),d);
  d=pages.remove(d,'canvas','canvas-main');const late=mergeResults(d,[{...result,id:'late',assets:[{id:'late-0'}]}]);assert.equal(late.tugouCanvas.nodes.length,0);assert.equal(late.assets.length,2);
});
test('undo focus finds edited page rather than last selected page; hidden-page resources stay in use',()=>{
  let original=pages.create(doc(),'canvas','B').document;original=pages.activate(original,'canvas','canvas-main');
  let edited=batch(original,[{name:'n',command:'canvas.create',args:{type:'text',position:{x:1,y:1},properties:{text:'changed'}}}]).document;
  edited=pages.activate(edited,'canvas',pages.list(edited,'canvas')[1].id);assert.deepEqual(pages.undoFocus(edited,original),{kind:'canvas',id:'canvas-main'});
  const a={id:'asset'};original.assets=[a];original=batch(original,[{name:'n',command:'canvas.create',args:{type:'asset',sourceId:a.id,position:{x:0,y:0}}}]).document;original=pages.activate(original,'canvas',pages.list(original,'canvas')[1].id);
  assert.throws(()=>batch(original,[{name:'del',command:'asset.delete',args:{ids:['asset']}}]),/引用/);
});
test('duplicate rewires groups, mention text and generation input references within the new page',()=>{
  let d=batch(doc(),[{name:'t',command:'canvas.create',args:{type:'text',position:{x:0,y:0}}},{name:'g',command:'canvas.create',args:{type:'config',position:{x:500,y:0}}},{name:'e',command:'canvas.connect',args:{source:{$ref:'t.id'},target:{$ref:'g.id'}}}]).document;
  const [text,desk]=d.tugouCanvas.nodes;desk.data.promptNodeId=text.id;desk.data.prompt='@[node:'+text.id+']';desk.data.inputOrder=[text.id];desk.data.inputRoles={[text.id]:'样式'};
  const copied=pages.duplicate(d,'canvas','canvas-main').document,[nt,ng]=copied.tugouCanvas.nodes;
  assert.equal(ng.data.promptNodeId,nt.id);assert.equal(ng.data.prompt,'@[node:'+nt.id+']');assert.equal(ng.data.inputOrder[0],nt.id);assert.equal(ng.data.inputRoles[nt.id],'样式');assert.equal(copied.tugouCanvas.edges[0].source,nt.id);
});
test('MCP rejects removing pages with running generation even inside a batch',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-pages-host-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let document=batch(doc(),[{name:'n',command:'canvas.create',args:{type:'config',position:{x:0,y:0}}}]).document;const nodeId=document.tugouCanvas.nodes[0].id;document=pages.create(document,'canvas','B').document;
  const dispatch=await require('../core/automation-host.cjs').createDispatcher({root,ui:async()=>({revision:'r1',projectId:'p',document}),projects:{verifyResources:async()=>{}},tasks:{list:()=>[{status:'running',context:{projectId:'p',nodeId}}]}});
  await assert.rejects(dispatch('batch',{expectedRevision:'r1',steps:[{name:'del',command:'page.delete',args:{kind:'canvas',id:'canvas-main'}}]}),e=>e.code==='BUSY');
});

test('lazy manifests read active pages only, reuse untouched page files, and recover the previous manifest',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-page-files-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new ProjectStore(root);await store.init();
  const record=await store.create();
  let document=record.document;
  const payload='一'.repeat(14000);
  for(let i=0;i<12;i++){
    document=pages.create(document,'canvas',`画布 ${i+2}`).document;
    document.tugouCanvas.nodes=Array.from({length:24},(_,n)=>({id:`node-${i}-${n}`,type:'text',position:{x:n*500,y:0},data:{name:`Node ${n}`,text:payload}}));
    document=pages.create(document,'layers',`图层页 ${i+2}`).document;
    document.layers=Array.from({length:24},(_,n)=>require('../core/layers.cjs').createLayer('text',{id:`layer-${i}-${n}`,x:n,text:payload}));
  }
  const file=await store.projectPath(record.id);
  await fs.writeFile(file,JSON.stringify({...record,document}));
  const measure=async run=>{
    const start=performance.now();
    const value=await run(),ms=Math.round(performance.now()-start),bytes=Buffer.byteLength(JSON.stringify(value.document));
    return {value,ms,bytes};
  };
  const embedded=await measure(()=>store.read(record.id));
  const first=await store.readEditor(record.id);
  assert.equal(first.version,2);
  assert.equal(JSON.parse(await fs.readFile(file+'.bak','utf8')).version,1);
  const reads=[],readPage=store.readPage.bind(store);store.readPage=(id,digest)=>{reads.push(digest);return readPage(id,digest);};
  const lazy=await measure(()=>store.readEditor(record.id));
  assert.equal(reads.length,2);
  assert.ok(lazy.bytes*8<embedded.bytes);
  assert.deepEqual(pages.list(lazy.value.document,'layers'),pages.list(document,'layers'));
  const inactive=pages.group(lazy.value.document,'canvas').items[1];
  assert.equal(pages.nodePage(lazy.value.document,'node-0-0'),inactive.id);
  assert.throws(()=>pages.content(lazy.value.document,'canvas',inactive.id),/尚未加载/);
  const start=performance.now(),body=await store.readPage(record.id,inactive.ref.hash),switchMs=Math.round(performance.now()-start);
  const opened=pages.activate(pages.storagePage(lazy.value.document,'canvas',inactive.id,{content:body}),'canvas',inactive.id);
  assert.equal(opened.tugouCanvas.nodes[0].data.text,payload);
  assert.equal(reads.length,3);
  opened.tugouCanvas={...opened.tugouCanvas,nodes:opened.tugouCanvas.nodes.slice(1)};
  const folder=path.dirname(await store.pagePath(record.id,inactive.ref.hash)),before=await fs.readdir(folder);
  const second=await store.save(record.id,opened,first.revision);
  assert.equal((await fs.readdir(folder)).length,before.length+1);
  assert.equal(reads.length,3);
  assert.equal((await store.read(record.id)).document.tugouCanvas.nodes.length,23);
  await fs.writeFile(await store.pagePath(record.id,second.pageRefs.canvas[inactive.id].hash),'corrupt');
  const recovered=await store.readEditor(record.id);
  assert.equal(recovered.revision,first.revision);
  assert.equal(recovered.recovered,true);
  const repaired=await store.save(record.id,recovered.document,recovered.revision);
  assert.equal((await store.readEditor(record.id)).revision,repaired.revision);
  t.diagnostic(`26 tabs, legacy open ${embedded.ms} ms/${embedded.bytes} bytes, indexed open ${lazy.ms} ms/${lazy.bytes} bytes, cold requested page ${switchMs} ms`);
});
