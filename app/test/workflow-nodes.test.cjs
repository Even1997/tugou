const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {workflowNode,compileWorkflow,canLink}=require('../core/workflow-nodes.cjs');
const {groupNodes,ungroupNodes}=require('../core/canvas-groups.cjs');
const {ProjectStore}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs'),{WorkflowService}=require('../core/workflow-service.cjs');
const {mergeResults}=require('../core/results.cjs'),{saveMedia,mediaResponse}=require('../core/media.cjs'),{encode}=require('../core/cloud-pixels.cjs');
const root=path.resolve(__dirname,'../test-results/workflow-nodes');
require('./workflow-fixtures.cjs').write(root);
const base=()=>({modules:[],assets:[],tugouCanvas:{nodes:[],edges:[]}});
test('generation desk assembles ancestors once, with pending prompts and existing results',()=>{
  const d=base(),desk=workflowNode('config',{x:0,y:0}),middle=workflowNode('textgen',{x:0,y:0});
  const text={id:'words',type:'text',data:{text:'人物五官'}},mod={id:'style',type:'module',data:{binding:{moduleId:'style',snapshot:{text:'柔和手绘'}}}},ref={id:'reference',type:'asset',data:{assetId:'photo',role:'人物身份'}};
  middle.data.prompt='完整全身';desk.data.prompt='保留留白';d.assets=[{id:'photo',kind:'image'}];d.modules=[{id:'style',global:true,text:'柔和手绘',name:'画风'}];
  d.tugouCanvas.nodes=[desk,middle,text,mod,ref];d.tugouCanvas.edges=[{source:text.id,target:middle.id},{source:mod.id,target:middle.id},{source:ref.id,target:middle.id},{source:middle.id,target:desk.id},{source:mod.id,target:desk.id}];
  const original=JSON.stringify(d);let result=compileWorkflow(d,desk.id);
  assert.match(result.prompt,/人物五官\n\n柔和手绘\n\n完整全身\n\n保留留白/);assert.equal(result.prompt.split('柔和手绘').length,2);
  assert.deepEqual(result.references,[{assetId:'photo',nodeId:'reference',kind:'image',role:'人物身份'}]);assert.equal(JSON.stringify(d),original);
  middle.data.resultText='生成后的全身描述';result=compileWorkflow(d,desk.id);assert.match(result.prompt,/生成后的全身描述/);assert.doesNotMatch(result.prompt,/完整全身/);
  desk.data.excludeUpstreamText=true;desk.data.prompt='强调 @[node:words]';result=compileWorkflow(d,desk.id);assert.equal(result.prompt.split('人物五官').length,2);assert.match(result.prompt,/柔和手绘/);
  text.data.text='新的五官';assert.match(compileWorkflow(d,desk.id).prompt,/新的五官/);
  d.tugouCanvas.edges=d.tugouCanvas.edges.filter(e=>e.source!==ref.id);assert.equal(compileWorkflow(d,desk.id).references.length,0);
});
test('generation desk keeps input order and rejects cycles missing assets and incompatible media',()=>{
  const d=base(),desk=workflowNode('config',{x:0,y:0}),a={id:'a',type:'text',data:{text:'动作'}},b={id:'b',type:'text',data:{text:'服装'}};
  d.tugouCanvas.nodes=[desk,a,b];d.tugouCanvas.edges=[{source:a.id,target:desk.id},{source:b.id,target:desk.id}];desk.data.inputOrder=['b','a'];assert.equal(compileWorkflow(d,desk.id).prompt,'服装\n\n动作');
  const ref={id:'ref',type:'asset',data:{assetId:'missing'}};d.tugouCanvas.nodes.push(ref);d.tugouCanvas.edges.push({source:ref.id,target:desk.id});assert.throws(()=>compileWorkflow(d,desk.id),/尚无可用结果/);
  d.assets=[{id:'missing',kind:'audio'}];assert.throws(()=>compileWorkflow(d,desk.id),/只接受图片/);
  d.tugouCanvas.edges.push({source:desk.id,target:a.id});assert.throws(()=>compileWorkflow(d,desk.id),/循环/);
});
test('generation desk source trace matches used snapshots globals references and local additions',()=>{
  const d=base(),desk=workflowNode('config',{x:0,y:0}),middle=workflowNode('textgen',{x:0,y:0});
  const person={id:'person-node',type:'module',data:{binding:{moduleId:'person',snapshot:{name:'新娘',kind:'character',text:'原始人物'},overrideText:'本次人物'}}};
  const action={id:'action-node',type:'module',data:{binding:{moduleId:'action',snapshot:{name:'牵手',kind:'action',text:'轻轻牵手'}}}};
  const ref={id:'photo-node',type:'asset',data:{assetId:'photo'}};
  d.assets=[{id:'photo',name:'人物照片',kind:'image'}];d.modules=[{id:'global-style',name:'C 版画风',kind:'style',text:'柔和手绘',global:true}];
  middle.data.resultText='全身构图';Object.assign(desk.data,{prompt:'保持留白',negativePrompt:'多余手指',inputRoles:{'photo-node':'保留人物身份'}});
  d.tugouCanvas.nodes=[person,action,ref,middle,desk];d.tugouCanvas.edges=[person,action,ref].map(n=>({source:n.id,target:middle.id})).concat([{source:middle.id,target:desk.id},{source:person.id,target:desk.id}]);
  const before=JSON.stringify(d),c=compileWorkflow(d,desk.id);
  assert.equal(c.sources.filter(s=>s.nodeId==='person-node').length,1);
  assert.deepEqual(c.sources.find(s=>s.nodeId==='person-node'),{nodeId:'person-node',name:'新娘',category:'character',text:'本次人物',origin:'prompt'});
  assert.equal(c.sources.find(s=>s.nodeId==='action-node').category,'action');assert.equal(c.sources.find(s=>s.nodeId===middle.id).origin,'result');
  assert.deepEqual(c.sources.find(s=>s.moduleId==='global-style'),{moduleId:'global-style',name:'C 版画风',category:'style',text:'柔和手绘',origin:'global'});
  assert.equal(c.sources.find(s=>s.assetId==='photo').role,c.references[0].role);assert.equal(c.sources.find(s=>s.assetId==='photo').nodeId,'photo-node');
  assert.equal(c.sources.filter(s=>s.origin==='local').length,2);assert.equal(JSON.stringify(d),before);
  for(const s of c.sources.filter(s=>s.text))assert.ok(c.prompt.includes(s.text));
  desk.data.prompt='强调 @[node:person-node]';const mentioned=compileWorkflow(d,desk.id);assert.equal(mentioned.sources.find(s=>s.nodeId==='person-node').origin,'mention');assert.equal(mentioned.prompt.split('本次人物').length,2);
  d.tugouCanvas.edges=d.tugouCanvas.edges.filter(e=>e.source!=='photo-node');assert.ok(!compileWorkflow(d,desk.id).sources.some(s=>s.assetId==='photo'));
});
test('workflow input order, mentions, roles, config and panorama projection',()=>{
  const d=base(),a={id:'a',type:'text',data:{text:'第一段'}},b={id:'b',type:'text',data:{text:'第二段'}},c=workflowNode('config',{x:0,y:0}),n=workflowNode('video',{x:0,y:0});
  Object.assign(c.data,{count:3,model:'configured',seconds:8,size:'1280x720'});n.data.prompt='镜头';
  d.tugouCanvas.nodes=[a,b,c,n];d.tugouCanvas.edges=[{source:'a',target:c.id},{source:'b',target:c.id},{source:c.id,target:n.id}];c.data.inputOrder=['b','a'];
  let compiled=compileWorkflow(d,n.id);assert.equal(compiled.parameterSourceId,c.id);assert.equal(compiled.model,'configured');assert.equal(compiled.seconds,8);assert.ok(compiled.prompt.indexOf('第二段')<compiled.prompt.indexOf('第一段'));
  n.data.prompt='@[node:a] 然后 @[node:b]';compiled=compileWorkflow(d,n.id);assert.match(compiled.prompt,/第一段 然后 第二段/);
  n.data.prompt='@[node:missing]';assert.throws(()=>compileWorkflow(d,n.id),/未连接/);
  n.type='panorama';n.data.prompt='花园';compiled=compileWorkflow(d,n.id);assert.equal(compiled.size,'2048x1024');assert.match(compiled.prompt,/360/);
  d.tugouCanvas.edges.push({source:n.id,target:c.id});assert.throws(()=>compileWorkflow(d,n.id),/循环/);
});
test('connection rules and grouping preserve positions on ungroup',()=>{
  const a=workflowNode('image',{x:50,y:40}),b=workflowNode('director',{x:320,y:40}),c=workflowNode('config',{x:0,y:0});
  assert.ok(canLink({nodes:[a,b,c],edges:[]},a.id,b.id));assert.equal(canLink({nodes:[a,b,c],edges:[]},c.id,b.id),false);
  const nodes=groupNodes([a,b],[a.id,b.id]);assert.equal(nodes.length,3);assert.deepEqual(ungroupNodes(nodes,nodes[0].id).map(n=>n.position),[a.position,b.position]);
});
test('a generated desk passes its selected result downstream while retaining parameter inheritance',()=>{
  const d=base(),desk=workflowNode('config',{x:0,y:0}),next=workflowNode('panorama',{x:500,y:0});
  const input={id:'input',type:'asset',data:{assetId:'original',role:'人物身份'}};
  Object.assign(desk.data,{prompt:'生成合影',model:'shared-image',quality:'high',outputAssetIds:['first','second'],outputAssetId:'second'});next.data.prompt='扩展成花园全景';
  d.assets=[{id:'original',kind:'image'},{id:'first',kind:'image'},{id:'second',kind:'image'}];
  d.tugouCanvas.nodes=[input,desk,next];d.tugouCanvas.edges=[{source:input.id,target:desk.id},{source:desk.id,target:next.id,role:'沿用当前合影'}];
  let c=compileWorkflow(d,next.id);assert.deepEqual(c.references,[{assetId:'second',nodeId:desk.id,kind:'image',role:'沿用当前合影'}]);assert.equal(c.parameterSourceId,desk.id);assert.equal(c.model,'shared-image');assert.equal(c.quality,'high');assert.equal(c.size,'2048x1024');
  desk.data.outputAssetId='first';assert.equal(compileWorkflow(d,next.id).references[0].assetId,'first');
  desk.data.outputAssetId='missing';assert.throws(()=>compileWorkflow(d,next.id),/尚无可用结果/);
  delete desk.data.outputAssetId;c=compileWorkflow(d,next.id);assert.equal(c.references[0].assetId,'original');assert.match(c.prompt,/生成合影/);
  desk.data.outputAssetId='text';desk.data.resultText='编辑后的婚礼文案';d.assets.push({id:'text',kind:'text',text:'原始文案'});c=compileWorkflow(d,next.id);assert.equal(c.references.length,0);assert.match(c.prompt,/编辑后的婚礼文案/);
  next.data.prompt=`请沿用 @[node:${desk.id}]`;assert.match(compileWorkflow(d,next.id).prompt,/请沿用 编辑后的婚礼文案/);
  const words={id:'words',type:'text',data:{text:'上游构图要求'}};d.tugouCanvas.nodes.push(words);d.tugouCanvas.edges.push({source:words.id,target:desk.id});
  desk.data.outputAssetId='second';next.data.prompt='额外遵循 @[node:words]';c=compileWorkflow(d,next.id);assert.match(c.prompt,/额外遵循 上游构图要求/);assert.equal(c.references[0].assetId,'second');
});
test('media range response supports seeks and rejects malformed ranges',async()=>{
  await fs.mkdir(root,{recursive:true});const profile=await fs.mkdtemp(path.join(root,'range-'));await fs.mkdir(path.join(profile,'resources'));
  const wav=await fs.readFile(path.join(root,'sample.wav')),asset=await saveMedia(profile,wav,'audio.wav'),file=path.join(profile,'resources',asset.resource);
  const response=await mediaResponse(file,'bytes=20-39');assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),wav.subarray(20,40));
  assert.equal((await mediaResponse(file,'bytes=999999-')).status,416);assert.equal((await mediaResponse(file,'bytes=-10')).headers.get('content-length'),'10');
  await assert.rejects(saveMedia(profile,Buffer.from('not valid audio'),'bad.mp3'));
});
test('all generation modes: parameters, result persistence, cancellation and explicit retry',async t=>{
  await fs.mkdir(root,{recursive:true});const profile=await fs.mkdtemp(path.join(root,'tasks-')),projects=new ProjectStore(profile);await projects.init();
  const record=await projects.create('完整节点测试'),tasks=new TaskQueue(profile);await tasks.init();const requests=[];let hold=false,release;
  const png=await encode({width:32,height:16,data:Buffer.alloc(32*16*4,255)}),video=await fs.readFile(path.join(root,'sample.mp4')),audio=await fs.readFile(path.join(root,'sample.wav'));
  const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks).toString();requests.push({url:req.url,raw});
    if(req.url.endsWith('/chat/completions')){if(hold)await new Promise(r=>release=r);res.end(JSON.stringify({choices:[{message:{content:'真实测试文本输出'}}]}));}
    else if(req.url.endsWith('/images/generations'))res.end(JSON.stringify({data:Array.from({length:JSON.parse(raw).n},()=>({b64_json:png.toString('base64')}))}));
    else if(req.url.endsWith('/audio/speech'))res.end(audio);
    else if(req.url==='/v1/videos'&&req.method==='POST')res.end(JSON.stringify({id:'remote-1',status:'queued'}));
    else if(req.url==='/v1/videos/remote-1')res.end(JSON.stringify({id:'remote-1',status:'completed'}));
    else if(req.url==='/v1/videos/remote-1/content')res.end(video);else{res.statusCode=404;res.end();}
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{release?.();server.closeAllConnections();server.close();});
  const settings={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'private-fixture',model:'image',textModel:'text',videoModel:'video',audioModel:'audio'};
  const service=new WorkflowService(projects,{readPrivate:async()=>settings},tasks,()=>({width:32,height:16}));
  let document={...record.document,tugouCanvas:{version:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}}};
  for(const type of ['textgen','image','video','audio','panorama','config']){
    const node=workflowNode(type,{x:0,y:0});Object.assign(node.data,{prompt:'测试生成',format:'wav',count:2});document.tugouCanvas.nodes.push(node);
    const task=await service.start(record.id,document,node.id);await tasks.execution;
    assert.equal(tasks.list().find(t=>t.id===task.id).status,'completed',type);
    const result=JSON.parse(await fs.readFile(path.join(profile,'results',task.id+'.json'),'utf8'));document=mergeResults(document,[result]);
    assert.ok(document.tugouCanvas.nodes.find(n=>n.id===node.id).data.outputAssetId);
    assert.deepEqual(mergeResults(document,[result]),document);
    assert.ok(!(await fs.readFile(path.join(profile,'requests',task.id+'.json'),'utf8')).includes(settings.apiKey));
  }
  assert.equal(JSON.parse(requests.find(r=>r.url.endsWith('/images/generations')).raw).n,2);
  assert.equal(JSON.parse(requests.find(r=>r.url.endsWith('/audio/speech')).raw).response_format,'wav');
  assert.ok(requests.some(r=>r.url==='/v1/videos/remote-1/content'));
  const node=workflowNode('textgen',{x:0,y:0});node.data.prompt='取消';document.tugouCanvas.nodes.push(node);hold=true;
  const task=await service.start(record.id,document,node.id);while(!release)await new Promise(r=>setTimeout(r,10));
  await assert.rejects(service.start(record.id,document,node.id),/已有任务/);await tasks.cancel(task.id);release();await tasks.execution;
  assert.equal(tasks.list().find(t=>t.id===task.id).status,'cancelled');await assert.rejects(fs.stat(path.join(profile,'results',task.id+'.json')));
  hold=false;const retried=await service.retry(task.id);await tasks.execution;assert.equal(tasks.list().find(t=>t.id===retried.id).status,'completed');
  hold=true;release=null;node.data.prompt='阻塞队列';const running=await service.start(record.id,document,node.id);while(!release)await new Promise(r=>setTimeout(r,10));
  const queuedNode=workflowNode('textgen',{x:20,y:0});queuedNode.data.prompt='等待后取消';document.tugouCanvas.nodes.push(queuedNode);
  const queued=await service.start(record.id,document,queuedNode.id);assert.equal(tasks.list().find(t=>t.id===queued.id).status,'queued');await tasks.cancel(queued.id);
  assert.equal(JSON.parse(await fs.readFile(path.join(profile,'requests',queued.id+'.json'),'utf8')).nodeId,queuedNode.id);
  hold=false;release();await tasks.execution;const queuedRetry=await service.retry(queued.id);await tasks.execution;assert.equal(tasks.list().find(t=>t.id===queuedRetry.id).status,'completed');
  await projects.save(record.id,document,record.revision);const restarted=new TaskQueue(profile);await restarted.init();assert.equal(restarted.list().length,tasks.list().length);
});
