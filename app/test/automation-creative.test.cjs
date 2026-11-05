const test=require('node:test'),assert=require('node:assert/strict');
const {batch,validate,listCommands}=require('../core/automation-commands.cjs');
const base=()=>({id:'p',name:'MCP',width:64,height:64,background:'#fff',modules:[],recipes:[],assets:[{id:'a',kind:'image',width:64,height:64},{id:'b',kind:'image',width:64,height:64}],layers:[],jobs:[]});
const step=(command,args)=>({name:'x',command,args}),apply=(doc,command,args)=>batch(doc,[step(command,args)]);
function fixture(){const result=apply(base(),'artboard.create',{name:'board',width:64,height:64});return {doc:result.document,board:result.results.x.id};}

test('creative command schemas reject unsafe paths fields, unbounded media and invalid geometry',()=>{
  assert.ok(listCommands().some(c=>c.name==='scene.record'));
  for(const [command,args] of [
    ['gif.create',{requestId:'r',frames:[{assetId:'a',delay:13}],width:64,height:64}],
    ['scene.record',{requestId:'r',nodeId:'n',duration:61}],
    ['paint.retouch',{requestId:'r',id:'l',tool:'eval',size:10,points:[{x:0,y:0}]}],
    ['layout.update',{artboardId:'b',patch:{gridSize:0}}],
    ['layer.update',{id:'l',patch:{warp:[0,1]}}],
    ['artboard.exportAnimation',{requestId:'r',artboardId:'b',path:'a.gif',format:'webm'}],
  ])assert.throws(()=>validate(command,args));
});
test('recipe references and binding conflicts preserve pinned content and apply explicit resolution',()=>{
  let d=base(),r=apply(d,'prompt.create',{name:'style',text:'before'});d=r.document;const moduleId=r.results.x.id;
  r=apply(d,'recipe.create',{name:'recipe',moduleIds:[moduleId]});d=r.document;const recipeId=r.results.x.id;
  d=apply(d,'recipe.references',{id:recipeId,references:[{assetId:'b',role:'background'},{assetId:'a',role:'subject'}]}).document;
  d=apply(d,'prompt.binding',{recipeId,moduleId,action:'override',text:'local'}).document;
  d=apply(d,'prompt.update',{id:moduleId,patch:{text:'after'}}).document;
  d=apply(d,'prompt.binding',{recipeId,moduleId,action:'safe'}).document;
  assert.equal(d.recipes[0].moduleBindings[0].snapshot.text,'before');assert.equal(d.recipes[0].moduleBindings[0].overrideText,'local');
  d=apply(d,'prompt.binding',{recipeId,moduleId,action:'keep'}).document;assert.equal(d.recipes[0].moduleBindings[0].snapshot.text,'after');assert.equal(d.recipes[0].moduleBindings[0].overrideText,'local');
  d=apply(d,'prompt.binding',{recipeId,moduleId,action:'source'}).document;assert.equal(d.recipes[0].moduleBindings[0].overrideText,undefined);assert.deepEqual(d.recipes[0].references.map(v=>v.assetId),['b','a']);
  assert.throws(()=>apply(d,'recipe.references',{id:recipeId,references:[{assetId:'missing'}]}));
});
test('duplicated grouped graph remaps edges, input order, roles and inline references atomically',()=>{
  let d=base();d.tugouCanvas={version:1,viewport:{x:0,y:0,zoom:1},nodes:[{id:'g',type:'group',data:{name:'group'},position:{x:10,y:20}},{id:'t',type:'text',parentId:'g',position:{x:1,y:2},data:{name:'text',text:'text'}},{id:'n',type:'config',parentId:'g',position:{x:200,y:2},data:{name:'config',prompt:'@[node:t]',promptNodeId:'t',inputOrder:['t'],inputRoles:{t:'subject'},outputAssetIds:['a','b'],outputAssetId:'a'}}],edges:[{id:'e',source:'t',target:'n'}]};
  const r=apply(d,'canvas.duplicate',{ids:['g']}),m=r.results.x.mapping,n=r.document.tugouCanvas.nodes.find(n=>n.id===m.n);
  assert.equal(n.parentId,m.g);assert.equal(n.data.prompt,`@[node:${m.t}]`);assert.deepEqual(n.data.inputOrder,[m.t]);assert.equal(n.data.inputRoles[m.t],'subject');assert.equal(r.document.tugouCanvas.edges[1].source,m.t);assert.equal(d.tugouCanvas.nodes.length,3);
  d=apply(r.document,'canvas.selectResult',{id:m.n,assetId:'b'}).document;assert.equal(d.tugouCanvas.nodes.find(n=>n.id===m.n).data.outputAssetId,'b');
  assert.throws(()=>apply(d,'canvas.selectResult',{id:m.n,assetId:'missing'}));
});
test('selection composition, free transform, clipping and mask anchors round trip with locks',()=>{
  let {doc:d,board}=fixture();let r=apply(d,'layer.create',{artboardId:board,kind:'shape',properties:{shape:'line',width:30,height:30}});d=r.document;const id=r.results.x.id;
  d=apply(d,'layer.update',{id,patch:{scaleX:2,scaleY:.5,skewX:10,blend:'color-burn',warp:[0,0,1,0,1,1,0,1],clipping:true}}).document;
  d=apply(d,'selection.rectangle',{artboardId:board,x:0,y:0,width:20,height:20}).document;
  d=apply(d,'selection.ellipse',{artboardId:board,x:5,y:5,width:10,height:10,operation:'subtract'}).document;
  assert.equal(d.layers.find(l=>l.id===board).selection.paths[1].operation,'subtract');
  d=apply(d,'mask.create',{id}).document;d=apply(d,'mask.link',{id,linked:false}).document;
  assert.deepEqual(d.layers.find(l=>l.id===id).mask.anchor.warp,[0,0,1,0,1,1,0,1]);
  assert.throws(()=>apply(d,'layer.update',{id,patch:{scaleX:0}}));assert.throws(()=>apply(d,'layer.update',{id,patch:{maskSourceId:id}}));
  d=apply(d,'layer.lock',{id:board,locked:true}).document;
  assert.throws(()=>apply(d,'mask.transform',{id,matrix:[1,0,0,1,0,0],width:64,height:64}));
  assert.throws(()=>apply(d,'layout.update',{artboardId:board,patch:{grid:true}}));
});
test('long operations cannot be hidden in document batches',()=>{
  const {doc,board}=fixture();for(const command of ['paint.create','selection.grow','artboard.cropSelection'])assert.throws(()=>apply(doc,command,{artboardId:board,requestId:'r',...(command==='selection.grow'?{radius:2}:{})}),e=>e.code==='NON_TRANSACTIONAL');
});


test('task cancellation guard preserves completed writes for both UI and MCP callers',async t=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{TaskQueue}=require('../core/tasks.cjs');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-cancel-guard-'));t.after(async()=>{assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(os.tmpdir()));assert.ok(path.basename(root).startsWith('tugou-cancel-guard-'));await fs.rm(root,{recursive:true,force:true});});
  const tasks=new TaskQueue(root);await tasks.init();let finish,started,committed=false;
  const ready=new Promise(r=>{started=r;});const task=await tasks.start('test',async()=>{started();await new Promise(r=>{finish=r;});return 'receipt';},{kind:'local-tool'},{canCancel:()=>!committed});
  await ready;await tasks.report(task.id,{progress:42.2,message:'进度测试'});assert.equal(tasks.list()[0].progress,42);committed=true;assert.equal(await tasks.cancel(task.id),false);assert.equal(tasks.list()[0].status,'running');finish();await task.completion;assert.equal(tasks.list()[0].status,'completed');assert.equal(tasks.list()[0].resultId,'receipt');
});
