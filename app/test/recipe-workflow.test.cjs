const test=require('node:test'),assert=require('node:assert/strict');
const p=require('../core/prompts.cjs'),{compileWorkflow,workflowNode}=require('../core/workflow-nodes.cjs');

function fixture(type='config'){
  const document={modules:Array.from({length:26},(_,i)=>({id:`m${i}`,name:`模块${i}`,kind:'custom',global:false,text:`CONTENT_${i}_END`})),recipes:[],assets:[{id:'photo',kind:'image',name:'人物参考'}],tugouCanvas:p.emptyCanvas()};
  const recipe=p.pinRecipe(document,{...p.newRecipe(),name:'封面',moduleIds:document.modules.slice(0,18).map(m=>m.id),references:[{assetId:'photo',role:'人物身份'}],output:'封面输出'});
  document.recipes.push(recipe);
  const source=p.createNode(document,'recipe',recipe.id,{x:0,y:0}),target=workflowNode(type,{x:400,y:0});
  document.tugouCanvas.nodes.push(source,target);document.tugouCanvas.edges.push({source:source.id,target:target.id});
  return {document,source,target};
}
const occurrences=(text,part)=>text.split(part).length-1;

for(const type of ['config','image','textgen','panorama'])test(`recipe passes all selected modules and references to ${type}`,()=>{
  const {document,source,target}=fixture(type),before=JSON.stringify(document),result=compileWorkflow(document,target.id);
  for(let i=0;i<26;i++)assert.equal(occurrences(result.prompt,`CONTENT_${i}_END`),i<18?1:0,`module ${i}`);
  assert.match(result.prompt,/封面输出/);assert.deepEqual(result.references,[{assetId:'photo',nodeId:source.id,kind:'image',role:'人物身份'}]);
  assert.equal(JSON.stringify(document),before);
  if(type==='config'){
    assert.equal(result.sources.filter(s=>s.moduleId).length,18);
    for(const s of result.sources.filter(s=>s.text))assert.ok(result.prompt.includes(s.text));
  }
});

test('recipe keeps pinned and deleted modules, local overrides and pinned global style',()=>{
  const {document,source,target}=fixture();
  source.data.snapshot.moduleBindings[0].overrideText='本次人物';
  const style={id:'style',name:'画风',kind:'style',global:true,text:'旧画风'};
  source.data.snapshot.moduleBindings.push(p.bindModule(style));document.modules.push({...style,text:'新画风'});
  document.modules[1].text='新版模块';document.modules=document.modules.filter(m=>m.id!=='m2');
  document.recipes[0].output='新版输出';
  const result=compileWorkflow(document,target.id);
  assert.match(result.prompt,/本次人物/);assert.match(result.prompt,/CONTENT_1_END/);assert.match(result.prompt,/CONTENT_2_END/);
  assert.equal(occurrences(result.prompt,'旧画风'),1);assert.match(result.prompt,/此画风统一应用/);
  assert.ok(result.prompt.indexOf('旧画风')>result.prompt.indexOf('封面输出'));
  assert.doesNotMatch(result.prompt,/CONTENT_0_END|新版模块|新画风|新版输出/);
  assert.equal(result.sources.find(s=>s.moduleId==='m0').text.includes('本次人物'),true);
});

test('nested recipes, direct modules and shared references expand once for every target',()=>{
  for(const type of ['config','image','textgen']){
    const {document,source,target}=fixture(type);
    const inner=p.createNode(document,'recipe',document.recipes[0].id,{x:0,y:200});inner.data.snapshot={...inner.data.snapshot,output:'内页输出'};
    const direct=p.createNode(document,'module','m0',{x:0,y:300}),words=p.createNode(document,'text',undefined,{x:0,y:400});words.data.text='额外连接要求';
    document.tugouCanvas.nodes.push(inner,direct,words);
    document.tugouCanvas.edges.push({source:direct.id,target:target.id},{source:inner.id,target:source.id},{source:words.id,target:inner.id},{source:inner.id,target:target.id});
    const c=compileWorkflow(document,target.id);
    for(let i=0;i<18;i++)assert.equal(occurrences(c.prompt,`CONTENT_${i}_END`),1);
    assert.equal(occurrences(c.prompt,'额外连接要求'),1);assert.equal(occurrences(c.prompt,'内页输出'),1);assert.equal(c.references.length,1);
  }
});

test('recipe references honor roles and reject missing or incompatible media',()=>{
  const {document,source,target}=fixture();target.data.inputRoles={[source.id]:'仅参考服装'};
  let c=compileWorkflow(document,target.id);assert.equal(c.references[0].role,'仅参考服装');assert.equal(c.sources.find(s=>s.assetId).role,'仅参考服装');
  document.assets=[];assert.throws(()=>compileWorkflow(document,target.id),/尚无可用结果/);
  document.assets=[{id:'photo',kind:'audio'}];assert.throws(()=>compileWorkflow(document,target.id),/只接受图片/);
});

test('connected module override replaces the recipe copy regardless of input order',()=>{
  for(const reverse of [false,true]){
    const {document,source,target}=fixture(),direct=p.createNode(document,'module','m0',{x:0,y:200});
    direct.data.binding.overrideText='直连人物修改';document.tugouCanvas.nodes.push(direct);
    document.tugouCanvas.edges.push({source:direct.id,target:target.id});if(reverse)document.tugouCanvas.edges.reverse();
    const c=compileWorkflow(document,target.id);assert.equal(occurrences(c.prompt,'直连人物修改'),1);assert.doesNotMatch(c.prompt,/CONTENT_0_END/);
    for(const s of c.sources.filter(s=>s.text))assert.ok(c.prompt.includes(s.text));
  }
});

test('explicit recipe mention expands its text and keeps image references',()=>{
  for(const type of ['config','image','textgen']){
    const {document,source,target}=fixture(type);target.data.prompt=`采用 @[node:${source.id}]`;
    const c=compileWorkflow(document,target.id);
    for(let i=0;i<18;i++)assert.equal(occurrences(c.prompt,`CONTENT_${i}_END`),1);
    assert.match(c.prompt,/采用 【/);assert.match(c.prompt,/封面输出/);assert.equal(c.references.length,1);
  }
});

test('expanded recipe content obeys prompt and media limits and cycle checks',()=>{
  const {document,source,target}=fixture();source.data.snapshot.moduleBindings[0].overrideText='x'.repeat(100001);
  assert.throws(()=>compileWorkflow(document,target.id),/提示词过长/);
  source.data.snapshot.moduleBindings[0].overrideText='short';
  document.assets=Array.from({length:17},(_,i)=>({id:`photo${i}`,kind:'image'}));source.data.snapshot.references=document.assets.map(a=>({assetId:a.id,role:'参考'}));
  assert.throws(()=>compileWorkflow(document,target.id),/最多连接 16/);
  document.tugouCanvas.edges.push({source:target.id,target:source.id});assert.throws(()=>compileWorkflow(document,target.id),/循环/);
});
