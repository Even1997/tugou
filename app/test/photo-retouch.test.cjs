const test=require('node:test'),assert=require('node:assert/strict');
const {defaults,adjustPixels,validateAdjustment}=require('../core/adjustments.cjs');
const {retouchCopy}=require('../core/retouch-copy.cjs'),{createLayer}=require('../core/layers.cjs');
const {batch,validate}=require('../core/automation-commands.cjs');
const run=(patch,pixel=[80,120,160,123])=>[...adjustPixels(Uint8ClampedArray.from(pixel),1,{...defaults('photo'),...patch})];
test('photo controls preserve neutral pixels and alpha; transparent payload remains untouched',()=>{
  assert.deepEqual(run({}),[80,120,160,123]);assert.deepEqual(run({exposure:3},[40,60,80,0]),[40,60,80,0]);
  for(const patch of [{temperature:100},{tint:-100},{exposure:2},{highlights:-100},{shadows:100},{vibrance:100},{saturation:-100}])assert.equal(run(patch)[3],123);
  assert.deepEqual(run({exposure:1},[40,50,60,255]),[80,100,120,255]);
  const warm=run({temperature:100},[100,100,100,255]),cool=run({temperature:-100},[100,100,100,255]);assert.ok(warm[0]>warm[2]&&cool[0]<cool[2]);
  const tint=run({tint:100},[100,100,100,255]);assert.ok(tint[0]>tint[1]&&tint[2]>tint[1]);
  assert.ok(run({shadows:100},[40,40,40,255])[0]>40);assert.ok(run({highlights:-100},[210,210,210,255])[0]<210);
  assert.deepEqual(run({saturation:-100}).slice(0,3),[114,114,114]);assert.deepEqual(run({vibrance:100},[100,100,100,255]),[100,100,100,255]);
  assert.deepEqual(run({shadows:100,highlights:-100},[0,0,0,255]),[0,0,0,255]);
});
test('photo tone is deterministic across tiles and rejects invalid parameters',()=>{
  const pixels=Uint8ClampedArray.from({length:64*4},(_,i)=>i%251),a={...defaults('photo'),temperature:35,shadows:50,vibrance:25};
  const full=adjustPixels(pixels.slice(),64,a),part=adjustPixels(pixels.slice(16*4),48,a,{x:16,y:0});assert.deepEqual(part,full.slice(16*4));
  for(const patch of [{temperature:101},{exposure:4},{shadows:NaN},{vibrance:Infinity}])assert.throws(()=>validateAdjustment({...a,...patch}));
});
test('retouch copy is independent, in-place, adjacent, hides original, preserves metadata and does not mutate input',()=>{
  const layer=createLayer('image',{id:'source',assetId:'asset',name:'原图',x:-10,y:30,rotation:17,opacity:.5,blend:'multiply',mask:{x:0,y:0,width:.5,height:1}}),tail=createLayer('shape'),layers=[layer,tail],before=structuredClone(layers);
  const result=retouchCopy(layers,'source'),copy=result.layers[1];assert.deepEqual(layers,before);assert.equal(result.layers[0].visible,false);assert.equal(result.layers[2].id,tail.id);
  assert.equal(copy.x,-10);assert.equal(copy.y,30);assert.equal(copy.opacity,.5);assert.equal(copy.blend,'multiply');assert.equal(copy.id,result.id);assert.notEqual(copy.mask,layer.mask);assert.equal(copy.assetId,layer.assetId);
  copy.mask.width=.9;assert.equal(layer.mask.width,.5);
  for(const bad of [{...layer,locked:true},{...layer,visible:false},{...layer,kind:'shape'}])assert.throws(()=>retouchCopy([bad],bad.id));
  assert.throws(()=>retouchCopy([layer,{...tail,maskSourceId:layer.id}],layer.id),/关联/);
});
test('MCP exposes strict photo parameters and retouch copy through the shared document transaction',()=>{
  let doc={id:'p',name:'工程',width:64,height:64,background:'#fff',modules:[],recipes:[],assets:[{id:'asset',kind:'image',width:64,height:64}],layers:[],jobs:[]};
  const step=(command,args)=>{const result=batch(doc,[{name:'x',command,args}]);doc=result.document;return result.results.x;};
  const board=step('artboard.create',{name:'画板',width:64,height:64}).id;
  const image=step('layer.create',{artboardId:board,kind:'image',properties:{assetId:'asset'}}).id;
  const copy=step('layer.retouchCopy',{id:image}).id;assert.equal(doc.layers.find(l=>l.id===image).visible,false);assert.equal(doc.layers.find(l=>l.id===copy).assetId,'asset');
  const adjustment=step('layer.adjustment',{artboardId:board,adjustment:{type:'photo',temperature:25,shadows:40}}).id;assert.equal(doc.layers.find(l=>l.id===adjustment).adjustment.saturation,0);
  assert.throws(()=>validate('layer.adjustment',{artboardId:board,adjustment:{type:'photo',temperature:101}}));assert.throws(()=>validate('layer.retouchCopy',{id:image,path:'x'}));
});
