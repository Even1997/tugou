const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../core/layers.cjs');
const near=(a,b)=>a.forEach((p,i)=>{assert.ok(Math.abs(p.x-b[i].x)<1e-8);assert.ok(Math.abs(p.y-b[i].y)<1e-8)});
test('group corners follow moved and resized child without changing pixels',()=>{
  const result=L.groupLayers([L.createLayer('shape',{id:'shape',x:100,y:200,width:600,height:350})],['shape']);
  const moved=L.moveLayers(result.layers,['shape'],60,-200).map(l=>l.id==='shape'?{...l,width:480,height:290}:l);
  near(L.corners(moved,moved.find(l=>l.kind==='group')),L.corners(moved,moved.find(l=>l.id==='shape')));
  near(L.corners(result.layers,result.layers.find(l=>l.kind==='group')),L.corners(result.layers,result.layers.find(l=>l.id==='shape')));
});
test('nested rotated and scaled groups keep content bounds and regroup without movement',()=>{
  const child=L.createLayer('shape',{id:'s',parentId:'inner',x:-70,y:100,width:220,height:90});
  const inner=L.createLayer('group',{id:'inner',parentId:'outer',x:80,y:60,width:1,height:1,rotation:0});
  const outer=L.createLayer('group',{id:'outer',x:400,y:200,width:1,height:1,rotation:30,scaleX:1.5,scaleY:.8});
  const layers=[outer,inner,child],before=L.corners(layers,child);
  near(L.corners(layers,outer),before);
  const grouped=L.groupLayers(layers,['outer']);near(L.corners(grouped.layers,grouped.layers.find(l=>l.id==='s')),before);
});
test('artboard frame stays fixed and empty groups retain a usable box',()=>{
  const board=L.createLayer('group',{id:'b',artboard:true,x:0,y:0,width:1024,height:1536}),child=L.createLayer('shape',{parentId:'b',x:100,y:100});
  assert.deepEqual(L.corners([board,child],board),[{x:0,y:0},{x:1024,y:0},{x:1024,y:1536},{x:0,y:1536}]);
  const empty=L.createLayer('group',{x:0,y:0,width:10,height:20});assert.deepEqual(L.localBounds([empty],empty),{x:0,y:0,width:10,height:20});
});
