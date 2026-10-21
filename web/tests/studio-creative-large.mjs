import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import { processImageTool } from '../src/app/api/studio/image-tools.ts';
const root=process.env.STUDIO_CREATIVE_TEST_DIR;
const maximum=process.env.STUDIO_CREATIVE_MAX_TEST==='1',patternSize=maximum?10000:4096;
if(!root || !path.isAbsolute(root) || !root.includes('qa-creative'))throw Error('Isolated qa-creative directory required');
const original=new URL('../public/studio-demo/03-couple.png',import.meta.url),results=[];
for(const [tool,options] of [['relight',{lightType:'radial',lightX:.3,lightY:.2,lightRadius:.8,angle:0,exposure:.8,color:'#ffead1'}],['pattern',{width:patternSize,height:patternSize,pattern:'half-drop',gap:20,tileScale:.25}]]) {
    const folder=path.join(root,tool+'-'+Date.now());await mkdir(folder,{recursive:true});
    if(maximum&&tool==='relight')await sharp({create:{width:10000,height:10000,channels:4,background:{r:60,g:90,b:120,alpha:.5}}}).png().toFile(path.join(folder,'input'));
    else await copyFile(original,path.join(folder,'input'));
    let peak=process.memoryUsage().rss;const sampler=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss)},10);const start=performance.now();
    try {
        const result=await processImageTool(root,{id:tool,projectId:'qa',sourceId:'source',name:'C reference',tool,options},folder,new AbortController().signal,()=>{});
        const seconds=(performance.now()-start)/1000;peak=Math.max(peak,process.memoryUsage().rss);
        if(tool==='relight')assert.deepEqual(await sharp(path.join(folder,'output.png')).extractChannel('alpha').raw().toBuffer(),await sharp(path.join(folder,'input')).extractChannel('alpha').raw().toBuffer());
        else {assert.equal(result.width,patternSize);assert.equal(result.height,patternSize);assert.ok((await sharp(path.join(folder,'output.png')).stats()).channels[3].min===0)}
        results.push({tool,...result,seconds,nodeIncludingNativePeakMiB:Math.round(peak/1024/1024),output:path.join(folder,'output.png')});
    }finally{clearInterval(sampler)}
}
await writeFile(new URL(`../../docs/studio-evidence/atelier-creative-${maximum?'100mp':'large'}.json`,import.meta.url),JSON.stringify({at:new Date().toISOString(),results},null,2));console.log(JSON.stringify(results));
