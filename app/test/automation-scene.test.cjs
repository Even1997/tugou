const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {batch,validate}=require('../core/automation-commands.cjs');
const {appendCapture}=require('../core/automation-scene.cjs');
const {importModel}=require('../core/import-model.cjs');
const base=()=>({name:'Scene',width:128,height:128,background:'#ffffff',modules:[],recipes:[],assets:[],layers:[],jobs:[]});
const step=(name,command,args)=>({name,command,args}),ref=name=>({$ref:name+'.id'});
const apply=(document,command,args)=>batch(document,[step('one',command,args)]).document;
function setup(){return batch(base(),[step('node','canvas.create',{type:'director',position:{x:10,y:20}}),step('box','scene.object.create',{nodeId:ref('node'),kind:'box'}),step('person','scene.object.create',{nodeId:ref('node'),kind:'character',properties:{body:'child',pose:{rightArm:2}}})]);}
test('scene commands validate types, camera geometry, resources and rollback',()=>{
 const r=setup(),d=r.document,nodeId=r.results.node.id,box=r.results.box.id;
 assert.throws(()=>apply(d,'scene.object.update',{nodeId,id:box,patch:{pose:{leftLeg:1}}}),/只有角色/);
 for(const patch of [{scale:[1,0,1]},{rotation:[1,2]},{position:[Infinity,0,0]},{resource:'../x.obj'}])assert.throws(()=>validate('scene.object.update',{nodeId,id:box,patch}));
 assert.throws(()=>apply(d,'scene.camera.update',{nodeId,id:'camera',patch:{position:[0,1,0]}}),/重合/);
 assert.deepEqual(d.tugouCanvas.nodes[0].data.scene.cameras[0].position,[5,3,7]);
 assert.throws(()=>apply(d,'scene.camera.delete',{nodeId,id:'camera'}),/至少保留/);
 assert.throws(()=>apply(d,'scene.object.create',{nodeId,kind:'model'}),/resource/);
 assert.throws(()=>batch(d,[step('ok','project.rename',{name:'wrong'}),step('bad','scene.object.delete',{nodeId,id:'absent'})]));assert.equal(d.name,'Scene');
});
test('scene animation and camera operations are reversible document snapshots',()=>{
 const r=setup(),nodeId=r.results.node.id,box=r.results.box.id;let d=r.document;
 d=apply(d,'scene.frame.set',{nodeId,time:0});d=apply(d,'scene.object.update',{nodeId,id:box,patch:{position:[2,.5,0]}});d=apply(d,'scene.frame.set',{nodeId,time:2});
 const original=structuredClone(d);d=apply(d,'scene.frame.apply',{nodeId,time:1});assert.equal(d.tugouCanvas.nodes[0].data.scene.objects[0].position[0],1);assert.deepEqual(d.tugouCanvas.nodes[0].data.scene.frames,original.tugouCanvas.nodes[0].data.scene.frames);
 d=apply(d,'scene.object.delete',{nodeId,id:box});assert.ok(d.tugouCanvas.nodes[0].data.scene.frames.every(f=>!f.objects.some(o=>o.id===box)));
 d=apply(d,'scene.frame.delete',{nodeId,time:2});assert.equal(d.tugouCanvas.nodes[0].data.scene.frames.length,1);
 const more=batch(d,[step('camera','scene.camera.create',{nodeId,properties:{name:'side'}}),step('active','scene.camera.activate',{nodeId,id:ref('camera')}),step('remove','scene.camera.delete',{nodeId,id:ref('camera')}),step('clone','scene.object.duplicate',{nodeId,id:r.results.person.id})]);
 const s=more.document.tugouCanvas.nodes[0].data.scene;assert.equal(s.activeCamera,'camera');assert.equal(s.objects.length,2);assert.notEqual(s.objects[0].id,s.objects[1].id);
});
test('scene capture reuses output positioning, works inside groups and never mutates source',()=>{
 const r=setup(),node=r.document.tugouCanvas.nodes[0];node.parentId='group';r.document.tugouCanvas.nodes.push({id:'group',type:'group',position:{x:100,y:200},data:{name:'Group'}});
 const asset={id:'picture',resource:'a'.repeat(64)+'.png',width:128,height:128,name:'render'};
 const out=appendCapture(r.document,node.id,asset);assert.equal(r.document.assets.length,0);assert.ok(out.document.tugouCanvas.nodes.at(-1).position.x>410);assert.equal(out.document.tugouCanvas.edges[0].source,node.id);assert.equal(out.document.tugouCanvas.nodes[0].data.outputAssetId,asset.id);
});
test('model import rejects wrong types, empty data, symlinks and oversized files',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-model-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const file=path.join(dir,'model.obj');await fs.writeFile(file,'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3');
 const model=await importModel(dir,file);assert.match(model.resource,/^[a-f0-9]{64}\.obj$/);assert.equal((await importModel(dir,file)).resource,model.resource);
 const invalid=path.join(dir,'bad.obj');await fs.writeFile(invalid,'empty');await assert.rejects(()=>importModel(dir,invalid),/顶点/);
 await fs.writeFile(path.join(dir,'bad.fbx'),'empty');await assert.rejects(()=>importModel(dir,path.join(dir,'bad.fbx')),/无效/);
 const large=await fs.open(invalid,'w');await large.truncate(64*1024*1024+1);await large.close();await assert.rejects(()=>importModel(dir,invalid),/64 MiB/);
 await fs.mkdir(path.join(dir,'models'));await fs.symlink(path.join(dir,'models'),path.join(dir,'linked'),process.platform==='win32'?'junction':'dir');await assert.rejects(()=>importModel(dir,path.join(dir,'linked/model.obj')),/链接/);
});
test('layer.update cannot bypass an inherited lock to unlock a child',()=>{
 const r=batch(base(),[step('board','artboard.create',{name:'Board',width:128,height:128}),step('shape','layer.create',{artboardId:ref('board'),kind:'shape',properties:{locked:true}}),step('locked','layer.lock',{id:ref('board'),locked:true})]);
 assert.throws(()=>apply(r.document,'layer.update',{id:r.results.shape.id,patch:{locked:false}}),/锁定/);
});
