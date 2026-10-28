const {test}=require('node:test'),assert=require('node:assert/strict'),{LocalAIService}=require('../core/local-ai.cjs');
test('concurrent AI status checks share one probe but subsequent checks are fresh',async()=>{
  const service=new LocalAIService({root:'unused'});let calls=0,finish;
  service.runtime=()=>{calls++;return new Promise(resolve=>{finish=resolve})};
  const a=service.status(),b=service.status();assert.equal(calls,1);finish({cutout:true,availableModels:[],providers:[]});
  assert.equal((await a).configured,true);assert.deepEqual(await b,await a);
  const c=service.status();assert.equal(calls,2);finish({cutout:false,availableModels:[],providers:[]});assert.equal((await c).cutout,false);
});
test('failed shared AI probe reports safe reason and can retry',async()=>{
  const service=new LocalAIService({root:'unused'});let calls=0;service.runtime=async()=>{calls++;throw Object.assign(Error('private details'),{safeMessage:'组件不可用'})};
  const results=await Promise.all([service.status(),service.status()]);assert.equal(calls,1);assert.equal(results[0].message,'组件不可用');assert.equal(results[1].configured,false);await service.status();assert.equal(calls,2);
});
