import test from "node:test";
import assert from "node:assert/strict";
import { adjustmentDefinitions, defaultAdjustment, defaultEffect, validAdjustment, validEffects } from "../src/app/studio/tone-schema.js";
import { adjustPixels, curveLut, edgeDistance } from "../src/app/studio/tone-pixels.ts";
import { blankProject, createLayer, validateProject, recoverProject } from "../src/app/studio/model.ts";
const pixel = (kind, values = {}, input = [100, 150, 200, 128], extra = {}) => {
    const a = defaultAdjustment(kind), data = new Uint8ClampedArray(input);
    adjustPixels(data, 1, { ...a, ...extra, values: { ...a.values, ...values } }); return [...data];
};
test("中性调整不改变 RGBA，透明像素不被着色", () => {
    for (const kind of ["hsv", "levels", "curves", "exposure", "balance"]) assert.deepEqual(pixel(kind), [100,150,200,128], kind);
    for (const kind of Object.keys(adjustmentDefinitions)) assert.deepEqual(pixel(kind, {}, [10,20,30,0]), [10,20,30,0], kind);
});
test("色相、色阶、曝光、黑白、色彩平衡与反相符合固定数值基准", () => {
    assert.deepEqual(pixel("hsv", {hue:120}, [255,0,0,255]), [0,255,0,255]);
    assert.deepEqual(pixel("hsv", {saturation:-100}, [255,0,0,255]), [128,128,128,255]);
    assert.deepEqual(pixel("levels", {black:100,white:200},[100,150,200,128]), [0,128,255,128]);
    const exposure=pixel("exposure",{exposure:1},[100,100,100,128]); assert.ok(exposure[0]>=137&&exposure[0]<=139);assert.equal(exposure[3],128);
    assert.deepEqual(pixel("bw",{},[255,0,0,128]),[76,76,76,128]);
    assert.deepEqual(pixel("invert"),[155,105,55,128]);
    assert.deepEqual(pixel("balance",{red:100},[128,0,255,128]),[255,0,255,128]);
});
test("渐变映射、RGB 独立曲线、曲线插值无额外过冲", () => {
    assert.deepEqual(pixel("gradient",{},[0,0,0,128],{colors:["#ff0000","#0000ff"]}),[255,0,0,128]);
    assert.deepEqual(pixel("gradient",{},[255,255,255,128],{colors:["#ff0000","#0000ff"]}),[0,0,255,128]);
    const a=defaultAdjustment("curves");a.curves[1]=[[0,1],[1,0]];
    assert.deepEqual(pixel("curves",{},[100,150,200,128],a),[155,150,200,128]);
    const lut=curveLut([[0,0],[.3,.7],[.6,.2],[1,1]]);
    for(let i=0;i<256;i++){assert.ok(lut[i]>=0&&lut[i]<=1);if(i/255>.3&&i/255<.6)assert.ok(lut[i]>=.2-1e-6&&lut[i]<=.7+1e-6);}
});
test("颗粒与杂色固定种子；全图与分块文档坐标完全一致", () => {
    for(const kind of ["grain","noise"]){
        const a=defaultAdjustment(kind),original=new Uint8ClampedArray(64*32*4).fill(128),full=original.slice();
        adjustPixels(full,64,a,15,20,1);
        const stripe=original.slice(64*8*4,64*24*4);adjustPixels(stripe,64,a,15,28,1);
        assert.deepEqual(stripe,full.slice(64*8*4,64*24*4));assert.notDeepEqual(full,original);
        for(let i=3;i<full.length;i+=4)assert.equal(full[i],128);
    }
});
test("圆形描边距离与暴力欧氏距离一致，包括没有边界的情况",()=>{
    const w=17,h=13,a=new Uint8ClampedArray(w*h*4);for(let y=4;y<9;y++)for(let x=6;x<11;x++)a[(y*w+x)*4+3]=255;
    for(const opaque of [true,false]){
        const actual=edgeDistance(a,w,h,opaque);
        for(let y=0;y<h;y++)for(let x=0;x<w;x++){let d=Infinity;for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++)if((a[(yy*w+xx)*4+3]>=128)===opaque)d=Math.min(d,Math.hypot(x-xx,y-yy));assert.ok(Math.abs(actual[y*w+x]-d)<1e-5);}
    }
    assert.ok(edgeDistance(new Uint8ClampedArray(16),2,2,true).every(n=>Number.isFinite(n)&&n>500));
});
test("V5 参数保存恢复；旧工程保留版本，不接受未知、失序曲线及超限参数",()=>{
    const p=blankProject();const l={...createLayer("adjustment","曝光"),adjustment:defaultAdjustment("exposure")};p.layers=[l];
    assert.throws(()=>validateProject(p),/版本/);p.version=5;validateProject(p);assert.deepEqual(recoverProject(JSON.parse(JSON.stringify(p))).layers,p.layers);
    const old=blankProject();assert.equal(recoverProject(old).version,4);
    for(const a of [{kind:"unknown",values:{}},{...defaultAdjustment("levels"),values:{...defaultAdjustment("levels").values,black:254,white:100}},{...defaultAdjustment("curves"),curves:[[[0,0],[0,1]],[],[],[]]},{...defaultAdjustment("blur"),values:{radius:Infinity}}])assert.equal(validAdjustment(a),false);
    const e=defaultEffect("shadow");assert.equal(validEffects([e]),true);assert.equal(validEffects([e,e]),false);assert.equal(validEffects([{...e,color:"url(bad)"}]),false);
    assert.equal(validEffects([{...e,values:{...e.values,blur:501}}]),false);
});
