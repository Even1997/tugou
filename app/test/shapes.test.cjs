const {test}=require('node:test'),assert=require('node:assert/strict');
const {shapeBounds,shapePoints}=require('../core/shapes.cjs');
test('shape drags preserve origin across all quadrants and constrain squares',()=>{
  for(const sx of [-1,1])for(const sy of [-1,1]){
    const box=shapeBounds({x:-200,y:100},{x:-200+sx*80,y:100+sy*30});
    assert.deepEqual(box,{x:sx<0?-280:-200,y:sy<0?70:100,width:80,height:30});
    const square=shapeBounds({x:-200,y:100},{x:-200+sx*80,y:100+sy*30},true);
    assert.deepEqual(square,{x:sx<0?-280:-200,y:sy<0?20:100,width:80,height:80});
  }
});
test('zero and very large drags have finite positive bounded dimensions',()=>{
  assert.deepEqual(shapeBounds({x:0,y:0},{x:0,y:0}),{x:0,y:0,width:1,height:1});
  const b=shapeBounds({x:0,y:0},{x:1e6,y:-1e6},true);assert.equal(b.width,30000);assert.equal(b.height,30000);
});
test('polygon vertices occupy their advertised box and remain normalized',()=>{
  for(const type of ['triangle','diamond','star']){
    const pts=shapePoints(type);assert.equal(pts.length,{triangle:3,diamond:4,star:10}[type]);
    for(const axis of [0,1]){assert.equal(Math.min(...pts.map(p=>p[axis])),0);assert.equal(Math.max(...pts.map(p=>p[axis])),1);}
    assert.ok(pts.flat().every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  }
});
