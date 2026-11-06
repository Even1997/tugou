const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),sharp=require('sharp');
const {decode,encode}=require('../core/psd-codec.cjs'),{runPsd,importPsd}=require('../core/psd-service.cjs');
const {writePsdBuffer,readPsd}=require('ag-psd');
const {header}=require('../core/psd-format.cjs');
const image=(width=4,height=3,color=[240,30,60,255])=>({width,height,data:new Uint8ClampedArray(Array.from({length:width*height},()=>color).flat())});
const fixture=children=>writePsdBuffer({width:16,height:12,children:children||[{name:'底层',left:-2,top:3,imageData:image()},{name:'分组',blendMode:'normal',opacity:.8,children:[{name:'隐藏',hidden:true,left:5,top:4,blendMode:'multiply',opacity:.5,imageData:image(3,2,[0,200,80,128])}]}],imageData:image(16,12)},{noBackground:true});
test('PSD preserves pixels, layer ordering, offset, groups, visibility and opacity',async()=>{
  const result=await decode(fixture());assert.deepEqual(result.layers.map(l=>l.name),['底层','分组','隐藏']);
  assert.equal(result.layers[0].x,-2);assert.equal(result.layers[2].parent,1);assert.equal(result.layers[2].visible,false);assert.equal(result.layers[2].blend,'multiply');
  assert.ok(Math.abs(result.layers[2].opacity-.5)<1/255);assert.equal(result.layers[1].kind,'group');
  const raw=await sharp(result.layers[0].bytes).raw().toBuffer();assert.deepEqual([...raw.slice(0,4)],[240,30,60,255]);
});
test('PSD rejects unsupported semantics without silently dropping them; merged import is explicit',async()=>{
  const bytes=fixture([{name:'蒙版',imageData:image(),mask:{left:0,top:0,imageData:image(4,3,[0,0,0,255])}}]);
  await assert.rejects(decode(bytes),/蒙版/);const flat=await decode(bytes,true);assert.equal(flat.layers.length,1);assert.match(flat.warnings[0],/合并预览/);
  await assert.rejects(decode(fixture([{name:'穿透组',blendMode:'pass through',children:[{name:'混合',blendMode:'multiply',imageData:image()}]}])),/混合模式/);
  const ordinary=await decode(fixture([{name:'普通穿透组',blendMode:'pass through',children:[{name:'图片',imageData:image()}]}]));assert.equal(ordinary.layers[0].kind,'group');
  const blendingRanges={compositeGrayBlendSource:[0,0,0,0],compositeGraphBlendDestinationRange:[0,0,255,255],ranges:[]};
  await assert.rejects(decode(fixture([{name:'混合颜色带',blendingRanges,imageData:image()}])),/颜色带/);
  blendingRanges.compositeGrayBlendSource=[0,0,255,255];assert.equal((await decode(fixture([{name:'默认混合',blendingRanges,imageData:image()}]))).layers.length,1);
});
test('PSD rejects corrupted headers, PSB, unsupported color/depth, excessive dimensions and layers',async()=>{
  assert.throws(()=>header(Buffer.from('bad')),/PSD/);
  for(const [offset,value,pattern] of [[4,2,/PSB/],[22,16,/8 位/],[24,4,/RGB/]]){const b=Buffer.from(fixture());b.writeUInt16BE(value,offset);await assert.rejects(decode(b),pattern);}
  const b=Buffer.from(fixture());b.writeUInt32BE(30001,18);await assert.rejects(decode(b),/30000/);
  await assert.rejects(decode(fixture(Array.from({length:129},()=>({name:'空层'})))),/128/);
  await assert.rejects(decode(fixture().subarray(0,100)));
});
test('layered export reopens with exact RGBA, hidden layer, opacity and merged preview',async()=>{
  const bytes=await sharp(Buffer.from(image().data),{raw:{width:4,height:3,channels:4}}).png().toBuffer();
  const data=await encode({width:4,height:3,composite:bytes,layers:[{name:'可编辑像素',hidden:true,opacity:.7,blendMode:'multiply',bytes}]});
  const read=readPsd(data,{useImageData:true,skipThumbnail:true});assert.equal(read.children[0].hidden,true);assert.equal(read.children[0].blendMode,'multiply');assert.deepEqual([...read.children[0].imageData.data],[...image().data]);assert.deepEqual([...read.imageData.data],[...image().data]);
  await assert.rejects(encode({width:4,height:3,composite:bytes,layers:[{name:'无效',opacity:2,blendMode:'normal',bytes}]}),/参数/);
  await assert.rejects(encode({width:8000,height:4000,composite:bytes,layers:[{}]}),/3200/);
  await assert.rejects(encode({width:5,height:3,composite:bytes,layers:[{name:'无效',opacity:1,blendMode:'normal',bytes}]}),/同尺寸/);
});
test('worker can be cancelled and malformed PSD does not crash the host',async()=>{
  const control=new AbortController(),promise=runPsd({action:'decode',bytes:fixture()},control.signal);control.abort();await assert.rejects(promise,/取消/);
  await assert.rejects(runPsd({action:'decode',bytes:Buffer.from('invalid')},new AbortController().signal),/PSD/);
  assert.equal((await runPsd({action:'decode',bytes:fixture()},new AbortController().signal)).layers.length,3);
});
test('import stages resources transactionally and leaves original PSD untouched',async t=>{
  const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-psd-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const file=path.join(root,'源文件.psd'),bytes=fixture();await fs.writeFile(file,bytes);
  const result=await importPsd(root,file,false,new AbortController().signal,b=>({width:b.readUInt32BE(16),height:b.readUInt32BE(20)}));
  assert.equal(result.assets.length,2);assert.equal(result.layers[2].parentId,result.layers[1].id);assert.deepEqual(await fs.readFile(file),bytes);
  assert.deepEqual(await fs.readdir(path.join(root,'imports')),[]);assert.equal((await fs.readdir(path.join(root,'resources'))).length,2);
  await assert.rejects(importPsd(root,file,false,new AbortController().signal,()=>{throw Error('模拟失败')}),/模拟失败/);assert.deepEqual(await fs.readdir(path.join(root,'imports')),[]);
});
