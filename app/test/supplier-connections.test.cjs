const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {ConnectionStore}=require('../core/connection.cjs');
const {reconcile}=require('../core/connection-state.cjs');
const encryption={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-suppliers-'));t.after(async()=>{const resolved=await fs.realpath(root);if(path.dirname(resolved)!==await fs.realpath(os.tmpdir())||!path.basename(resolved).startsWith('tugou-suppliers-'))throw Error('unsafe cleanup');await fs.rm(resolved,{recursive:true,force:true});});return {root,store:new ConnectionStore(root,encryption)};}
const fields={image:'model',analysis:'analysisModel',text:'textModel',video:'videoModel',audio:'audioModel'};
function profile(id,apiKey,baseUrl='https://example.com/v1',endpointId='endpoint-a'){
 const values={model:`image-${id}`,analysisModel:`vision-${id}`,textModel:`text-${id}`,videoModel:`video-${id}`,audioModel:`audio-${id}`};
 return {id,name:id,providerId:`provider-${endpointId}`,endpointId,baseUrl,apiKey,...values,models:Object.entries(fields).map(([purpose,field])=>({id:values[field],purposes:[purpose]}))};
}
async function setup(store,a=profile('a','key-a'),b=profile('b','key-b')){
 const providers=[...new Map([a,b].map(c=>[c.providerId,{id:c.providerId,name:c.providerId,endpoints:[{id:c.endpointId,name:'API',baseUrl:c.baseUrl}]}])).values()];
 return store.saveManager({revision:0,activeId:null,providers,connections:[a,b],routes:{image:'a',analysis:'b',text:'b',video:'b',audio:'a'}});
}
test('supplier projection is read-only and preserves existing per-purpose routing and encrypted Keys',async t=>{
 const {store,root}=await fixture(t);await store.save({id:'a'.repeat(80),baseUrl:'https://example.com/v1',apiKey:'old-secret',model:'old-image',analysisModel:'old-vision'});const file=path.join(root,'connection.enc'),before=await fs.readFile(file);
 const view=await store.listSuppliers();assert.deepEqual(await fs.readFile(file),before);assert.equal(view.activeId,null);assert.equal(view.connections[0].models.length,2);assert.equal(view.routes.text,'a'.repeat(80));assert.ok(!JSON.stringify(view).includes('old-secret'));
 await store.saveManager(view);assert.equal((await store.readPrivate('text')).textModel,'old-vision');assert.equal((await store.readPrivate('image')).apiKey,'old-secret');assert.deepEqual((await store.listSuppliers()).providers,view.providers);
});
test('same supplier URL has isolated Keys and model catalogs, saved blanks preserve exact credentials',async t=>{
 const {store}=await fixture(t);let m=await setup(store);m.connections.forEach(c=>c.apiKey='');await store.saveManager(m);
 assert.equal((await store.readPrivate('image')).apiKey,'key-a');assert.equal((await store.readPrivate('analysis')).apiKey,'key-b');assert.notDeepEqual((await store.listSuppliers()).connections[0].models,(await store.listSuppliers()).connections[1].models);
 await assert.rejects(store.probe({id:'new',baseUrl:m.connections[0].baseUrl}),/密钥/);
 m=await store.listSuppliers();m.connections[1].apiKey='replacement';await store.saveManager(m);assert.equal((await store.readPrivate('image')).apiKey,'key-a');assert.equal((await store.readPrivate('analysis')).apiKey,'replacement');assert.ok(!JSON.stringify(await store.listSuppliers()).includes('replacement'));
});
test('invalid supplier membership, URL, model capability and default references reject without writing',async t=>{
 const {store,root}=await fixture(t);await setup(store);const file=path.join(root,'connection.enc'),before=await fs.readFile(file);
 const changes=[m=>m.connections[0].providerId='missing',m=>m.connections[0].endpointId='missing',m=>m.connections[0].baseUrl='https://other.example/v1',m=>m.providers.push(m.providers[0]),m=>m.providers[0].endpoints.push(m.providers[0].endpoints[0]),m=>m.connections[0].models.push(m.connections[0].models[0]),m=>m.connections[0].models[0].purposes=['bogus'],m=>m.connections[0].models[0].purposes=['analysis'],m=>m.connections[0].model='unselected',m=>m.connections[0].clearKey=true,m=>m.activeId='a'];
 for(const change of changes){const m=await store.listSuppliers();change(m);await assert.rejects(store.saveManager(m));assert.deepEqual(await fs.readFile(file),before);}
});
test('removing Key/model or changing purpose clears only impacted routes, no implicit fallback',async t=>{
 const {store}=await fixture(t);const original=await setup(store);
 let m=reconcile({...original,connections:original.connections.map(c=>c.id==='b'?{...c,models:c.models.filter(m=>m.id!=='vision-b')}:c)});assert.equal(m.routes.analysis,null);assert.equal(m.routes.image,'a');assert.equal(m.routes.text,'b');await store.saveManager(m);assert.equal((await store.readPrivate('analysis')).apiKey,'');
 m=await store.listSuppliers();m=reconcile({...m,connections:m.connections.filter(c=>c.id!=='a')});await store.saveManager(m);assert.equal((await store.readPrivate('image')).apiKey,'');assert.equal((await store.readPrivate('text')).apiKey,'key-b');
 m=await store.listSuppliers();m.connections=[];m.providers=[];await store.saveManager(reconcile(m));assert.equal((await store.listSuppliers()).connections.length,0);
});
test('stale supplier editor cannot overwrite a newer Key configuration',async t=>{
 const {store}=await fixture(t);const stale=await setup(store);const newer=structuredClone(stale);newer.connections[1].apiKey='new-secret';await store.saveManager(newer);await assert.rejects(store.saveManager(stale),/配置已变化/);assert.equal((await store.readPrivate('analysis')).apiKey,'new-secret');
});
test('one supplier accepts many Keys but rejects zero or multiple URLs atomically',async t=>{
 const {store,root}=await fixture(t);await setup(store);const file=path.join(root,'connection.enc'),before=await fs.readFile(file);
 for(const endpoints of [[],[{id:'endpoint-a',name:'API',baseUrl:'https://example.com/v1'},{id:'endpoint-other',name:'Other',baseUrl:'https://other.example/v1'}]]){
   const m=await store.listSuppliers();m.providers[0].endpoints=endpoints;await assert.rejects(store.saveManager(m),/只能配置一个 URL/);assert.deepEqual(await fs.readFile(file),before);
 }
 assert.equal((await store.listSuppliers()).connections.length,2);
});
test('model catalogs accept 5000 bounded entries and strip extraneous model fields',async t=>{
 const {store}=await fixture(t);const m=await setup(store);m.connections[0].models.push(...Array.from({length:5000},(_,i)=>({id:`catalog-${i}`,purposes:['image'],apiKey:'must-not-persist'})));await store.saveManager(m);const saved=await store.listSuppliers();assert.equal(saved.connections[0].models.length,5005);assert.ok(!JSON.stringify(saved).includes('must-not-persist'));
});
test('grouped supplier workflow image/text/video/audio and vision requests reach their assigned URL with matching Key and model',async t=>{
 const {root,store}=await fixture(t),requests=[];const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
 const media=require('./workflow-fixtures.cjs');
 async function provider(name){const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):{};requests.push({provider:name,url:req.url,auth:req.headers.authorization,body});
  if(req.url.endsWith('/models'))return res.end(JSON.stringify({data:[{id:`model-${name}`}]}));
  if(req.url.endsWith('/images/generations'))return res.end(JSON.stringify({data:[{b64_json:png}]}));
  if(req.url.endsWith('/audio/speech'))return res.end(media.audio);
  if(req.url.endsWith('/videos'))return res.end(JSON.stringify({id:'video',status:'completed'}));
  if(req.url.endsWith('/content'))return res.end(media.video);
  res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:body.model.startsWith('vision')?JSON.stringify({summary:'参考图片',modules:[{name:'画风',kind:'style',text:'简洁图形'}]}):'文字结果'}}]}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});return `http://127.0.0.1:${server.address().port}/v1`;}
 const a=await provider('a'),b=await provider('b');await setup(store,profile('a','key-a',a),profile('b','key-b',b,'endpoint-b'));
 for(const id of ['a','b']){assert.equal((await store.probe({id},true)).models[0],`model-${id}`);assert.equal(requests.at(-1).auth,`Bearer key-${id}`);}
 const {ProjectStore}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs'),{WorkflowService}=require('../core/workflow-service.cjs'),{workflowNode}=require('../core/workflow-nodes.cjs');
 const projects=new ProjectStore(root);await projects.init();const record=await projects.create('路由验收'),tasks=new TaskQueue(root);await tasks.init();t.after(()=>tasks.shutdown());
 const service=new WorkflowService(projects,store,tasks,()=>({width:1,height:1}));
 for(const [type,route,provider,model] of [['image','/images/generations','a','image-a'],['textgen','/chat/completions','b','text-b'],['video','/videos','b','video-b'],['audio','/audio/speech','a','audio-a']]){
  const node=workflowNode(type,{x:0,y:0});node.data.prompt='测试';if(type==='audio')node.data.format='wav';
  const doc={...record.document,tugouCanvas:{version:1,nodes:[node],edges:[],viewport:{x:0,y:0,zoom:1}}};const task=await service.start(record.id,doc,node.id);await tasks.execution;
  assert.equal(tasks.list().find(t=>t.id===task.id).status,'completed');const request=requests.filter(r=>r.url.endsWith(route)).at(-1);assert.equal(request.provider,provider);assert.equal(request.auth,`Bearer key-${provider}`);assert.equal(request.body.model,model);
 }
 const {AnalysisService}=require('../core/analysis.cjs'),analysis=new AnalysisService(projects,store,tasks);const doc={...record.document,assets:[{id:'source',name:'图',dataUrl:`data:image/png;base64,${png}`} ]};const task=await analysis.start(record.id,doc,'source');await tasks.execution;assert.equal(tasks.list().find(t=>t.id===task.id).status,'completed');const last=requests.at(-1);assert.equal(last.provider,'b');assert.equal(last.auth,'Bearer key-b');assert.equal(last.body.model,'vision-b');
 const snapshot=await fs.readFile(path.join(root,'tasks.json'),'utf8');assert.ok(!snapshot.includes('key-a')&&!snapshot.includes('key-b'));
});

