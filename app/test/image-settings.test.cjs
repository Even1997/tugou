const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {imageCapabilities,imageSettingsError,validateImageSettings,ratioOf,resolutionOf,sizeFor,imageResultWarning}=require('../core/image-settings.cjs');
const model='gpt-image-2.5-sunburst';
test('model capabilities expose exact-ratio legal tiers, snapshots and separate quality settings',()=>{
  const p=imageCapabilities(model);assert.equal(p.known,true);assert.deepEqual(p.qualityValues,['auto','low','medium','high','xhigh','max']);
  for(const [ratio,sizes] of Object.entries(p.presets))for(const [i,size] of sizes.entries()){
    const [w,h]=size.split('x').map(Number),[rw,rh]=ratio.split(':').map(Number);assert.equal(w*rh,h*rw);assert.equal(w%16,0);assert.equal(h%16,0);assert.ok(Math.max(w,h)<=3840&&w*h<=8294400&&w*h>=655360);
    assert.equal(imageSettingsError(model,{size,quality:'max'}),'');assert.equal(resolutionOf(size,model),p.resolutions[i]);assert.equal(sizeFor(ratio,p.resolutions[i],model),size);assert.equal(ratioOf(size),ratio);
  }
  assert.equal(sizeFor('1:1','4k',model),'2880x2880');assert.equal(sizeFor('9:16','4k',model),'2160x3840');
  assert.deepEqual(imageCapabilities('openai/gpt-image-2.5-flare-2026-09-08').qualityValues,p.qualityValues);
  assert.deepEqual(imageCapabilities('gpt-image-2-2026-04-21').qualityValues,['auto','low','medium','high']);
  const old=imageCapabilities('gpt-image-1.5');assert.equal(old.custom,false);assert.deepEqual(old.resolutions,['1k']);assert.equal(sizeFor('1:1','2k','gpt-image-1.5'),undefined);
});
test('unsupported parameters are explicit errors and unverified models retain manual values',()=>{
  for(const [size,match] of [['1920x1080',/16 的倍数/],['4096x4096',/3840/],['3840x3840',/总像素/],['16x16',/总像素/],['3840x1008',/宽高比/],['x1024',/宽x高/],['0x1024',/正整数/]])assert.match(imageSettingsError(model,{size}),match);
  for(const quality of ['standard','hd','bad'])assert.throws(()=>validateImageSettings(model,{size:'1024x1536',quality}),/不支持质量/);
  assert.equal(imageSettingsError(model,{quality:''}),'');
  assert.match(imageSettingsError('gpt-image-1.5',{size:'2048x2048'}),/仅支持/);assert.match(imageSettingsError('gpt-image-1.5',{quality:'max'}),/不支持质量/);
  const unknown=imageCapabilities('custom-image');assert.equal(unknown.known,false);assert.match(unknown.notice,/未验证/);assert.equal(imageSettingsError('custom-image',{size:'1500x1001',quality:'cinematic'}),'');
  assert.match(imageSettingsError('custom-image',{size:'99999x99999'}),/一亿像素/);assert.equal(imageResultWarning('auto',1390,1132),'');assert.equal(imageResultWarning('1024x1536',1024,1536),'');assert.match(imageResultWarning('1024x1536',1390,1132),/请求 1024 × 1536，实际 1390 × 1132/);
});
async function fixture(t){
  const out=path.resolve('test-results/image-settings');await fs.mkdir(out,{recursive:true});const root=await fs.mkdtemp(path.join(out,'core-'));
  const {ProjectStore}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs');const projects=new ProjectStore(root);await projects.init();const record=await projects.create('生图参数验收'),tasks=new TaskQueue(root);await tasks.init();
  const png=await require('sharp')({create:{width:32,height:24,channels:4,background:'#aabbcc'}}).png().toBuffer(),requests=[];let fail=false;
  const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks),form=req.headers['content-type'].includes('multipart');const body=form?Object.fromEntries(await new Request('http://localhost'+req.url,{method:'POST',headers:{'content-type':req.headers['content-type']},body:raw}).formData()):JSON.parse(raw);requests.push({url:req.url,prompt:body.prompt,size:body.size,quality:body.quality,count:Number(body.n)});if(fail){res.statusCode=400;res.end('{}');return;}res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const settings={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture-secret-not-in-journal',model};
  const connections={readPrivate:async()=>settings,publicSettings:async()=>({model})};
  const service=new (require('../core/workflow-service.cjs').WorkflowService)(projects,connections,tasks,bytes=>({width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)}));
  const node=require('../core/workflow-nodes.cjs').workflowNode('config',{x:0,y:0});Object.assign(node.data,{prompt:'参数验收',size:'1024x1536',quality:'max'});
  const document={...record.document,tugouCanvas:{version:1,nodes:[node],edges:[],viewport:{x:0,y:0,zoom:1}}};
  t.after(async()=>{await tasks.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));});
  return {root,projects,record,tasks,service,connections,settings,node,document,png,requests,fail:v=>fail=v};
}
test('JSON and multipart send independent size and quality, retain original bytes and journal mismatches',async t=>{
  const f=await fixture(t),{saveImage}=require('../core/generation.cjs');
  for(const withReference of [false,true]){
    if(withReference){const asset={id:'ref',...await saveImage(f.root,f.png,()=>({width:32,height:24}))};f.document.assets=[asset];f.document.tugouCanvas.nodes.push({id:'ref-node',type:'asset',position:{x:-400,y:0},data:{assetId:asset.id,role:'参考图片'}});f.document.tugouCanvas.edges.push({id:'ref-edge',source:'ref-node',target:f.node.id});}
    const original=require('../core/workflow-nodes.cjs').compileWorkflow(f.document,f.node.id).prompt;
    const task=await f.service.start(f.record.id,f.document,f.node.id);await f.tasks.execution;const saved=f.tasks.list().find(v=>v.id===task.id),wire=f.requests.at(-1);
    assert.deepEqual({...wire,prompt:wire.prompt.replace(/\r\n/g,'\n')},{url:withReference?'/v1/images/edits':'/v1/images/generations',prompt:original+'\n\n输出画幅要求（仅用于构图，不要在图中绘制这些文字）：采用 2:3 竖版构图，目标输出尺寸为 1024 × 1536 像素。',size:'1024x1536',quality:'max',count:1});assert.equal(saved.status,'completed');assert.equal(saved.context.quality,'max');assert.deepEqual(saved.actualSizes,['32x24']);assert.match(saved.message,/尺寸不符/);
    const result=JSON.parse(await fs.readFile(path.join(f.root,'results',task.id+'.json'))),asset=result.assets[0];assert.equal(asset.generation.quality,'max');assert.equal(asset.generation.requestedSize,'1024x1536');assert.deepEqual(await fs.readFile(path.join(f.root,'resources',asset.resource)),f.png);
    const snapshot=await fs.readFile(path.join(f.root,'requests',task.id+'.json'),'utf8');assert.ok(!snapshot.includes(f.settings.apiKey));assert.equal(JSON.parse(snapshot).compiled.prompt,original);assert.equal(result.prompt,original);assert.equal(asset.generation.prompt,original);assert.equal(f.node.data.prompt,'参数验收');
  }
  assert.equal(f.requests.length,2);
});

