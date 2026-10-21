import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { regionImage } from '../src/app/api/studio/region-tools.js';
import { validateTool } from '../src/app/api/studio/image-tools.ts';

async function fixture(t) {
    const folder=await mkdtemp(path.join(os.tmpdir(),'studio-region-'));
    t.after(()=>rm(folder,{recursive:true,force:true}));
    const raw=Buffer.from(Array.from({length:8*6*4},(_,i)=>(i*71)%256));
    const source=path.join(folder,'input.png'), secondary=path.join(folder,'secondary.png');
    await sharp(raw,{raw:{width:8,height:6,channels:4}}).png().toFile(source);
    await sharp({create:{width:2,height:2,channels:4,background:{r:255,g:20,b:30,alpha:.5}}}).png().toFile(secondary);
    return {source,secondary,raw};
}
const region={left:2,top:1,width:3,height:4,feather:1};
test('局部替换/材质在所有RGBA值下严格保留选区外像素；材质保留透明度',async t=>{
    const {source,secondary,raw}=await fixture(t);
    for(const tool of ['patch','texture']) {
        const output=await(await regionImage(source,tool,region,secondary,new AbortController().signal)).raw().toBuffer();
        let changed=0;
        for(let y=0;y<6;y++)for(let x=0;x<8;x++) {
            const i=(y*8+x)*4, inside=x>=2&&x<5&&y>=1&&y<5;
            if(!inside) assert.deepEqual(output.subarray(i,i+4),raw.subarray(i,i+4));
            else if(!output.subarray(i,i+4).equals(raw.subarray(i,i+4))) changed++;
            if(tool==='texture') assert.equal(output[i+3],raw[i+3]);
        }
        assert.ok(changed>0);
    }
});
test('框选提取保持完整尺寸和区域内像素，扩边平移不重采样',async t=>{
    const {source,secondary,raw}=await fixture(t);
    const extracted=await(await regionImage(source,'extract',{...region,feather:0},secondary,new AbortController().signal)).raw().toBuffer({resolveWithObject:true});
    assert.equal(extracted.info.width,8); assert.equal(extracted.info.height,6);
    for(let y=0;y<6;y++)for(let x=0;x<8;x++) {
        const i=(y*8+x)*4,inside=x>=2&&x<5&&y>=1&&y<5;
        assert.deepEqual(extracted.data.subarray(i,i+4),inside?raw.subarray(i,i+4):Buffer.alloc(4));
    }
    const expanded=await(await regionImage(source,'extend',{left:2,top:3,width:12,height:10},secondary,new AbortController().signal)).raw().toBuffer();
    for(let y=0;y<10;y++)for(let x=0;x<12;x++) {
        const i=(y*12+x)*4, inside=x>=2&&x<10&&y>=3&&y<9, old=((y-3)*8+x-2)*4;
        assert.deepEqual(expanded.subarray(i,i+4),inside?raw.subarray(old,old+4):Buffer.alloc(4));
    }
});
test('错误选区/扩边/羽化被拒绝；取消不继续处理',async t=>{
    const {source,secondary}=await fixture(t);
    await assert.rejects(regionImage(source,'patch',{left:7,top:1,width:3,height:4},secondary,new AbortController().signal),/超出/);
    await assert.rejects(regionImage(source,'extend',{left:1,top:0,width:8,height:6},secondary,new AbortController().signal),/容纳/);
    assert.throws(()=>validateTool('extract',{...region,feather:11}),/羽化/);
    assert.throws(()=>validateTool('extend',{left:0,top:0,width:30000,height:30000}),/像素/);
    await assert.rejects(regionImage(source,'extract',region,secondary,AbortSignal.abort(new Error('cancelled'))),/cancelled/);
});
test('大于选区的材质正确裁边，原尺寸纹理不被缩小',async t=>{
    const {source,secondary}=await fixture(t);
    const pixels=Buffer.from([255,0,0,255, 0,255,0,255, 0,0,255,255]);
    await writeFile(secondary,await sharp(pixels,{raw:{width:3,height:1,channels:4}}).png().toBuffer());
    const output=await(await regionImage(source,'texture',{left:0,top:0,width:2,height:1,feather:0},secondary,new AbortController().signal)).raw().toBuffer();
    assert.deepEqual([...output.subarray(0,3)],[255,0,0]); assert.deepEqual([...output.subarray(4,7)],[0,255,0]);
});
