const {test}=require('node:test'),assert=require('node:assert/strict');
const {comparisonLayout,zoomCamera}=require('../renderer/comparison-view.cjs');
const source={width:512,height:768};
test('upscale and resize register the same source coordinate at different resolutions',()=>{
  for(const operation of ['resize','upscale']){const l=comparisonLayout(source,{width:2048,height:3072,toolResult:{operation}});assert.deepEqual(l.original,l.output);assert.equal(l.width,512);}
});
test('crop retains its original location instead of stretching',()=>{
  const l=comparisonLayout(source,{width:100,height:200,toolResult:{operation:'crop',left:30,top:40}});assert.deepEqual(l.output,{x:30,y:40,width:100,height:200});assert.equal(l.height,768);
});
test('extend aligns source offset with the expanded result',()=>{
  for(const settings of [{operation:'extend',padding:64},{operation:'extend',sizeMode:'size',left:64,top:64},{operation:'cloudExtend',left:64,top:64}]){const l=comparisonLayout(source,{width:640,height:896,toolResult:settings});assert.equal(l.original.x,64);assert.equal(l.original.y,64);assert.equal(l.width,640);assert.equal(l.height,896);}
});
test('rotation preserves aspect and centers changed orientation',()=>{
  const l=comparisonLayout(source,{width:768,height:512,toolResult:{operation:'rotate'}});assert.equal(l.original.x,128);assert.equal(l.output.y,128);assert.equal(l.width,768);assert.equal(l.height,768);
});
test('zoom keeps the point under the cursor fixed and clamps extremes',()=>{
  const c={x:256,y:384,zoom:.5},z=zoomCamera(c,2,90,-50);assert.equal(c.x+90/c.zoom,z.x+90/z.zoom);assert.equal(c.y-50/c.zoom,z.y-50/z.zoom);assert.equal(zoomCamera(c,100).zoom,32);assert.equal(zoomCamera(c,.0001).zoom,.01);
});
