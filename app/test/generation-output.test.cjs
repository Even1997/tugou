const test=require('node:test'),assert=require('node:assert/strict');
const {stageOutputs}=require('../core/generation-output.cjs');
const {mergeResults,applyResults}=require('../core/results.cjs');
const {workflowNode,compileWorkflow}=require('../core/workflow-nodes.cjs');
const fixture=()=>({assets:[],modules:[],tugouCanvas:{version:1,viewport:{x:0,y:0,zoom:1},nodes:[{...workflowNode('config',{x:100,y:50}),id:'desk'}],edges:[]}});
const task=(id='job',count=2,status='running')=>({id,status,context:{kind:'workflow',nodeId:'desk',mode:'image',count,outputNodes:true}});
const result=(count=2)=>({id:'job',nodeId:'desk',kind:'workflow',mode:'image',assets:Array.from({length:count},(_,i)=>({id:`job-${i}`,kind:'image',name:`结果${i}`}))});
test('submission reserves distinct right-hand nodes and one edge per image, idempotently',()=>{
 const d=fixture(),s=stageOutputs(d,[task()]),out=s.tugouCanvas.nodes.slice(1);
 assert.equal(d.tugouCanvas.nodes.length,1);assert.equal(out.length,2);assert.ok(out.every(n=>n.position.x>=570));assert.ok(out[1].position.y-out[0].position.y>=632);
 assert.deepEqual(s.tugouCanvas.edges.map(e=>[e.source,e.target]),out.map(n=>['desk',n.id]));assert.equal(stageOutputs(s,[task()]),s);
});
test('completion fills existing placeholders without moving user-positioned nodes or duplicating edges',()=>{
 const s=stageOutputs(fixture(),[task()]);s.tugouCanvas.nodes[1].position={x:999,y:111};const n=mergeResults(s,[result()]);
 assert.equal(n.tugouCanvas.nodes.length,3);assert.equal(n.tugouCanvas.edges.length,2);assert.deepEqual(n.tugouCanvas.nodes[1].position,{x:999,y:111});assert.equal(n.tugouCanvas.nodes[1].data.assetId,'job-0');assert.deepEqual(mergeResults(n,[result()]),n);
});
test('deleted placeholders remain deleted across task polling and completion',()=>{
 const s=stageOutputs(fixture(),[task()]);s.tugouCanvas.nodes.splice(1,1);s.tugouCanvas.edges.splice(0,1);
 assert.equal(stageOutputs(s,[task()]),s);const n=mergeResults(s,[result()]);assert.ok(!n.tugouCanvas.nodes.some(x=>x.id==='result-job-0'));assert.equal(n.assets.length,2);assert.equal(n.tugouCanvas.edges.length,1);
});
test('partial provider batch removes unused placeholders and their edges',()=>{
 const n=mergeResults(stageOutputs(fixture(),[task()]),[result(1)]);assert.equal(n.tugouCanvas.nodes.length,2);assert.equal(n.tugouCanvas.edges.length,1);
});
test('new generation preserves previous results and avoids their occupied positions',()=>{
 const s=mergeResults(stageOutputs(fixture(),[task()]),[result()]),n=stageOutputs(s,[task('second',1)]);
 assert.equal(n.tugouCanvas.nodes.length,4);assert.ok(n.tugouCanvas.nodes.at(-1).position.y>s.tugouCanvas.nodes.at(-1).position.y+600);
});
test('grouped sources use absolute coordinates; pending task survives failure, cancellation and reload',()=>{
 const d=fixture();d.tugouCanvas.nodes[0].parentId='group';d.tugouCanvas.nodes.unshift({id:'group',type:'group',position:{x:400,y:200},data:{}});
 const s=stageOutputs(d,[task()]);assert.equal(s.tugouCanvas.nodes[2].position.x,970);assert.equal(s.tugouCanvas.nodes[2].position.y,250);
 for(const state of ['failed','cancelled','interrupted'])assert.deepEqual(stageOutputs(JSON.parse(JSON.stringify(s)),[task('job',2,state)]),s);
});
test('completion merges into undo and redo snapshots without stale pending cards',()=>{
 const s=stageOutputs(fixture(),[task()]),n=applyResults(s,{past:[s],future:[s]},[result()]);
 for(const d of [n.document,...n.history.past,...n.history.future])assert.ok(d.tugouCanvas.nodes.slice(1).every(n=>n.data.assetId));
});
test('source removal creates no dangling links and prior completed tasks do not produce placeholders',()=>{
 const d=fixture();assert.equal(stageOutputs(d,[{...task(),status:'completed',context:{...task().context,outputNodes:false}}]),d);
 d.tugouCanvas.nodes=[];assert.equal(stageOutputs(d,[task()]),d);assert.equal(mergeResults(d,[result()]).tugouCanvas.edges.length,0);
});
test('downstream desk references only generated asset, not creator inputs or settings',()=>{
 const d=fixture(),a=d.tugouCanvas.nodes[0];a.data.prompt='不应重复的旧要求';
 const s=mergeResults(stageOutputs(d,[task('job',1)]),[result(1)]),b={...workflowNode('config',{x:1100,y:50}),id:'next'};b.data.prompt='下一轮要求';s.tugouCanvas.nodes.push(b);s.tugouCanvas.edges.push({id:'next-link',source:'result-job-0',target:'next'});
 const c=compileWorkflow(s,'next');assert.ok(!c.prompt.includes('不应重复'));assert.equal(c.references.length,1);assert.equal(c.references[0].assetId,'job-0');
});
