import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { prepareCloudImage, finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';

const encode=b=>'data:image/png;base64,'+b.toString('base64'),decode=s=>Buffer.from(s.split(',')[1],'base64');
const png=async(width,height,background)=>sharp({create:{width,height,channels:4,background}}).png().toBuffer();
const source=encode(await png(10000,10000,'#dc784080')),generated=encode(await png(10000,10000,'#0080ff'));
const mask=encode(await sharp(await png(10000,10000,'#00000000')).composite([
 {input:await png(6000,6000,'#ffffffff'),left:2000,top:2000},
 {input:await png(2000,2000,'#ffffffff'),left:4000,top:4000,blend:'dest-out'},
 {input:await png(100,6000,'#ffffff80'),left:1900,top:2000},
]).png().toBuffer());
const op={kind:'edit',sourceId:'large',sourceWidth:10000,sourceHeight:10000,width:10000,height:10000,left:0,top:0},signal=new AbortController().signal;
const start=performance.now(),prepared=await prepareCloudImage(source,op,signal,mask),preparedAt=performance.now();
const result=await finishCloudImage(source,generated,op,signal,mask),finishedAt=performance.now();
const hash=async(image,region)=>createHash('sha256').update(await sharp(decode(image)).extract(region).ensureAlpha().raw().toBuffer()).digest('hex');
for(const region of [{left:0,top:0,width:10000,height:1900},{left:4000,top:4000,width:2000,height:2000}])assert.equal(await hash(result,region),await hash(source,region));
for(const[x,y,expected,alpha]of[[0,0,[220,120,64,128],255],[2500,2500,[0,128,255,255],0],[5000,5000,[220,120,64,128],255],[1950,2500,[73,125,192,192],127]]){
 const region={left:x,top:y,width:1,height:1};assert.deepEqual([...await sharp(decode(result)).extract(region).ensureAlpha().raw().toBuffer()],expected);
 assert.equal((await sharp(decode(prepared.mask)).extract(region).ensureAlpha().raw().toBuffer())[3],alpha);
}
const report={at:new Date().toISOString(),fixture:'100MP synthetic semitransparent source and local provider placeholder; not model quality',output:[10000,10000],preparedMs:Math.round(preparedAt-start),compositeMs:Math.round(finishedAt-preparedAt),peakProcessMiB:Math.round(process.resourceUsage().maxRSS/1024),protected23MPHashEqual:true,holeAndFeatherPixels:true};
await writeFile(new URL('../../docs/studio-evidence/atelier-selection-cloud-large.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
