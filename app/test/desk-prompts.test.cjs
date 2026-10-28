const {test}=require('node:test'),assert=require('node:assert/strict');
const {extractDeskPrompts}=require('../core/desk-prompts.cjs');
const {workflowNode,compileWorkflow}=require('../core/workflow-nodes.cjs');
function fixture(prompt){
  const desk=workflowNode('config',{x:400,y:40});desk.id='desk';desk.data.prompt=prompt;
  return {modules:[],assets:[],tugouCanvas:{nodes:[{id:'text',type:'text',position:{x:0,y:0},data:{text:'人物要求'}},desk],edges:[{id:'edge',source:'text',target:'desk'}]}};
}
for(const prompt of ['全身构图','遵循 @[node:text]，全身构图'])test('extract visible prompt preserves compiled request: '+prompt,()=>{
  const before=fixture(prompt),frozen=JSON.stringify(before),after=extractDeskPrompts(before);
  assert.equal(compileWorkflow(after,'desk').prompt,compileWorkflow(before,'desk').prompt);
  assert.equal(JSON.stringify(before),frozen);
  assert.equal(extractDeskPrompts(after),after);
  const desk=after.tugouCanvas.nodes.find(n=>n.id==='desk'),text=after.tugouCanvas.nodes.at(-1);
  assert.equal(desk.data.prompt,'');assert.equal(text.type,'text');assert.equal(text.data.text,prompt);
  assert.equal(desk.data.inputOrder.at(-1),text.id);
  assert.deepEqual(after.tugouCanvas.edges[0],before.tugouCanvas.edges[0]);
  const downstream=workflowNode('image',{x:800,y:0});downstream.id='image';downstream.data.prompt='生成';
  for(const doc of [before,after]){doc.tugouCanvas.nodes.push(downstream);doc.tugouCanvas.edges.push({id:'to-image',source:'desk',target:'image'});}
  assert.equal(compileWorkflow(after,'image').prompt,compileWorkflow(before,'image').prompt);
});
test('regular generators and empty desks remain unchanged',()=>{const doc=fixture('');doc.tugouCanvas.nodes.push({...workflowNode('image',{x:0,y:0}),data:{prompt:'保留原生提示词'}});assert.equal(extractDeskPrompts(doc),doc);});
test('extracted prompts remain visible with invalid generation parameters',()=>{const doc=fixture('内容不能丢');doc.tugouCanvas.nodes[1].data.count=0;const next=extractDeskPrompts(doc);assert.equal(next.tugouCanvas.nodes.at(-1).data.text,'内容不能丢');});
test('removing a template reference excludes it from the compiled request',()=>{const doc=extractDeskPrompts(fixture('遵循 @[node:text]'));const text=doc.tugouCanvas.nodes.at(-1);doc.tugouCanvas.edges=doc.tugouCanvas.edges.filter(e=>e.source!==text.id);assert.equal(compileWorkflow(doc,'desk').prompt,'人物要求');});
test('extracted text reserves room for long content and existing groups',()=>{const doc=fixture('长文本\n'.repeat(80));doc.tugouCanvas.nodes.push({id:'group',type:'group',position:{x:0,y:600},width:500,height:700,data:{name:'已有组合'}});const next=extractDeskPrompts(doc),text=next.tugouCanvas.nodes.at(-1);assert.ok(text.position.y>=1300+48);assert.deepEqual(next.tugouCanvas.nodes.find(n=>n.id==='group'),doc.tugouCanvas.nodes.at(-1));});
