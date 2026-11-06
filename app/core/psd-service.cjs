const {Worker}=require('node:worker_threads');
const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {safePath}=require('./storage.cjs');
const {saveImage}=require('./generation.cjs');
const {createLayer}=require('./layers.cjs');
const {MAX_BYTES}=require('./psd-format.cjs');
function runPsd(data,signal){
  signal.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(path.join(__dirname,'psd-worker.cjs'),{workerData:data,resourceLimits:{maxOldGenerationSizeMb:384}});
    let ended=false;const finish=(error,value)=>{if(ended)return;ended=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);worker.terminate();error?reject(error):resolve(value);};
    const cancel=()=>finish(Error('已取消 PSD 处理'));
    const timer=setTimeout(()=>finish(Error('PSD 处理超时，请减少尺寸或图层后重试')),120000);
    worker.once('message',message=>finish(message.error?Error(message.error):null,message.value));
    worker.once('error',error=>finish(error));worker.once('exit',()=>finish(Error('PSD 处理进程已中断')));
    signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  });
}
async function importPsd(root,filename,merged,signal,inspectImage){
  const file=await safePath(path.dirname(filename),path.basename(filename)),stat=await fs.stat(file);
  if(!stat.isFile()||stat.size>MAX_BYTES||!file.toLowerCase().endsWith('.psd'))throw Error('请选择不超过 128 MiB 的 PSD 文件');
  const result=await runPsd({action:'decode',bytes:await fs.readFile(file),merged},signal);
  signal.throwIfAborted();
  await fs.mkdir(await safePath(root,'imports'),{recursive:true});
  await fs.mkdir(await safePath(root,'resources'),{recursive:true});
  const staging=await fs.mkdtemp(path.join(await safePath(root,'imports'),'psd-'));
  try{
    const assets=[],layers=[],ids=result.layers.map(()=>randomUUID());
    for(const [index,item] of result.layers.entries()){
      signal.throwIfAborted();const {bytes,parent,...values}=item;
      let asset;
      if(bytes){asset={id:randomUUID(),name:item.name,...await saveImage(staging,Buffer.from(bytes),inspectImage),createdAt:new Date().toISOString()};assets.push(asset);}
      layers.push(createLayer(item.kind||'image',{...values,id:ids[index],...(parent!==undefined?{parentId:ids[parent]}:{}),...(asset?{assetId:asset.id}:{})}));
    }
    signal.throwIfAborted();
    for(const resource of new Set(assets.map(a=>a.resource)))await fs.rename(await safePath(staging,'resources',resource),await safePath(root,'resources',resource));
    return {name:path.basename(file,path.extname(file)),width:result.width,height:result.height,warnings:result.warnings,assets,layers};
  }finally{await fs.rm(staging,{recursive:true,force:true});}
}
module.exports={runPsd,importPsd};
