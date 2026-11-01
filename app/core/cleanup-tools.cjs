const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const sharp = require('sharp');
const {safePath, atomicWrite} = require('./storage.cjs');
const {referenceBytes} = require('./generation.cjs');
const {runProcess} = require('./local-process.cjs');
const {verifiedDownload, extractArchive} = require('./runtime-files.cjs');
const {cleanupNames, validateCleanup} = require('./cleanup-settings.cjs');
const manifest = require('../runtime/cleanup-tools/components.json');
const bootstrap = require('../runtime/components.json');
const fail = message => Object.assign(Error(message), {safeMessage:message});
const resources = path.join(__dirname, '../runtime/cleanup-tools');
const active = task => ['queued','running'].includes(task.status);
const pngColor = ['Gamma','SRGBRendering','WhitePointX','WhitePointY','RedX','RedY','GreenX','GreenY','BlueX','BlueY'].map(key=>'PNG:'+key);
function metadataFields(record) {
  const structural = new Set(['ImageWidth','ImageHeight','BitDepth','ColorType','Compression','Filter','Interlace','Gamma','SRGBRendering','Orientation']);
  const display = new Set(['PNG:ProfileName','EXIF:YCbCrPositioning','RIFF:WebP_Flags','RIFF:AlphaPreprocessing','RIFF:AlphaFiltering','RIFF:AlphaCompression','RIFF:VP8Version','RIFF:HorizontalScale','RIFF:VerticalScale']);
  return Object.entries(record).filter(([key]) => key.includes(':') && !/^(ExifTool|System|File|Composite|ICC_Profile):/.test(key) && !structural.has(key.split(':').at(-1)) && !display.has(key) && !pngColor.includes(key))
    .map(([key,value]) => ({key,value:String(typeof value==='object'?JSON.stringify(value):value).slice(0,200)}));
}
class CleanupTools {
  constructor(projects) {
    this.root = projects.root;
    this.directory = path.join(path.dirname(this.root), 'components', 'cleanup-tools');
  }
  async runtime(operation) {
    if (!cleanupNames[operation]) throw fail('清理工具不存在');
    const config = JSON.parse(await fs.readFile(await safePath(this.directory, operation+'.json'), 'utf8'));
    if (config.version !== manifest.version || !/^[a-f0-9-]{36}$/.test(config.release)) throw fail('清理组件需要重新下载');
    const folder = await safePath(this.directory, 'releases', config.release);
    const runtime = {folder, provider:'CPUExecutionProvider'};
    if (operation === 'metadata') {
      runtime.executable = await safePath(folder, 'bin', process.platform === 'win32' ? 'exiftool.exe' : 'exiftool');
      await fs.access(runtime.executable);
      if (process.platform === 'darwin') await fs.access('/usr/bin/perl');
    } else {
      // POSIX venv executables are legitimate symlinks into managed Python.
      runtime.python = path.join(await safePath(folder, 'python'), process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python3');
      await fs.access(runtime.python);
      runtime.script = await safePath(folder, 'watermark.py');
      await fs.access(runtime.script);
    }
    return runtime;
  }
  async status() {
    const entries = await Promise.all(Object.keys(cleanupNames).map(async operation => {
      try { await this.runtime(operation); return [operation,{installed:true,ready:true}]; }
      catch { return [operation,{installed:false,ready:false,reason:'请先手动下载工具'}]; }
    }));
    return {directory:this.directory, ...Object.fromEntries(entries)};
  }
  async install(tasks, operation) {
    if (!cleanupNames[operation] || !bootstrap.uv[`${process.platform}-${process.arch}`]) throw fail('当前平台不支持此工具');
    if (this.installing || tasks.list().some(t=>t.context?.kind==='runtime-install'&&active(t))) throw fail('已有工具正在安装');
    this.installing = true;
    try {
      if (operation==='metadata' && process.platform==='darwin') {
        try { await fs.access('/usr/bin/perl'); } catch { throw fail('系统缺少 Perl，无法运行元数据工具'); }
      }
      const task = await tasks.start('下载'+cleanupNames[operation], async(signal,id) => {
        const folder = await safePath(this.directory,'releases',id);
        await fs.mkdir(folder,{recursive:true});
        const space = await fs.statfs(folder);
        if (space.bavail*space.bsize < (operation==='watermark'?2048:128)*1024**2) throw fail('组件目录可用空间不足');
        const entry = tasks.tasks.find(t=>t.id===id);
        const progress = (percent,message) => {signal.throwIfAborted();entry.progress=Math.floor(percent);entry.message=message;};
        const cache = await safePath(this.directory,'cache');
        if (operation==='metadata') {
          const item=manifest.metadata[process.platform];
          const archive=await verifiedDownload(item,cache,signal,(done,total)=>progress(done/total*85,'下载元数据工具'));
          progress(87,'解压并验证工具');
          await extractArchive(archive,folder,item,signal);
          const executable=await safePath(folder,'bin',process.platform==='win32'?'exiftool.exe':'exiftool');
          if(process.platform!=='win32')await fs.chmod(executable,0o755);
          const version=await this.exif({executable},['-ver'],signal);
          if(version.trim()!=='13.60')throw fail('元数据组件版本不匹配');
        } else {
          const uv=bootstrap.uv[`${process.platform}-${process.arch}`];
          const archive=await verifiedDownload(uv,cache,signal,(done,total)=>progress(done/total*12,'下载 Python 安装器'));
          const bin=await safePath(folder,'bootstrap');await extractArchive(archive,bin,uv,signal);
          const executable=await safePath(bin,uv.only);if(process.platform!=='win32')await fs.chmod(executable,0o755);
          const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(UV_|PIP_|PYTHON)/i.test(k))),UV_CACHE_DIR:path.join(this.directory,'cache','python'),UV_PYTHON_INSTALL_DIR:path.join(this.directory,'python-managed'),UV_LINK_MODE:'copy'};
          const run=args=>runProcess(executable,args,{env,signal,cwd:folder});
          progress(15,'安装独立 Python');
          await run(['python','install',manifest.python,'--no-bin','--no-registry','--no-config']);
          const venv=await safePath(folder,'python');
          await run(['venv',venv,'--python',manifest.python,'--managed-python','--no-python-downloads','--no-config']);
          const python=path.join(venv,process.platform==='win32'?'Scripts/python.exe':'bin/python3');
          const requirements=await safePath(folder,'requirements.txt');
          await atomicWrite(requirements,await fs.readFile(path.join(resources,`requirements-${process.platform}-${process.arch}.txt`)));
          progress(35,'下载并校验图片处理依赖');
          await run(['pip','sync',requirements,'--python',python,'--require-hashes','--only-binary',':all:','--no-config','--default-index','https://pypi.org/simple']);
          await atomicWrite(path.join(folder,'watermark.py'),await fs.readFile(path.join(resources,'watermark.py')));
          const spec=path.join(folder,'probe.json');await atomicWrite(spec,JSON.stringify({action:'probe'}));
          progress(92,'验证本地水印工具');
          const result=await runProcess(python,['-I','-u',path.join(folder,'watermark.py'),spec],{signal,timeout:60000});
          if(!JSON.parse(result.trim()).ready)throw fail('水印组件验证失败');
        }
        signal.throwIfAborted();
        const config=await safePath(this.directory,operation+'.json');
        let previous;try{previous=await fs.readFile(config);}catch(error){if(error.code!=='ENOENT')throw error;}
        await atomicWrite(config,JSON.stringify({version:manifest.version,release:id}));
        if(signal.aborted){if(previous)await atomicWrite(config,previous);else await fs.unlink(config);signal.throwIfAborted();}
        progress(100,'已下载 · 离线可用');
      },{kind:'runtime-install',cleanup:operation,components:[operation]});
      return {id:task.id};
    } finally {this.installing=false;}
  }
  exif(runtime,args,signal) {
    const options=['-config','',...args];
    return runProcess(process.platform==='darwin'?'/usr/bin/perl':runtime.executable,process.platform==='darwin'?[runtime.executable,...options]:options,{signal,timeout:120000});
  }
  async readMetadata(runtime,file,signal,raw=false) {
    await this.exif(runtime,['-j','-G0','-a','-s','-all:all','-w!','%d%f.metadata.json','--',file],signal);
    const report=file.replace(/\.[^.]+$/,'.metadata.json');
    if ((await fs.stat(report)).size>8*1024**2) throw fail('元数据过多，暂不能展示');
    const record=JSON.parse(await fs.readFile(report,'utf8'))[0];
    return raw?record:metadataFields(record);
  }
  async withInput(input,signal,fn) {
    const bytes=await referenceBytes(this.root,input);
    const info=await sharp(bytes,{limitInputPixels:100000000}).metadata();
    if(!['png','jpeg','webp'].includes(info.format)||(info.pages||1)!==1)throw fail('清理工具仅支持静态 PNG、JPEG、WebP');
    const base=await safePath(this.root,'cleanup-jobs');await fs.mkdir(base,{recursive:true});
    const folder=await fs.mkdtemp(path.join(base,'job-'));
    try {
      signal.throwIfAborted();
      const source=path.join(folder,'input.'+(info.format==='jpeg'?'jpg':info.format));
      await atomicWrite(source,bytes);return await fn({folder,source,bytes,info});
    } finally {
      // Only a fresh, application-created job folder may be removed recursively.
      await safePath(base,path.basename(folder));await fs.rm(folder,{recursive:true,force:true});
    }
  }
  async inspect(input,signal=AbortSignal.timeout(120000)) {
    const runtime=await this.runtime('metadata');
    return this.withInput(input,signal,async({source})=>{
      const fields=await this.readMetadata(runtime,source,signal);
      return {fields:fields.slice(0,200),count:fields.length,truncated:fields.length>200};
    });
  }
  async execute(job,runtime,signal,id,onPart,onProgress) {
    for(let inputIndex=0;inputIndex<job.inputs.length;inputIndex++) {
      const input=job.inputs[inputIndex],settings=job.settings;
      validateCleanup(settings,input);
      if(os.freemem()<256*1024**2+input.width*input.height*(settings.operation==='watermark'?32:16))throw fail('可用内存不足，请关闭其他应用后重试');
      onProgress(inputIndex/job.inputs.length*100,`处理 ${inputIndex+1}/${job.inputs.length}`);
      const part=await this.withInput(input,signal,async({folder,source,bytes,info})=>{
        if(settings.operation==='watermark' && (info.depth!=='uchar'||info.space==='cmyk'||(info.icc&&info.space==='b-w')))throw fail('水印修复需要 8 位 RGB 图片，请先转换色彩模式');
        const output=path.join(folder,'output.'+(settings.operation==='watermark'?'png':info.format==='jpeg'?'jpg':info.format));
        let report;
        if(settings.operation==='metadata') {
          const beforeTags=await this.readMetadata(runtime,source,signal,true),before=metadataFields(beforeTags);
          await this.exif(runtime,['-all=','-Trailer:All=','-tagsFromFile','@','-ICC_Profile','-EXIF:Orientation','-PNG:Gamma','-PNG:SRGBRendering','-o',output,'--',source],signal);
          const afterTags=await this.readMetadata(runtime,output,signal,true),after=metadataFields(afterTags);
          if(pngColor.some(key=>JSON.stringify(beforeTags[key])!==JSON.stringify(afterTags[key])))throw fail('PNG 色彩信息一致性检查失败，结果未入库');
          const remaining=new Set(after.map(x=>x.key));
          report={status:after.length?'partial':before.length?'cleaned':'no_metadata',before:before.map(x=>x.key),remaining:[...remaining],removed:before.filter(x=>!remaining.has(x.key)).map(x=>x.key)};
          // Compare decoded pixels, ICC and orientation; metadata cleanup must not redraw.
          const result=await fs.readFile(output),next=await sharp(result).metadata();
          const [a,b]=await Promise.all([sharp(bytes).raw().toBuffer(),sharp(result).raw().toBuffer()]);
          if(!a.equals(b)||!(info.icc||Buffer.alloc(0)).equals(next.icc||Buffer.alloc(0))||(info.orientation||1)!==(next.orientation||1))throw fail('显示一致性检查失败，结果未入库');
        } else {
          const spec={input:source,output,mode:settings.mode,radius:settings.radius};
          if(settings.mode==='region')spec.region=[settings.left,settings.top,settings.width,settings.height];
          if(settings.mode==='mask') {
            spec.mask=path.join(folder,'mask.png');await atomicWrite(spec.mask,await referenceBytes(this.root,job.mask));
          }
          const file=path.join(folder,'job.json');await atomicWrite(file,JSON.stringify(spec));
          try {
            const result=await runProcess(runtime.python,['-I','-u',runtime.script,file],{signal,cwd:folder,timeout:180000});
            report=JSON.parse(result.trim());
          } catch(error) {
            signal.throwIfAborted();
            let message;try{message=JSON.parse(error.output?.trim()).error;}catch{}
            throw fail(message||'水印修复失败，请缩小区域后重试');
          }
        }
        signal.throwIfAborted();
        return {bytes:report.status==='no_watermark'?bytes:await fs.readFile(output),report};
      });
      await onPart({...part,inputIndex,index:0,count:1});
      onProgress((inputIndex+1)/job.inputs.length*100);
    }
  }
}
module.exports={CleanupTools,metadataFields};
