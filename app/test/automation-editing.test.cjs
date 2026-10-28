const test=require('node:test'),assert=require('node:assert/strict');
const {createLayer}=require('../core/layers.cjs'),{mergePlan,mergedDocument}=require('../core/merge-layers.cjs');
const {validate}=require('../core/automation-commands.cjs');
const layer=(id,p={})=>createLayer('shape',{id,...p});
const doc=layers=>({width:64,height:64,background:'transparent',layers,assets:[]});
test('merge respects stack order even with reversed input ids and retains unselected layers',()=>{
  const d=doc([layer('a'),layer('b'),layer('c')]),plan=mergePlan(d,['b','a']),r=mergedDocument(d,plan,{id:'r',name:'merged'});
  assert.equal(plan.last,'b');assert.deepEqual(r.document.layers.map(l=>l.id),[r.id,'c']);assert.equal(d.layers.length,3);
});
test('merge rejects nonadjacent, cross-board, locked descendants, blend and external mask dependencies',()=>{
  assert.throws(()=>mergePlan(doc([layer('a'),layer('b'),layer('c')]),['a','c']),/相邻/);
  assert.throws(()=>mergePlan(doc([layer('a')]),['a','other']),/同一画板/);
  assert.throws(()=>mergePlan(doc([createLayer('group',{id:'g'}),layer('c',{parentId:'g',locked:true})]),['g']),/解锁/);
  assert.throws(()=>mergePlan(doc([layer('a',{blend:'multiply'})]),['a']),/正常混合/);
  assert.throws(()=>mergePlan(doc([layer('a'),layer('b',{maskSourceId:'a'})]),['a']),/外部/);
});
test('image replacement clears stale bitmap while preserving geometry and mask and rejecting wrong kinds',()=>{
  const l=createLayer('image',{id:'a',assetId:'old',bitmap:{resource:'old.png'},width:50,height:20,rotation:30,mask:{x:0,y:0,width:1,height:1}}),d={...doc([l]),assets:[{id:'new',kind:'image',width:100,height:200}]};
  validate('layer.replaceImage',{id:'a',assetId:'new'}).apply(d,{id:'a',assetId:'new'});
  assert.equal(l.bitmap,undefined);assert.equal(l.assetId,'new');assert.equal(l.height,20);assert.equal(l.rotation,30);assert.ok(l.mask);
  assert.throws(()=>validate('layer.replaceImage',{id:'a',assetId:'new'}).apply(doc([layer('a')]),{id:'a',assetId:'new'}),/图片图层/);
  assert.throws(()=>validate('image.fillSelection',{id:'a',mode:'invalid'}));
});
