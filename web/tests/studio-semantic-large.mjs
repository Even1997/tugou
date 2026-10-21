import sharp from 'sharp';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { finishCloudImage } from '../src/app/api/studio/cloud-image-tools.js';

const encode=b=>'data:image/png;base64,'+b.toString('base64'),decode=s=>Buffer.from(s.split(',')[1],'base64');
const png=(width,height,background)=>sharp({create:{width,height,channels:4,background}}).png().toBuffer();
const source=await png(10000,10000,'#dc784080'),mask=await sharp(await png(10000,10000,'#000000')).composite([
 {input:await png(6000,6000,'#ffffff'),left:2000,top:2000},
 {input:await png(2000,2000,'#000000'),left:4000,top:4000},
 {input:await png(100,6000,'#808080'),left:1900,top:2000},
]).png().toBuffer();
const start=performance.now(),result=decode(await finishCloudImage(encode(source),encode(mask),{kind:'segment',sourceId:'large',sourceWidth:10000,sourceHeight:10000,width:10000,height:10000,left:0,top:0},new AbortController().signal)),finished=performance.now();
const rgbHash=async bytes=>createHash('sha256').update(await sharp(bytes).removeAlpha().raw().toBuffer()).digest('hex');assert.equal(await rgbHash(result),await rgbHash(source));
for(const[x,y,alpha]of[[0,0,0],[2500,2500,128],[5000,5000,0],[1950,2500,64]])assert.equal((await sharp(result).extract({left:x,top:y,width:1,height:1}).ensureAlpha().raw().toBuffer())[3],alpha);
const report={at:new Date().toISOString(),fixture:'100MP synthetic source and grayscale mask; not a real semantic model',output:[10000,10000],extractionMs:Math.round(finished-start),peakProcessMiB:Math.round(process.resourceUsage().maxRSS/1024),all100MPRGBHashEqual:true,alphaAndHoleSamples:true};
await writeFile(new URL('../../docs/studio-evidence/atelier-semantic-large.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
