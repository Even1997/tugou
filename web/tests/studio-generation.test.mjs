import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { createServer } from 'node:http';
import sharp from 'sharp';
import { GenerationQueue, generationInput } from '../src/app/api/studio/generation-queue.ts';
import { gateway, setConfig } from '../src/app/api/studio/gateway.ts';
import { collectGeneration } from '../src/app/studio/collect-generation.ts';

const ref='/api/studio/resource/'+ 'a'.repeat(64)+'.png';
const input={id:'one',projectId:'project',name:'test',prompt:'原始提示词',size:'1024x1536',references:[ref],recipeId:'recipe',fingerprint:'version1'};
const connection={baseUrl:'https://model.example/v1',model:'fixture'};
const asset={id:'one',name:'test',generationJobId:'one',dataUrl:ref,width:1,height:1,hasAlpha:true,createdAt:new Date().toISOString()};
async function folder(t){const dir=await mkdtemp(path.join(tmpdir(),'studio-generation-'));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
async function done(q,id='one'){for(let n=0;n<200;n++){const job=await q.get(id,'project');if(!['running','queued'].includes(job.status)){await wait(20);return job}await wait(10)}throw Error('timeout')}

test('concurrent duplicate submission runs once; immutable snapshot and persisted result contain no key',async t=>{
 const dir=await folder(t);let calls=0,received;
 const q=new GenerationQueue(dir,async(job)=>{calls++;received=job;await wait(30);return asset});
 const original=structuredClone(input);
 await Promise.all([q.submit({...original,apiKey:'never-persist'},connection),q.submit(original,connection)]);
 original.prompt='changed';original.references=[];
 assert.equal((await done(q)).status,'completed');assert.equal(calls,1);assert.equal(received.prompt,input.prompt);assert.deepEqual(received.references,[ref]);
 const manifest=await readFile(path.join(dir,'one.json'),'utf8');assert.ok(!manifest.includes('never-persist'));
 const restored=new GenerationQueue(dir,()=>{throw Error('must not resubmit')});assert.deepEqual((await restored.get('one','project')).result,asset);
 await assert.rejects(q.submit({...input,prompt:'different'},connection),/不同输入/);await assert.rejects(q.get('one','other'),/不存在/);
});
test('cancel queued and running jobs; late completion cannot become a published result',async t=>{
 const dir=await folder(t);let calls=0,start;const started=new Promise(r=>start=r);
 const q=new GenerationQueue(dir,async()=>{calls++;start();await wait(70);return asset});
 await q.submit(input,connection);await started;await q.submit({...input,id:'two'},connection);
 await q.cancel('two','project');await q.cancel('one','project');await wait(120);
 assert.equal(calls,1);assert.equal((await q.get('two','project')).status,'cancelled');
 const stopped=await q.get('one','project');assert.equal(stopped.status,'cancelled');assert.equal(stopped.result,undefined);assert.match(stopped.error,/计费/);
});
test('restart marks queued/running tasks interrupted and never resubmits paid requests',async t=>{
 const dir=await folder(t);let calls=0;
 for(const [id,status]of [['one','running'],['two','queued']])await writeFile(path.join(dir,id+'.json'),JSON.stringify({job:{...input,...connection,id,status,createdAt:new Date().toISOString()},hash:'x'}));
 const q=new GenerationQueue(dir,async()=>{calls++;return asset});const jobs=await q.list('project');
 assert.equal(calls,0);assert.equal(jobs.length,2);assert.ok(jobs.every(j=>j.status==='interrupted'&&/不会自动/.test(j.error)));
 await q.submit({...input,id:'manual'},connection);assert.equal((await done(q,'manual')).status,'completed');assert.equal(calls,1);
});

test('timeout rejects late generation, advances queue and stays failed after restart without resubmitting',async t=>{
 const dir=await folder(t),schedule=globalThis.setTimeout;let expire,begin,release,receivedSignal,calls=0;
 const started=new Promise(r=>begin=r),gate=new Promise(r=>release=r);
 t.mock.method(globalThis,'setTimeout',(callback,ms,...args)=>{if(ms===600000)expire=callback;return schedule(callback,ms,...args)});
 const q=new GenerationQueue(dir,async(job,signal)=>{calls++;if(job.id==='one'){receivedSignal=signal;begin();await gate}return {...asset,id:job.id}});
 await q.submit(input,connection);await started;await q.submit({...input,id:'next'},connection);
 assert.equal(typeof expire,'function');expire();assert.equal(receivedSignal.aborted,true);release();
 assert.equal((await done(q,'next')).status,'completed');
 const failed=await q.get('one','project');assert.equal(failed.status,'failed');assert.equal(failed.result,undefined);assert.match(failed.error,/10分钟.*核对请求记录/);
 const restored=new GenerationQueue(dir,()=>{calls++;throw Error('must not resubmit')});
 assert.equal((await restored.get('one','project')).status,'failed');assert.equal(calls,2);
 assert.equal(JSON.parse(await readFile(path.join(dir,'one.json'),'utf8')).job.result,undefined);
});
test('invalid snapshots and failed processing do not publish results; collection is isolated and deduplicated',async t=>{
 for(const patch of [{id:'../x'},{references:['https://host/image.png']},{references:Array(13).fill(ref)},{prompt:''},{size:'100000x100000'},{sourceNodeId:'../x'}])assert.throws(()=>generationInput({...input,...patch}));
 const q=new GenerationQueue(await folder(t),async()=>{throw Error('service unavailable')});await q.submit(input,connection);
 assert.equal((await done(q)).status,'failed');assert.equal((await q.get('one','project')).result,undefined);
 const p={id:'project',assets:[],jobs:[]},job={...input,...connection,createdAt:new Date().toISOString(),status:'completed',result:asset};const saved=collectGeneration(p,job);
 assert.equal(saved.assets.length,1);assert.strictEqual(collectGeneration(saved,job),saved);assert.equal(p.assets.length,0);
 assert.equal(saved.jobs[0].prompt,job.prompt);assert.equal(saved.jobs[0].assetId,asset.id);assert.equal(saved.jobs[0].model,job.model);
 assert.throws(()=>collectGeneration({id:'other',assets:[]},job),/工程已切换/);
 assert.throws(()=>collectGeneration({...p,assets:Array.from({length:500},(_,i)=>({id:String(i)}))},job),/500/);
});
test('Images adapter preserves ordered references/size, redacts key, rejects connection changes, and aborts requests',async t=>{
 const png=await sharp({create:{width:2,height:2,channels:4,background:'#ff000080'}}).png().toBuffer(),requests=[];
 const server=createServer(async(req,res)=>{
  const bytes=[];for await(const chunk of req)bytes.push(chunk);const body=Buffer.concat(bytes);
  const request=new Request('http://127.0.0.1'+req.url,{method:'POST',headers:req.headers,body});
  const parsed=req.headers['content-type']?.startsWith('multipart')?await request.formData():JSON.parse(body.toString());requests.push(parsed);
  const prompt=parsed instanceof FormData?parsed.get('prompt'):parsed.prompt;
  if(prompt==='error'){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'bad fixture-secret'}}));return}
  if(prompt==='delay')await wait(250);
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close()});
 const baseUrl=`http://127.0.0.1:${server.address().port}/v1`;setConfig({baseUrl,apiKey:'fixture-secret',model:'fixture'});
 const dataUrl='data:image/png;base64,'+png.toString('base64'),secondPng=await sharp({create:{width:3,height:2,channels:4,background:'#0000ff40'}}).png().toBuffer();
 const output=await gateway('generate',{prompt:'two refs',size:'1024x1536',quality:'high',responseFormatB64Json:true,references:[dataUrl,'data:image/png;base64,'+secondPng.toString('base64')]});
 assert.equal(output.dataUrl,dataUrl);assert.equal(requests[0].getAll('image[]').length,2);assert.equal(requests[0].get('size'),'1024x1536');
 assert.deepEqual(Buffer.from(await requests[0].getAll('image[]')[0].arrayBuffer()),png);assert.deepEqual(Buffer.from(await requests[0].getAll('image[]')[1].arrayBuffer()),secondPng);
 assert.equal(requests[0].get('quality'),'high');assert.equal(requests[0].get('response_format'),'b64_json');
 await gateway('generate',{prompt:'auto size',size:'auto'});assert.ok(!('size' in requests[1]));
 await assert.rejects(gateway('generate',{prompt:'error'}),e=>e.message.includes('[已隐藏]')&&!e.message.includes('fixture-secret'));
 const before=requests.length;await assert.rejects(gateway('generate',{prompt:'x'},undefined,{baseUrl,model:'changed'}),/连接已改变/);assert.equal(requests.length,before);
 const c=new AbortController();const pending=gateway('generate',{prompt:'delay'},c.signal);setTimeout(()=>c.abort(),30);await assert.rejects(pending);await wait(270);
 assert.throws(()=>setConfig({baseUrl:baseUrl+'?key=secret'}),/查询参数/);
});
