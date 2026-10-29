const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {batch,listCommands,validate}=require('../core/automation-commands.cjs');
const {RequestJournal,createDispatcher}=require('../core/automation-host.cjs');
const base=()=>({id:'p',name:'MCP',width:128,height:128,background:'#ffffff',modules:[],recipes:[],assets:[],layers:[],jobs:[]});
const step=(name,command,args={})=>({name,command,args});
const ref=name=>({$ref:name+'.id'});
const apply=(d,command,args)=>batch(d,[step('one',command,args)]);

test('cutout edge schema exposes source-pixel bounds and rejects invalid requests',()=>{
 const args={ids:['a'],requestId:'edge-test',settings:{operation:'cutout',model:'u2netp',edgeShrink:1,edgeFeather:0.5}};
 assert.doesNotThrow(()=>validate('image.process',args));
 for(const settings of [{edgeShrink:1.5},{edgeShrink:5},{edgeFeather:-1},{edgeFeather:5}])
  assert.throws(()=>validate('image.process',{...args,settings:{...args.settings,...settings}}));
});
test('catalog has schemas, effects, and no executable escape hatch',()=>{const c=listCommands();assert.ok(c.length>=60);for(const x of c){assert.equal(x.inputSchema.additionalProperties,false);assert.ok(x.effect);}assert.throws(()=>validate('eval',{code:'x'}));assert.throws(()=>validate('layer.update',{id:'a',patch:{bitmap:{url:'https://bad'}}}));});
test('batch refs create connected graph; failures do not mutate original',()=>{
 const d=base(),result=batch(d,[step('text','canvas.create',{type:'text',position:{x:0,y:0},properties:{text:'a cat'}}),step('desk','canvas.create',{type:'config',position:{x:400,y:0}}),step('edge','canvas.connect',{source:ref('text'),target:ref('desk')})]);
 assert.equal(d.tugouCanvas,undefined);assert.equal(result.document.tugouCanvas.edges[0].source,result.results.text.id);
 assert.throws(()=>batch(d,[step('a','project.rename',{name:'changed'}),step('bad','canvas.connect',{source:'x',target:'y'})]));assert.equal(d.name,'MCP');
 assert.throws(()=>batch(d,[step('bad','generation.start',{nodeId:'x',requestId:'x'})]),/批次仅允许/);
 assert.throws(()=>batch(d,[step('a','project.rename',{name:ref('future')})]),/引用/);
});
test('prompt recipes pin snapshots and synchronize deliberately',()=>{
 const result=batch(base(),[step('p','prompt.create',{name:'风格',kind:'style',text:'水彩'}),step('r','recipe.create',{name:'配方',moduleIds:[ref('p')]}),step('u','prompt.update',{id:ref('p'),patch:{text:'油画'}}),step('s','prompt.sync')]);
 assert.equal(result.document.modules[0].text,'油画');assert.equal(result.document.recipes[0].moduleBindings[0].snapshot.text,'油画');
});
test('artboards, groups, transforms, masks and free selection round trip',()=>{
 const result=batch(base(),[
  step('board','artboard.create',{name:'设计',width:128,height:128}),
  step('shape','layer.create',{artboardId:ref('board'),kind:'shape',properties:{x:10,y:20,width:50,height:30,color:'#ff0000'}}),
  step('text','layer.create',{artboardId:ref('board'),kind:'text',properties:{text:'标题'}}),
  step('mask','mask.create',{id:ref('shape')}),step('invert','mask.update',{id:ref('shape'),patch:{inverted:true,density:70}}),
  step('selection','selection.polygon',{artboardId:ref('board'),points:[0,0,100,0,50,100]}),step('inverse','selection.invert',{artboardId:ref('board')})]);
 let d=result.document;const shapeId=result.results.shape.id,boardId=result.results.board.id,textId=result.results.text.id;
 assert.equal(d.layers.find(l=>l.id===shapeId).mask.density,70);assert.equal(d.layers.find(l=>l.id===boardId).selection.inverted,true);
 const grouped=apply(d,'layer.group',{ids:[shapeId,textId]});assert.equal(grouped.results.one.ids.length,1);
 const ungrouped=apply(grouped.document,'layer.ungroup',{id:grouped.results.one.ids[0]});assert.equal(ungrouped.results.one.ids.length,2);
 d=apply(ungrouped.document,'layer.move',{ids:[shapeId],dx:10,dy:5}).document;
 assert.equal(d.layers.find(l=>l.id===shapeId).x,20);assert.equal(d.layers.find(l=>l.id===shapeId).y,25);
 d=apply(d,'layer.update',{id:shapeId,patch:{locked:true}}).document;assert.throws(()=>apply(d,'mask.delete',{id:shapeId}),/锁定/);
 d=apply(d,'layer.update',{id:shapeId,patch:{locked:false}}).document;d=apply(d,'mask.delete',{id:shapeId}).document;assert.equal(d.layers.find(l=>l.id===shapeId).mask,undefined);
 d=apply(d,'selection.clear',{artboardId:boardId}).document;assert.equal(d.layers.find(l=>l.id===boardId).selection,undefined);
});
test('canvas groups preserve positions after ungroup and reorder uses real engine names',()=>{
 let r=batch(base(),[step('a','canvas.create',{type:'text',position:{x:100,y:200}}),step('b','canvas.create',{type:'text',position:{x:500,y:200}}),step('g','canvas.group',{ids:[ref('a'),ref('b')]})]);
 r=apply(r.document,'canvas.ungroup',{id:r.results.g.id});assert.equal(r.document.tugouCanvas.nodes[0].position.x,100);
 assert.throws(()=>validate('layer.reorder',{ids:['a'],action:'front'}));
});
test('journal persists successful submissions and refuses ambiguous or changed retries',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-mcp-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const file=path.join(dir,'requests.json'),j=new RequestJournal(file);await j.init();let count=0;
 assert.equal((await j.execute('key',{x:1},async()=>({taskId:String(++count)}))).taskId,'1');
 const reloaded=new RequestJournal(file);await reloaded.init();assert.equal((await reloaded.execute('key',{x:1},async()=>({taskId:String(++count)}))).replayed,true);assert.equal(count,1);
 await assert.rejects(()=>reloaded.execute('key',{x:2},async()=>{}),/不同请求/);
 await assert.rejects(()=>reloaded.execute('ambiguous',{},async()=>{throw Error('disconnect');}),/disconnect/);
 const restarted=new RequestJournal(file);await restarted.init();await assert.rejects(()=>restarted.execute('ambiguous',{},async()=>{count++;}),/不确定/);assert.equal(count,1);
});
test('dispatcher protects live revision, paths, and pagination',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-host-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));let state={projectId:'p',revision:'v1',document:base(),busy:false};let commits=0;
 const ui=async(action,args,revision)=>{if(action==='snapshot')return structuredClone(state);assert.equal(revision,state.revision);commits++;state={...state,document:args.document,revision:'v'+(commits+1)};return state;};
 const dispatch=await createDispatcher({ui,projects:{verifyResources:async()=>{}},root,filesRoot:root});
 await assert.rejects(()=>dispatch('run_command',{command:'project.rename',args:{name:'bad'},expectedRevision:'old'}),/revision/);
 const result=await dispatch('run_command',{command:'project.rename',args:{name:'new'},expectedRevision:'v1'});assert.equal(result.name,'new');assert.equal(commits,1);
 await assert.rejects(()=>dispatch('run_command',{command:'asset.import',args:{path:'../secret.txt'},expectedRevision:'v2'}),/路径/);
 await assert.rejects(()=>dispatch('query_objects',{kind:'asset',limit:999}),/参数/);
 assert.equal((await dispatch('query_objects',{kind:'asset'})).total,0);
});
test('layout, hierarchy, clone, lock and delete commands operate on real document objects',()=>{
 let r=batch(base(),[step('b','artboard.create',{name:'画板',width:128,height:128}),step('a','layer.create',{artboardId:ref('b'),kind:'shape',properties:{x:20,y:20,width:20,height:20}}),step('b2','artboard.duplicate',{id:ref('b')})]);
 const b=r.results.b.id,a=r.results.a.id,b2=r.results.b2.id;
 let d=apply(r.document,'artboard.update',{id:b,patch:{x:500}}).document;
 d=apply(d,'layer.align',{ids:[a],axis:'x',mode:'start'}).document;assert.equal(d.layers.find(l=>l.id===a).x,0);
 r=apply(d,'layer.duplicate',{ids:[a]});const copy=r.results.one.ids[0];d=r.document;
 d=apply(d,'layer.reorder',{ids:[a],action:'top'}).document;assert.ok(d.layers.findIndex(l=>l.id===a)>d.layers.findIndex(l=>l.id===copy));
 d=apply(d,'layer.reparent',{ids:[copy],targetId:b2}).document;assert.equal(d.layers.find(l=>l.id===copy).parentId,b2);
 d=apply(d,'layer.lock',{id:b,locked:true}).document;assert.throws(()=>apply(d,'layer.update',{id:a,patch:{x:1}}),/锁定/);
 d=apply(d,'layer.lock',{id:b,locked:false}).document;d=apply(d,'artboard.delete',{id:b2}).document;assert.ok(!d.layers.some(l=>l.id===copy));
 d=apply(d,'layer.delete',{ids:[a]}).document;assert.ok(!d.layers.some(l=>l.id===a));
 assert.throws(()=>apply(d,'layer.duplicate',{ids:[b]}),/artboard/);
});
test('effect, adjustment and image settings reject unsupported fields and ranges',()=>{
 const r=batch(base(),[step('b','artboard.create',{name:'board',width:128,height:128}),step('a','layer.create',{artboardId:ref('b'),kind:'shape'}),step('e','layer.effects',{id:ref('a'),effects:[{type:'shadow',radius:5}]}),step('c','layer.adjustment',{artboardId:ref('b'),adjustment:{type:'curves'}})]);
 assert.equal(r.document.layers.find(l=>l.id===r.results.c.id).adjustment.channels.rgb[1][1],255);
 assert.throws(()=>validate('layer.effects',{id:'a',effects:[{type:'shadow',radius:99999}]}));
 assert.throws(()=>validate('image.process',{ids:['a'],requestId:'r',settings:{operation:'mirror',executable:'cmd.exe'}}));
 assert.throws(()=>validate('paint.stroke',{id:'a',target:'guess',points:[{x:0,y:0}],size:3}));
 assert.throws(()=>validate('layer.update',{id:'a',patch:{color:'#12345'}}));
});
test('file junction escape is refused and large queries are paginated',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-root-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const files=path.join(root,'files'),outside=path.join(root,'outside');await fs.mkdir(files);await fs.mkdir(outside);await fs.writeFile(path.join(outside,'secret.png'),'secret');
 await fs.symlink(outside,path.join(files,'escape'),process.platform==='win32'?'junction':'dir');
 const document=base();document.assets=Array.from({length:10000},(_,i)=>({id:String(i),name:'Asset '+i}));
 const dispatch=await createDispatcher({ui:async()=>({projectId:'p',revision:'v1',document}),root,filesRoot:files});
 const page=await dispatch('query_objects',{kind:'asset',offset:9900,limit:100});assert.equal(page.total,10000);assert.equal(page.objects.length,100);assert.equal(page.nextOffset,null);
 await assert.rejects(()=>dispatch('run_command',{command:'asset.import',args:{path:'escape/secret.png'},expectedRevision:'v1'}),/链接|link|符号/);
});
