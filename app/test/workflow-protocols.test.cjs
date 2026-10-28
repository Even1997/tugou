const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {ProjectStore,validateDocument}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs'),{WorkflowService}=require('../core/workflow-service.cjs');
const {workflowNode}=require('../core/workflow-nodes.cjs'),{sceneFrame}=require('../core/scene-animation.cjs'),{saveImage}=require('../core/generation.cjs'),{encode}=require('../core/cloud-pixels.cjs');
const {video}=require('./workflow-fixtures.cjs');
test('Responses and three video protocols preserve real references, first/last frames and protected fields',async t=>{
  const root=path.resolve(__dirname,'../test-results/workflow-nodes');await fs.mkdir(root,{recursive:true});const profile=await fs.mkdtemp(path.join(root,'protocol-')),projects=new ProjectStore(profile);await projects.init();const record=await projects.create('协议验收'),tasks=new TaskQueue(profile);await tasks.init();
  const requests=[];const server=http.createServer(async(req,res)=>{const bytes=[];for await(const c of req)bytes.push(c);requests.push({url:req.url,headers:req.headers,raw:Buffer.concat(bytes).toString()});
    if(req.url.endsWith('/responses'))res.end(JSON.stringify({output:[{content:[{type:'output_text',text:'Responses 文本'}]}]}));
    else if(req.url.endsWith('/content'))res.end(video);else res.end(JSON.stringify({id:'v',status:'completed'}));
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const settings={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture',model:'img',textModel:'txt',videoModel:'vid',textApiMode:'responses'};
  const service=new WorkflowService(projects,{readPrivate:async()=>settings},tasks,()=>({width:2,height:2})),asset={...await saveImage(profile,await encode({width:2,height:2,data:Buffer.alloc(16,255)}),()=>({width:2,height:2})),id:'picture'};
  const node=workflowNode('textgen',{x:0,y:0});node.data.prompt='识别参考';const source={id:'input',type:'asset',position:{x:0,y:0},data:{assetId:asset.id,role:'角色'}};
  const document={...record.document,assets:[asset],tugouCanvas:{version:1,nodes:[source,node],edges:[{id:'edge',source:source.id,target:node.id}],viewport:{x:0,y:0,zoom:1}}};
  const execute=async()=>{const task=await service.start(record.id,document,node.id);await tasks.execution;assert.equal(tasks.list().find(t=>t.id===task.id).status,'completed');return requests.filter(r=>r.url.endsWith('/videos')||r.url.endsWith('/responses')).at(-1);};
  let request=await execute(),body=JSON.parse(request.raw);assert.equal(body.input[0].content[1].type,'input_image');assert.match(body.input[0].content[1].image_url,/^data:image\/png;base64,/);
  node.type='video';node.data.firstFrameId='input';node.data.size='1280x720';node.data.seconds=8;node.data.generateAudio=true;node.data.videoOptions='{"seed":42,"model":"do-not-use","seconds":99}';
  request=await execute();body=JSON.parse(request.raw);assert.equal(body.model,'vid');assert.equal(body.seconds,'8');assert.equal(body.seed,42);assert.equal(body.generate_audio,true);assert.match(body.first_frame_url,/^data:image\/png/);
  settings.videoProtocol='multipart';request=await execute();assert.match(request.headers['content-type'],/^multipart\/form-data/);assert.match(request.raw,/name="first_frame_url"; filename="reference.png"/);assert.match(request.raw,/name="seed"\r\n\r\n42/);
  settings.videoProtocol='sora';request=await execute();assert.match(request.raw,/name="input_reference"; filename="frame.png"/);assert.ok(!request.raw.includes('name="first_frame_url"'));
  node.data.lastFrameId='input';const before=requests.length,failed=await service.start(record.id,document,node.id);await tasks.execution;assert.equal(tasks.list().find(t=>t.id===failed.id).status,'failed');assert.equal(requests.length,before);
});
test('scene keyframes interpolate shortest rotation and reject corrupt output and animation',()=>{
  const n=workflowNode('director',{x:0,y:0}),scene=n.data.scene,object={id:'actor',kind:'character',position:[0,0,0],rotation:[0,3,0],scale:[1,1,1]};
  scene.objects=[object];scene.frames=[{time:0,objects:[object],camera:scene.cameras[0]},{time:2,objects:[{...object,position:[4,0,0],rotation:[0,-3,0]}],camera:{...scene.cameras[0],fov:65}}];
  const frame=sceneFrame(scene,1,2);assert.equal(frame.objects[0].position[0],2);assert.ok(Math.abs(frame.objects[0].rotation[1]-Math.PI)<.001);assert.equal(frame.camera.fov,55);
  const document={name:'测试',width:1024,height:1024,modules:[],recipes:[],assets:[],layers:[],jobs:[],tugouCanvas:{version:1,nodes:[n],edges:[],viewport:{x:0,y:0,zoom:1}}};
  validateDocument(document);scene.size='99999x99999';assert.throws(()=>validateDocument(document),/输出设置/);delete scene.size;scene.frames[0].camera={fov:NaN};assert.throws(()=>validateDocument(document),/关键帧/);
});
test('generated image replacement and angle tools preserve generation parameters and references',()=>{
  const n=workflowNode('image',{x:10,y:20});n.data.outputAssetId='old';n.data.outputAssetIds=['old'];n.data.prompt='保持我的提示词';
  const asset={id:'new',kind:'image',width:20,height:10},document={assets:[{id:'old',width:10,height:10},asset],tugouCanvas:{nodes:[n],edges:[{source:'ref',target:n.id}]}};
  const next=require('../core/canvas-media.cjs').replaceCanvasAsset(document,n.id,'old',asset);
  assert.equal(next.tugouCanvas.nodes[0].data.outputAssetId,'new');assert.deepEqual(next.tugouCanvas.nodes[0].data.outputAssetIds,['old','new']);assert.equal(next.tugouCanvas.nodes[0].data.prompt,n.data.prompt);assert.deepEqual(next.tugouCanvas.edges,document.tugouCanvas.edges);assert.equal(document.tugouCanvas.nodes[0].data.outputAssetId,'old');
  assert.ok(require('../core/canvas-view.cjs').angleRequest(next,n.id,'new',{}));
  assert.throws(()=>require('../core/canvas-media.cjs').replaceCanvasAsset(next,n.id,'old',asset),/已变化/);
});
