import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { GenerationQueue } from '../src/app/api/studio/generation-queue.ts';
import { generationReviewSize } from '../src/app/studio/cloud-tool-input.js';
import { finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';
import { collectGeneration, collectRawGeneration } from '../src/app/studio/collect-generation.ts';

const ref='/api/studio/resource/'+'a'.repeat(64)+'.png';
const operation={kind:'edit',sourceId:'source',sourceWidth:8,sourceHeight:8,width:4,height:4,left:2,top:2};
const input={id:'one',projectId:'project',name:'sample',prompt:'blue',size:'8x8',references:[ref],operation};
const connection={baseUrl:'https://model.example/v1',model:'fixture'};
const raw={id:'raw-asset',name:'raw',dataUrl:ref,width:16,height:16,hasAlpha:false,createdAt:new Date().toISOString(),generationJobId:'raw:one'};
const final={...raw,id:'result',width:8,height:8,generationJobId:'one'};
async function folder(t){const f=await mkdtemp(path.join(tmpdir(),'studio-review-'));t.after(()=>rm(f,{recursive:true,force:true}));return f}
async function done(q){for(let i=0;i<200;i++){const j=await q.get('one','project');if(!['queued','running'].includes(j.status)){await delay(20);return j}await delay(10)}throw Error('timeout')}

test('raw response survives postprocess failure and restart; local resolution is idempotent and does not call provider',async t=>{
 const root=await folder(t);let remote=0,local=0;
 const q=new GenerationQueue(root,async(job,signal,saveRaw)=>{remote++;await saveRaw(raw);throw Error('size mismatch')});
 await q.submit(input,connection);assert.equal((await done(q)).status,'review');
 assert.equal(JSON.parse(await readFile(path.join(root,'one.json'),'utf8')).job.rawResult.id,raw.id);
 const restored=new GenerationQueue(root,async job=>{assert.equal(job.resolution,'fit');local++;return final});
 assert.deepEqual((await restored.get('one','project')).rawResult,raw);
 await assert.rejects(restored.resolveSize('one','other'),/不存在/);
 await Promise.all([restored.resolveSize('one','project'),restored.resolveSize('one','project')]);
 const completed=await done(restored);assert.equal(completed.status,'completed');assert.deepEqual(completed.rawResult,raw);assert.equal(completed.error,undefined);
 await restored.resolveSize('one','project');assert.equal(remote,1);assert.equal(local,1);
 const p={id:'project',assets:[],jobs:[]};
 const savedRaw=collectRawGeneration(p,completed),savedBoth=collectGeneration(savedRaw,completed);
 assert.equal(savedBoth.assets.length,2);assert.equal(savedBoth.jobs.length,0);
 assert.strictEqual(collectRawGeneration(savedBoth,completed),savedBoth);
 assert.throws(()=>collectRawGeneration({...p,id:'other'},completed),/切换/);
});

test('restart after raw persistence requires confirmation and never reruns a paid request',async t=>{
 const root=await folder(t);
 await writeFile(path.join(root,'one.json'),JSON.stringify({hash:'x',job:{...input,...connection,status:'running',rawResult:raw,createdAt:new Date().toISOString()}}));
 let calls=0;const q=new GenerationQueue(root,async()=>{calls++;return final});
 assert.equal((await q.get('one','project')).status,'review');assert.equal(calls,0);
 assert.deepEqual((await q.get('one','project')).rawResult,raw);
});

test('raw collection cannot collide with an ordinary job whose ID starts with raw-',()=>{
 const p={id:'project',assets:[{...final,id:'other-asset',generationJobId:'raw-one'}],jobs:[]};
 assert.equal(collectRawGeneration(p,{...input,...connection,status:'review',rawResult:raw}).assets.length,2);
});

test('late raw response after cancellation is rejected; cancellation during local resolution preserves raw only',async t=>{
 const root=await folder(t);let begin,release;
 const started=new Promise(r=>begin=r),gate=new Promise(r=>release=r);
 const q=new GenerationQueue(root,async(job,signal,saveRaw)=>{begin();await gate;await saveRaw(raw);return final});
 await q.submit(input,connection);await started;await q.cancel('one','project');release();await delay(50);
 const cancelled=await q.get('one','project');assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.rawResult,undefined);assert.equal(cancelled.result,undefined);
 const other=await folder(t);await writeFile(path.join(other,'one.json'),JSON.stringify({hash:'x',job:{...input,...connection,status:'review',rawResult:raw,createdAt:new Date().toISOString()}}));
 let localStart,localRelease;const localStarted=new Promise(r=>localStart=r),localGate=new Promise(r=>localRelease=r);
 const local=new GenerationQueue(other,async()=>{localStart();await localGate;return final});
 await local.resolveSize('one','project');await localStarted;await local.cancel('one','project');localRelease();await delay(50);
 const stopped=await local.get('one','project');assert.equal(stopped.status,'cancelled');assert.deepEqual(stopped.rawResult,raw);assert.equal(stopped.result,undefined);
});

test('explicit proportional downsize protects outside RGBA and rejects smaller or mismatched aspect outputs',async()=>{
 const source=await sharp({create:{width:8,height:8,channels:4,background:'#12345680'}}).png().toBuffer();
 const generated=await sharp({create:{width:16,height:16,channels:4,background:'#0044ffff'}}).png().toBuffer();
 const url=b=>'data:image/png;base64,'+b.toString('base64'),signal=new AbortController().signal;
 await assert.rejects(finishCloudImage(url(source),url(generated),operation,signal),/未拉伸/);
 const bytes=Buffer.from((await finishCloudImage(url(source),url(generated),operation,signal,undefined,true)).split(',')[1],'base64');
 const result=await sharp(bytes).raw().toBuffer();
 for(let y=0;y<8;y++)for(let x=0;x<8;x++)assert.deepEqual(Array.from(result.subarray((y*8+x)*4,(y*8+x)*4+4)),x>=2&&x<6&&y>=2&&y<6?[0,68,255,255]:[18,52,86,128]);
 for(const [width,height] of [[4,4],[16,12]]){
  const invalid=await sharp({create:{width,height,channels:4,background:'#fff'}}).png().toBuffer();
  await assert.rejects(finishCloudImage(url(source),url(invalid),operation,signal,undefined,true),/未拉伸/);
  assert.equal(generationReviewSize({...input,rawResult:{...raw,width,height}}),null);
 }
 assert.deepEqual(generationReviewSize({...input,rawResult:raw}),{width:8,height:8});
});
