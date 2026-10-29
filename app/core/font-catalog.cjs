const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {safePath,atomicWrite,hash}=require('./storage.cjs');
const {builtinFonts,findBuiltinFont}=require('./builtin-fonts.cjs');
const {fontFaces}=require('./font-weights.cjs');
let cached,expires=0;
function normalizeFonts(items){
  const seen=new Set();return items.filter(item=>{
    if(!item||typeof item.family!=='string'||!item.family.trim()||/[\p{C}]/u.test(item.family))return false;
    const key=item.family.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;
  }).map(f=>({family:f.family,name:f.name||f.family,aliases:Array.isArray(f.aliases)?f.aliases:[],weights:[...new Set((Array.isArray(f.weights)?f.weights:[400]).filter(w=>Number.isInteger(w)&&w>=1&&w<=1000))].sort((a,b)=>a-b)})).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
}
async function localFonts(){
  if(cached&&Date.now()<expires)return cached;
  cached=(async()=>{
    if(process.platform==='darwin'){
      const {script,macFonts}=require('./mac-fonts.cjs');
      const {stdout}=await promisify(execFile)('/usr/bin/osascript',['-l','JavaScript','-e',script],{timeout:15000,maxBuffer:8*1024*1024,encoding:'utf8'});
      return normalizeFonts(macFonts(JSON.parse(stdout)));
    }
    if(process.platform!=='win32')throw Error('当前本机字体枚举支持 Windows 和 macOS');
    const script="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); Add-Type -AssemblyName PresentationCore; @([System.Windows.Media.Fonts]::SystemFontFamilies | ForEach-Object { $names=$_.FamilyNames; $name=$names[[System.Windows.Markup.XmlLanguage]::GetLanguage('zh-cn')]; if(!$name){$name=$_.Source}; @{family=$_.Source; name=$name; aliases=@($names.Values); weights=@($_.GetTypefaces() | Where-Object {$_.Style -eq [System.Windows.FontStyles]::Normal} | ForEach-Object {$_.Weight.ToOpenTypeWeight()} | Sort-Object -Unique)} }) | ConvertTo-Json -Compress -Depth 3";
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
  const builtin=await Promise.all(builtinFonts.map(async f=>({id:f.id,family:f.family,name:f.name,aliases:f.aliases,version:f.version,weights:fontFaces(f).map(v=>v.weight).sort((a,b)=>a-b),faces:await Promise.all(fontFaces(f).map(async face=>({id:face.id,weight:face.weight,bytes:face.bytes,...(service.downloads?await service.downloads.status(face.id):{status:'cloud'})})))})));
  return {custom:custom.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),builtin,system:system.filter(f=>!findBuiltinFont(f.family)),warning};
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
