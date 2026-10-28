const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp');
module.exports=async({call,value,state,run,object,batch,step,ref,check,report,out,kind,profile,js,shot,sleep})=>{
 const initial=await state(),setup=await batch([
  step('director','canvas.create',{type:'director',position:{x:0,y:1500}}),
  step('box','scene.object.create',{nodeId:ref('director'),kind:'box',properties:{color:'#ff0000',position:[0,.5,0]}}),
  step('character','scene.object.create',{nodeId:ref('director'),kind:'character',properties:{position:[1,0,0],body:'child',pose:{rightArm:2.7}}}),
  step('camera','scene.camera.create',{nodeId:ref('director'),properties:{position:[0,1,5],target:[0,.6,0]}}),
  step('activate','scene.camera.activate',{nodeId:ref('director'),id:ref('camera')}),
  step('frame','scene.frame.set',{nodeId:ref('director'),time:0}),
  step('move','scene.object.update',{nodeId:ref('director'),id:ref('box'),patch:{position:[-1,.5,0]}}),
  step('frame2','scene.frame.set',{nodeId:ref('director'),time:2})]);
 const nodeId=setup.results.director.id,box=setup.results.box.id,cameraId=setup.results.camera.id;
 const scene=async()=>(await object('canvasNode',nodeId)).data.scene;
 check('director scene batch shares one undo entry',setup.history.undo===initial.history.undo+1&&(await scene()).frames.length===2);
 const scoped=await value('query_objects',{kind:'sceneObject',nodeId,limit:1});check('scene object discovery is scoped and paginated',scoped.total===2&&scoped.nextOffset===1);
 const cam=await value('get_object',{kind:'camera',nodeId,id:cameraId});check('camera detail is discoverable',cam.object.position[2]===5);
 await assert.rejects(()=>value('query_objects',{kind:'camera'}));check('camera query cannot silently use another director',true);
 const before=await state();await assert.rejects(()=>batch([step('rename','project.rename',{name:'wrong'}),step('bad','scene.camera.update',{nodeId,id:cameraId,patch:{fov:999}})]));check('invalid scene edit rolls back complete batch',(await state()).revision===before.revision);
 const image=async args=>{const r=await call('run_command',{command:'scene.preview',args:{nodeId,maxSize:256,...args}});return Buffer.from(r.content.find(c=>c.type==='image').data,'base64');};
 const start=Date.now(),first=await image({time:0});report.scenePreviewMs=Date.now()-start;fs.writeFileSync(path.join(out,kind+'-scene.png'),first);
 const stats=await sharp(first).stats(),meta=await sharp(first).metadata();check('real WebGL preview has rendered colored geometry',meta.width===256&&meta.height===144&&stats.channels[0].stdev>20);
 const later=await image({time:2});check('animation preview changes pixels without editing document',!first.equals(later)&&(await state()).revision===before.revision);
 const alternate=await image({cameraId:'camera'});check('explicit camera changes rendered view',!alternate.equals(later));
 const invalidBefore=await state();await assert.rejects(()=>image({cameraId:'missing'}));check('bad preview leaves document and history unchanged',(await state()).revision===invalidBefore.revision);
 const captured=await run('scene.capture',{nodeId,time:0,maxSize:256,name:'MCP 场景结果'}),result=await object('canvasNode',captured.nodeId),edges=await value('query_objects',{kind:'edge',limit:100});
 check('scene capture creates connected right-side asset node',result.data.assetId===captured.assetId&&result.position.x>0&&edges.objects.some(e=>e.source===nodeId&&e.target===result.id));
 const capturedFile=path.join(profile,'workspace/resources',(await object('asset',captured.assetId)).resource);
 check('capture pixels match read-only preview',(await sharp(capturedFile).raw().toBuffer()).equals(await sharp(first).raw().toBuffer()));
 await run('history.undo');check('capture undo removes node asset and output together',(await scene()).outputAssetId===undefined&&!(await value('query_objects',{kind:'asset'})).objects.some(a=>a.id===captured.assetId));await run('history.redo');
 const files=path.join(profile,'automation');fs.writeFileSync(path.join(files,'triangle.obj'),'v -1 0 0\nv 1 0 0\nv 0 2 0\nf 1 2 3\n');
 const model=await run('scene.model.import',{nodeId,path:'triangle.obj',properties:{position:[-2,0,0],color:'#00ff00'}});
 check('OBJ import stores hashed resource and scene object',(await scene()).objects.some(o=>o.id===model.id&&o.resource===model.resource));
 const modeled=await image({});fs.writeFileSync(path.join(out,kind+'-scene-model.png'),modeled);check('imported OBJ actually renders',!modeled.equals(later));
 await assert.rejects(()=>run('scene.model.import',{nodeId,path:'../outside.obj'}));check('model import rejects file root traversal',true);
 fs.writeFileSync(path.join(files,'invalid.obj'),'not a model');const importBefore=await state();await assert.rejects(()=>run('scene.model.import',{nodeId,path:'invalid.obj'}));check('invalid model leaves scene untouched',(await state()).revision===importBefore.revision);
 await run('scene.frame.apply',{nodeId,time:1});check('animation interpolates actual object positions',(await scene()).objects.find(o=>o.id===box).position[0]===-.5);await run('history.undo');
 await run('scene.object.delete',{nodeId,id:box});check('object deletion removes animation ghosts',(await scene()).frames.every(f=>!f.objects.some(o=>o.id===box)));await run('history.undo');
 const visibleBefore=await scene();await run('project.save');const projectId=(await state()).projectId;await run('project.open',{id:projectId});check('scene cameras poses keyframes and models survive reopen',JSON.stringify(await scene())===JSON.stringify(visibleBefore));
 const repeat=Date.now();for(let i=0;i<24;i++){const frame=await image({time:i%3});assert.ok(frame.length>500);}report.scenePreview24Ms=Date.now()-repeat;check('24 consecutive previews release contexts and retain live bridge',!!(await state()).revision);
 await run('workspace.show',{workspace:'canvas'});await run('canvas.viewport',{x:80,y:-1000,zoom:.8});await sleep(350);
 // Open the actual existing SceneView; screenshot validates UI reads the same scene.
 await js(`(()=>{const node=document.querySelector('[data-id="${nodeId}"]');if(node)node.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));})()`);await sleep(500);
 check('MCP scene opens in existing director UI',await js('!!document.querySelector("[data-scene-view]")'));await shot('director');
};
