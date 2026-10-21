import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { connectedCoverage, growCoverage } from "../src/app/studio/selection-pixels.ts";
import { blankProject, validateProject, createLayer, removeLayers } from "../src/app/studio/model.ts";
import { duplicateLayers } from "../src/app/studio/layer-operations.ts";
import { saveStoredProject, readStoredProject } from "../src/app/api/studio/project-storage.ts";
import { homography, inverseHomography, projectPoint } from "../src/app/studio/perspective.ts";

test("魔棒只连通四邻域，保留洞和透明度，不跳到孤岛", () => {
    const input = new Uint8Array([255,255,0,0,255,255,0,0,0,0,0,0,255,255,255,0]);
    const result = connectedCoverage(input,4,4,0);
    assert.deepEqual([...result],[255,255,0,0,255,255,0,0,0,0,0,0,0,0,0,0]);
    assert.equal(connectedCoverage(new Uint8Array([128,0,0,255]),2,2,0)[0],128);
});
test("扩缩线性算法与暴力像素基准一致，覆盖边缘与半透明", () => {
    const width=19,height=17,input=Uint8Array.from({length:width*height},(_,i)=>(i*43+i%7*19)%256);
    for(const amount of [-4,-1,1,4]){
        const result=growCoverage(input,width,height,amount),radius=Math.abs(amount);
        for(let y=0;y<height;y++)for(let x=0;x<width;x++){
            let expected=amount>0?0:255;
            for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
                const sx=x+dx,sy=y+dy,v=sx<0||sy<0||sx>=width||sy>=height?0:input[sy*width+sx];
                expected=amount>0?Math.max(expected,v):Math.min(expected,v);
            }
            assert.equal(result[y*width+x],expected);
        }
    }
});
test("选区透视正向与逆向映射往返",()=>{
    const quad=[.2,.1,.9,0,1,1,0,.8],forward=homography(quad),inverse=inverseHomography(quad);
    for(const [x,y] of [[0,0],[1,1],[.2,.6],[.8,.3]]){
        const p=projectPoint(forward,x,y),q=projectPoint(inverse,p.x,p.y);
        assert.ok(Math.abs(q.x-x)<1e-8&&Math.abs(q.y-y)<1e-8);
    }
});
test("文档选区保存为独立资源，恢复参数，非法尺寸/组合被拒绝", async()=>{
    const dir=await mkdtemp(path.join(os.tmpdir(),"studio-selection-"));
    try{
        const sharp=(await import("sharp")).default;
        const dataUrl="data:image/png;base64,"+(await sharp({create:{width:1024,height:1536,channels:4,background:"#00000080"}}).png().toBuffer()).toString("base64");
        const p={...blankProject(),selection:{bitmap:{dataUrl,width:1024,height:1536},feather:3,grow:-2,inverted:true}};
        validateProject(p);await saveStoredProject(dir,p);
        const manifest=JSON.parse(await readFile(path.join(dir,`${p.id}.json`),"utf8"));
        assert.ok(manifest.selection.bitmap.resource);assert.equal(manifest.selection.bitmap.dataUrl,undefined);
        assert.deepEqual(await readStoredProject(dir,p.id),p);
        assert.throws(()=>validateProject({...p,selection:{...p.selection,paths:[]}}));
        assert.throws(()=>validateProject({...p,selection:{...p.selection,grow:101}}));
        assert.throws(()=>validateProject({...p,selection:{...p.selection,bitmap:{...p.selection.bitmap,width:512}}}));
        manifest.selection.bitmap.resource="../outside.png";await import("node:fs/promises").then(fs=>fs.writeFile(path.join(dir,`${p.id}.json`),JSON.stringify(manifest)));
        await assert.rejects(()=>readStoredProject(dir,p.id),/路径/);
    }finally{await rm(dir,{recursive:true,force:true});}
});
test("实时蒙版拒绝循环与缺失来源，复制重映射，删除来源解除引用",()=>{
    const a={...createLayer("shape","A"),shape:"rect"},b={...createLayer("shape","B"),shape:"rect",maskSourceId:a.id};
    const p={...blankProject(),layers:[a,b]};validateProject(p);
    assert.throws(()=>validateProject({...p,layers:[{...a,maskSourceId:b.id},b]}),/循环/);
    assert.throws(()=>validateProject({...p,layers:[{...b,maskSourceId:"missing"}]}),/缺失/);
    const copy=duplicateLayers(p,[a.id,b.id]).project;
    const copies=copy.layers.filter(l=>l.id!==a.id&&l.id!==b.id);
    assert.equal(copies[1].maskSourceId,copies[0].id);
    assert.equal(removeLayers(p.layers,[a.id])[0].maskSourceId,undefined);
    assert.throws(()=>validateProject({...p,layers:[{...a,mask:{x:0,y:0,width:1,height:1,anchor:{matrix:[0,0,0,0,0,0],width:64,height:64}}}]}),/坐标/);
});
