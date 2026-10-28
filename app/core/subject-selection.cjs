const {randomUUID}=require('node:crypto');
const {referenceBytes,saveImage}=require('./generation.cjs');
const {validateLocalSettings}=require('./local-ai.cjs');

// Reuse the installed local cutout model; return its alpha without editing a project.
async function selectSubject(localAI,reference,inspectImage,signal,stage=()=>{}) {
  stage('检查模型与资源');
  const runtime=await localAI.resolveRuntime({operation:'cutout'});
  signal.throwIfAborted();
  const input=await saveImage(localAI.root,await referenceBytes(localAI.root,reference),inspectImage);
  const settings=validateLocalSettings({operation:'cutout'},input);
  const bytes=await localAI.processInput(input,settings,runtime,signal,randomUUID(),stage);
  signal.throwIfAborted();
  return saveImage(localAI.root,bytes,inspectImage);
}
module.exports={selectSubject};
