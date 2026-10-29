const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ProjectStore,hash}=require('../core/storage.cjs'),{createDispatcher}=require('../core/automation-host.cjs');
const {newRecipe}=require('../core/prompts.cjs');
const step=(name,command,args={})=>({name,command,args});

async function session(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-batch-preservation-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const projects=new ProjectStore(root);await projects.init();const record=await projects.create('素材保护回归');
  const bytes=Buffer.from('existing-resource'),resource=`${hash(bytes)}.png`;await fs.writeFile(path.join(root,'resources',resource),bytes);
  const document={...record.document,assets:[{id:'photo',name:'已导入素材',kind:'image',resource}],recipes:[{...newRecipe(),name:'已有空配方'}]};
  let state={projectId:record.id,revision:'live:1',document,history:{undo:2,redo:0},dirty:true},commits=0;
  const dispatch=await createDispatcher({root,filesRoot:root,projects,ui:async(action,args,expected)=>{
    if(action==='snapshot')return structuredClone(state);
    assert.equal(action,'commit');
    if(expected!==state.revision)throw Object.assign(Error('实时文档已变化'),{code:'CONFLICT'});
    commits++;state={...state,document:args.document,revision:`live:${commits+1}`,history:{undo:state.history.undo+1,redo:0}};return structuredClone(state);
  }});
  return {root,projects,record,dispatch,bytes,resource,get state(){return state;},get commits(){return commits;},manualEdit(){state={...state,revision:'manual',document:{...state.document,name:'人工修改'}};}};
}

test('failed batches preserve pre-existing unsaved assets recipes history and resource bytes',async t=>{
  const s=await session(t),before=structuredClone(s.state);
  for(const bad of [step('bad','canvas.connect',{source:'missing',target:'missing'}),step('bad','prompt.create',{name:'bad',text:{$ref:'missing.id'}}),step('bad','asset.import',{path:'missing.png'})]){
    await assert.rejects(()=>s.dispatch('batch',{expectedRevision:s.state.revision,steps:[step('rename','project.rename',{name:'临时修改'}),step('create','prompt.create',{name:'临时模块',text:'不要提交'}),bad]}));
    assert.deepEqual(s.state,before);assert.equal(s.commits,0);
    assert.equal((await s.dispatch('query_objects',{kind:'asset'})).total,1);assert.equal((await s.dispatch('query_objects',{kind:'recipe'})).total,1);
    assert.deepEqual(await fs.readFile(path.join(s.root,'resources',s.resource)),s.bytes);
  }
  const saved=await s.projects.save(s.record.id,s.state.document,s.record.revision),reopened=await s.projects.read(s.record.id);
  assert.equal(reopened.revision,saved.revision);assert.deepEqual(reopened.document,before.document);
});

test('successful 26-module batch commits once and later failure cannot revert it',async t=>{
  const s=await session(t),steps=Array.from({length:26},(_,i)=>step(`m${i}`,'prompt.create',{name:`模块${i}`,text:`内容${i}`,global:false}));
  steps.push(step('recipe','recipe.create',{name:'组合配方',moduleIds:steps.map(v=>({$ref:`${v.name}.id`}))}));
  const result=await s.dispatch('batch',{expectedRevision:s.state.revision,steps});
  assert.equal(result.counts.prompts,26);assert.equal(result.counts.assets,1);assert.equal(result.counts.recipes,2);assert.equal(s.commits,1);assert.equal(result.history.undo,3);
  const before=structuredClone(s.state);
  await assert.rejects(()=>s.dispatch('batch',{expectedRevision:s.state.revision,steps:[step('delete','recipe.delete',{id:result.results.recipe.id}),step('bad','canvas.connect',{source:'x',target:'y'})]}));
  assert.deepEqual(s.state,before);assert.equal(s.commits,1);
});

test('resource validation failure preserves live data and concurrent changes reject stale commits',async t=>{
  const s=await session(t),before=structuredClone(s.state);
  // A content-addressed reference exercises commit validation without touching user files.
  const resource='a'.repeat(64)+'.png';
  await assert.rejects(()=>s.dispatch('batch',{expectedRevision:s.state.revision,steps:[step('p','prompt.create',{name:'引用',text:resource})]}),/ENOENT/);
  assert.deepEqual(s.state,before);assert.equal(s.commits,0);
  s.projects.verifyResources=async()=>s.manualEdit();
  await assert.rejects(()=>s.dispatch('batch',{expectedRevision:s.state.revision,steps:[step('p','prompt.create',{name:'引用',text:resource})]}),e=>e.code==='CONFLICT');
  assert.equal(s.state.document.name,'人工修改');assert.deepEqual(s.state.document.assets,before.document.assets);assert.deepEqual(s.state.document.recipes,before.document.recipes);assert.equal(s.commits,0);
});

test('MCP compile and workflow submission use the same complete pinned recipe payload',async t=>{
  const s=await session(t),ref=name=>({$ref:`${name}.id`});
  const setup=await s.dispatch('batch',{expectedRevision:s.state.revision,steps:[
    step('module','prompt.create',{name:'人物',text:'保留人物身份',global:false}),
    step('recipe','recipe.create',{name:'封面',moduleIds:[ref('module')],output:'竖版构图'}),
    step('recipeNode','canvas.create',{type:'recipe',sourceId:ref('recipe'),position:{x:0,y:0}}),
    step('image','canvas.create',{type:'asset',sourceId:'photo',position:{x:0,y:300}}),
    step('desk','canvas.create',{type:'config',position:{x:400,y:0}}),
    step('imageLink','canvas.connect',{source:ref('image'),target:ref('recipeNode')}),
    step('recipeLink','canvas.connect',{source:ref('recipeNode'),target:ref('desk')})
  ]});
  const nodeId=setup.results.desk.id,compiled=await s.dispatch('run_command',{command:'canvas.compile',args:{id:nodeId}});
  const service=new (require('../core/workflow-service.cjs').WorkflowService)(s.projects);
  let submitted;service.submit=async value=>{submitted=value;return {id:'captured'};};
  await service.start(s.record.id,s.state.document,nodeId);
  assert.deepEqual(submitted.compiled,compiled);assert.match(compiled.prompt,/保留人物身份/);assert.match(compiled.prompt,/竖版构图/);assert.equal(compiled.references[0].assetId,'photo');
  assert.deepEqual(submitted.assets,s.state.document.assets);
});
