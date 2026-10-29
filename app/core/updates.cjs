const fs=require('node:fs/promises'),path=require('node:path');
const {atomicWrite}=require('./storage.cjs');
const RELEASES='https://github.com/Even1997/tugou/releases';
// No provider URL, executable path or credential is accepted from the renderer.
class Updates {
  constructor({updater,profile,version,supported,guard,prepare,beforeInstall=async()=>{},emit=()=>{},now=Date.now}){
    Object.assign(this,{updater,profile,guard,prepare,beforeInstall,emit,now});
    this.state={status:supported?'idle':'portable',currentVersion:version,supported,installMode:updater.installMode||'automatic',releaseUrl:RELEASES,lastChecked:null};
    updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;
    updater.on('checking-for-update',()=>this.set({status:'checking',version:null,notes:'',blocked:null,error:null}));
    updater.on('update-available',info=>this.set({status:'available',version:info.version,notes:notes(info.releaseNotes),error:null}));
    updater.on('update-not-available',()=>this.set({status:'latest',version:null,notes:'',error:null}));
    updater.on('download-progress',p=>this.set({status:'downloading',percent:Math.max(0,Math.min(100,p.percent)),transferred:p.transferred,total:p.total}));
    updater.on('update-downloaded',info=>this.set({status:'ready',version:info.version,percent:100,error:null}));
    updater.on('error',e=>this.failure(e));
  }
  set(patch){this.state={...this.state,...patch};this.emit(this.snapshot());}
  snapshot(){return {...this.state};}
  failure(e){const code=String(e.code||'');this.set({status:'error',error:/404|latest|release|channel/i.test(code+' '+e.message)?'releaseUnavailable':'updateFailed'});}
  async init(){try{const saved=JSON.parse(await fs.readFile(path.join(this.profile,'update-state.json'),'utf8'));if(Number.isFinite(saved.lastChecked))this.state.lastChecked=saved.lastChecked;}catch(e){if(e.code!=='ENOENT')this.state.error='updateFailed';}}
  async check({automatic=false,autoDownload=false}={}){
    if(!this.state.supported)return this.snapshot();
    if(this.operation||['ready','installing'].includes(this.state.status))return this.snapshot();
    if(automatic&&this.state.lastChecked&&this.now()-this.state.lastChecked<86400000)return this.snapshot();
    this.operation=true;
    try{this.set({status:'checking',error:null});await this.updater.checkForUpdates();}
    catch(e){this.failure(e);}finally{this.operation=false;this.set({lastChecked:this.now()});try{await atomicWrite(path.join(this.profile,'update-state.json'),JSON.stringify({lastChecked:this.state.lastChecked}));}catch(e){this.failure(e);}}
    if(autoDownload&&this.state.status==='available')await this.download();
    return this.snapshot();
  }
  async download(){
    if(this.operation)return this.snapshot();
    if(this.state.status!=='available')throw Error('UPDATE_NOT_AVAILABLE');
    this.operation=true;this.set({status:'downloading',percent:0,transferred:0,total:0,error:null});
    try{await this.updater.downloadUpdate();}catch(e){this.failure(e);}finally{this.operation=false;}
    return this.snapshot();
  }
  async install(){
    if(this.state.installMode==='dmg')throw Error('UPDATE_MANUAL_INSTALL_REQUIRED');
    if(this.state.status!=='ready'||this.operation)throw Error('UPDATE_NOT_READY');
    this.operation=true;
    try{
      const reason=await this.guard();if(reason){this.set({blocked:reason});return this.snapshot();}
      await this.prepare();
      const again=await this.guard();if(again){this.set({blocked:again});return this.snapshot();}
      this.set({status:'installing',blocked:null});await this.beforeInstall();this.updater.quitAndInstall(true,true);
    }catch(e){this.failure(e);}finally{this.operation=false;}
    return this.snapshot();
  }
  async openInstaller(){
    if(this.state.installMode!=='dmg'||this.state.status!=='ready'||this.operation)throw Error('UPDATE_NOT_READY');
    this.operation=true;
    try{await this.updater.openInstaller();}catch(e){this.failure(e);}finally{this.operation=false;}
    return this.snapshot();
  }
}
function notes(value){return (Array.isArray(value)?value.map(v=>v.note).join('\n'):typeof value==='string'?value:'').slice(0,20000);}
module.exports={Updates,RELEASES};
