const test=require('node:test'),assert=require('node:assert/strict');
const {workflowNode,compileWorkflow,canLink}=require('../core/workflow-nodes.cjs');
const {validate,batch}=require('../core/automation-commands.cjs');
const {validateDocument}=require('../core/storage.cjs');
const {purposes,reconcile}=require('../core/connection-state.cjs');
const {WorkflowService}=require('../core/workflow-service.cjs');
const base=()=>({name:'旧工程',width:128,height:128,modules:[],recipes:[],assets:[],layers:[],jobs:[],tugouCanvas:{version:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}}});

test('UI model purposes and MCP schemas only expose image, analysis and text',()=>{
  assert.deepEqual(purposes.map(p=>p[0]),['image','analysis','text']);
  for(const type of ['video','audio']){
    assert.throws(()=>workflowNode(type,{x:0,y:0}));
    assert.throws(()=>validate('canvas.create',{type,position:{x:0,y:0}}));
    assert.throws(()=>validate('canvas.update',{id:'n',properties:{mode:type}}));
    assert.throws(()=>validate('models.assign',{purpose:type,settingsRevision:0}));
    assert.throws(()=>validate('models.set',{id:'k',settingsRevision:0,models:[{id:'m',purposes:[type]}]}));
  }
  assert.throws(()=>validate('models.key.update',{id:'k',settingsRevision:0,patch:{videoProtocol:'sora'}}));
  validate('models.assign',{purpose:'image',settingsRevision:0,keyId:'k',modelId:'m'});
});

test('legacy nodes survive validation and unrelated edits without generating or accepting new inputs',()=>{
  const d=base(),text={id:'text',type:'text',position:{x:0,y:0},data:{name:'提示词',text:'猫'}};
  for(const type of ['video','audio','config']){
    const n={...workflowNode('config',{x:100,y:0}),id:type,type};n.data.mode='video';n.data.prompt='旧内容';d.tugouCanvas.nodes.push(n);
    assert.throws(()=>compileWorkflow(d,n.id),/已移除/);
    assert.equal(canLink({nodes:[text,n],edges:[]},text.id,n.id),false);
  }
  validateDocument(d);const before=structuredClone(d.tugouCanvas);
  const next=batch(d,[{name:'rename',command:'project.rename',args:{name:'新名称'}}]).document;
  assert.deepEqual(next.tugouCanvas,before);
});

test('retry of saved retired requests is rejected before credentials, network or task creation',async()=>{
  const touched=()=>{throw Error('must not be called');};
  const service=new WorkflowService({root:''},{readPrivate:touched},{list:touched},touched);
  for(const mode of ['video','audio'])await assert.rejects(service.submit({compiled:{mode}}),/已移除/);
});

test('legacy model routes remain intact on unrelated edits and are cleared when a Key is removed',()=>{
  const m={routes:{image:'k',video:'k',audio:'k'},connections:[{id:'k',hasKey:true,model:'img',videoModel:'vid',audioModel:'wav',models:[{id:'img',purposes:['image']},{id:'vid',purposes:['video']},{id:'wav',purposes:['audio']}]}]};
  const next=reconcile(m);assert.equal(next.routes.video,'k');assert.equal(next.routes.audio,'k');
  const removed=reconcile({...m,connections:[]});assert.equal(removed.routes.video,null);assert.equal(removed.routes.audio,null);
});

test('legacy timing fields cannot block image generation',()=>{
  const d=base(),n=workflowNode('image',{x:0,y:0});Object.assign(n.data,{prompt:'猫',seconds:0,speed:0});d.tugouCanvas.nodes.push(n);
  assert.equal(compileWorkflow(d,n.id).mode,'image');
});
