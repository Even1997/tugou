const fs=require('node:fs/promises'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {safePath,atomicWrite,hash}=require('./storage.cjs');
const mime={mp4:'video/mp4',webm:'video/webm',weba:'audio/webm',mp3:'audio/mpeg',wav:'audio/wav',ogg:'audio/ogg',m4a:'audio/mp4',flac:'audio/flac',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp'};
function mediaType(bytes,name=''){
  if(bytes.length<12)throw Error('媒体文件不完整');
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WAVE')return 'wav';
  if(bytes.toString('ascii',0,4)==='OggS')return 'ogg';
  if(bytes.toString('ascii',0,4)==='fLaC')return 'flac';
  if(bytes.toString('ascii',0,3)==='ID3'||(bytes[0]===255&&(bytes[1]&0xe0)===0xe0))return 'mp3';
  if(bytes.toString('ascii',4,8)==='ftyp')return /\.m4a$/i.test(name)?'m4a':'mp4';
  if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))return /\.weba$/i.test(name)?'weba':'webm';
  throw Error('不支持的媒体格式，请使用 MP4/WebM 或 MP3/WAV/OGG/M4A/FLAC');
}
async function saveMedia(root,bytes,name){
  if(!bytes.length||bytes.length>256*1024*1024)throw Error('媒体大小须在 256 MiB 以内');
  const ext=mediaType(bytes,name),resource=hash(bytes)+'.'+ext;
  await atomicWrite(await safePath(root,'resources',resource),bytes);
  return {id:randomUUID(),name:String(name||'媒体'),resource,bytes:bytes.length,kind:mime[ext].split('/')[0],mimeType:mime[ext]};
}
async function importMedia(root,files){
  if(!Array.isArray(files)||!files.length||files.length>32)throw Error('请选择 1–32 个媒体文件');
  const pending=[];
  for(const filename of [...new Set(files)]){
    const file=await safePath(path.dirname(path.resolve(filename)),path.basename(filename));
    if((await fs.stat(file)).size>256*1024*1024)throw Error('媒体文件超过 256 MiB');
    const bytes=await fs.readFile(file);mediaType(bytes,filename);pending.push({bytes,name:path.basename(filename)});
  }
  const assets=[];for(const item of pending)assets.push(await saveMedia(root,item.bytes,item.name));return assets;
}
async function mediaResponse(file,range){
  const size=(await fs.stat(file)).size,type=mime[path.extname(file).slice(1)]||'application/octet-stream';
  let start=0,end=size-1;
  if(range){
    const m=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!m||(!m[1]&&!m[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
    if(!m[1])start=Math.max(0,size-Number(m[2]));else{start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}
    if(!Number.isSafeInteger(start)||start>end)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`}});
  }
  const data=Buffer.alloc(end-start+1),handle=await fs.open(file,'r');
  try{await handle.read(data,0,data.length,start);}finally{await handle.close();}
  return new Response(data,{status:range?206:200,headers:{'Content-Type':type,'Content-Length':String(data.length),'Accept-Ranges':'bytes','Access-Control-Allow-Origin':'*',...(range?{'Content-Range':`bytes ${start}-${end}/${size}`}:{})}});
}
module.exports={mime,mediaType,saveMedia,importMedia,mediaResponse};
