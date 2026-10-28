const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{createWriteStream,createReadStream}=require('node:fs'),{Readable}=require('node:stream'),{pipeline}=require('node:stream/promises'),yauzl=require('yauzl');
const folder=require('./qa-paths.cjs').path("installer-probe");
const artifacts=[
 ['uv-win.zip','https://github.com/astral-sh/uv/releases/download/0.13.4/uv-x86_64-pc-windows-msvc.zip','ccec7508a07d9933d7cb1261880633efcf1f30d6e6eddab21823f1dae6f23225'],
 ['uv-arm.tar.gz','https://github.com/astral-sh/uv/releases/download/0.13.4/uv-aarch64-apple-darwin.tar.gz','e0b1d4743ce64c55d9f0f4a444afa6b81125680070ee04e853fcd0f6c1ebf8f1'],
 ['uv-intel.tar.gz','https://github.com/astral-sh/uv/releases/download/0.13.4/uv-x86_64-apple-darwin.tar.gz','7be2dcd316122f4b3e5a0a7889f6248266c14425374e105ff7dc9779184603a6'],
 ['esrgan-mac.zip','https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip',null]
];
(async()=>{
 await fs.mkdir(folder,{recursive:true});const report=[];
 for(const [name,url,expected] of artifacts){
  const file=path.join(folder,name);try{await fs.access(file)}catch{const r=await fetch(url);if(!r.ok)throw Error('HTTP '+r.status);await pipeline(Readable.fromWeb(r.body),createWriteStream(file,{flags:'wx'}));}
  const h=crypto.createHash('sha256');for await(const c of createReadStream(file))h.update(c);const digest=h.digest('hex');if(expected&&digest!==expected)throw Error('digest '+name);
  report.push({name,url,sha256:digest,bytes:(await fs.stat(file)).size});
 }
 const files=[];
 for(const name of ['uv-win.zip','esrgan-mac.zip'])await new Promise((resolve,reject)=>yauzl.open(path.join(folder,name),{lazyEntries:true},(err,zip)=>{
   if(err)return reject(err);zip.on('error',reject);zip.on('end',resolve);zip.on('entry',entry=>{
     files.push({archive:name,name:entry.fileName,bytes:entry.uncompressedSize});
     if(entry.fileName==='uv.exe')zip.openReadStream(entry,async(err,stream)=>{if(err)return reject(err);await pipeline(stream,createWriteStream(path.join(folder,'uv.exe')));zip.readEntry()});
     else if(/realesrgan-ncnn-vulkan$/.test(entry.fileName))zip.openReadStream(entry,(err,stream)=>{if(err)return reject(err);let bytes=Buffer.alloc(0);stream.on('data',c=>{if(bytes.length<64)bytes=Buffer.concat([bytes,c]).subarray(0,64)});stream.on('end',()=>{report.push({macExecutableHeader:bytes.toString('hex')});zip.readEntry()})});
     else zip.readEntry();
   });zip.readEntry();
 }));
 await fs.writeFile(path.resolve(__dirname,'../test-results/installer-artifacts.json'),JSON.stringify({folder,artifacts:report,files},null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
