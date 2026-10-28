const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {safePath,atomicWrite,hash}=require('./storage.cjs');
let cached,expires=0;
function normalizeFonts(items){
  const seen=new Set();return items.filter(item=>{
    if(!item||typeof item.family!=='string'||!item.family.trim()||/[\p{C}]/u.test(item.family))return false;
    const key=item.family.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;
  }).map(f=>({family:f.family,name:f.name||f.family,aliases:Array.isArray(f.aliases)?f.aliases:[]})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
async function localFonts(){
  if(cached&&Date.now()<expires)return cached;
  cached=(async()=>{
    if(process.platform!=='win32')throw Error('当前本机字体枚举仅支持 Windows');
    const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Drawing; $fonts=[System.Drawing.Text.InstalledFontCollection]::new(); try { @($fonts.Families | ForEach-Object { @{family=$_.GetName(1033); name=$_.GetName(2052); aliases=@($_.Name,$_.GetName(1033),$_.GetName(2052))} }) | ConvertTo-Json -Compress -Depth 3 } finally {$fonts.Dispose()}";
    const {stdout}=await promisify(execFile)(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:15000,maxBuffer:2*1024*1024,encoding:'utf8'});
    return normalizeFonts(JSON.parse(stdout.replace(/^\uFEFF/,'')));
  })();expires=Date.now()+60000;
  try{return await cached;}catch(e){cached=null;throw e;}
}
async function fontLibrary(service){
  const {projects}=await service.dispatch('font.project.list',{},{}),custom=[];
  for(const summary of projects){
    const p=await service.load(summary.id);
    if(p.published)custom.push({projectId:p.id,name:p.name,jobId:p.published.fontResource.jobId,sourceRevision:p.published.sourceRevision,ready:true});
  }
  let system=[],warning;
  try{system=await localFonts();}catch{warning='本机字体读取失败，可重新打开下拉重试';}
  return {custom:custom.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),system,warning};
}
async function fontFace(service,{projectId,jobId},allowUnpublished=false){
  const p=await service.load(projectId);
  if(!allowUnpublished&&p.published?.fontResource.jobId!==jobId)throw Error('请先发布此字体版本');
  const r=await service.result(p,jobId);
  if(r.task?.status!=='completed'||!['build','refine'].includes(r.job.operation))throw Error('请先在字体工作台生成字体文件');
  const asset=r.result?.artifacts.find(a=>a.mimeType==='font/ttf');if(!asset)throw Error('字体文件不存在');
  const file=await safePath(r.dir,asset.file),stat=await fs.stat(file);
  if(stat.size>32*1024*1024)throw Error('字体文件超过32 MiB');
  const bytes=await fs.readFile(file);
  if(hash(bytes)!==asset.sha256||bytes.length<12||!bytes.subarray(0,4).equals(Buffer.from([0,1,0,0])))throw Error('字体文件校验失败');
  const resource=asset.sha256+'.ttf';await atomicWrite(await safePath(service.root,'resources',resource),bytes);
  return {fontFamily:p.name,fontResource:{resource,projectId,jobId}};
}
module.exports={normalizeFonts,localFonts,fontLibrary,fontFace};
