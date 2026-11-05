const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {ProjectStore,validateDocument}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs'),{ImageTaskService}=require('../core/image-tasks.cjs');
const {saveImage,referenceBytes,GenerationService}=require('../core/generation.cjs'),{applyResults,mergeResults}=require('../core/results.cjs');
const {createTool,compileTool,toolOutput}=require('../core/canvas-tools.cjs'),{createNode,canConnect,compileNode,emptyCanvas}=require('../core/prompts.cjs'),{compileWorkflow}=require('../core/workflow-nodes.cjs');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-canvas-tool-')),projects=new ProjectStore(root);await projects.init();
  const tasks=new TaskQueue(root);await tasks.init();const record=await projects.create('工具节点测试');
  const inspect=bytes=>({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}),bytes=await sharp({create:{width:8,height:6,channels:4,background:'#6498ab'}}).png().toBuffer();
  const asset={id:'original',name:'原图',...await saveImage(root,bytes,inspect)},image=createNode({...record.document,assets:[asset]},'asset',asset.id,{x:0,y:0});
  const up=createTool('upscale',{x:400,y:0}),cut=createTool('cutout',{x:800,y:0}),gen=createNode(record.document,'config',undefined,{x:1200,y:0});gen.data.prompt='基于处理结果生成';
  const document={...record.document,assets:[asset],tugouCanvas:{...emptyCanvas(),nodes:[image,up,cut,gen],edges:[{id:'a',source:image.id,target:up.id},{id:'b',source:up.id,target:cut.id},{id:'c',source:cut.id,target:gen.id}]}};
  const local={resolveRuntime:async()=>({folder:root,cutoutFolder:root,provider:'CPUExecutionProvider'}),execute:async(job,runtime,signal,id,part,progress)=>{
    signal.throwIfAborted();progress(50,'处理中');const input=job.inputs[0],scale=job.settings.operation==='upscale'?job.settings.scale:1;
    const output=await sharp(await referenceBytes(root,input)).resize(input.width*scale,input.height*scale).png().toBuffer();
    await part({inputIndex:0,index:0,count:1,bytes:output});
  }};
  const service=new ImageTaskService(projects,tasks,inspect,null,local),generation=new GenerationService(projects,null,tasks,inspect);
  t.after(async()=>{await tasks.shutdown();await tasks.execution;await fs.rm(root,{recursive:true,force:true});});
  const run=async(doc,nodeId)=>{await service.startNode(record.id,doc,nodeId);await tasks.execution;const result=(await generation.results(record.id)).at(-1);assert.equal(tasks.list().at(-1).status,'completed');return result;};
  return {root,projects,tasks,record,document,asset,image,up,cut,gen,local,service,generation,run};
}

test('tool links accept one image input, reject text/duplicate input/cycles and block missing upstream output',async t=>{
  const f=await fixture(t),graph={...f.document.tugouCanvas,edges:[]};
  assert.ok(canConnect(graph,f.image.id,f.up.id));assert.ok(canConnect(graph,f.up.id,f.cut.id));assert.ok(canConnect(graph,f.cut.id,f.gen.id));
  const text=createNode(f.document,'text',undefined,{x:0,y:0});graph.nodes.push(text);assert.equal(canConnect(graph,text.id,f.up.id),false);
  graph.edges=[{id:'x',source:f.up.id,target:f.cut.id}];assert.equal(canConnect(graph,f.image.id,f.cut.id),false);assert.equal(canConnect(graph,f.cut.id,f.up.id),false);
  assert.throws(()=>compileTool(f.document,f.cut.id),/尚无当前结果/);assert.throws(()=>compileWorkflow(f.document,f.gen.id),/尚无当前结果/);
  validateDocument(f.document);const invalid=structuredClone(f.document);invalid.tugouCanvas.nodes.find(n=>n.id===f.up.id).data.parameters.scale=20;assert.throws(()=>validateDocument(invalid),/超分/);
});

