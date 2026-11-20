const fs=require('node:fs/promises'),path=require('node:path');
const {execFile}=require('node:child_process'),{promisify}=require('node:util');
const {safePath,atomicWrite,hash}=require('./storage.cjs');
const {builtinFonts,findBuiltinFont}=require('./builtin-fonts.cjs');
const {fontFaces,builtinFace,nearestWeight}=require('./font-weights.cjs');
const {fail}=require('./automation-commands.cjs');
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
  return {custom:custom.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')),builtin,system,warning};
}
function cloudFace(family,fontWeight=400){
  const font=findBuiltinFont(family);
  if(!font)fail('NOT_FOUND','云字体不在目录中');
  const face=builtinFace({fontFamily:font.family,fontWeight});
  return {id:face.id,font:{fontFamily:font.family,fontWeight:face.weight,fontSource:null,fontResource:null}};
}
async function downloadFont(service,{id,family,fontWeight}){
  if(id){
    if(family||fontWeight!==undefined)fail('INVALID_ARGUMENT','请使用字重 ID，或字体名称和可选字重');
    return service.downloads.ensure(id);
  }
  if(!family)fail('INVALID_ARGUMENT','请指定字重 ID 或字体名称');
  const face=cloudFace(family,fontWeight);
  return {...await service.downloads.ensure(face.id),font:face.font};
}
async function fontFace(service,{projectId,jobId,source,family,fontWeight},allowUnpublished=false){
  if(source==='cloud'||source==='system'){
    if(!family||projectId||jobId)fail('INVALID_ARGUMENT','请为所选字体来源指定名称');
    if(source==='cloud')return cloudFace(family,fontWeight).font;
    const query=family.trim().toLowerCase(),fonts=await localFonts();
    const matches=fonts.filter(f=>[f.name,...f.aliases].some(n=>n.toLowerCase()===query));
    const font=fonts.find(f=>f.family.toLowerCase()===query)||(matches.length===1?matches[0]:null);
    if(!font)fail(matches.length?'INVALID_ARGUMENT':'NOT_FOUND',matches.length?'本机字体别名重复，请使用目录中的 family':'本机字体不存在');
    return {fontFamily:font.family,fontWeight:nearestWeight(font.weights,fontWeight??400),fontSource:'system',fontResource:null};
  }
  if(!projectId||!jobId||family||fontWeight!==undefined)fail('INVALID_ARGUMENT','请指定已发布字体的 projectId 和 jobId');
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
  return {fontFamily:p.name,fontSource:null,fontResource:{resource,projectId,jobId}};
}
module.exports={normalizeFonts,localFonts,fontLibrary,fontFace,downloadFont};
