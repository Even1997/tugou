const fs=require('node:fs/promises'),path=require('node:path'),{EventEmitter}=require('node:events');
const {safePath}=require('./storage.cjs'),{verifiedDownload,hashFile}=require('./runtime-files.cjs');
const {builtinFonts}=require('./builtin-fonts.cjs'),{fontFaces}=require('./font-weights.cjs');
const release='https://github.com/Even1997/tugou/releases/download/font-assets-v1/';
const assetName=face=>face.sha256+path.extname(face.file);
class FontDownloads extends EventEmitter {
  constructor(root,{faces=builtinFonts.flatMap(fontFaces),download=verifiedDownload}={}){
    super();this.folder=path.join(root,'font-cache');this.faces=new Map(faces.map(f=>[f.id,f]));this.download=download;this.pending=new Map();this.states=new Map();this.verified=new Map();
  }
  face(id){const face=this.faces.get(id);if(!face)throw Error('字体不在目录中');return face;}
  async location(face){return safePath(this.folder,face.sha256);}
  async status(id){
    const face=this.face(id),active=this.states.get(id);if(active?.status==='downloading'||active?.status==='error')return active;
    try{const stat=await fs.stat(await this.location(face));if(stat.size===face.bytes)return {id,status:'ready',percent:100,total:face.bytes,transferred:face.bytes};}catch(e){if(e.code!=='ENOENT')throw e;}
    return {id,status:'cloud',percent:0,total:face.bytes,transferred:0};
  }
  async file(id){
    const face=this.face(id),file=await this.location(face);let stat;try{stat=await fs.stat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}
    const signature=[stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
    if(stat.size!==face.bytes)return null;
    if(this.verified.get(face.sha256)!==signature){if(await hashFile(file)!==face.sha256)return null;this.verified.set(face.sha256,signature);}
    return file;
  }
  ensure(id){
    this.face(id);if(this.pending.has(id))return this.pending.get(id);
    const operation=this.fetch(id).finally(()=>this.pending.delete(id));this.pending.set(id,operation);return operation;
  }
  async fetch(id){
    const face=this.face(id);let last=0;
    const emit=state=>{const value={id,total:face.bytes,...state};this.states.set(id,value);this.emit('progress',value);return value;};
    try{
      if(await this.file(id))return emit({status:'ready',percent:100,transferred:face.bytes});
      emit({status:'downloading',percent:0,transferred:0});
      await this.download({...face,url:release+assetName(face)},this.folder,new AbortController().signal,(transferred,total)=>{
        if(Date.now()-last<100&&transferred<total)return;last=Date.now();emit({status:'downloading',transferred,percent:Math.min(99,Math.floor(transferred/total*100))});
      });
      if(!await this.file(id))throw Error('字体校验失败，请重试');
      return emit({status:'ready',percent:100,transferred:face.bytes});
    }catch(error){emit({status:'error',percent:0,transferred:0,error:'字体下载失败，请联网后重试：'+error.message});throw error;}
  }
}
const stores=new Map();
function fontDownloads(root){const key=path.resolve(root);if(!stores.has(key))stores.set(key,new FontDownloads(key));return stores.get(key);}
module.exports={FontDownloads,fontDownloads,assetName,release};
