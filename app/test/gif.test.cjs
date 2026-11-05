const {test}=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {encodeGif,inspectGif,limits}=require('../core/gif.cjs'),{timeline,frameAt}=require('../core/gif-timeline.cjs');
const png=(color,width=16,height=16)=>sharp({create:{width,height,channels:4,background:color}}).png().toBuffer();
test('GIF encoding preserves ordered pixels, delays, dimensions and loop',async()=>{
 const bytes=await encodeGif([await png('red'),await png('blue')],{width:16,height:16,delays:[100,250],loop:0});
 const meta=await inspectGif(bytes);assert.deepEqual(meta,{width:16,height:16,gif:{frames:2,delays:[100,250],loop:0}});
 const raw=await sharp(bytes,{animated:true}).ensureAlpha().raw().toBuffer();assert.deepEqual([...raw.subarray(0,4)],[255,0,0,255]);assert.deepEqual([...raw.subarray(16*16*4,16*16*4+4)],[0,0,255,255]);
});
test('different sizes fit transparently without stretching; once-only loop survives',async()=>{
 const bytes=await encodeGif([await png('red',16,8),await png('blue',8,16)],{width:16,height:16,delays:[80,120],loop:1});
 const meta=await inspectGif(bytes);assert.equal(meta.gif.loop,1);const raw=await sharp(bytes,{page:0}).ensureAlpha().raw().toBuffer();assert.equal(raw[3],0);assert.equal(raw[(8*16+8)*4],255);
});
test('import preserves GIF bytes and animation through project persistence',async t=>{
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-gif-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const {ProjectStore}=require('../core/storage.cjs'),store=new ProjectStore(root);await store.init();
 const bytes=await encodeGif([await png('red'),await png('blue')],{width:16,height:16,delays:[100,200]});const file=path.join(root,'source.gif');await fs.writeFile(file,bytes);
 const [asset]=await require('../core/import-images.cjs').importImages(root,[file],()=>{throw Error('GIF must not use static native image decoder');});assert.equal(asset.gif.frames,2);assert.deepEqual(await fs.readFile(path.join(root,'resources',asset.resource)),bytes);
 const p=await store.create('动画');await store.save(p.id,{...p.document,assets:[asset]},p.revision);assert.deepEqual((await store.read(p.id)).document.assets[0].gif,asset.gif);
});
test('GIF rejects invalid, corrupt and oversized data before output',async()=>{
 assert.throws(()=>limits(4097,1,2));assert.throws(()=>limits(1024,1024,100));assert.throws(()=>limits(1,1,241));
 await assert.rejects(inspectGif(Buffer.from('GIF89a')));await assert.rejects(inspectGif(await png('red')));
 await assert.rejects(encodeGif([await png('red')],{width:16,height:16,delays:[15]}));
});
test('timeline uses actual frame durations, repeats shorter GIFs and respects hidden parents',()=>{
 const a={frames:2,delays:[100,200],loop:0},b={frames:2,delays:[200,400],loop:0};
 assert.equal(frameAt(a,99),0);assert.equal(frameAt(a,100),1);assert.equal(frameAt(a,300),0);assert.equal(frameAt({...a,loop:1},300),1);
 const doc={assets:[{id:'a',gif:a},{id:'b',gif:b}],layers:[{id:'a',kind:'image',assetId:'a'},{id:'b',kind:'image',assetId:'b'}]};
 assert.deepEqual(timeline(doc),[{time:0,delay:100},{time:100,delay:100},{time:200,delay:100},{time:300,delay:100},{time:400,delay:200}]);
 doc.layers=[{id:'g',kind:'group',visible:false},{id:'a',kind:'image',assetId:'a',parentId:'g'}];assert.deepEqual(timeline(doc),[{time:0,delay:100}]);
});
test('GIF batch export names use correct extensions and avoid overwrites',async t=>{
 const dir=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'gif-export-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));await fs.writeFile(path.join(dir,'动图.gif'),'existing');
 const targets=await require('../core/image-export.cjs').batchTargets(dir,['动图','动图'],'gif');assert.deepEqual(targets.map(p=>path.basename(p)),['动图 (2).gif','动图 (3).gif']);
});
