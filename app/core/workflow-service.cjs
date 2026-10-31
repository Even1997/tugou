const fs=require('node:fs/promises');
const {compileWorkflow,nodeName}=require('./workflow-nodes.cjs');
const {safePath,atomicWrite,validateDocument}=require('./storage.cjs');
const {saveImage,referenceBytes}=require('./generation.cjs');
const {boundedBytes,requestImages}=require('./image-api.cjs');
const {validateImageSettings,imageResultWarning}=require('./image-settings.cjs');
const fail=s=>Object.assign(Error(s),{safeMessage:s});
const endpoint=(settings,route)=>settings.baseUrl.replace(/\/$/,'')+(settings.baseUrl.endsWith('/v1')?'':'/v1')+route;
async function call(settings,route,signal,body){
  const form=body instanceof FormData;
  const response=await fetch(endpoint(settings,route),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${settings.apiKey}`,...(body&&!form?{'Content-Type':'application/json'}:{})},...(body?{body:form?body:JSON.stringify(body)}:{}),signal,redirect:'error'});
  if(!response.ok){await response.body?.cancel();throw fail(`模型请求失败（HTTP ${response.status}），请检查模型和参数`);}
  return response;
}
async function json(response){try{return JSON.parse((await boundedBytes(response,32*1024*1024)).toString());}catch{throw fail('模型响应不是有效 JSON');}}
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
    if(!['image','text'].includes(c.mode))throw fail('视频和音频生成已移除，已有结果仍可查看');
    const busy=()=>this.tasks.list().some(t=>t.context?.projectId===projectId&&t.context.nodeId===nodeId&&['queued','running'].includes(t.status));
    if(busy())throw fail('该节点已有任务');
    const saved=await this.connections.readPrivate(c.mode),model=c.model||saved[`${c.mode}Model`]||(c.mode==='image'?saved.model:c.mode==='text'?saved.analysisModel:'');
    if(!saved.baseUrl||!saved.apiKey||!model)throw fail('请在模型连接或节点参数中填写对应模型');
    const settings={...saved,model},refs=[];
    if(c.mode==='image')validateImageSettings(model,c);
    for(const ref of c.references){const asset=snapshot.assets.find(a=>a.id===ref.assetId);if(!asset)throw fail('参考素材缺失');const bytes=await referenceBytes(this.root,asset);if(bytes.length>64*1024*1024)throw fail('单个模型参考不超过 64 MiB');refs.push({...ref,bytes,mimeType:asset.mimeType||`image/${asset.resource?.endsWith('.jpg')?'jpeg':asset.resource?.split('.').at(-1)||'png'}`});}
    if(busy())throw fail('该节点已有任务');
    // Persist only parameters and referenced assets; credentials are read anew on an explicit retry.
    const request={...snapshot,compiled:{...c,model},assets:snapshot.assets.filter(a=>c.references.some(r=>r.assetId===a.id))};
    let ready,failed;const savedRequest=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});savedRequest.catch(()=>{});
    const task=await this.tasks.start(label||'节点生成',async(cancelSignal,id)=>{
      await savedRequest;cancelSignal.throwIfAborted();
      const signal=AbortSignal.any([cancelSignal,AbortSignal.timeout(600000)]),assets=[];
      const journal=this.tasks.tasks.find(t=>t.id===id);
      // A provider deadline must not discard other images already saved; user cancellation still stops publishing.
      const stage=async value=>{cancelSignal.throwIfAborted();journal.stage=value;await this.tasks.persist();};
      await stage('generating');
      const uri=r=>`data:${r.mimeType};base64,${r.bytes.toString('base64')}`;
      if(c.mode==='text'){
        const content=[{type:'text',text:c.prompt},...refs.map(r=>({type:'image_url',image_url:{url:uri(r)}}))];
        const responses=settings.textApiMode==='responses';
        const payload=await json(await call(settings,responses?'/responses':'/chat/completions',signal,responses?{model,input:[{role:'user',content:content.map(c=>c.type==='text'?{type:'input_text',text:c.text}:{type:'input_image',image_url:c.image_url.url})}],stream:false}:{model,messages:[{role:'user',content}],stream:false}));
        const text=responses?(payload.output_text||payload.output?.flatMap(o=>o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('\n')):payload.choices?.[0]?.message?.content;if(typeof text!=='string'||!text.trim())throw fail('文本模型未返回文本');
        assets.push({kind:'text',text,name:(label||'文本')+' · 结果'});
      }else if(c.mode==='image'){
        const outcomes=await Promise.allSettled(Array.from({length:c.count},async()=>{
          const images=await requestImages(settings,{prompt:c.prompt,size:c.size,quality:c.quality,count:1,images:refs.map(r=>r.bytes)},signal),saved=[];
          for(const bytes of images){signal.throwIfAborted();saved.push({...await saveImage(this.root,bytes,this.inspectImage),kind:'image',projection:c.projection});}
          return saved;
        }));
        cancelSignal.throwIfAborted();
        const failures=outcomes.filter(r=>r.status==='rejected');
        if(failures.length===outcomes.length)throw failures[0].reason;
        assets.push(...outcomes.filter(r=>r.status==='fulfilled').flatMap(r=>r.value));
        if(failures.length)journal.message=`已生成 ${outcomes.length-failures.length}/${c.count} 张，${failures.length} 张失败；成功结果已保留，未自动重试`;
        await stage('saving');
      }
      cancelSignal.throwIfAborted();
      await stage('saving');
      assets.forEach((a,i)=>Object.assign(a,{id:`${id}-${i}`,name:`${label||'生成'} · ${i+1}`,generation:{taskId:id,nodeId,model,requestedSize:c.size,quality:c.quality||'auto',prompt:c.prompt}}));
      if(c.mode==='image'){
        journal.actualSizes=assets.map(a=>`${a.width}x${a.height}`);
        const warnings=[...new Set(assets.map(a=>imageResultWarning(c.size,a.width,a.height)).filter(Boolean))];
        if(warnings.length)journal.message=[journal.message,...warnings].filter(Boolean).join('；');
      }
      const result={id,kind:'workflow',projectId,nodeId,mode:c.mode,createdAt:new Date().toISOString(),prompt:c.prompt,references:c.references,assets};
      await atomicWrite(await safePath(this.root,'results',id+'.json'),JSON.stringify(result));return id;
    },{kind:'workflow',projectId,nodeId,model,mode:c.mode,requestedSize:c.size,quality:c.quality||'auto',count:c.count,outputNodes:true});
    try{await atomicWrite(await safePath(this.root,'requests',task.id+'.json'),JSON.stringify(request));ready();}
    catch(error){failed(error);await this.tasks.cancel(task.id);throw error;}
    return {id:task.id};
  }
}
module.exports={WorkflowService};

