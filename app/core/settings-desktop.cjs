const fs=require('node:fs/promises'),path=require('node:path');
const {Updates,RELEASES}=require('./updates.cjs');
const {atomicWrite}=require('./storage.cjs');
const {clientConfig,clientFormats}=require('./mcp-client-config.cjs');
async function directorySize(directory){let total=0;try{for(const entry of await fs.readdir(directory,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const file=path.join(directory,entry.name);if(entry.isDirectory())total+=await directorySize(file);else if(entry.isFile())total+=(await fs.stat(file)).size;}}catch(e){if(e.code!=='ENOENT')throw e;}return total;}
async function registerSettings({app,window,handle,preferences,projects,fonts,tasks,isDirty,isBusy,enableMcp,disableMcp,mcpStatus,prepareMcpUpdate,updater,refreshShortcuts}){
  const {shell,Notification}=require('electron'),profile=app.getPath('userData'),root=path.join(profile,'workspace');
  if(process.platform==='darwin')updater=new (require('./mac-dmg-updater.cjs').MacDmgUpdater)({profile,version:require('../package.json').version,openPath:file=>shell.openPath(file)});
  const installed=require('./desktop-platform.cjs').installedForUpdates({packaged:app.isPackaged,platform:process.platform,executable:app.getPath('exe'),home:app.getPath('home'),exists:require('node:fs').existsSync});
  const updates=new Updates({updater,profile,version:require('../package.json').version,supported:installed,
    guard:async()=>isDirty()?'unsaved':await isBusy()||tasks.list().some(t=>['queued','running'].includes(t.status))?'tasksBusy':null,
    prepare:async()=>{await Promise.all([projects.pending,fonts.pending,preferences.pending,tasks.pending]);},
    beforeInstall:prepareMcpUpdate,
    emit:state=>{if(!window.isDestroyed())window.webContents.send('tugou:update-state',state);}});
  await updates.init();
  let storageOperation;
  handle('settings',async(action,payload)=>{
    if(action==='get')return {preferences:{...preferences.value},locale:app.getLocale(),version:require('../package.json').version,platform:process.platform,arch:process.arch,dataDir:root};
    if(action==='save'){const value=await preferences.save(payload);window.webContents.setZoomFactor(value.zoom/100);if(payload.shortcuts)refreshShortcuts?.();return value;}
    if(action==='shortcutCapture'){if(typeof payload!=='boolean')throw Error('INVALID_SETTINGS');window.webContents.setIgnoreMenuShortcuts(payload);return true;}
    if(action==='storage')return {bytes:await directorySize(root),cacheBytes:await window.webContents.session.getCacheSize(),dataDir:root};
    if(action==='clearCache'){if(!storageOperation)storageOperation=window.webContents.session.clearCache().finally(()=>{storageOperation=null;});await storageOperation;return true;}
    if(action==='openFolder'){const error=await shell.openPath(root);if(error)throw Error('OPEN_FOLDER_FAILED');return true;}
    if(action==='releasePage'||action==='sourcePage'){await shell.openExternal(action==='releasePage'?RELEASES:'https://github.com/Even1997/tugou');return true;}
    if(action==='mcpStatus')return mcpStatus();
    if(action==='mcpEnable'){if(typeof payload!=='boolean')throw Error('INVALID_SETTINGS');if(payload)await enableMcp();else await disableMcp();return mcpStatus();}
    if(action==='mcpConfig'||action==='mcpConnection'){
      const config=clientConfig(app.isPackaged?app.getPath('exe'):process.execPath,app.getAppPath(),profile),formats=clientFormats(config);
      return action==='mcpConfig'?formats.codex:{transport:'stdio',...config,formats};
    }
    if(action==='lastProject'){try{const {id}=JSON.parse(await fs.readFile(path.join(profile,'last-project.json'),'utf8'));return preferences.value.restoreProject?await projects.read(id):null;}catch(e){if(e.code==='ENOENT')return null;throw e;}}
    throw Error('INVALID_SETTINGS_ACTION');
  });
  handle('update',async action=>{if(action==='status')return updates.snapshot();if(action==='check')return updates.check({autoDownload:preferences.value.autoDownload});if(action==='download')return updates.download();if(action==='install')return updates.install();if(action==='openInstaller')return updates.openInstaller();throw Error('INVALID_UPDATE_ACTION');});
  window.webContents.on('did-start-loading',()=>window.webContents.setIgnoreMenuShortcuts(false));
  window.webContents.setZoomFactor(preferences.value.zoom/100);
  const automatic=()=>{if(preferences.value.autoCheck)updates.check({automatic:true,autoDownload:preferences.value.autoDownload}).catch(()=>{});};
  const start=setTimeout(automatic,15000),daily=setInterval(automatic,3600000);start.unref();daily.unref();
  const known=new Map(tasks.list().map(t=>[t.id,t.status]));
  const notify=setInterval(()=>{for(const task of tasks.list()){const before=known.get(task.id);known.set(task.id,task.status);if(before&&before!==task.status&&task.status==='completed'&&preferences.value.notifyTasks&&Notification.isSupported())new Notification({title:'土狗 / Tugou',body:task.label,silent:!preferences.value.sounds}).show();}},2000);notify.unref();
  window.once('closed',()=>{clearTimeout(start);clearInterval(daily);clearInterval(notify);});
  return {updates,remember:record=>atomicWrite(path.join(profile,'last-project.json'),JSON.stringify({id:record.id}))};
}
module.exports={registerSettings,directorySize};
