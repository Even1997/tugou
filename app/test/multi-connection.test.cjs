const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {ConnectionStore}=require('../core/connection.cjs');
const encryption={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-multi-key-'));t.after(async()=>{const resolved=await fs.realpath(root);if(path.dirname(resolved)!==await fs.realpath(os.tmpdir())||!path.basename(resolved).startsWith('tugou-multi-key-'))throw Error('unsafe cleanup');await fs.rm(resolved,{recursive:true,force:true});});return {root,store:new ConnectionStore(root,encryption)};}
const profile=(id,apiKey,baseUrl='https://example.com/v1')=>({id,name:id,baseUrl,apiKey,model:`image-${id}`,analysisModel:`vision-${id}`,textModel:`text-${id}`,videoModel:`video-${id}`,audioModel:`audio-${id}`});
async function setup(store,a=profile('a','key-a'),b=profile('b','key-b')){return store.saveManager({revision:0,activeId:'a',connections:[a,b],routes:{image:'a',analysis:'b',text:'b',video:'b',audio:'a'}});}

test('existing single encrypted connection is preserved and moved into named management only on save',async t=>{
 const {root,store}=await fixture(t),file=path.join(root,'connection.enc'),original=Buffer.from(JSON.stringify({baseUrl:'https://example.com/v1',apiKey:'original-secret',model:'old-image'}));await fs.writeFile(file,original);
 const manager=await store.list();assert.equal(manager.connections[0].name,'原有连接');assert.equal(manager.connections[0].hasKey,true);assert.equal(manager.connections[0].apiKey,undefined);assert.deepEqual(await fs.readFile(file),original);
 manager.connections.push(profile('second','second-secret'));manager.routes.analysis='second';await store.saveManager(manager);
 assert.equal((await store.readPrivate('image')).apiKey,'original-secret');assert.equal((await store.readPrivate('analysis')).apiKey,'second-secret');
});
test('purpose routing and public defaults choose correct profiles without exposing any key',async t=>{
 const {store}=await fixture(t);await setup(store);
 for(const [purpose,id] of Object.entries({image:'a',analysis:'b',text:'b'}))assert.equal((await store.readPrivate(purpose)).apiKey,`key-${id}`);
 const publicSettings=await store.publicSettings();assert.equal(publicSettings.model,'image-a');assert.equal(publicSettings.analysisModel,'vision-b');assert.equal(publicSettings.textModel,'text-b');assert.equal(JSON.stringify(await store.list()).includes('key-'),false);
});
test('blank edits keep only their own Key; new connections cannot borrow an existing Key even at the same URL',async t=>{
 const {store}=await fixture(t);const manager=await setup(store);manager.connections[0].apiKey='';manager.connections[1].apiKey='';manager.connections.push(profile('new',''));
 await store.saveManager(manager);assert.equal((await store.readPrivate('analysis')).apiKey,'key-b');assert.equal((await store.readPrivate('image')).apiKey,'key-a');
 await assert.rejects(store.probe({id:'new',baseUrl:'https://example.com',apiKey:''}),/密钥/);await assert.rejects(store.probe({id:'unsaved',baseUrl:'https://example.com',apiKey:''}),/密钥/);
 const next=await store.list();next.connections[1].clearKey=true;await store.saveManager(next);assert.equal((await store.readPrivate('analysis')).apiKey,'');assert.equal((await store.readPrivate('image')).apiKey,'key-a');
});
test('invalid routing, duplicate IDs and stale editor revisions reject atomically',async t=>{
 const {store,root}=await fixture(t);await setup(store);const before=await fs.readFile(path.join(root,'connection.enc'));
 for(const edit of [m=>{m.routes.image='missing';},m=>{m.connections[1].id='a';},m=>{m.activeId='missing';},m=>{m.connections[0].name='';}]){const m=await store.list();edit(m);await assert.rejects(store.saveManager(m));assert.deepEqual(await fs.readFile(path.join(root,'connection.enc')),before);}
 const stale=await store.list();await store.save({model:'newer'});await assert.rejects(store.saveManager(stale),/配置已变化/);assert.equal((await store.readPrivate('image')).model,'newer');
});
test('deleting profiles removes keys; no default means unassigned purposes remain unconfigured',async t=>{
 const {store}=await fixture(t);const m=await setup(store);m.connections=m.connections.filter(c=>c.id==='b');m.activeId=null;m.routes={analysis:'b'};await store.saveManager(m);
 assert.equal((await store.readPrivate('image')).apiKey,'');assert.equal((await store.readPrivate('analysis')).apiKey,'key-b');
 const empty=await store.list();empty.connections=[];empty.routes={};await store.saveManager(empty);assert.equal((await store.list()).connections.length,0);assert.equal((await store.readPrivate()).apiKey,'');
});
test('actual workflow image/text and vision requests reach their assigned URL with matching Key and model',async t=>{
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
 const a=await provider('a'),b=await provider('b');await setup(store,profile('a','key-a',a),profile('b','key-b',b));
 for(const id of ['a','b']){assert.equal((await store.probe({id},true)).models[0],`model-${id}`);assert.equal(requests.at(-1).auth,`Bearer key-${id}`);}
 const {ProjectStore}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs'),{WorkflowService}=require('../core/workflow-service.cjs'),{workflowNode}=require('../core/workflow-nodes.cjs');
 const projects=new ProjectStore(root);await projects.init();const record=await projects.create('路由验收'),tasks=new TaskQueue(root);await tasks.init();t.after(()=>tasks.shutdown());
 const service=new WorkflowService(projects,store,tasks,()=>({width:1,height:1}));
 for(const [type,route,provider,model] of [['image','/images/generations','a','image-a'],['textgen','/chat/completions','b','text-b']]){
  const node=workflowNode(type,{x:0,y:0});node.data.prompt='测试';
  const doc={...record.document,tugouCanvas:{version:1,nodes:[node],edges:[],viewport:{x:0,y:0,zoom:1}}};const task=await service.start(record.id,doc,node.id);await tasks.execution;
  assert.equal(tasks.list().find(t=>t.id===task.id).status,'completed');const request=requests.filter(r=>r.url.endsWith(route)).at(-1);assert.equal(request.provider,provider);assert.equal(request.auth,`Bearer key-${provider}`);assert.equal(request.body.model,model);
 }
 const {AnalysisService}=require('../core/analysis.cjs'),analysis=new AnalysisService(projects,store,tasks);const doc={...record.document,assets:[{id:'source',name:'图',dataUrl:`data:image/png;base64,${png}`} ]};const task=await analysis.start(record.id,doc,'source');await tasks.execution;assert.equal(tasks.list().find(t=>t.id===task.id).status,'completed');const last=requests.at(-1);assert.equal(last.provider,'b');assert.equal(last.auth,'Bearer key-b');assert.equal(last.body.model,'vision-b');
 const snapshot=await fs.readFile(path.join(root,'tasks.json'),'utf8');assert.ok(!snapshot.includes('key-a')&&!snapshot.includes('key-b'));
});