test('output instructions follow all 27 tiers and custom ratios, leave auto untouched and never mutate the original prompt',async t=>{
  const f=await fixture(t),{requestImages}=require('../core/image-api.cjs'),signal=AbortSignal.timeout(10000);
  for(const [ratio,sizes]of Object.entries(imageCapabilities(model).presets))for(const size of sizes){
    const request=Object.freeze({prompt:'用户原文\n  保留空白 ',size,quality:'max'}),[w,h]=size.split('x').map(Number);
    await requestImages(f.settings,request,signal);const wire=f.requests.at(-1);
    assert.ok(wire.prompt.startsWith(request.prompt+'\n\n'));assert.ok(wire.prompt.includes(`采用 ${ratio} ${w===h?'方形':w>h?'横版':'竖版'}构图`));assert.ok(wire.prompt.includes(`${w} × ${h} 像素`));assert.equal(wire.prompt.split('输出画幅要求').length-1,1);assert.equal(request.prompt,'用户原文\n  保留空白 ');
  }
  const request=Object.freeze({prompt:'自定义提示词',size:'1500x1001'}),settings={...f.settings,model:'custom-image'};
  for(let i=0;i<2;i++){await requestImages(settings,request,signal);assert.match(f.requests.at(-1).prompt,/采用 1500:1001 横版构图，目标输出尺寸为 1500 × 1001 像素/);assert.equal(f.requests.at(-1).prompt.split('输出画幅要求').length-1,1);}
  await requestImages(f.settings,{prompt:'自动尺寸原文',size:'auto'},signal);assert.equal(f.requests.at(-1).prompt,'自动尺寸原文');assert.equal(f.requests.length,30);
});
test('shared-model validation rejects before task creation; retry keeps its original settings',async t=>{
  const f=await fixture(t);f.node.data.size='1920x1080';await assert.rejects(f.service.start(f.record.id,f.document,f.node.id),/16 的倍数/);assert.equal(f.tasks.list().length,0);assert.equal(f.requests.length,0);
  f.node.data.size='1024x1536';f.node.data.quality='hd';await assert.rejects(f.service.start(f.record.id,f.document,f.node.id),/不支持质量/);assert.equal(f.requests.length,0);
  f.node.data.quality='xhigh';f.fail(true);const failed=await f.service.start(f.record.id,f.document,f.node.id);await f.tasks.execution;assert.equal(f.tasks.list()[0].status,'failed');assert.equal(f.requests.length,1);
  f.node.data.size='2880x2880';f.node.data.quality='low';f.fail(false);const retried=await f.service.retry(failed.id);await f.tasks.execution;assert.equal(f.tasks.list().find(v=>v.id===retried.id).status,'completed');assert.equal(f.requests[1].size,'1024x1536');assert.equal(f.requests[1].quality,'xhigh');assert.equal(f.requests[1].prompt,f.requests[0].prompt);assert.equal(f.requests[1].prompt.split('输出画幅要求').length-1,1);assert.equal(f.requests.length,2);
});
test('MCP discovers shared capabilities without returning credentials, and recipes preserve quality',async t=>{
  const f=await fixture(t),{createDispatcher}=require('../core/automation-host.cjs'),dispatch=await createDispatcher({root:f.root,connections:f.connections,ui:async()=>({revision:'r',projectId:f.record.id,document:f.document})});
  const catalog=await dispatch('list_commands',{search:'imageCapabilities'});assert.equal(catalog.commands[0].name,'models.imageCapabilities');
  const caps=await dispatch('run_command',{command:'models.imageCapabilities',args:{}});assert.deepEqual(caps,imageCapabilities(model));assert.ok(!JSON.stringify(caps).includes(f.settings.apiKey));
  const prompts=require('../core/prompts.cjs'),recipe={...prompts.newRecipe(),output:'测试配方',quality:'max'},document={...f.document,recipes:[recipe]};
  assert.equal(prompts.compileRecipe(document,recipe).quality,'max');const node=prompts.createNode(document,'recipe',recipe.id,{x:0,y:0});document.tugouCanvas.nodes.push(node);assert.equal(prompts.compileNode(document,node.id).quality,'max');
});
