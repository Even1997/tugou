import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { lightImage, patternImage } from '../src/app/api/studio/creative-tools.js';
import { checkToolMemory, validateTool } from '../src/app/api/studio/image-tools.ts';
const lighting={lightType:'linear',lightX:.5,lightY:.5,lightRadius:.4,angle:0,exposure:1,color:'#ffffff'};
async function file(t,width,height,data){const root=await mkdtemp(path.join(os.tmpdir(),'studio-creative-'));t.after(()=>rm(root,{recursive:true,force:true}));const input=path.join(root,'input.png');await sharp(data,{raw:{width,height,channels:4}}).png().toFile(input);return input}
const signal=()=>new AbortController().signal;
test('零曝光逐像素不变；方向光明暗方向正确，所有透明度保留',async t=>{
    const raw=Buffer.from(Array.from({length:8*4},(_,i)=>i%4===3?Math.floor(i/4)*32:90));
    const input=await file(t,8,1,raw);
    const identity=await(await lightImage(input,{...lighting,exposure:0},signal())).raw().toBuffer();assert.deepEqual(identity,raw);
    const bright=await(await lightImage(input,lighting,signal())).raw().toBuffer(),dark=await(await lightImage(input,{...lighting,exposure:-1},signal())).raw().toBuffer();
    assert.ok(bright[28]>bright[4]);assert.ok(dark[28]<dark[4]);
    for(let i=3;i<raw.length;i+=4){assert.equal(bright[i],raw[i]);assert.equal(dark[i],raw[i])}
    assert.deepEqual(bright.subarray(0,4),raw.subarray(0,4));
});
test('径向光半径外不变；红色光只改变红通道；取消不输出',async t=>{
    const raw=Buffer.alloc(9*9*4);for(let i=0;i<raw.length;i+=4){raw.set([60,90,120,128],i)}const input=await file(t,9,9,raw);
    const result=await(await lightImage(input,{...lighting,lightType:'radial',color:'#ff0000'},signal())).raw().toBuffer();
    assert.deepEqual(result.subarray(0,4),raw.subarray(0,4));const center=(4*9+4)*4;assert.ok(result[center]>60);
    for(let i=0;i<raw.length;i+=4){assert.equal(result[i+1],90);assert.equal(result[i+2],120);assert.equal(result[i+3],128)}
    await assert.rejects(lightImage(input,lighting,AbortSignal.abort(new Error('cancelled'))),/cancelled/);
});
test('重复/镜像/隔列错位像素位置正确，间距保持透明，不改变半透明像素',async t=>{
    const raw=Buffer.from([10,20,30,64, 40,50,60,128, 70,80,90,192, 100,110,120,255]);const input=await file(t,2,2,raw);
    const options={width:4,height:4,pattern:'repeat',gap:0,tileScale:1};
    const repeat=await(await patternImage(input,options,signal())).raw().toBuffer();assert.deepEqual([...repeat.subarray(0,16)],[...raw.subarray(0,8),...raw.subarray(0,8)]);
    const mirror=await(await patternImage(input,{...options,pattern:'mirror'},signal())).raw().toBuffer();assert.deepEqual([...mirror.subarray(0,16)],[...raw.subarray(0,8),...raw.subarray(4,8),...raw.subarray(0,4)]);
    assert.deepEqual(mirror.subarray(32,40),raw.subarray(8,16));
    const stagger=await(await patternImage(input,{...options,pattern:'half-drop'},signal())).raw().toBuffer();assert.deepEqual(stagger.subarray(8,16),raw.subarray(8,16));assert.deepEqual(stagger.subarray(24,32),raw.subarray(0,8));
    const gaps=await(await patternImage(input,{...options,gap:1},signal())).raw().toBuffer();assert.deepEqual(gaps.subarray(8,12),Buffer.alloc(4));assert.deepEqual(gaps.subarray(32,48),Buffer.alloc(16));assert.deepEqual(gaps.subarray(0,4),raw.subarray(0,4));
});
test('图案缩放/输出尺寸与取消，非法参数及低内存拒绝',async t=>{
    const input=await file(t,2,2,Buffer.alloc(16,100));const options={width:3,height:5,pattern:'repeat',gap:0,tileScale:.5};
    const {info}=await(await patternImage(input,options,signal())).raw().toBuffer({resolveWithObject:true});assert.equal(info.width,3);assert.equal(info.height,5);
    await assert.rejects(patternImage(input,options,AbortSignal.abort(new Error('cancelled'))),/cancelled/);
    for(const patch of [{exposure:NaN},{color:'javascript:bad'},{lightRadius:0},{lightX:2}])assert.throws(()=>validateTool('relight',{...lighting,...patch}),/打光/);
    for(const patch of [{gap:-1},{tileScale:0},{pattern:'unknown'}])assert.throws(()=>validateTool('pattern',{...options,...patch}),/图案/);
    assert.throws(()=>checkToolMemory(100_000_000,128*1024**2),/内存不足/);assert.doesNotThrow(()=>checkToolMemory(100_000_000,3*1024**3));
});
