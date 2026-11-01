const fs=require('node:fs/promises'),path=require('node:path');
const {safePath,atomicWrite}=require('./storage.cjs');
async function exportDefaultPath(profile,fallback,name=''){
  let directory=fallback;
  try{
    const saved=JSON.parse(await fs.readFile(path.join(profile,'image-export.json'),'utf8')).directory;
    if(typeof saved==='string'&&path.isAbsolute(saved)&&(await fs.stat(saved)).isDirectory())directory=saved;
  }catch{}
  return path.join(directory,name);
}
async function rememberExportDirectory(profile,target){
  // The image is already saved; a preference-write failure must not report it as lost.
  try{await atomicWrite(path.join(profile,'image-export.json'),JSON.stringify({directory:path.dirname(target)}));}
  catch(error){console.warn('无法记住图片保存目录:',error.code||'WRITE_FAILED');}
}
function pngName(value){
  let name=String(value||'画板').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'').slice(0,100)||'画板';
  if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))name='_'+name;
  return name;
}
async function batchTargets(folder,names){
  if(!Array.isArray(names)||!names.length||names.length>500||names.some(n=>typeof n!=='string'||n.length>256))throw Error('请选择 1–500 个画板');
  const used=new Set((await fs.readdir(folder)).map(n=>n.normalize('NFC').toLowerCase()));
  const targets=[];
  for(const value of names){const base=pngName(value);let name=base+'.png',index=2;while(used.has(name.normalize('NFC').toLowerCase()))name=`${base} (${index++}).png`;used.add(name.normalize('NFC').toLowerCase());targets.push(await safePath(folder,name));}
  return targets;
}
async function writeExclusive(target,bytes){
  await safePath(path.dirname(target),path.basename(target));
  const file=await fs.open(target,'wx');
  let failed=false;
  try{await file.writeFile(bytes);await file.sync();}catch(error){failed=true;throw error;}finally{await file.close();if(failed)await fs.unlink(target);}
}
module.exports={pngName,batchTargets,writeExclusive,exportDefaultPath,rememberExportDirectory};