test('image to upscale to cutout to generation transmits only processed output and persists parameters/results',async t=>{
  const f=await fixture(t),original=structuredClone(f.document);
  const first=await f.run(f.document,f.up.id),upDoc=applyResults(f.document,{past:[],future:[]},[first]).document;
  const second=await f.run(upDoc,f.cut.id),final=applyResults(upDoc,{past:[],future:[]},[second]).document;
  assert.equal(final.assets.length,3);assert.deepEqual(final.assets[0],original.assets[0]);assert.deepEqual(f.document,original);
  const compiled=compileWorkflow(final,f.gen.id);assert.deepEqual(compiled.references.map(r=>r.assetId),[second.assets[0].id]);
  assert.equal(second.assets[0].toolResult.sourceId,first.assets[0].id);assert.equal(first.assets[0].width,32);assert.equal(second.assets[0].width,32);
  assert.equal(final.tugouCanvas.nodes.length,6);assert.equal(final.tugouCanvas.edges.length,5);assert.equal(toolOutput(final,final.tugouCanvas.nodes.find(n=>n.id===f.cut.id)).id,second.assets[0].id);
  const saved=await f.projects.save(f.record.id,final,f.record.revision),reopened=await f.projects.read(saved.id);assert.deepEqual(reopened.document.tugouCanvas,final.tugouCanvas);
  const recipe={id:'r',type:'recipe',data:{snapshot:{moduleBindings:[],references:[],output:'使用抠图',size:'auto'}},position:{x:1600,y:0}};
  final.tugouCanvas.nodes.push(recipe);final.tugouCanvas.edges.push({id:'recipe-edge',source:f.cut.id,target:'r'});assert.deepEqual(compileNode(final,'r').references.map(r=>r.assetId),[second.assets[0].id]);
});

test('changing upstream settings invalidates all downstream output until reprocessed',async t=>{
  const f=await fixture(t);let doc=mergeResults(f.document,[await f.run(f.document,f.up.id)]);doc=mergeResults(doc,[await f.run(doc,f.cut.id)]);
  doc.tugouCanvas.nodes.find(n=>n.id===f.up.id).data.parameters={model:'anime',scale:2};
  assert.throws(()=>compileWorkflow(doc,f.gen.id),/重新处理/);assert.throws(()=>compileTool(doc,f.cut.id),/重新处理/);
  doc=mergeResults(doc,[await f.run(doc,f.up.id)]);assert.equal(compileTool(doc,f.cut.id).asset.width,16);assert.throws(()=>compileWorkflow(doc,f.gen.id),/重新处理/);
  doc=mergeResults(doc,[await f.run(doc,f.cut.id)]);assert.equal(compileWorkflow(doc,f.gen.id).references[0].assetId,doc.assets.at(-1).id);
});

test('tool completion is undoable once, receipts prevent replay, and edits made during processing survive',async t=>{
  const f=await fixture(t),result=await f.run(f.document,f.up.id),changed=structuredClone(f.document);
  changed.tugouCanvas.nodes.find(n=>n.id===f.up.id).data.parameters={model:'anime',scale:2};
  const applied=applyResults(changed,{past:[f.document],future:[]},[result]);
  assert.equal(applied.history.past.length,2);assert.equal(applied.document.tugouCanvas.nodes.find(n=>n.id===f.up.id).data.parameters.scale,2);
  assert.throws(()=>toolOutput(applied.document,applied.document.tugouCanvas.nodes.find(n=>n.id===f.up.id)),/重新处理/);
  const undo=applied.history.past.at(-1);assert.equal(undo.assets.length,1);assert.equal(undo.tugouCanvas.nodes.find(n=>n.id===f.up.id).data.outputAssetId,undefined);
  assert.deepEqual(applyResults(undo,{past:[],future:[]},[result]).document,undo);
  const deleted=structuredClone(f.document);deleted.tugouCanvas.nodes=deleted.tugouCanvas.nodes.filter(n=>n.id!==f.up.id);deleted.tugouCanvas.edges=[];
  const received=mergeResults(deleted,[result]);assert.equal(received.assets.length,2);assert.ok(!received.tugouCanvas.nodes.some(n=>n.id===f.up.id));
});

