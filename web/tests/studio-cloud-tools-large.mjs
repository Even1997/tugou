import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { prepareCloudImage, finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';

const root=process.env.STUDIO_LARGE_OUTPUT_ROOT;
if(!root||!path.isAbsolute(root))throw Error('Set isolated STUDIO_LARGE_OUTPUT_ROOT');
await mkdir(root,{recursive:true});
const encode=buffer=>'data:image/png;base64,'+buffer.toString('base64'),decode=url=>Buffer.from(url.split(',')[1],'base64');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
const source=encode(await sharp({create:{width:8000,height:8000,channels:4,background:'#dc784080'}}).png().toBuffer());
const generated=encode(await sharp({create:{width:10000,height:10000,channels:4,background:'#1267ae'}}).png().toBuffer());
const operation={kind:'outpaint',sourceId:'large',sourceWidth:8000,sourceHeight:8000,left:1000,top:1000,width:10000,height:10000},signal=new AbortController().signal;
const start=performance.now(),prepared=await prepareCloudImage(source,operation,signal),preparedAt=performance.now();
const after=await finishCloudImage(source,generated,operation,signal),finishedAt=performance.now();
const sourceHash=hash(await sharp(decode(source)).ensureAlpha().raw().toBuffer());
assert.equal(hash(await sharp(decode(after)).extract({left:1000,top:1000,width:8000,height:8000}).ensureAlpha().raw().toBuffer()),sourceHash);
for(const [x,y,alpha] of [[0,0,0],[999,1000,0],[1000,1000,255],[8999,8999,255],[9000,9000,0]]){
 const pixel=await sharp(decode(prepared.mask)).extract({left:x,top:y,width:1,height:1}).ensureAlpha().raw().toBuffer();assert.equal(pixel[3],alpha);
}
const corner=await sharp(decode(after)).extract({left:0,top:0,width:1,height:1}).ensureAlpha().raw().toBuffer();assert.deepEqual([...corner],[18,103,174,255]);
await writeFile(path.join(root,'protected-outpaint.png'),decode(after));
const result={at:new Date().toISOString(),fixture:'synthetic 64MP semitransparent source, 100MP provider placeholder; no real model',output:[10000,10000],preparedMs:Math.round(preparedAt-start),protectedCompositeMs:Math.round(finishedAt-preparedAt),peakProcessMiB:Math.round(process.resourceUsage().maxRSS/1024),protected64MPHashEqual:true,maskBoundarySamples:true,outputFile:path.join(root,'protected-outpaint.png')};
await writeFile(new URL('../../docs/studio-evidence/atelier-cloud-tools-large.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
