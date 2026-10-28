// One explicitly requested reference-image check, with a persistent no-repeat ledger.
const {app,safeStorage,nativeImage}=require('electron');
const fs=require('node:fs/promises'),syncFs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {ProjectStore,safePath}=require('../core/storage.cjs');
const {ConnectionStore}=require('../core/connection.cjs');
const {decryptLegacyConnection}=require('../core/legacy-connection.cjs');
const {TaskQueue}=require('../core/tasks.cjs');
const {AnalysisService}=require('../core/analysis.cjs');
const {saveImage}=require('../core/generation.cjs');
const profile=path.join(syncFs.realpathSync(os.tmpdir()),'tugou-live-analysis');
app.setPath('userData',profile);
const reportFile=path.resolve(__dirname,'../test-results/analysis-live.json');
app.whenReady().then(async()=>{
 if(process.platform!=='win32')throw new Error('This live check reads the authorized Windows profile only');
 if(!process.env.TUGOU_ANALYSIS_IMAGE)throw new Error('Reference image required');
 const root=path.join(profile,'workspace'),store=new ProjectStore(root);await store.init();
 const tasks=new TaskQueue(root);await tasks.init();if(tasks.list().length)throw new Error('Live analysis was already attempted; refusing automatic repeat');
 const current=path.join(app.getPath('appData'),'TugouIndependent');
 const fixture=await safePath(profile,'credential-fixture');await fs.mkdir(fixture,{recursive:true});
 const connection=new ConnectionStore(root,safeStorage);
 try{
   await fs.copyFile(await safePath(current,'Local State'),path.join(fixture,'Local State'));
   await fs.copyFile(await safePath(current,'workspace','connection.enc'),path.join(fixture,'credentials.enc'));
   await connection.importLegacy(path.join(fixture,'credentials.enc'),decryptLegacyConnection);
 }finally{if(path.dirname(fixture)!==profile||path.basename(fixture)!=='credential-fixture')throw new Error('Unsafe temporary path');await fs.rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
 const settings=await connection.publicSettings();
 if(!settings.analysisModel){await fs.writeFile(reportFile,JSON.stringify({status:'not-configured',requests:0,hasKey:settings.hasKey,reason:'现有连接未配置视觉分析模型'}));app.exit(0);return;}
 const bytes=await fs.readFile(process.env.TUGOU_ANALYSIS_IMAGE);
 const record=await store.create('参考图分析真实验收');
 record.document.assets=[{id:'approved-reference',name:'已认可人物参考',...await saveImage(root,bytes,b=>nativeImage.createFromBuffer(b).getSize())}];
 await store.save(record.id,record.document,record.revision);
 const service=new AnalysisService(store,connection,tasks),started=Date.now();
 await service.start(record.id,record.document,'approved-reference','忠实拆分画风、人物、动作、服饰、构图和实际出现的道具。不要将不存在的宠物或文字补入。');await tasks.execution;
 const task=tasks.list()[0],results=await service.results(record.id);
 await fs.writeFile(reportFile,JSON.stringify({status:task.status,message:task.message,model:task.context.model,elapsedMs:Date.now()-started,requests:1,profile,projectId:record.id,results},null,2));
 app.exit(task.status==='completed'?0:1);
}).catch(async error=>{await fs.writeFile(reportFile,JSON.stringify({status:'failed',reason:error.safeMessage||'真实验收启动失败，请检查配置和本地日志；未自动重试'}));app.exit(1);});
