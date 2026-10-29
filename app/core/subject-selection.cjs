const {randomUUID}=require('node:crypto');
const {referenceBytes,saveImage}=require('./generation.cjs');
const {validateLocalSettings}=require('./local-ai.cjs');
const {subjectReadiness}=require('./subject-readiness.cjs');

// Reuse the installed local cutout model; return its alpha without editing a project.
async function selectSubject(localAI,reference,inspectImage,signal,stage=()=>{}) {
  stage('检查模型与资源');
  signal.throwIfAborted();
  const input=await saveImage(localAI.root,await referenceBytes(localAI.root,reference),inspectImage);
  const ready=subjectReadiness(await localAI.status(),input,require('node:os').freemem());
  if(!ready.ready)throw Object.assign(Error(ready.reason),{safeMessage:ready.reason});
  const settings=validateLocalSettings({operation:'cutout',model:ready.model},input);
  const runtime=await localAI.resolveRuntime(settings,undefined,input);
  const bytes=await localAI.processInput(input,settings,runtime,signal,randomUUID(),stage);
  signal.throwIfAborted();
  return saveImage(localAI.root,bytes,inspectImage);
}
module.exports={selectSubject};
