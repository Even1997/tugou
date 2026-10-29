const fs=require('node:fs/promises'),{EventEmitter}=require('node:events');
const semver=require('semver');
const {hashFile,verifiedDownload}=require('./runtime-files.cjs');
const {safePath}=require('./storage.cjs');
const API='https://api.github.com/repos/Even1997/tugou/releases/latest';
const RELEASES='https://github.com/Even1997/tugou/releases';
const MAX_DMG_BYTES=4*1024**3;

// Manual DMG replacement: never invokes Squirrel, quits the app or removes quarantine.
class MacDmgUpdater extends EventEmitter {
  constructor({profile,version,arch=process.arch,openPath,fetchRelease=fetch}){
    super();Object.assign(this,{profile,version,arch,openPath,fetchRelease});this.installMode='dmg';
  }
  async checkForUpdates(){
    this.asset=null;this.file=null;this.emit('checking-for-update');
    const response=await this.fetchRelease(API,{headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('RELEASE_UNAVAILABLE');
    const release=await response.json(),version=semver.valid(release.tag_name);
    if(release.draft||release.prerelease||!version||semver.prerelease(version)||!semver.valid(this.version))throw Error('RELEASE_UNAVAILABLE');
    if(!semver.gt(version,this.version)){this.emit('update-not-available');return;}
    if(!['arm64','x64'].includes(this.arch))throw Error('RELEASE_ARCH_UNAVAILABLE');
    const name=`tugou-${version}-mac-${this.arch}.dmg`,asset=release.assets?.find(item=>item.name===name);
    const url=`${RELEASES}/download/${encodeURIComponent(release.tag_name)}/${name}`;
    if(!asset||asset.browser_download_url!==url||!/^sha256:[a-f0-9]{64}$/.test(asset.digest)||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>MAX_DMG_BYTES)throw Error('RELEASE_ASSET_UNAVAILABLE');
    this.asset={name,url,sha256:asset.digest.slice(7),bytes:asset.size,version};
    this.emit('update-available',{version,releaseNotes:release.body});
  }
  async validFile(file){
    try{return (await fs.stat(file)).size===this.asset.bytes&&(await hashFile(file))===this.asset.sha256;}
    catch(e){if(e.code==='ENOENT')return false;throw e;}
  }
  async downloadUpdate(){
    if(!this.asset)throw Error('UPDATE_NOT_AVAILABLE');
    const folder=await safePath(this.profile,'updates','mac-dmg',this.asset.sha256),file=await safePath(folder,this.asset.name);
    let last=0;
    if(!await this.validFile(file)){
      await fs.rm(file,{force:true});
      const downloaded=await verifiedDownload(this.asset,folder,new AbortController().signal,(transferred,total)=>{
        if(Date.now()-last<200&&transferred!==total)return;
        last=Date.now();this.emit('download-progress',{percent:transferred/total*100,transferred,total});
      },MAX_DMG_BYTES);
      await fs.rename(downloaded,file);
    }
    this.file=file;this.emit('update-downloaded',{version:this.asset.version});
  }
  async openInstaller(){
    if(!this.file||!this.asset)throw Error('UPDATE_NOT_READY');
    await safePath(this.profile,'updates','mac-dmg',this.asset.sha256,this.asset.name);
    if(!await this.validFile(this.file))throw Error('UPDATE_FILE_CHANGED');
    const error=await this.openPath(this.file);if(error)throw Error('UPDATE_OPEN_FAILED');
  }
}
module.exports={MacDmgUpdater};
