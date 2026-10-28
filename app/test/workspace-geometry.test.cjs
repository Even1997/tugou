const {test}=require('node:test'),assert=require('node:assert/strict');
const {rulerTicks,selectionMetrics}=require('../core/workspace-geometry.cjs');
test('ruler origin and negative coordinates track pan and zoom',()=>{
  for(const zoom of [.02,.1,.39,1,3,8]){
    const ticks=rulerTicks(1920,643,zoom);
    assert.ok(ticks.length<130);assert.ok(ticks.some(t=>t.value<0));
    assert.equal(ticks.find(t=>t.value===0).position,643);
    assert.ok(ticks.every(t=>Math.abs(t.position-(643+t.value*zoom))<.001&&t.position>=22&&t.position<=1920));
    const major=ticks.filter(t=>t.major);assert.ok(major[1].position-major[0].position>=79.99);
  }
});
test('rulers handle empty viewport and invalid scale',()=>{assert.deepEqual(rulerTicks(0,0,1),[]);assert.deepEqual(rulerTicks(900,0,0),[])});
test('selection dimensions follow rotated edges instead of enclosing bounding box',()=>{
  const angle=Math.PI/4,rotate=([x,y])=>({x:100+x*Math.cos(angle)-y*Math.sin(angle),y:80+x*Math.sin(angle)+y*Math.cos(angle)});
  const metric=selectionMetrics([[0,0],[300,0],[300,120],[0,120]].map(rotate));
  assert.ok(Math.abs(metric.width-300)<1e-8);assert.ok(Math.abs(metric.height-120)<1e-8);assert.ok(metric.bottom>metric.top);
});
