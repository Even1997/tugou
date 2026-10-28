const fs=require('node:fs/promises'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const sharp=require('sharp');
const {safePath,atomicWrite,hash}=require('./storage.cjs');
const {runProcess}=require('./local-process.cjs');
const {fail}=require('./automation-commands.cjs');
const uuid=/^[a-f0-9-]{36}$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;

class FontService {
  constructor(root,tasks){this.root=root;this.tasks=tasks;this.pending=Promise.resolve();}
  async directory(id){if(!uuid.test(id))fail('INVALID_ARGUMENT','字体工程 ID 无效');return safePath(this.root,'fonts',id);}
  async load(id){try{return JSON.parse(await fs.readFile(await safePath(await this.directory(id),'project.json'),'utf8'));}catch(e){if(e.code==='ENOENT')fail('NOT_FOUND','字体工程不存在');throw e;}}
  async save(p){await atomicWrite(await safePath(await this.directory(p.id),'project.json'),JSON.stringify(p));return this.summary(p);}
  summary(p){const {jobs,reviews,recognitionReviews,...rest}=p,tasks=this.tasks.list();return {...rest,jobs:jobs.map(j=>({...j,task:tasks.find(t=>t.id===j.taskId)})),reviewedCount:Object.keys(reviews).length};}
  async runtime(){
    let location=process.env.TUGOU_FONT_RUNTIME;
    if(!location){try{location=JSON.parse(await fs.readFile(await safePath(this.root,'font-runtime.json'),'utf8')).directory;}catch(e){if(e.code!=='ENOENT')throw e;}}
    if(!location)return {ready:false,reason:require('./font-environment.cjs').setupHint()};
    try{
      return await require('./font-environment.cjs').fontEnvironment(location);
    }catch{return {ready:false,reason:'字体运行环境不完整或系统不匹配；'+require('./font-environment.cjs').setupHint()};}
  }
  async result(p,id){const job=p.jobs.find(j=>j.id===id);if(!job)fail('NOT_FOUND','字体任务不属于此工程');const dir=await safePath(await this.directory(p.id),'jobs',id);
    let result;try{result=JSON.parse(await fs.readFile(await safePath(dir,'result.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const task=this.tasks.list().find(t=>t.id===job.taskId);
    return {job,dir,result,task};
  }
  async current(p){if(!p.current)fail('NO_FONT_SOURCE','请先处理图集并应用候选');const r=await this.result(p,p.current);if(!r.result?.report||r.task?.status!=='completed')fail('NOT_READY','字体源尚未就绪');return r;}
  async execute(name,a,access){
    // Includes asynchronous completions only through immutable job files; metadata has a single writer.
    const operation=()=>this.dispatch(name,a,access);
    const next=this.pending.then(operation);this.pending=next.catch(()=>{});return next;
  }
  async dispatch(name,a,{filePath,writeNew,journal}){
    if(name==='font.library')return require('./font-catalog.cjs').fontLibrary(this);
    if(name==='font.face')return require('./font-catalog.cjs').fontFace(this,a);
    if(name==='font.status'){const {python,potrace,...status}=await this.runtime();return {...status,maxGlyphs:65533,maxPixels:16000000,maxImageBytes:33554432,engine:'atlas-2',normalization:['center','size','baseline','weight'],normalizationOptIn:true,outlineRefinement:{command:'font.outline.refine',smoothing:14,bold:4,units:'1/1000 em',preserveTopology:true}};}
    if(name==='font.project.list'){
      const dir=await safePath(this.root,'fonts');await fs.mkdir(dir,{recursive:true});
      const ids=(await fs.readdir(dir)).filter(id=>uuid.test(id));return {projects:await Promise.all(ids.map(async id=>{const p=await this.load(id);return {id,name:p.name,fontRevision:p.fontRevision,characters:p.characters,current:p.current,covered:p.covered||''};}))};
    }
    const mutate=!!a.requestId,key=`font:${a.projectId||'new'}:${a.requestId}`,payload=canonical({command:name,args:a});
    if(mutate&&journal.entries[key])return journal.execute(key,payload,()=>{});
    const p=name==='font.project.create'?null:await this.load(a.projectId);
    if(mutate&&p&&p.fontRevision!==a.fontRevision)fail('FONT_CONFLICT','字体版本已改变，请重新读取 font.project.get');
    if(name==='font.project.get')return this.summary(p);
    if(name==='font.atlas.preview'){
      const atlas=p.atlases.find(v=>v.id===a.atlasId);if(!atlas)fail('NOT_FOUND','图集不属于此工程');
      const file=await safePath(await this.directory(p.id),'originals',atlas.sha256+'.'+atlas.format),bytes=await fs.readFile(file);
      if(hash(bytes)!==atlas.sha256)fail('SOURCE_CHANGED','原图摘要不一致');
      const {data,info}=await sharp(bytes,{limitInputPixels:16000000}).resize({width:a.maxSize||1200,height:a.maxSize||1200,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
      return {mimeType:'image/png',data:data.toString('base64'),width:info.width,height:info.height};
    }
    if(name==='font.job.get'){
      const {job,dir,result,task}=await this.result(p,a.id);let failure;
      if(task?.status==='failed')try{failure=JSON.parse(await fs.readFile(await safePath(dir,'failure.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
      return {id:job.id,task,failure,baseFontRevision:job.baseFontRevision,review:p.recognitionReviews?.[a.id]||null,result:result?{...result,source:undefined}:null};
    }
    if(name==='font.glyph.preview'){
      const {dir}=await this.current(p),runtime=await this.runtime();if(!runtime.ready)fail('NOT_READY',runtime.reason);
      const output=await safePath(dir,'preview-'+randomUUID()+'.json');
      const worker=path.join(__dirname,'../runtime/font-preview.py').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
      try{
        await runProcess(runtime.python,['-I',worker,dir,a.characters,output],{timeout:30000});
        if((await fs.stat(output)).size>8*1024*1024)fail('RESOURCE_LIMIT','字形预览超过 8 MiB，请减少本页字数');
        return {sourceRevision:p.current,...JSON.parse(await fs.readFile(output,'utf8'))};
      }finally{await fs.rm(output,{force:true});}
    }
    if(name==='font.glyph.query'){
      const {result}=await this.current(p),offset=a.offset||0,limit=a.limit||50;
      const glyphs=result.report.glyphs.map(g=>({...g,review:p.reviews[g.id]?.sha256===g.sha256?p.reviews[g.id]:null}));
      return {fontRevision:p.fontRevision,total:glyphs.length,glyphs:glyphs.slice(offset,offset+limit),nextOffset:offset+limit<glyphs.length?offset+limit:null};
    }
    if(name.startsWith('font.artifact.')){
      const {dir,result,task}=await this.result(p,a.jobId);if(!['completed','review'].includes(task?.status)||!result)fail('NOT_READY','产物尚未就绪');
      const asset=result.artifacts.find(v=>v.id===a.artifactId);if(!asset)fail('NOT_FOUND','产物不存在');
      const file=await safePath(dir,asset.file),stat=await fs.stat(file);if(stat.size>64*1024*1024)fail('RESOURCE_LIMIT','产物超过 64 MiB');
      const bytes=await fs.readFile(file);if(hash(bytes)!==asset.sha256)fail('ARTIFACT_CHANGED','产物摘要不一致');
      if(name==='font.artifact.export')return {...await writeNew(a.path,bytes),sha256:asset.sha256,mimeType:asset.mimeType};
      if(asset.mimeType!=='image/png')fail('INVALID_TARGET','此产物不是图片');
      const {data,info}=await sharp(bytes,{limitInputPixels:16000000}).resize({width:a.maxSize||1600,height:a.maxSize||1600,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
      return {mimeType:'image/png',data:data.toString('base64'),width:info.width,height:info.height,revision:String(p.fontRevision)};
    }
    let prepared;
    if(name==='font.project.create'){
      const characters=[...new Set([...a.characters])].join('');
      if([...characters].some(c=>/[\s\p{C}]/u.test(c)))fail('INVALID_ARGUMENT','字符集不接受空白、控制符或代理项；空格自动加入字体');
      if([...characters].length>65533)fail('FONT_FORMAT_LIMIT','字符数量超出 TrueType 字形容量');
      if(!a.name.trim()||/[\p{C}]/u.test(a.name))fail('INVALID_ARGUMENT','请输入有效字体名称');
      prepared={id:randomUUID(),name:a.name.trim(),characters,fontRevision:0,atlases:[],jobs:[],reviews:{},current:null,covered:''};
    }
    if(name==='font.atlas.import'){
      if((a.planId!==undefined)!==(a.page!==undefined))fail('INVALID_ARGUMENT','固定模板需同时指定 planId 和 page');
      if(a.planId){const plan=await this.result(p,a.planId);if(plan.task?.status!=='completed'||!plan.result?.plan?.pages[a.page])fail('INVALID_TARGET','模板页不存在或尚未完成');}
      const file=await filePath(a.path),stat=await fs.stat(file);if(!stat.isFile()||stat.size>33554432)fail('RESOURCE_LIMIT','图集不得超过 32 MiB');
      const bytes=await fs.readFile(file),meta=await sharp(bytes,{limitInputPixels:16000000}).metadata();
      if(!['png','jpeg','webp'].includes(meta.format)||(meta.pages||1)>1)fail('INVALID_ARGUMENT','只接受静态 PNG/JPEG/WebP');
      prepared={bytes,record:{id:randomUUID(),planId:a.planId,page:a.page,sha256:hash(bytes),format:meta.format,width:meta.width,height:meta.height,sourceNote:a.sourceNote||'',importedAt:new Date().toISOString()}};
    }
    let runtime;
    if(['font.atlas.plan','font.atlas.process','font.atlas.recognize','font.build','font.outline.refine'].includes(name)){
      runtime=await this.runtime();if(!runtime.ready)fail('NOT_READY',runtime.reason);
      prepared={name:p.name,characters:p.characters};
      if(name==='font.atlas.recognize'){
        const atlas=p.atlases.find(v=>v.id===a.atlasId);if(!atlas)fail('NOT_FOUND','图集不属于此工程');
        const source=await safePath(await this.directory(p.id),'originals',atlas.sha256+'.'+atlas.format);
        if(hash(await fs.readFile(source))!==atlas.sha256)fail('SOURCE_CHANGED','原图摘要不一致');
        Object.assign(prepared,{operation:'recognize',atlas:{...atlas,source}});
      }
      if(name==='font.outline.refine'){
        if(!!a.path===!!a.jobId)fail('INVALID_ARGUMENT','path 与 jobId 必须二选一');
        let file,expected;
        if(a.path)file=await filePath(a.path);
        else{
          const previous=await this.result(p,a.jobId),asset=previous.result?.artifacts.find(v=>v.id==='font.ttf'&&v.mimeType==='font/ttf');
          if(previous.task?.status!=='completed'||!asset)fail('NOT_READY','来源任务没有已完成的 TTF');
          file=await safePath(previous.dir,asset.file);expected=asset.sha256;
          prepared.characters=previous.result.report.covered||previous.result.report.glyphs.map(g=>g.character).join('');
          prepared.sourceRevision=previous.job.sourceRevision;
        }
        const stat=await fs.stat(file);if(!stat.isFile()||stat.size>33554432)fail('RESOURCE_LIMIT','字体不得超过 32 MiB');
        const sourceBytes=await fs.readFile(file),sourceSha256=hash(sourceBytes);
        if(expected&&sourceSha256!==expected)fail('ARTIFACT_CHANGED','来源字体摘要不一致');
        if(!sourceBytes.subarray(0,4).equals(Buffer.from([0,1,0,0])))fail('INVALID_ARGUMENT','仅接受静态 TrueType TTF');
        Object.assign(prepared,{operation:'refine',sourceBytes,sourceSha256,sourceJobId:a.jobId||null,smoothing:a.smoothing??14,bold:a.bold??4});
      }
      if(name==='font.atlas.plan')Object.assign(prepared,{operation:'plan',layout:a.layout||'markers',cellSize:a.cellSize||384});
      if(name==='font.atlas.process'){
        const atlases=[];
        if(a.mapping&&(a.atlasIds.length!==1||a.alignment?.length))fail('INVALID_ARGUMENT','识别映射仅支持单图，不能同时指定定位角点');
        let recognized;
        if(a.mapping){
          recognized=await this.result(p,a.mapping.jobId);
          if(recognized.job.operation!=='recognize'||recognized.task?.status!=='completed'||recognized.result?.report?.atlasId!==a.atlasIds[0])fail('INVALID_TARGET','识别记录不属于当前图集或尚未完成');
        }
        if((a.alignment||[]).some(v=>!a.atlasIds.includes(v.atlasId))||new Set((a.alignment||[]).map(v=>v.atlasId)).size!==(a.alignment||[]).length)fail('INVALID_ARGUMENT','角点必须对应唯一已选择的图集');
        const chars=new Set();
        for(const id of a.atlasIds){
          const record=p.atlases.find(v=>v.id===id);if(!record)fail('NOT_FOUND','图集不属于此工程');
          let page;
          if(!a.mapping){if(!record.planId)fail('MAPPING_REQUIRED','请先识别并提交字符对应关系');const plan=await this.result(p,record.planId);page=plan.result.plan.pages[record.page];}
          if(a.mapping){
            if(recognized.result.report.sourceHash!==record.sha256)fail('SOURCE_CHANGED','识别记录与原图不一致');
            const cells=a.mapping.glyphs.map(g=>{
              const [x0,y0,x1,y1]=g.box;
              if([...g.character].length!==1||/[\s\p{C}]/u.test(g.character))fail('INVALID_ARGUMENT','每个裁切框必须对应一个有效字符');
              if(x1<=x0||y1<=y0||x1>record.width||y1>record.height)fail('INVALID_ARGUMENT','裁切框超出原图或尺寸无效');
              return {...g,id:'u'+g.character.codePointAt(0).toString(16).toUpperCase().padStart(6,'0'),baseline:280,emPixels:300,originX:42};
            });
            page={layout:'recognized',width:record.width,height:record.height,cells,recognitionJobId:a.mapping.jobId};
          }
          for(const c of page.cells){if(chars.has(c.character))fail('DUPLICATE_GLYPH','本次选择的图集包含重复字符');chars.add(c.character);}
          const source=await safePath(await this.directory(p.id),'originals',record.sha256+'.'+record.format);
          if(hash(await fs.readFile(source))!==record.sha256)fail('SOURCE_CHANGED','原图摘要不一致');
          atlases.push({...record,page,source,corners:a.alignment?.find(v=>v.atlasId===id)?.corners});
        }
        if(chars.size>65533)fail('FONT_FORMAT_LIMIT','字符数量超出 TrueType 字形容量');
        let previous;
        if(a.merge&&p.current){const current=await this.current(p),input=JSON.parse(await fs.readFile(path.join(current.dir,'input.json'),'utf8'));previous={source:path.join(current.dir,'source.ufo'),glyphs:current.result.report.glyphs,originals:input.originals||input.atlases};}
        if(new Set([...chars,...(previous?.glyphs||[]).map(g=>g.character)]).size>65533)fail('FONT_FORMAT_LIMIT','合并后超出 TrueType 字形容量');
        Object.assign(prepared,{operation:'process',atlases,previous,originals:[...(previous?.originals||[]),...atlases],...(a.merge||a.mapping?{characters:[...new Set([...p.characters,...chars])].filter(c=>chars.has(c)||(previous?.glyphs||[]).some(g=>g.character===c)).join('')}:{}),background:a.background,threshold:a.threshold??128,potrace:runtime.potrace,...(a.normalization!==undefined?{normalization:a.normalization}:{})});
      }
      if(name==='font.build'){
        const current=await this.current(p),glyphs=current.result.report.glyphs;
        const missing=[...p.characters].filter(c=>!glyphs.some(g=>g.character===c));
        const unreviewed=glyphs.filter(g=>{const review=p.reviews[g.id];return !review||review.sha256!==g.sha256||review.identity!=='verified'||review.style!=='accepted';}).map(g=>g.character);
        if(!glyphs.length)fail('NO_FONT_SOURCE','没有可编译字形');
        if(a.mode==='strict'&&(missing.length||unreviewed.length||current.result.report.geometry!=='pass'))fail('REVIEW_REQUIRED','严格导出要求完整覆盖、几何通过且当前字形身份与风格已审阅');
        const input=JSON.parse(await fs.readFile(await safePath(current.dir,'input.json'),'utf8'));
        const originals=(input.originals||input.atlases).map(({source,sha256,format,page,id})=>({source,sha256,format,page,id}));
        Object.assign(prepared,{operation:'build',source:await safePath(current.dir,'source.ufo'),sourceRevision:p.current,glyphs,mode:a.mode,missing,unreviewed,
          originals,sourceReport:current.result.report,reviews:p.reviews});
      }
    }
    if(name==='font.publish'){
      const r=await this.result(p,a.jobId);
      if(!p.current||r.job.sourceRevision!==p.current)fail('FONT_CONFLICT','字形已修改，请重新编译后发布');
      const face=await require('./font-catalog.cjs').fontFace(this,a,true);
      prepared={...face,sourceRevision:p.current,publishedAt:new Date().toISOString()};
    }
    if(name==='font.atlas.review'){
      const r=await this.result(p,a.jobId);
      if(r.job.operation!=='recognize'||r.task?.status!=='completed')fail('INVALID_TARGET','识别记录尚未完成');
      const {width,height}=r.result.report;
      for(const e of a.entries){if([...e.character].length>1||/[\s\p{C}]/u.test(e.character)||e.box[0]>width||e.box[2]>width||e.box[1]>height||e.box[3]>height)fail('INVALID_ARGUMENT','复核字符或坐标无效');}
    }
    if(name==='font.revision.apply'){
      prepared=await this.result(p,a.candidateId);
      if(prepared.task?.status==='review')fail('NEEDS_REVIEW','候选需要修正素材或定位，请查看 font.job.get 的诊断');
      if(prepared.job.operation!=='process'||prepared.task?.status!=='completed'||!prepared.result?.report.glyphs.length)fail('NOT_READY','候选尚未完成或没有可用字形');
      if(prepared.result.report.geometry!=='pass')fail('NEEDS_REVIEW','候选有缺字、定位或几何问题；请修复素材后重新处理');
      if(prepared.job.baseFontRevision!==p.fontRevision)fail('FONT_CONFLICT','候选产生后字体工程已改变，请基于当前版本重新处理');
    }
    if(name==='font.review.record'){
      prepared=(await this.current(p)).result.report.glyphs;
      if([...a.characters].some(c=>!prepared.some(g=>g.character===c)))fail('NOT_FOUND','审阅包含当前源版本没有的字符');
    }
    return journal.execute(key,payload,async()=>{
      if(name==='font.project.create')return this.save(prepared);
      if(name==='font.atlas.import'){
        const {bytes,record}=prepared,file=await safePath(await this.directory(p.id),'originals',record.sha256+'.'+record.format);
        await fs.mkdir(path.dirname(file),{recursive:true});
        try{await fs.writeFile(file,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
        p.atlases.push(record);p.fontRevision++;await this.save(p);return {atlas:record,fontRevision:p.fontRevision};
      }
      if(runtime)return this.start(p,prepared,runtime);
      if(name==='font.publish')p.published=prepared;
      else if(name==='font.atlas.review'){p.recognitionReviews??={};p.recognitionReviews[a.jobId]={entries:a.entries,updatedAt:new Date().toISOString()};}
      else if(name==='font.revision.apply'){p.current=a.candidateId;p.covered=prepared.result.report.glyphs.map(g=>g.character).join('');p.characters=[...new Set([...p.characters,...p.covered])].join('');const hashes=new Map(prepared.result.report.glyphs.map(g=>[g.id,g.sha256]));p.reviews=Object.fromEntries(Object.entries(p.reviews).filter(([id,r])=>hashes.get(id)===r.sha256));}
      else if(name==='font.review.record')for(const c of [...new Set(a.characters)]){const g=prepared.find(g=>g.character===c);p.reviews[g.id]={sha256:g.sha256,identity:a.identity,style:a.style,note:a.note,recordedAt:new Date().toISOString()};}
      else fail('UNKNOWN_COMMAND','不支持的字体命令');
      p.fontRevision++;return this.save(p);
    });
  }
  async start(p,spec,runtime){
    const id=randomUUID(),dir=await safePath(await this.directory(p.id),'jobs',id);await fs.mkdir(dir,{recursive:true});
    if(spec.sourceBytes){const {sourceBytes,...rest}=spec;spec={...rest,source:await safePath(dir,'input.ttf')};await fs.writeFile(spec.source,sourceBytes,{flag:'wx'});}
    const job={...spec,output:dir};await atomicWrite(await safePath(dir,'input.json'),JSON.stringify(job));
    const worker=path.join(__dirname,'../runtime/font-worker.py').replace(/app\.asar([\\/])/,'app.asar.unpacked$1');
    const task=await this.tasks.start('字体 · '+spec.operation,async(signal,taskId)=>{
      try{
        await runProcess(runtime.python,['-I','-u',worker,path.join(dir,'input.json')],{cwd:dir,signal,timeout:spec.operation==='refine'?Math.max(300000,[...spec.characters].length*1500):Math.max(180000,[...spec.characters].length*200),onLine:line=>{
          let event;try{event=JSON.parse(line);}catch{return;}
          const t=this.tasks.tasks.find(v=>v.id===taskId);
          if(event.stage&&t){t.stage=event.stage;t.message=`${event.done}/${event.total}`;t.progress=Math.round(event.done/Math.max(1,event.total)*100);}
        }});
      }catch(e){
        if(!signal.aborted){let code='FONT_WORKER_FAILED';for(const line of (e.output||'').split('\n'))try{const event=JSON.parse(line);if(event.error){await atomicWrite(path.join(dir,'failure.json'),JSON.stringify({error:event.error}));code=event.error.split(':')[0].slice(0,60);}}catch{}
          e.safeMessage=`字体处理失败 (${code})，请检查输入或运行环境`;}
        throw e;
      }
      signal.throwIfAborted();
      if(spec.operation==='process'&&JSON.parse(await fs.readFile(path.join(dir,'result.json'),'utf8')).report.geometry!=='pass')return {review:true};
      return id;
    },{kind:'local-tool',engine:'font',fontProjectId:p.id,fontJobId:id});
    p.fontRevision++;p.jobs.push({id,taskId:task.id,operation:spec.operation,atlasId:spec.atlas?.id,layout:spec.layout,parameters:{smoothing:spec.smoothing,bold:spec.bold,threshold:spec.threshold,normalization:spec.normalization},sourceRevision:spec.sourceRevision,baseFontRevision:p.fontRevision});
    await this.save(p);return {taskId:task.id,jobId:id,fontRevision:p.fontRevision};
  }
}
module.exports={FontService};
