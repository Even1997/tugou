const fs=require('node:fs/promises'),path=require('node:path');
const {safePath,hash,atomicWrite}=require('./storage.cjs');
async function importModel(root,filename){
  const file=await safePath(path.dirname(filename),path.basename(filename)),ext=path.extname(file).toLowerCase().slice(1);
  const stat=await fs.stat(file);
  if(!stat.isFile()||!['obj','fbx'].includes(ext)||stat.size>64*1024*1024)throw Error('模型文件须为 64 MiB 以内的 OBJ/FBX');
  const bytes=await fs.readFile(file);if(bytes.length>64*1024*1024)throw Error('模型文件超过 64 MiB');
  if(ext==='obj'&&!/^v\s+-?[\d.]/m.test(bytes.toString()))throw Error('OBJ 文件没有顶点');
  if(ext==='fbx'&&!bytes.subarray(0,64).toString().includes('FBX'))throw Error('无效的 FBX 文件');
  const resource=hash(bytes)+'.'+ext;await atomicWrite(await safePath(root,'resources',resource),bytes);return {resource,name:path.basename(file),bytes:bytes.length};
}
module.exports={importModel};
