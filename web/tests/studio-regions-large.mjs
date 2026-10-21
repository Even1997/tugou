import sharp from 'sharp';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { processImageTool } from '../src/app/api/studio/image-tools.ts';
const root = process.env.STUDIO_REGION_TEST_DIR;
if(!root || !path.isAbsolute(root) || !root.includes('qa-region')) throw Error('An isolated qa-region directory is required');
const folder=path.join(root,String(Date.now()));await mkdir(folder,{recursive:true});
await sharp({create:{width:10000,height:10000,channels:4,background:{r:37,g:83,b:129,alpha:.5}}}).png().toFile(path.join(folder,'input'));
await sharp({create:{width:64,height:64,channels:4,background:{r:200,g:40,b:60,alpha:1}}}).png().toFile(path.join(folder,'secondary'));
let peak=process.memoryUsage().rss;const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss)},10);
const started=performance.now();
try {
    const result=await processImageTool(root,{id:'large',projectId:'qa',sourceId:'source',secondarySourceId:'material',name:'100MP region',tool:'patch',options:{left:3000,top:3000,width:4000,height:4000,feather:2}},folder,new AbortController().signal,()=>{});
    const seconds=(performance.now()-started)/1000;assert.equal(result.width,10000);assert.equal(result.height,10000);
    const image=sharp(path.join(folder,'output.png'));
    const outside=await image.clone().extract({left:0,top:0,width:8,height:8}).raw().toBuffer();
    const before=await sharp(path.join(folder,'input')).extract({left:0,top:0,width:8,height:8}).raw().toBuffer();assert.deepEqual(outside,before);
    const inside=await image.clone().extract({left:5000,top:5000,width:1,height:1}).raw().toBuffer();assert.deepEqual([...inside],[200,40,60,255]);
    peak=Math.max(peak,process.memoryUsage().rss);
    await writeFile(new URL('../../docs/studio-evidence/atelier-regions-large.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),width:10000,height:10000,seconds,nodeIncludingNativePeakMiB:Math.round(peak/1024/1024),outsideSampleUnchanged:true,insidePixelCorrect:true,output:path.join(folder,'output.png')},null,2));
    console.log(JSON.stringify({seconds,peakMiB:Math.round(peak/1024/1024),dimensions:[result.width,result.height]}));
} finally {clearInterval(sampler)}
