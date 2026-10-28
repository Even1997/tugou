// Read-only /models probe of the user's existing connection; never log URL, Key or IDs.
const {app,safeStorage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const {ConnectionStore}=require('../core/connection.cjs');
const out=path.resolve('test-results/connection-compact'),root=path.resolve('preview-data/workspace'),file=path.join(root,'connection.enc');
app.setPath('userData',fs.mkdtempSync(path.join(out,'live-profile-')));
setTimeout(()=>app.exit(1),25000);
app.whenReady().then(async()=>{
 const report={readOnly:true,actualApiCalled:false};
 try{const store=new ConnectionStore(root,safeStorage),settings=await store.publicSettings();
  if(settings.baseUrl&&settings.hasKey){const before=fs.readFileSync(file);const result=await store.probe({},true);Object.assign(report,{actualApiCalled:true,ok:result.ok,count:result.count,elapsedMs:result.elapsedMs,message:result.message,storedBytesUnchanged:before.equals(fs.readFileSync(file))});}
  else report.skipped='No existing configured connection';
 }catch{report.failure='Unable to read or test existing encrypted connection';}
 fs.writeFileSync(path.join(out,'live.json'),JSON.stringify(report,null,2));app.exit(report.failure?1:0);
});