test('missing runtime fails before task submission; cancellation and failure publish nothing; retry keeps the tool snapshot',async t=>{
  const f=await fixture(t),resolve=f.local.resolveRuntime,execute=f.local.execute;
  f.local.resolveRuntime=async()=>{throw Error('请下载工具');};await assert.rejects(f.service.startNode(f.record.id,f.document,f.up.id),/下载/);assert.equal(f.tasks.list().length,0);f.local.resolveRuntime=resolve;
  f.local.execute=async()=>{throw Error('本地模型失败');};const failed=await f.service.startNode(f.record.id,f.document,f.up.id);await f.tasks.execution;assert.equal(f.tasks.list().at(-1).status,'failed');assert.deepEqual(await f.generation.results(f.record.id),[]);
  f.local.execute=execute;await f.service.retry(failed.id);await f.tasks.execution;assert.equal((await f.generation.results(f.record.id))[0].nodeId,f.up.id);
  f.local.execute=async(job,runtime,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(signal.reason);signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  const cancelled=await f.service.startNode(f.record.id,f.document,f.up.id);await assert.rejects(f.service.startNode(f.record.id,f.document,f.up.id),/正在处理/);await f.tasks.cancel(cancelled.id);await f.tasks.execution;
  assert.equal(f.tasks.list().at(-1).status,'cancelled');assert.equal((await f.generation.results(f.record.id)).length,1);
});

test('completion updates its original canvas after switching pages without creating duplicate nodes',async t=>{
  const f=await fixture(t),pages=require('../core/pages.cjs'),result=await f.run(f.document,f.up.id);
  const original=pages.group(f.document,'canvas').activeId,created=pages.create(f.document,'canvas','另一页');
  const elsewhere=pages.activate(created.document,'canvas',created.id);
  const merged=applyResults(elsewhere,{past:[],future:[]},[result]).document;
  assert.equal(pages.group(merged,'canvas').activeId,created.id);assert.equal(merged.tugouCanvas.nodes.length,0);
  const restored=pages.activate(merged,'canvas',original);assert.equal(restored.tugouCanvas.nodes.find(n=>n.id===f.up.id).data.outputAssetId,result.assets[0].id);
  assert.equal(restored.tugouCanvas.nodes.length,5);assert.equal(restored.assets.length,2);validateDocument(restored);
});

test('tool outputs are separate right-side snapshots, fan out to tools and survive reruns without relinking',async t=>{
  const f=await fixture(t),first=await f.run(f.document,f.up.id);
  let doc=applyResults(f.document,{past:[],future:[]},[first]).document;
  const output=doc.tugouCanvas.nodes.find(n=>n.id===`result-${first.assets[0].id}`);
  assert.equal(output.type,'asset');assert.equal(output.data.role,'处理结果');assert.ok(output.position.x>f.up.position.x+320);
  assert.ok(doc.tugouCanvas.edges.some(e=>e.source===f.up.id&&e.target===output.id));
  const branch=createTool('upscale',{x:1600,y:0});doc.tugouCanvas.nodes.push(branch);
  doc.tugouCanvas.edges=doc.tugouCanvas.edges.filter(e=>e.target!==f.cut.id);
  for(const target of [f.cut.id,branch.id]){
    assert.ok(canConnect(doc.tugouCanvas,output.id,target));doc.tugouCanvas.edges.push({id:target,source:output.id,target});
    assert.equal(compileTool(doc,target).asset.id,first.assets[0].id);
  }
  assert.equal(canConnect(doc.tugouCanvas,output.id,f.up.id),false);
  doc.tugouCanvas.nodes.find(n=>n.id===f.up.id).data.parameters={model:'anime',scale:2};
  assert.equal(compileTool(doc,f.cut.id).asset.id,first.assets[0].id);
  const second=await f.run(doc,f.up.id),applied=applyResults(doc,{past:[],future:[]},[second]);
  const outputs=applied.document.tugouCanvas.nodes.filter(n=>n.type==='asset'&&n.data.role==='处理结果');
  assert.equal(outputs.length,2);assert.notDeepEqual(outputs[0].position,outputs[1].position);
  assert.equal(compileTool(applied.document,branch.id).asset.id,first.assets[0].id);
  assert.deepEqual(applied.document.tugouCanvas.edges.filter(e=>e.source===output.id),doc.tugouCanvas.edges.filter(e=>e.source===output.id));
  assert.deepEqual(mergeResults(applied.document,[first,second]),applied.document);
  assert.deepEqual(applied.history.past[0].tugouCanvas,doc.tugouCanvas);
  const saved=await f.projects.save(f.record.id,applied.document,f.record.revision);assert.deepEqual((await f.projects.read(saved.id)).document.tugouCanvas,applied.document.tugouCanvas);
});
