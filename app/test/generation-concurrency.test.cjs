const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const {ProjectStore,validateDocument}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs'),{WorkflowService}=require('../core/workflow-service.cjs');
const {workflowNode}=require('../core/workflow-nodes.cjs'),{GenerationService,saveImage}=require('../core/generation.cjs');
const {stageOutputs}=require('../core/generation-output.cjs'),{mergeResults}=require('../core/results.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(predicate){for(let i=0;i<200;i++){if(await predicate())return;await sleep(10);}assert.fail('requests did not overlap before any response was released');}
async function fixture(t,count=1,concurrency=4){
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-parallel-')),projects=new ProjectStore(root);await projects.init();
  const record=await projects.create('并发生图验收'),tasks=new TaskQueue(root);await tasks.init();tasks.setImageConcurrency(concurrency);require('../core/image-api.cjs').setImageConcurrency(concurrency);record.document.tugouCanvas=require('../core/prompts.cjs').emptyCanvas();
  const requests=[],inspect=b=>({width:b.readUInt32BE(16),height:b.readUInt32BE(20)}),pngs=[];
  for(let i=0;i<64;i++)pngs.push(await require('sharp')({create:{width:16+i,height:12,channels:4,background:'#aabbcc'}}).png().toBuffer());
  let active=0,peak=0;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks);
    const body=req.headers['content-type'].includes('multipart')?Object.fromEntries(await new Request('http://localhost'+req.url,{method:'POST',headers:{'content-type':req.headers['content-type']},body:raw}).formData()):JSON.parse(raw);
    const entry={body,url:req.url,res,index:requests.length,wire:Number(req.headers['x-fixture-call'])};requests.push(entry);active++;peak=Math.max(peak,active);res.once('close',()=>active--);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const settings={baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture-not-for-journal',model:'custom-image'};
  const fetch=global.fetch;let wire=0;global.fetch=(url,options)=>fetch(url,String(url).startsWith(settings.baseUrl)?{...options,headers:{...options.headers,'x-fixture-call':String(wire++)}}:options);
  const connections={readPrivate:async()=>settings},service=new WorkflowService(projects,connections,tasks,inspect),generation=new GenerationService(projects,connections,tasks,inspect);
  const node=workflowNode('config',{x:0,y:0});Object.assign(node.data,{prompt:'并行测试',size:'auto',count});record.document.tugouCanvas.nodes.push(node);
  const release=(index,status=200)=>{const r=requests[index];r.res.statusCode=status;r.res.end(status===200?JSON.stringify({data:[{b64_json:pngs[r.wire].toString('base64')}]}):'private-provider-error');};
  t.after(async()=>{await tasks.shutdown();server.closeAllConnections();await new Promise(r=>server.close(r));await tasks.execution;require('../core/image-api.cjs').setImageConcurrency(8);global.fetch=fetch;await fs.rm(root,{recursive:true,force:true});});
  return {root,projects,record,tasks,requests,service,generation,node,inspect,pngs,release,peak:()=>peak,async result(id){return JSON.parse(await fs.readFile(path.join(root,'results',id+'.json'),'utf8'));}};
}

for(const limit of [1,8,16,32])test(`shared HTTP limit ${limit} spans multiple desks and refills slots`,async t=>{
  const f=await fixture(t,1,limit);
  for(let i=0;i<3;i++){const n=workflowNode('config',{x:i*400,y:0});Object.assign(n.data,{prompt:'并发上限 '+limit,size:'auto',count:15});f.record.document.tugouCanvas.nodes.push(n);await f.service.start(f.record.id,f.record.document,n.id);}
  await until(()=>f.requests.length===limit);await sleep(60);assert.equal(f.requests.length,limit);assert.equal(f.peak(),limit);
  for(let i=0;i<45;i++){await until(()=>f.requests.length>i);f.release(i);}
  await f.tasks.execution;assert.ok(f.peak()<=limit);assert.equal(f.tasks.list().filter(t=>t.status==='completed').length,3);
});

test('raising a live limit starts queued requests; lowering drains active requests without aborting',async t=>{
  const f=await fixture(t,15,2),configure=value=>{f.tasks.setImageConcurrency(value);require('../core/image-api.cjs').setImageConcurrency(value);};
  await f.service.start(f.record.id,f.record.document,f.node.id);await until(()=>f.requests.length===2);
  configure(8);await until(()=>f.requests.length===8);configure(2);
  for(let i=0;i<6;i++)f.release(i);await sleep(100);assert.equal(f.requests.length,8);assert.ok(f.requests.slice(6).every(r=>!r.res.destroyed));
  f.release(6);await until(()=>f.requests.length===9);await sleep(60);assert.equal(f.requests.length,9);
  configure(16);await until(()=>f.requests.length===15);for(let i=7;i<15;i++)f.release(i);
  await f.tasks.execution;assert.equal(f.tasks.list()[0].status,'completed');assert.equal((await f.result(f.tasks.list()[0].id)).assets.length,15);
});

test('raising and lowering the task limit preserves running desks and admits waiting desks',async t=>{
  const f=await fixture(t,1,2),configure=value=>{f.tasks.setImageConcurrency(value);require('../core/image-api.cjs').setImageConcurrency(value);};
  for(let i=0;i<6;i++){const n=workflowNode('config',{x:i*400,y:0});Object.assign(n.data,{prompt:'动态 '+i,size:'auto'});f.record.document.tugouCanvas.nodes.push(n);await f.service.start(f.record.id,f.record.document,n.id);}
  await until(()=>f.requests.length===2);configure(4);await until(()=>f.requests.length===4);configure(1);
  for(let i=0;i<3;i++)f.release(i);await sleep(100);assert.equal(f.requests.length,4);
  f.release(3);await until(()=>f.requests.length===5);f.release(4);await until(()=>f.requests.length===6);f.release(5);await f.tasks.execution;
  assert.ok(f.tasks.list().every(t=>t.status==='completed'));
});

test('one desk overlaps four requests, queues the fifth and preserves ordered result nodes',async t=>{
  const f=await fixture(t,5),job=await f.service.start(f.record.id,f.record.document,f.node.id);
  await until(()=>f.requests.length===4);assert.equal(f.peak(),4);assert.ok(f.requests.every(r=>r.body.n===1));
  const staged=stageOutputs(f.record.document,f.tasks.list()),ids=staged.tugouCanvas.nodes.slice(1).map(n=>n.id);
  assert.equal(ids.length,5);assert.equal(staged.tugouCanvas.edges.length,5);
  f.release(1);await until(()=>f.requests.length===5);assert.ok(f.peak()<=4);
  for(const i of [4,2,3,0])f.release(i);await f.tasks.execution;
  assert.equal(f.tasks.list()[0].status,'completed');const result=await f.result(job.id);
  assert.deepEqual(result.assets.map(a=>a.width),[16,17,18,19,20]);
  const merged=mergeResults(staged,[result]);validateDocument(merged);assert.equal(merged.assets.length,5);
  assert.ok(ids.every(id=>merged.tugouCanvas.nodes.find(n=>n.id===id)?.data.assetId));assert.equal(merged.tugouCanvas.edges.length,5);
  assert.ok(!(await fs.readFile(path.join(f.root,'tasks.json'),'utf8')).includes('fixture-not-for-journal'));
});

test('separate desks run together with four active jobs while local tools stay serial and independent',async t=>{
  const f=await fixture(t),started=[],releaseLocal=[];
  for(let i=0;i<2;i++)await f.tasks.start('本地处理',signal=>new Promise(resolve=>{started.push(i);releaseLocal[i]=resolve;signal.addEventListener('abort',resolve,{once:true});}),{kind:'local-tool'});
  const jobs=[];
  for(let i=0;i<6;i++){const n=workflowNode('config',{x:i*400,y:0});Object.assign(n.data,{prompt:'并行 '+i,size:'auto'});f.record.document.tugouCanvas.nodes.push(n);jobs.push(await f.service.start(f.record.id,f.record.document,n.id));}
  await until(()=>f.requests.length===4);assert.deepEqual(started,[0]);
  const imageTasks=f.tasks.list().filter(t=>t.context.kind==='workflow');assert.equal(imageTasks.filter(t=>t.status==='running').length,4);assert.equal(imageTasks.filter(t=>t.status==='queued').length,2);
  const cancelled=jobs[5].id;assert.equal(await f.tasks.cancel(cancelled),true);
  releaseLocal[0]();await until(()=>started.length===2);releaseLocal[1]();
  for(let i=0;i<4;i++)f.release(i);await until(()=>f.requests.length===5);f.release(4);await f.tasks.execution;
  assert.equal(f.requests.length,5);assert.equal(f.tasks.list().find(t=>t.id===cancelled).status,'cancelled');assert.ok(f.peak()<=4);
});

test('multipart reference requests keep references, parameters and separate concurrent POSTs',async t=>{
  const f=await fixture(t,3),asset={id:'reference',kind:'image',...await saveImage(f.root,f.pngs[0],f.inspect)};
  f.record.document.assets.push(asset);f.record.document.tugouCanvas.nodes.push({id:'ref',type:'asset',position:{x:-400,y:0},data:{assetId:asset.id,role:'参考'}});f.record.document.tugouCanvas.edges.push({id:'ref-edge',source:'ref',target:f.node.id});
  f.node.data.quality='high';await f.service.start(f.record.id,f.record.document,f.node.id);await until(()=>f.requests.length===3);
  for(const r of f.requests){assert.equal(r.url,'/v1/images/edits');assert.equal(r.body.n,'1');assert.equal(r.body.quality,'high');assert.ok(r.body['image[]'] instanceof File);assert.equal(r.body['image[]'].size,f.pngs[0].length);}
  for(let i=0;i<3;i++)f.release(i);await f.tasks.execution;assert.equal(f.tasks.list()[0].status,'completed');
});

test('fifteen concurrent identical outputs keep all assets and do not leak abort listeners',async t=>{
  const f=await fixture(t,15),warnings=[],warning=w=>warnings.push(w);process.on('warning',warning);t.after(()=>process.off('warning',warning));
  f.pngs.fill(f.pngs[0]);const job=await f.service.start(f.record.id,f.record.document,f.node.id);await until(()=>f.requests.length===4);
  for(let i=0;i<15;i++){await until(()=>f.requests.length>i);f.release(i);}
  await f.tasks.execution;const result=await f.result(job.id);
  assert.equal(result.assets.length,15);assert.equal(new Set(result.assets.map(a=>a.id)).size,15);assert.equal(new Set(result.assets.map(a=>a.resource)).size,1);
  assert.deepEqual(await fs.readFile(path.join(f.root,'resources',result.assets[0].resource)),f.pngs[0]);assert.equal(f.peak(),4);assert.deepEqual(warnings,[]);
});

test('cancelling a multi-image job aborts active calls and never sends its waiting images',async t=>{
  const f=await fixture(t,6),job=await f.service.start(f.record.id,f.record.document,f.node.id);await until(()=>f.requests.length===4);
  await f.tasks.cancel(job.id);await f.tasks.execution;await sleep(30);
  assert.equal(f.tasks.list()[0].status,'cancelled');assert.equal(f.requests.length,4);assert.equal(f.tasks.completions.size,0);
  await assert.rejects(fs.readFile(path.join(f.root,'results',job.id+'.json')),e=>e.code==='ENOENT');
});

test('partial failures retain successful paid results without automatic extra requests',async t=>{
  const f=await fixture(t,3),job=await f.service.start(f.record.id,f.record.document,f.node.id);await until(()=>f.requests.length===3);
  const staged=stageOutputs(f.record.document,f.tasks.list());f.release(2);f.release(0);f.release(1,429);await f.tasks.execution;
  assert.equal(f.tasks.list()[0].status,'completed');assert.match(f.tasks.list()[0].message,/2\/3.*1 张失败/);assert.equal(f.requests.length,3);
  const result=await f.result(job.id);assert.deepEqual(result.assets.map(a=>a.width),[f.requests[0],f.requests[2]].sort((a,b)=>a.wire-b.wire).map(r=>16+r.wire));const merged=mergeResults(staged,[result]);
  validateDocument(merged);assert.equal(merged.assets.length,2);assert.equal(merged.tugouCanvas.edges.length,2);assert.equal(merged.tugouCanvas.nodes.filter(n=>n.data?.generationTaskId===job.id&&!n.data.assetId).length,0);
});

test('a slow image timing out retains the images already saved without retrying',async t=>{
  const f=await fixture(t,3),deadline=new AbortController(),timeout=AbortSignal.timeout;
  AbortSignal.timeout=ms=>ms===600000?deadline.signal:timeout(ms);t.after(()=>{AbortSignal.timeout=timeout;});
  const job=await f.service.start(f.record.id,f.record.document,f.node.id);await until(()=>f.requests.length===3);f.release(0);
  await until(async()=>(await fs.readdir(path.join(f.root,'resources'))).some(n=>n.endsWith('.png')));deadline.abort(new DOMException('Fixture deadline','TimeoutError'));await f.tasks.execution;
  assert.equal(f.tasks.list()[0].status,'completed');assert.match(f.tasks.list()[0].message,/1\/3.*2 张失败/);assert.equal((await f.result(job.id)).assets.length,1);assert.equal(f.requests.length,3);
});

test('full failure retries only explicitly and uses the original immutable request',async t=>{
  const f=await fixture(t,2),job=await f.service.start(f.record.id,f.record.document,f.node.id);await until(()=>f.requests.length===2);
  f.release(0,500);f.release(1,500);await f.tasks.execution;assert.equal(f.tasks.list()[0].status,'failed');assert.equal(f.requests.length,2);
  f.node.data.prompt='不应进入重试';f.node.data.count=1;const retry=await f.service.retry(job.id);await until(()=>f.requests.length===4);
  assert.equal(f.requests[2].body.prompt,f.requests[0].body.prompt);assert.equal(f.requests[3].body.n,1);f.release(3);f.release(2);await f.tasks.execution;
  assert.equal(f.tasks.list().find(t=>t.id===retry.id).status,'completed');assert.equal((await f.result(retry.id)).assets.length,2);assert.equal(f.requests.length,4);
});

test('legacy recipe generation shares the concurrent network lane',async t=>{
  const f=await fixture(t),prompts=require('../core/prompts.cjs'),recipe={...prompts.newRecipe(),output:'旧配方测试'};f.record.document.recipes.push(recipe);
  const n=prompts.createNode(f.record.document,'recipe',recipe.id,{x:0,y:0});f.record.document.tugouCanvas.nodes.push(n);
  await f.service.start(f.record.id,f.record.document,f.node.id);await f.generation.start(f.record.id,f.record.document,n.id);await until(()=>f.requests.length===2);
  f.release(1);f.release(0);await f.tasks.execution;assert.ok(f.tasks.list().every(t=>t.status==='completed'));
});
