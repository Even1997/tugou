import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { setTimeout as wait } from "node:timers/promises";
import sharp from "sharp";
import { alphaParts, gridParts, splitImage } from "../src/app/api/studio/split-image.js";
import { validateTool, processImageTool } from "../src/app/api/studio/image-tools.ts";
import { ToolQueue } from "../src/app/api/studio/tool-queue.ts";
import { blankProject, createLayer } from "../src/app/studio/model.ts";
import { collectToolResults } from "../src/app/studio/collect-tool-results.ts";

const options={splitMode:"alpha",minArea:2,rows:2,columns:3},signal=()=>new AbortController().signal;
async function folder(t){const dir=await mkdtemp(path.join(os.tmpdir(),"studio-split-"));t.after(()=>rm(dir,{recursive:true,force:true}));return dir}
function sample(){
    const width=11,height=9,data=Buffer.alloc(width*height*4);
    const pixel=(x,y,a=255)=>{const i=(y*width+x)*4;data[i]=x*19;data[i+1]=y*21;data[i+2]=117;data[i+3]=a};
    // A ring surrounds a separate island: bounding rectangles overlap but pixel ownership must not.
    for(let y=1;y<8;y++)for(let x=1;x<8;x++)if(x===1||x===7||y===1||y===7)pixel(x,y,128);
    pixel(4,4);pixel(5,4,1);pixel(10,8,64);
    return {data,width,height};
}
async function png(f){return sharp(f.data,{raw:{width:f.width,height:f.height,channels:4}}).png().toBuffer()}
async function reconstruct(dir,count,f){
    const merged=Buffer.alloc(f.data.length),owners=new Uint8Array(f.width*f.height);
    for(let index=0;index<count;index++){
        const decoded=await sharp(await readFile(path.join(dir,index?`output-${index}.png`:"output.png"))).ensureAlpha().raw().toBuffer();
        for(let i=0;i<owners.length;i++)if(decoded[i*4+3]){assert.equal(owners[i]++,0,"pixel belongs to more than one layer");decoded.copy(merged,i*4,i*4,i*4+4)}
    }
    for(let i=0;i<owners.length;i++)if(f.data[i*4+3])assert.deepEqual(merged.subarray(i*4,i*4+4),f.data.subarray(i*4,i*4+4));else assert.equal(merged[i*4+3],0);
}
test("transparent islands preserve holes, nested objects, alpha=1 and small remnants",async t=>{
    const f=sample(),dir=await folder(t),plan=await alphaParts(f.data,f.width,f.height,2,signal());
    assert.equal(plan.parts.length,3);assert.equal(plan.parts.at(-1).name,"细小区域");assert.notEqual(plan.labels[4*f.width+4],plan.labels[1*f.width+1]);
    const result=await splitImage(await png(f),dir,options,signal(),()=>{});
    assert.equal(result.outputs.length,3);assert.ok(result.outputs.every(o=>o.width===11&&o.height===9&&o.hasAlpha&&o.bytes>0));
    await reconstruct(dir,3,f);
});
test("grid covers non-divisible edges exactly once with full-frame alignment",async t=>{
    const f=sample(),dir=await folder(t),parts=gridParts(11,9,3,2);
    assert.equal(parts.reduce((n,p)=>n+p.pixels,0),99);
    assert.deepEqual(parts.at(-1).bounds,{left:7,top:4,width:4,height:5});
    const result=await splitImage(await png(f),dir,{...options,splitMode:"grid"},signal(),()=>{});
    assert.equal(result.outputs.length,6);await reconstruct(dir,6,f);
});
test("diagonal pixels connect, opaque/empty/excessive inputs fail without silently dropping areas",async()=>{
    const data=Buffer.alloc(4*4*4);data[3]=1;data[(1*4+1)*4+3]=1;
    assert.equal((await alphaParts(data,4,4,1,signal())).parts.length,1);
    await assert.rejects(alphaParts(Buffer.alloc(16,255),2,2,1,signal()),/透明底/);
    await assert.rejects(alphaParts(Buffer.alloc(16),2,2,1,signal()),/完全透明/);
    const noisy=Buffer.alloc(33*33*4);for(let y=0;y<33;y+=4)for(let x=0;x<33;x+=4)noisy[(y*33+x)*4+3]=255;
    await assert.rejects(alphaParts(noisy,33,33,1,signal()),/超过 64/);
    assert.equal((await alphaParts(noisy,33,33,2,signal())).parts.length,1);
    assert.throws(()=>gridParts(2,2,3,2),/像素尺寸/);
    for(const patch of [{rows:0},{columns:17},{rows:16,columns:16},{minArea:0},{splitMode:"semantic"}])assert.throws(()=>validateTool("split",{...options,...patch}));
    const c=new AbortController();c.abort();await assert.rejects(alphaParts(data,4,4,1,c.signal),/abort/i);
});
async function settled(queue,id){for(let n=0;n<300;n++){const j=(await queue.list("p")).find(j=>j.id===id);if(j&&!['queued','running'].includes(j.status)){await wait(30);return j}await wait(10)}throw Error('timeout')}
test("multi-output queue persists, restores, checks indices and project ownership",async t=>{
    const dir=await folder(t),input=await png(sample()),processor=(job,folder,s,p)=>processImageTool(dir,job,folder,s,p);
    const queue=new ToolQueue(dir,processor);
    await queue.submit({id:"split",projectId:"p",sourceId:"a",name:"sample",tool:"split",options,dataUrl:"data:image/png;base64,"+input.toString("base64")});
    const job=await settled(queue,"split");assert.equal(job.status,"completed");assert.equal(job.outputs.length,3);
    const second=await queue.result("split","p",1),restored=new ToolQueue(dir,processor);
    assert.deepEqual(await restored.result("split","p",1),second);
    await assert.rejects(queue.result("split","other",1));
    for(const index of [-1,3,.5,"../input"])await assert.rejects(queue.result("split","p",index),/序号/);
    const manifest=JSON.parse(await readFile(path.join(dir,"split","job.json"),"utf8"));manifest.job.status="running";
    await writeFile(path.join(dir,"split","job.json"),JSON.stringify(manifest));
    const interrupted=new ToolQueue(dir,processor);assert.equal((await interrupted.list("p"))[0].status,"interrupted");
    await assert.rejects(interrupted.result("split","p",1));assert.ok(!(await readdir(path.join(dir,"split"))).some(file=>file.startsWith("output")));
});
test("cancellation hides and cleans every partial output, including a late writer",async t=>{
    const dir=await folder(t);let started;const ready=new Promise(r=>started=r);
    const queue=new ToolQueue(dir,async(job,folder,s)=>{await writeFile(path.join(folder,"output.png"),"first");started();await wait(60);await writeFile(path.join(folder,"output-1.png"),"late");return {width:1,height:1,outputs:[]}});
    await queue.submit({id:"cancel",projectId:"p",sourceId:"a",name:"sample",tool:"split",options,dataUrl:"data:image/png;base64,YQ=="});await ready;await queue.cancel("cancel","p");await wait(150);
    assert.equal((await queue.list("p"))[0].status,"cancelled");await assert.rejects(queue.result("cancel","p"));
    assert.ok(!(await readdir(path.join(dir,"cancel"))).some(file=>file.startsWith("output")));
    assert.ok((await readdir(path.join(dir,"cancel"))).includes("input"));
});
test("batch collection deduplicates each output, aligns transforms, and hides original in one transaction",()=>{
    const source={...createLayer("image","source"),assetId:"a",x:45,y:65,rotation:27,flipX:true,opacity:.7};
    const p={...blankProject(),id:"p",layers:[source],assets:[{id:"a"}]},job={id:"split",projectId:"p",sourceId:"a",tool:"split",options};
    const results=[0,1,2].map(index=>({index,asset:{id:`out-${index}`,name:`part ${index}`,dataUrl:"data:image/png;base64,YQ==",width:11,height:9,hasAlpha:true}}));
    const first=collectToolResults(p,job,[results[1]]).project;
    const all=collectToolResults(first,job,results,source.id,true);
    assert.equal(all.project.assets.length,4);assert.equal(all.project.layers.length,4);assert.equal(all.project.layers[0].visible,false);assert.equal(p.layers[0].visible,true);
    for(const l of all.project.layers.slice(1))for(const key of ["x","y","rotation","flipX","opacity"])assert.equal(l[key],source[key]);
    assert.strictEqual(collectToolResults(all.project,job,results).project,all.project);
    assert.throws(()=>collectToolResults({...p,id:"other"},job,results),/工程已切换/);
    assert.throws(()=>collectToolResults({...p,assets:Array.from({length:500},(_,i)=>({id:String(i)}))},job,results),/500/);
    assert.equal(p.assets.length,1);
});
