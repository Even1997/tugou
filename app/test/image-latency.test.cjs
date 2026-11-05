const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {requestImages,imageProgress}=require('../core/image-api.cjs');
const {TaskQueue}=require('../core/tasks.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('image diagnostics separate provider headers, response body and URL download without leaking data',async t=>{
  const headers=deferred(),body=deferred(),download=deferred(),requested=deferred(),downloading=deferred();
  const original=global.fetch,phases=[],calls=[];t.after(()=>{global.fetch=original;headers.resolve();body.resolve();download.resolve();});
  const task={context:{count:1}},tasks={emit:event=>assert.equal(event,'changed')},track=imageProgress(tasks,task);
  const payload=JSON.stringify({data:[{url:'https://images.example.test/private-image.png'}]});
  global.fetch=async(url,options)=>{
    calls.push({url:String(url),options});
    if(options.method==='POST'){
      requested.resolve();await headers.promise;
      return new Response(new ReadableStream({async start(controller){await body.promise;controller.enqueue(Buffer.from(payload));controller.close();}}));
    }
    downloading.resolve();await download.promise;return new Response(Buffer.from('image-fixture'));
  };
  const operation=requestImages({baseUrl:'https://api.example.test',apiKey:'private-key',model:'custom-image'},{prompt:'private-prompt',size:'auto'},new AbortController().signal,phase=>{phases.push(phase);track(phase);});
  await requested.promise;assert.equal(task.stage,'generating');await sleep(25);headers.resolve();
  while(!phases.includes('headers'))await sleep(1);
  assert.equal(task.stage,'receiving');assert.equal(task.imageTimings[0].body,undefined);
  await sleep(30);body.resolve();await downloading.promise;assert.equal(task.stage,'downloading');
  await sleep(35);download.resolve();assert.deepEqual(await operation,[Buffer.from('image-fixture')]);track('saved');
  assert.deepEqual(phases,['queued','sent','headers','body','download','ready']);
  const timing=task.imageTimings[0];assert.ok(timing.headers-timing.sent>=20);assert.ok(timing.body-timing.headers>=25);assert.ok(timing.ready-timing.body>=30);
  assert.equal(calls.length,2);assert.equal(calls[1].options.headers,undefined);
  assert.ok(!/private|example|prompt|apiKey/.test(JSON.stringify(task.imageTimings)));
});

test('batch timings remain separate and report the whole batch as generating until publication',()=>{
  const task={context:{count:2},stage:'generating'},tasks={emit:()=>{}};
  const first=imageProgress(tasks,task,0),second=imageProgress(tasks,task,1);
  first('queued');second('queued');first('sent');first('ready');first('saved');second('sent');
  assert.equal(task.stage,'generating');assert.ok(Number.isFinite(task.imageTimings[0].saved));assert.equal(task.imageTimings[1].saved,undefined);
});

test('completion notification follows durable task and result writes',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-latency-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const queue=new TaskQueue(root);await queue.init();const observations=[];
  queue.on('changed',()=>{if(queue.list().at(-1)?.status==='completed')observations.push(Promise.all([fs.readFile(path.join(root,'tasks.json'),'utf8'),fs.readFile(path.join(root,'fixture-result'),'utf8')]));});
  const job=await queue.start('test',async()=>{await fs.writeFile(path.join(root,'fixture-result'),'saved');return'result';},{kind:'generation'});await job.completion;
  assert.equal(observations.length,1);const [journal,result]=await observations[0];assert.equal(JSON.parse(journal)[0].status,'completed');assert.equal(result,'saved');
});
