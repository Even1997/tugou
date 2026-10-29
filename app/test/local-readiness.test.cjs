const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {LocalAIService}=require('../core/local-ai.cjs');
const {localToolReadiness}=require('../core/local-readiness.cjs');
test('missing Python cannot disable an installed upscale model; cutout gives actionable reason',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-readiness-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const dir=path.join(root,'realesrgan');await fs.mkdir(path.join(dir,'models'),{recursive:true});
  await fs.writeFile(path.join(dir,'realesrgan-ncnn-vulkan'+(process.platform==='win32'?'.exe':'')),'fixture');
  for(const ext of ['bin','param'])await fs.writeFile(path.join(dir,'models','realesrgan-x4plus.'+ext),'fixture');
  const service=new LocalAIService({root});
  await service.configure(root);
  const status=await service.status();assert.equal(status.configured,true);assert.equal(status.cutout,false);
  assert.equal(localToolReadiness(status,{operation:'upscale',model:'general'}).ready,true);
  assert.equal(localToolReadiness(status,{operation:'upscale',model:'anime'}).ready,false);
  await service.resolveRuntime({operation:'upscale',model:'general'});
  await assert.rejects(service.resolveRuntime({operation:'cutout'}),/抠图运行环境/);
  assert.equal(localToolReadiness(null,{operation:'upscale'}).ready,false);
});
test('low-memory cutout is blocked before queuing without blocking upscale',()=>{
 const status={configured:true,cutout:true,models:['general'],memory:{available:4*1024**3,commitAvailable:12*1024**3}};
 assert.equal(localToolReadiness(status,{operation:'cutout'}).resourceLimited,true);
 assert.equal(localToolReadiness(status,{operation:'upscale',model:'general'}).ready,true);
 status.memory.commitAvailable=16*1024**3;
 assert.equal(localToolReadiness(status,{operation:'cutout'},{width:1024,height:1024}).ready,true);
 assert.equal(localToolReadiness(status,{operation:'cutout'},{width:12000,height:12000}).resourceLimited,true);
});
test('lightweight cutout has its own model and memory checks; precise limits stay intact',()=>{
 const status={configured:true,cutout:true,cutoutModels:['birefnet','u2netp'],memory:{available:3*1024**3,commitAvailable:4*1024**3}};
 assert.equal(localToolReadiness(status,{operation:'cutout',model:'u2netp'},{width:512,height:768}).ready,true);
 assert.equal(localToolReadiness(status,{operation:'cutout',model:'birefnet'}).resourceLimited,true);
 assert.equal(localToolReadiness({...status,cutoutModels:['birefnet']},{operation:'cutout',model:'u2netp'}).ready,false);
 assert.equal(localToolReadiness(status,{operation:'cutout',model:'invalid'}).ready,false);
 assert.equal(localToolReadiness({...status,memory:{...status.memory,available:2*1024**3}},{operation:'cutout',model:'u2netp'},{width:10000,height:10000}).resourceLimited,true);
});
