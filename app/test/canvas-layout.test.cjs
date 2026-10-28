const test=require('node:test'),assert=require('node:assert/strict');
const {arrangeNodes,layoutSelection}=require('../core/canvas-layout.cjs');
const node=(id,x,y,width=300,height=220,extra={})=>({id,type:'text',position:{x,y},width,height,data:{text:id},...extra});
test('align only the selection without mutating inputs or metadata',()=>{
  const nodes=[node('a',40,80),node('b',500,20),node('outside',900,700)],before=structuredClone(nodes);
  const next=arrangeNodes(nodes,['a','b'],'left');
  assert.deepEqual(next.slice(0,2).map(n=>n.position),[{x:40,y:80},{x:40,y:20}]);
  assert.equal(next[2],nodes[2]);assert.equal(next[1].data,nodes[1].data);assert.deepEqual(nodes,before);
  assert.deepEqual(arrangeNodes(nodes,['a','b'],'top').slice(0,2).map(n=>n.position),[{x:40,y:20},{x:500,y:20}]);
  assert.equal(arrangeNodes(next,['a','b'],'left'),next);
});
test('spacing accounts for unequal sizes and never introduces negative gaps',()=>{
  const nodes=[node('a',20,20,220,140),node('b',700,60,400,260),node('c',900,90,300,220)];
  for(const [mode,axis,size]of [['horizontal','x','width'],['vertical','y','height']]){
    const next=arrangeNodes(nodes,nodes.map(n=>n.id),mode).sort((a,b)=>a.position[axis]-b.position[axis]);
    const gaps=next.slice(1).map((n,i)=>n.position[axis]-next[i].position[axis]-next[i][size]);
    assert.ok(gaps.every(g=>g>=40));assert.ok(Math.abs(gaps[0]-gaps[1])<0.0001);
  }
});
test('grid uses actual card sizes and preserves unrelated nodes',()=>{
  const nodes=[node('a',40,10,300,400),node('b',90,90,500,140),node('c',20,180,200,600),node('d',180,250,320,250),node('outside',1800,100)];
  const next=arrangeNodes(nodes,['a','b','c','d'],'grid');
  for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
    const a=next[i],b=next[j];assert.ok(a.position.x+a.width<=b.position.x||b.position.x+b.width<=a.position.x||a.position.y+a.height<=b.position.y||b.position.y+b.height<=a.position.y);
  }
  assert.equal(next[4],nodes[4]);
});
test('a selected group moves as one unit without double-moving selected descendants',()=>{
  const group=node('g',500,100,650,500,{type:'group'}),child=node('child',24,48,300,220,{parentId:'g'}),outside=node('outside',60,800);
  const nodes=[group,child,outside],ids=nodes.map(n=>n.id);
  assert.deepEqual(layoutSelection(nodes,ids).map(n=>n.id),['g','outside']);
  const next=arrangeNodes(nodes,ids,'left');assert.equal(next[0].position.x,60);assert.equal(next[1],child);
});
test('rearranging children preserves their parent and expands its border without moving siblings',()=>{
  const nodes=[node('g',100,80,664,544,{type:'group',style:{width:664,height:544}}),node('a',24,48,300,220,{parentId:'g'}),node('b',340,48,300,220,{parentId:'g'}),node('c',24,300,300,220,{parentId:'g'}),node('outside',1000,20)];
  const next=arrangeNodes(nodes,['a','b','c'],'grid');
  assert.deepEqual(next[0].position,nodes[0].position);assert.equal(next[0].width,712);assert.equal(next[0].height,576);
  assert.deepEqual(next.slice(1,4).map(n=>n.parentId),['g','g','g']);assert.equal(next[4],nodes[4]);
  for(const child of next.slice(1,4)){assert.ok(child.position.x+child.width+24<=next[0].width);assert.ok(child.position.y+child.height+24<=next[0].height);}
});
test('mixed containers and insufficient selections are rejected without modifying data',()=>{
  const nodes=[node('g',100,80,650,500,{type:'group'}),node('a',24,48,300,220,{parentId:'g'}),node('b',600,80)],before=structuredClone(nodes);
  assert.throws(()=>arrangeNodes(nodes,['a','b'],'grid'),/同一组合/);
  assert.throws(()=>arrangeNodes(nodes,['g','a'],'grid'),/至少选择两个/);
  assert.throws(()=>arrangeNodes(nodes,['g','b'],'horizontal'),/至少三个/);
  assert.deepEqual(nodes,before);
});
test('large selections remain deterministic and bounded',()=>{
  const nodes=Array.from({length:2000},(_,i)=>node(String(i),(i*73)%1800,(i*137)%2400,220+i%7,140+i%11));
  const ids=nodes.map(n=>n.id),start=performance.now(),next=arrangeNodes(nodes,ids,'grid');
  assert.equal(next.length,2000);assert.deepEqual(arrangeNodes(nodes,ids,'grid'),next);
  assert.ok(next.every(n=>Number.isFinite(n.position.x)&&Number.isFinite(n.position.y)));
  console.log(`2000-node arrangement: ${(performance.now()-start).toFixed(1)} ms (two runs and comparison)`);
});
test('connected layout staggers sources into two columns with a clear path to the downstream node',()=>{
  const nodes=[node('photo-a',20,20,300,360),node('photo-b',20,440,300,400),node('words',20,920),node('desk',500,350,400,500),node('outside',1800,400)];
  const edges=['photo-a','photo-b','words'].map(source=>({source,target:'desk',role:'keep'})),before=structuredClone({nodes,edges});
  const next=arrangeNodes(nodes,['photo-a','photo-b','words','desk'],'flow',edges),desk=next[3];
  assert.equal(next[0].position.x,next[1].position.x);assert.ok(next[2].position.x>next[0].position.x);
  assert.ok(next.slice(0,3).every(n=>n.position.x+n.width+112<=desk.position.x));
  const sideBottom=next[2].position.y+next[2].height;
  assert.ok(next.slice(0,2).every(n=>n.position.y+n.height/2>=sideBottom+64));assert.ok(desk.position.y+desk.height/2>=sideBottom+64);
  assert.equal(next[4],nodes[4]);assert.deepEqual({nodes,edges},before);
  assert.deepEqual(arrangeNodes(next,next.slice(0,4).map(n=>n.id),'flow',edges),next);
});
test('connected layout follows multiple levels and maps group child edges to the whole group',()=>{
  const nodes=[node('group',400,300,650,500,{type:'group'}),node('a',24,48,300,220,{parentId:'group'}),node('b',340,48,300,220,{parentId:'group'}),node('desk',20,20,400,500),node('result',50,30)];
  const edges=[{source:'a',target:'desk'},{source:'b',target:'desk'},{source:'desk',target:'result'}];
  const next=arrangeNodes(nodes,nodes.map(n=>n.id),'flow',edges);
  assert.equal(next[1],nodes[1]);assert.equal(next[2],nodes[2]);
  assert.ok(next[3].position.x>=next[0].position.x+next[0].width+112);
  assert.ok(next[4].position.x>=next[3].position.x+next[3].width+112);
});
test('connected layout handles disconnected selection and rejects cycles without mutation',()=>{
  const nodes=[node('a',40,80),node('b',20,400),node('c',20,800)],ids=nodes.map(n=>n.id),before=structuredClone(nodes);
  assert.equal(arrangeNodes(nodes,ids,'flow').length,3);
  assert.throws(()=>arrangeNodes(nodes,ids,'flow',[{source:'a',target:'b'},{source:'b',target:'a'}]),/循环/);
  assert.deepEqual(nodes,before);
});
