const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {selectSubject}=require('../core/subject-selection.cjs');
const {saveImage}=require('../core/generation.cjs');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6C9kAAAAASUVORK5CYII=','base64');
test('subject selection validates input, reuses local worker, saves result and obeys cancellation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-subject-')),inspect=()=>({width:1,height:1});
  let calls=0;const stages=[];
  const engine={root,resolveRuntime:async()=>({provider:'test'}),processInput:async(input,settings,runtime,signal,id,stage)=>{calls++;assert.equal(settings.operation,'cutout');assert.equal(input.width,1);assert.match(id,/^[a-f0-9-]{36}$/);signal.throwIfAborted();stage('加载主体模型');return png}};
  engine.status=async()=>({configured:true,cutout:true,cutoutModels:['u2netp'],memory:{available:4*1024**3,commitAvailable:4*1024**3}});
  try{
    const source=await saveImage(root,png,inspect),signal=new AbortController().signal;
    assert.equal((await selectSubject(engine,source,inspect,signal,s=>stages.push(s))).resource,source.resource);assert.equal(calls,1);assert.deepEqual(stages,['检查模型与资源','加载主体模型']);
    await assert.rejects(selectSubject(engine,{resource:'../../private.png'},inspect,signal),/参考图缺失/);assert.equal(calls,1);
    const cancelled=new AbortController();cancelled.abort();await assert.rejects(selectSubject(engine,source,inspect,cancelled.signal),{name:'AbortError'});assert.equal(calls,1);
    const after=new AbortController();engine.processInput=async()=>{after.abort();return png};await assert.rejects(selectSubject(engine,source,inspect,after.signal),{name:'AbortError'});
    await fs.writeFile(path.join(root,'resources',source.resource),'corrupt');await assert.rejects(selectSubject(engine,source,inspect,signal),/校验失败/);
  }finally{await fs.rm(root,{recursive:true,force:true})}
});
