const fs=require('node:fs/promises');
const {compileWorkflow,nodeName}=require('./workflow-nodes.cjs');
const {safePath,atomicWrite,validateDocument}=require('./storage.cjs');
const {saveImage,referenceBytes}=require('./generation.cjs');
const {saveMedia}=require('./media.cjs');
const {boundedBytes,requestImages}=require('./image-api.cjs');
const fail=s=>Object.assign(Error(s),{safeMessage:s});
const endpoint=(settings,route)=>settings.baseUrl.replace(/\/$/,'')+(settings.baseUrl.endsWith('/v1')?'':'/v1')+route;
async function call(settings,route,signal,body){
  const form=body instanceof FormData;
  const response=await fetch(endpoint(settings,route),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${settings.apiKey}`,...(body&&!form?{'Content-Type':'application/json'}:{})},...(body?{body:form?body:JSON.stringify(body)}:{}),signal,redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw fail(`模型请求失败（HTTP ${response.status}），请检查模型和参数`);}
  return response;
}
async function json(response){try{return JSON.parse((await boundedBytes(response,32*1024*1024)).toString());}catch{throw fail('模型响应不是有效 JSON');}}
async function download(settings,url,signal){
  const parsed=new URL(url),base=new URL(settings.baseUrl);
  if(parsed.username||parsed.password||(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&parsed.origin===base.origin&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname))))throw fail('媒体结果地址不安全');
  const r=await fetch(parsed,{signal,redirect:'error'});if(!r.ok)throw fail(`媒体下载失败（HTTP ${r.status}）`);
  return boundedBytes(r,256*1024*1024);
}
const pause=(ms,signal)=>new Promise((resolve,reject)=>{signal.throwIfAborted();const stop=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener('abort',stop);resolve();},ms);signal.addEventListener('abort',stop,{once:true});});
class WorkflowService{
  constructor(projects,connections,tasks,inspectImage){Object.assign(this,{projects,connections,tasks,inspectImage});this.root=projects.root;}
  async start(projectId,document,nodeId){
    await this.projects.read(projectId);validateDocument(document);
    return this.submit({projectId,nodeId,compiled:compileWorkflow(document,nodeId),assets:document.assets,label:nodeName(document.tugouCanvas.nodes.find(n=>n.id===nodeId))});
  }
  async retry(id){
    const task=this.tasks.list().find(t=>t.id===id&&t.context?.kind==='workflow'&&['failed','cancelled','interrupted'].includes(t.status));
    if(!task)throw fail('该任务不能重试');
    return this.submit(JSON.parse(await fs.readFile(await safePath(this.root,'requests',`${id}.json`),'utf8')));
  }
  async submit(snapshot){
    const {projectId,nodeId,compiled:c,label}=snapshot;
    const busy=()=>this.tasks.list().some(t=>t.context?.projectId===projectId&&t.context.nodeId===nodeId&&['queued','running'].includes(t.status));
    if(busy())throw fail('该节点已有任务');
    const saved=await this.connections.readPrivate(c.mode),model=c.model||saved[`${c.mode}Model`]||(c.mode==='image'?saved.model:c.mode==='text'?saved.analysisModel:'');
    if(!saved.baseUrl||!saved.apiKey||!model)throw fail('请在模型连接或节点参数中填写对应模型');
    const settings={...saved,model},refs=[];
    for(const ref of c.references){const asset=snapshot.assets.find(a=>a.id===ref.assetId);if(!asset)throw fail('参考素材缺失');const bytes=await referenceBytes(this.root,asset);if(bytes.length>64*1024*1024)throw fail('单个模型参考不超过 64 MiB');refs.push({...ref,bytes,mimeType:asset.mimeType||`image/${asset.resource?.endsWith('.jpg')?'jpeg':asset.resource?.split('.').at(-1)||'png'}`});}
    if(busy())throw fail('该节点已有任务');
    // Persist only parameters and referenced assets; credentials are read anew on an explicit retry.
    const request={...snapshot,compiled:{...c,model},assets:snapshot.assets.filter(a=>c.references.some(r=>r.assetId===a.id))};
    let ready,failed;const savedRequest=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});savedRequest.catch(()=>{});
    const task=await this.tasks.start(label||'节点生成',async(cancelSignal,id)=>{
      await savedRequest;cancelSignal.throwIfAborted();
      const signal=AbortSignal.any([cancelSignal,AbortSignal.timeout(c.mode==='video'?1800000:600000)]),assets=[];
      const journal=this.tasks.tasks.find(t=>t.id===id);
      const stage=async value=>{signal.throwIfAborted();journal.stage=value;await this.tasks.persist();};
      await stage('generating');
      const uri=r=>`data:${r.mimeType};base64,${r.bytes.toString('base64')}`;
      if(c.mode==='text'){
        const content=[{type:'text',text:c.prompt},...refs.map(r=>({type:'image_url',image_url:{url:uri(r)}}))];
        const responses=settings.textApiMode==='responses';
        const payload=await json(await call(settings,responses?'/responses':'/chat/completions',signal,responses?{model,input:[{role:'user',content:content.map(c=>c.type==='text'?{type:'input_text',text:c.text}:{type:'input_image',image_url:c.image_url.url})}],stream:false}:{model,messages:[{role:'user',content}],stream:false}));
        const text=responses?(payload.output_text||payload.output?.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n')):payload.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw fail('文本模型未返回文本');
        assets.push({kind:'text',text,name:(label||'文本')+' · 结果'});
      }else if(c.mode==='image'){
        const images=await requestImages(settings,{prompt:c.prompt,size:c.size,quality:c.quality,count:c.count,images:refs.map(r=>r.bytes)},signal);
        await stage('saving');
        for(const bytes of images){signal.throwIfAborted();assets.push({...await saveImage(this.root,bytes,this.inspectImage),kind:'image',projection:c.projection});}
      }else if(c.mode==='audio'){
        const response=await call(settings,'/audio/speech',signal,{model,input:c.prompt,voice:c.voice||'alloy',response_format:c.format||'mp3',speed:c.speed,...(c.instructions?{instructions:c.instructions}:{})});
        assets.push(await saveMedia(this.root,await boundedBytes(response,256*1024*1024),`语音.${c.format||'mp3'}`));
      }else{
        let options={};try{options=c.videoOptions?JSON.parse(c.videoOptions):{};}catch{throw fail('视频高级参数须为 JSON 对象');}
        if(!options||Array.isArray(options)||typeof options!=='object')throw fail('视频高级参数须为 JSON 对象');
        const body={...options,model,prompt:c.prompt,size:c.size,seconds:String(c.seconds),...(c.quality&&c.quality!=='auto'?{quality:c.quality}:{}),...(c.generateAudio!==undefined?{generate_audio:c.generateAudio}:{}),...(c.watermark!==undefined?{watermark:c.watermark}:{})};
        if(refs.length){
          const first=refs.find(r=>r.nodeId===c.firstFrameId),last=refs.find(r=>r.nodeId===c.lastFrameId);
          if(first)body.first_frame_url=uri(first);if(last)body.last_frame_url=uri(last);
          for(const [kind,key] of [['image','input_reference[]'],['video','video_reference[]'],['audio','audio_reference[]']]){const values=refs.filter(r=>r.kind===kind&&r!==first&&r!==last).map(uri);if(values.length)body[key]=values;}
        }
        let requestBody=body;
        if(settings.videoProtocol==='multipart'||settings.videoProtocol==='sora'){
          const form=new FormData();
          for(const [key,value] of Object.entries(body))if(!['input_reference[]','video_reference[]','audio_reference[]','first_frame_url','last_frame_url'].includes(key))form.set(key,typeof value==='object'?JSON.stringify(value):String(value));
          if(settings.videoProtocol==='sora'){
            if(refs.some(r=>r.kind!=='image')||refs.length>1||c.lastFrameId)throw fail('Sora 通道仅支持一张首帧图片');
            if(refs[0])form.append('input_reference',new Blob([refs[0].bytes],{type:refs[0].mimeType}),'frame.'+refs[0].mimeType.split('/')[1]);
          }else for(const ref of refs){const key=ref.nodeId===c.firstFrameId?'first_frame_url':ref.nodeId===c.lastFrameId?'last_frame_url':{image:'input_reference[]',video:'video_reference[]',audio:'audio_reference[]'}[ref.kind];form.append(key,new Blob([ref.bytes],{type:ref.mimeType}),'reference.'+ref.mimeType.split('/')[1]);}
          requestBody=form;
        }
        let payload=await json(await call(settings,'/videos',signal,requestBody));
        const remoteId=payload.id||payload.task_id;
        const task=this.tasks.tasks.find(t=>t.id===id);task.remoteId=typeof remoteId==='string'?remoteId:undefined;await this.tasks.persist();
        while(!['completed','succeeded','success','failed','error','cancelled'].includes(payload.status)&&!payload.url&&!payload.video_url){
          if(typeof remoteId!=='string'||remoteId.length>256)throw fail('视频接口未返回任务 ID 或视频结果');
          await pause(1000,signal);payload=await json(await call(settings,`/videos/${encodeURIComponent(remoteId)}`,signal));
          const progress=Number(payload.progress);if(Number.isFinite(progress)){task.progress=Math.max(0,Math.min(100,progress));await this.tasks.persist();}
        }
        if(['failed','error','cancelled'].includes(payload.status))throw fail('供应商视频任务失败或取消');
        const url=payload.video_url||payload.url||payload.output?.url;
        await stage('downloading');
        const bytes=url?await download(settings,url,signal):await boundedBytes(await call(settings,`/videos/${encodeURIComponent(remoteId)}/content`,signal),256*1024*1024);
        assets.push(await saveMedia(this.root,bytes,'视频.mp4'));
      }
      signal.throwIfAborted();
      await stage('saving');
      assets.forEach((a,i)=>Object.assign(a,{id:`${id}-${i}`,name:`${label||'生成'} · ${i+1}`,generation:{taskId:id,nodeId,model,requestedSize:c.size,prompt:c.prompt}}));
      const result={id,kind:'workflow',projectId,nodeId,mode:c.mode,createdAt:new Date().toISOString(),prompt:c.prompt,references:c.references,assets};
      await atomicWrite(await safePath(this.root,'results',id+'.json'),JSON.stringify(result));return id;
    },{kind:'workflow',projectId,nodeId,model,mode:c.mode,requestedSize:c.size,count:c.count,outputNodes:true});
    try{await atomicWrite(await safePath(this.root,'requests',task.id+'.json'),JSON.stringify(request));ready();}
    catch(error){failed(error);await this.tasks.cancel(task.id);throw error;}
    return {id:task.id};
  }
}
module.exports={WorkflowService};

