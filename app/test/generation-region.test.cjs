const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),sharp=require('sharp');
const {workflowNode,compileWorkflow}=require('../core/workflow-nodes.cjs');
const {createNode,compileNode}=require('../core/prompts.cjs');
const {ProjectStore,validateDocument}=require('../core/storage.cjs');
const {TaskQueue}=require('../core/tasks.cjs');
const {WorkflowService}=require('../core/workflow-service.cjs');
const {GenerationService,saveImage}=require('../core/generation.cjs');

function fixture(){
  const source={id:'source',type:'asset',position:{x:0,y:0},data:{assetId:'photo',role:'原图',localEdit:{assetId:'photo',maskId:'mask'}}};
  const other={id:'other',type:'asset',position:{x:0,y:0},data:{assetId:'other-photo',role:'风格'}},desk=workflowNode('config',{x:400,y:0});
  Object.assign(desk.data,{prompt:'修改帽子颜色',size:'2x2'});
  const assets=['photo','other-photo','mask'].map(id=>({id,width:2,height:2,kind:'image'}));
  const document={modules:[],assets,tugouCanvas:{version:1,nodes:[other,source,desk],edges:[other,source].map(n=>({id:n.id+'-edge',source:n.id,target:desk.id})),viewport:{x:0,y:0,zoom:1}}};
  return {document,source,other,desk};
}
test('masked reference leads API order; text and ordinary references remain unchanged',()=>{
  const {document,source,desk}=fixture(),before=JSON.stringify(document),c=compileWorkflow(document,desk.id);
  assert.deepEqual(c.references.map(r=>r.assetId),['photo','other-photo']);assert.equal(c.references[0].maskId,'mask');assert.match(c.prompt,/第一张参考图的蒙版区域/);assert.equal(JSON.stringify(document),before);
  desk.data.mode='text';assert.ok(compileWorkflow(document,desk.id).references.every(r=>!r.maskId));
  desk.data.mode='image';source.data.localEdit=null;assert.deepEqual(compileWorkflow(document,desk.id).references.map(r=>r.assetId),['other-photo','photo']);
});
test('changed source, missing or mismatched mask and multiple regions fail closed',()=>{
  const {document,source,other,desk}=fixture();
  source.data.assetId='other-photo';assert.throws(()=>compileWorkflow(document,desk.id),/原图已变化/);source.data.assetId='photo';
  source.data.localEdit.maskId='absent';assert.throws(()=>compileWorkflow(document,desk.id),/素材缺失/);source.data.localEdit.maskId='mask';
  document.assets[2].width=3;assert.throws(()=>compileWorkflow(document,desk.id),/尺寸/);document.assets[2].width=2;
  other.data.localEdit={assetId:'other-photo',maskId:'mask'};assert.throws(()=>compileWorkflow(document,desk.id),/只能连接一张/);
  document.tugouCanvas.edges=document.tugouCanvas.edges.filter(e=>e.source!==other.id);assert.equal(compileWorkflow(document,desk.id).references.length,1);
});
test('MCP can bind and clear a region; malformed bindings are rejected',()=>{
  const {validate,batch}=require('../core/automation-commands.cjs'),f=fixture();
  const document={...f.document,id:'project',name:'测试',width:2,height:2,recipes:[],layers:[],jobs:[]};
  const bind={id:f.source.id,properties:{localEdit:{assetId:'photo',maskId:'mask'}}};
  assert.doesNotThrow(()=>validate('canvas.update',bind));assert.throws(()=>validate('canvas.update',{...bind,properties:{localEdit:{maskId:'mask'}}}));
  const cleared=batch(document,[{name:'clear',command:'canvas.update',args:{id:f.source.id,properties:{localEdit:null}}}]).document;
  assert.equal(cleared.tugouCanvas.nodes.find(n=>n.id===f.source.id).data.localEdit,null);
  assert.equal(batch(cleared,[{name:'bind',command:'canvas.update',args:bind}]).document.tugouCanvas.nodes.find(n=>n.id===f.source.id).data.localEdit.maskId,'mask');
});
test('workflow failure retry and recipe generation retain real mask bytes and API semantics',async t=>{
  const out=path.resolve(__dirname,'../test-results/generation-region');await fs.mkdir(out,{recursive:true});
  const root=await fs.realpath(await fs.mkdtemp(path.join(out,'case-'))),projects=new ProjectStore(root);await projects.init();const record=await projects.create('局部生图');
  const tasks=new TaskQueue(root);await tasks.init();const inspect=()=>({width:2,height:2});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'#447799'}}).png().toBuffer();
  const maskBytes=await sharp(Buffer.from([255,255,255,255,255,255,255,0,255,255,255,0,255,255,255,0]),{raw:{width:2,height:2,channels:4}}).png().toBuffer();
  const f=fixture();f.document={...record.document,...f.document};
  for(const asset of f.document.assets)Object.assign(asset,await saveImage(root,asset.id==='mask'?maskBytes:png,inspect));
  validateDocument(f.document);const requests=[];let rejectNext=true;
  const server=http.createServer(async(req,res)=>{try{
    assert.ok(req.url.endsWith('/images/edits'));const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();
    requests.push({mask:Buffer.from(await form.get('mask').arrayBuffer()),images:form.getAll('image[]').length});
    if(rejectNext){rejectNext=false;res.writeHead(400);res.end('fixture rejection');return;}
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
  }catch(e){res.writeHead(500);res.end(e.message);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const connections={readPrivate:async()=>({baseUrl:`http://127.0.0.1:${server.address().port}`,apiKey:'fixture',model:'fixture-image'})};
  const service=new WorkflowService(projects,connections,tasks,inspect);
  const task=await service.start(record.id,f.document,f.desk.id);await tasks.execution;assert.equal(tasks.list().find(t=>t.id===task.id).status,'failed');
  // The live document can change; retry must use the saved region snapshot.
  f.source.data.localEdit=null;const retried=await service.retry(task.id);await tasks.execution;assert.equal(tasks.list().find(t=>t.id===retried.id).status,'completed');
  assert.deepEqual(requests[0].mask,requests[1].mask);assert.deepEqual([...(await sharp(requests[1].mask).extractChannel('alpha').raw().toBuffer())],[0,255,255,255]);assert.equal(requests[1].images,2);
  const saved=JSON.parse(await fs.readFile(path.join(root,'requests',retried.id+'.json'),'utf8'));assert.ok(saved.assets.some(a=>a.id==='mask'));assert.ok(!JSON.stringify(saved).includes('apiKey'));
  f.source.data.localEdit={assetId:'photo',maskId:'mask'};
  f.document.recipes=[{id:'recipe',name:'生图配方',moduleIds:[],moduleBindings:[],references:[],output:'修改帽子颜色',size:'2x2'}];
  const recipe=createNode(f.document,'recipe','recipe',{x:400,y:0});f.document.tugouCanvas.nodes.push(recipe);f.document.tugouCanvas.edges.push({id:'recipe-edge',source:f.source.id,target:recipe.id});
  assert.equal(compileNode(f.document,recipe.id).references[0].maskId,'mask');
  const legacy=new GenerationService(projects,connections,tasks,inspect),generated=await legacy.start(record.id,f.document,recipe.id);await tasks.execution;assert.equal(tasks.list().find(t=>t.id===generated.id).status,'completed');assert.deepEqual(requests[2].mask,requests[1].mask);
  const oldCount=requests.length,empty=await sharp({create:{width:2,height:2,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  Object.assign(f.document.assets.find(a=>a.id==='mask'),await saveImage(root,empty,inspect));
  await assert.rejects(service.start(record.id,f.document,f.desk.id),/没有可修改区域/);await assert.rejects(legacy.start(record.id,f.document,recipe.id),/没有可修改区域/);assert.equal(requests.length,oldCount);
});
