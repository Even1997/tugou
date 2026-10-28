// Local development only. Builds are staged; edits never overwrite a working UI until accepted.
const fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const backendEntries=['main.cjs','desktop-main.cjs','preload.cjs','build.cjs','package.json','package-lock.json'];
function signature(file){try{return createHash('sha256').update(fs.readFileSync(file)).digest('hex');}catch(error){if(['ENOENT','EISDIR'].includes(error.code))return null;throw error;}}
class DevPreview{
  constructor({root,output,emit,build}){Object.assign(this,{root,output,emit,build});this.version=0;this.state={enabled:true,status:'ready',version:0};this.watchers=[];this.snapshot=null;}
  status(){return this.state;}
  send(patch){this.state={...this.state,detail:undefined,...patch};this.emit(this.state);}
  start(){
    this.backendSignatures=new Map([...backendEntries,...fs.readdirSync(path.join(this.root,'core'),{recursive:true}).filter(name=>/\.(c?js|mjs|json)$/.test(name)).map(name=>'core/'+name.replaceAll('\\','/'))].map(name=>[name,signature(path.join(this.root,name))]));
    for(const directory of ['renderer','core'])this.watchers.push(fs.watch(path.join(this.root,directory),{recursive:true},(_,name)=>{if(name)this.notify(directory+'/'+String(name).replaceAll('\\','/'));}));
    this.watchers.push(fs.watch(this.root,(_,name)=>{if(backendEntries.includes(String(name)))this.notify(String(name));}));
    for(const watcher of this.watchers)watcher.on('error',()=>this.send({status:'error',message:'文件监听中断，请重启开发预览。'}));
  }
  notify(file){
    if(file.startsWith('renderer/'))return this.changed(file);
    this.backendChanges||=new Set();this.backendChanges.add(file);clearTimeout(this.backendTimer);
    // Wait for truncate/write or atomic replacement to finish before comparing bytes.
    this.backendTimer=setTimeout(()=>{const files=[...this.backendChanges];this.backendChanges.clear();for(const name of files)this.changed(name);},150);
  }
  changed(file){
    if(this.closed)return;
    if(!file.startsWith('renderer/')){
      if(!backendEntries.includes(file)&&!/^core\/.*\.(c?js|mjs|json)$/.test(file))return;
      // Windows can notify on unchanged files; only changed contents require restart.
      if(this.backendSignatures&&this.backendSignatures.get(file)===signature(path.join(this.root,file)))return;
      this.restart=true;const pending=this.pending;this.pending=null;if(pending)this.removeStage(pending.stage).catch(()=>{});this.send({status:'restart',message:`${file} 已变化，保存后重启开发预览生效。`});return;
    }
    if(!/\.(jsx?|css|html)$/.test(file)||this.restart)return;
    this.version++;clearTimeout(this.timer);this.timer=setTimeout(()=>this.rebuild(),250);
  }
  async rebuild(){
    if(this.running||this.applying||this.closed||this.restart)return;
    this.running=true;const version=this.version,previous=this.pending;this.pending=null;this.send({status:'building',version,message:''});
    let stage;
    try{
      if(previous)await this.removeStage(previous.stage);
      stage=await fsp.mkdtemp(path.join(path.dirname(this.output),'stage-'));
      await this.build(stage);
      if(this.closed||this.restart||version!==this.version)return;
      const names=await fsp.readdir(stage,{recursive:true}),changed=[];
      for(const name of names){const source=path.join(stage,name);if(!(await fsp.stat(source)).isFile())continue;const data=await fsp.readFile(source);let old;try{old=await fsp.readFile(path.join(this.output,name));}catch(e){if(e.code!=='ENOENT')throw e;}if(!old||!old.equals(data))changed.push(name);}
      if(!changed.length){this.send({status:'ready',message:'界面已是最新。'});return;}
      this.pending={stage,version,css:changed.every(name=>name.endsWith('.css'))};
      this.send({status:'pending',version,css:this.pending.css,message:this.pending.css?'正在更新样式…':'界面有更新，等待安全时机应用…'});
    }catch(error){if(!this.closed&&!this.restart)this.send({status:'error',message:'构建失败，当前界面已保留。修正代码后会自动重试。',detail:String(error.message).slice(-2000)});}
    finally{this.running=false;if(stage&&this.pending?.stage!==stage)await this.removeStage(stage).catch(()=>{});if(!this.closed&&!this.restart&&version!==this.version)this.rebuild();}
  }
  async removeStage(stage){const base=path.dirname(this.output),target=path.resolve(stage);if(path.dirname(target)!==base||!path.basename(target).startsWith('stage-'))throw Error('Invalid preview stage');await fsp.rm(target,{recursive:true,force:true});}
  async apply(version,snapshot){
    if(this.applying||!this.pending||this.pending.version!==version||this.running||this.restart||this.closed)return {applied:false};
    const pending=this.pending;
    if(!pending.css){if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.history?.past)||!Array.isArray(snapshot.history?.future))throw Error('编辑现场不完整，已暂缓更新');if(Buffer.byteLength(JSON.stringify(snapshot))>64*1024*1024)throw Error('编辑现场较大，已保留当前界面，请先保存后重启');}
    this.applying=true;
    try{
      // Keep the previous files for recovery if publishing encounters an I/O error.
      const backup=await fsp.mkdtemp(path.join(path.dirname(this.output),'stage-'));
      try{await fsp.cp(this.output,backup,{recursive:true});await fsp.cp(pending.stage,this.output,{recursive:true});}
      catch(error){await fsp.cp(backup,this.output,{recursive:true});throw error;}
      finally{await this.removeStage(backup);}
      if(!pending.css)this.snapshot=structuredClone(snapshot);
      this.pending=null;await this.removeStage(pending.stage);this.send({status:'ready',version,message:pending.css?'样式已更新':'界面已更新，编辑现场已保留'});
      return {applied:true,css:pending.css,version};
    }finally{this.applying=false;if(this.version!==version&&!this.restart)this.rebuild();}
  }
  close(){this.closed=true;clearTimeout(this.timer);clearTimeout(this.backendTimer);for(const watcher of this.watchers)watcher.close();if(this.pending&&!this.applying){this.removeStage(this.pending.stage).catch(()=>{});this.pending=null;}}
}
function buildPreview(root,output){return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'build.cjs')],{cwd:root,windowsHide:true,env:{...process.env,ELECTRON_RUN_AS_NODE:'1',TUGOU_BUILD_DIR:output},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',chunk=>{error=(error+chunk).slice(-3000);});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(Error(error||'Build failed')));
});}
module.exports={DevPreview,buildPreview};
