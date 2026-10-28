const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomBytes,randomUUID,timingSafeEqual} = require('node:crypto');
const {safePath,atomicWrite,hash,resourcesIn} = require('./storage.cjs');
const commands = require('./automation-commands.cjs');
const {object,string,enumeration,fail,find} = commands;
const {sceneNode}=require('./automation-scene.cjs');
const Ajv = require('ajv');
const {setTimeout:delay}=require('node:timers/promises');
const MAX_BYTES=32*1024*1024;
const toolSchemas={
  get_state:object({}),
  list_commands:object({domain:string,search:{type:'string',maxLength:256},schemas:{type:'boolean'}}),
  query_objects:object({kind:enumeration('canvasNode','edge','layer','artboard','asset','prompt','recipe','sceneObject','camera'),nodeId:string,search:{type:'string',maxLength:256},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['kind']),
  get_object:object({kind:enumeration('canvasNode','edge','layer','artboard','asset','prompt','recipe','sceneObject','camera'),nodeId:string,id:string},['kind','id']),
  run_command:object({command:string,args:{type:'object'},expectedRevision:string},['command']),
  batch:object({expectedRevision:string,steps:{type:'array',minItems:1,maxItems:100,items:object({name:string,command:string,args:{type:'object'}},['name','command'])}},['expectedRevision','steps']),
  preview:object({artboardId:string,id:string,mode:enumeration('composite','mask','overlay','original'),maxSize:{type:'integer',minimum:64,maximum:2048}},['artboardId']),
};
const ajv=new Ajv(),checks=Object.fromEntries(Object.entries(toolSchemas).map(([n,s])=>[n,ajv.compile(s)]));
const compact = ({document,...state}) => ({...state,name:document?.name,counts:document?{nodes:document.tugouCanvas?.nodes.length||0,edges:document.tugouCanvas?.edges.length||0,layers:document.layers.length,artboards:document.layers.filter(l=>l.artboard).length,assets:document.assets.length,prompts:document.modules.length,recipes:document.recipes.length}:null});
function collection(document,kind){return ({canvasNode:document.tugouCanvas?.nodes||[],edge:document.tugouCanvas?.edges||[],layer:document.layers,artboard:document.layers.filter(l=>l.artboard),asset:document.assets,prompt:document.modules,recipe:document.recipes})[kind];}
function summary(item,kind){return {id:item.id,kind,type:item.type||item.kind,name:item.name||item.data?.name||item.data?.binding?.snapshot?.name,parentId:item.parentId,position:item.position,...(kind==='layer'||kind==='artboard'?{x:item.x,y:item.y,width:item.width,height:item.height,rotation:item.rotation,visible:item.visible,locked:item.locked,hasMask:!!item.mask,coordinateSpace:'parent-local'}:{}),...(kind==='edge'?{source:item.source,target:item.target}:{})};}

// The journal records intent BEFORE a paid operation. An ambiguous crash is never retried automatically.
class RequestJournal {
  constructor(file){this.file=file;this.entries={};}
  async init(){try{this.entries=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
  async execute(key,payload,operation){
    const digest=hash(JSON.stringify(payload)),previous=this.entries[key];
    if(previous){if(previous.digest!==digest)fail('IDEMPOTENCY_CONFLICT','requestId 已用于不同请求');if(previous.result)return {...previous.result,replayed:true};fail('AMBIGUOUS_REQUEST','上次提交结果不确定；请检查任务列表与供应商记录，不要自动重发');}
    if(Object.keys(this.entries).length>=5000)fail('RESOURCE_LIMIT','请求记录已达上限，请归档会话后继续');
    this.entries[key]={digest,status:'submitting'};await atomicWrite(this.file,JSON.stringify(this.entries));
    const result=await operation();this.entries[key]={digest,status:'submitted',result};await atomicWrite(this.file,JSON.stringify(this.entries));return result;
  }
}

async function createDispatcher({ui,projects,connections,tasks,workflow,generation,analysis,localAI,imageTools,cloud,semantic,root,filesRoot,fonts=new (require('./font-service.cjs').FontService)(root,tasks)}){
  const journal=new RequestJournal(await safePath(root,'mcp-requests.json'));await journal.init();
  const snapshot=()=>ui('snapshot');
  const guard=(state,expected)=>{if(state.busy)fail('BUSY','界面正在处理操作');if(expected!==state.revision)fail('CONFLICT','请使用 get_state 返回的实时 revision');};
  const project=state=>{if(!state.document)fail('NO_PROJECT','请先打开工程');return state.document;};
  const commit=async(state,document)=>{
    const previous=resourcesIn(state.document),added=[...resourcesIn(document)].filter(name=>!previous.has(name));
    if(added.length)await projects.verifyResources(added.map(resource=>({resource})));
    return compact(await ui('commit',{document},state.revision));
  };
  const filePath=async filename=>{
    if(path.isAbsolute(filename))fail('PATH_DENIED','请使用相对于会话文件根目录的路径');
    if(!filename||filename.split(/[\\/]/).some(v=>v==='..'||v.includes(':')))fail('PATH_DENIED','路径不允许越界或包含备用数据流');
    return safePath(filesRoot,filename);
  };
  const writeNew=async(filename,bytes)=>{const file=await filePath(filename);await fs.mkdir(path.dirname(file),{recursive:true});await filePath(filename);await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});return {path:file,bytes:bytes.length};};
  return async(method,args,{signal,onProgress}={})=>{
    if(!checks[method]?.(args))fail('INVALID_ARGUMENT',`不支持的请求或参数：${method}`);
    if(method==='list_commands'){
      const schemas=args.schemas??!!args.domain,terms=(args.search||'').toLowerCase().split(/\s+/).filter(Boolean);
      const found=commands.listCommands(args.domain,schemas).filter(c=>terms.every(term=>(c.name.replaceAll('.',' ')+' '+c.name+' '+c.description).toLowerCase().includes(term)));
      return {commands:found,total:found.length,schemaMode:schemas?'full':'summary'};
    }
    const state=await snapshot();
    if(method==='get_state')return {...compact(state),filesRoot,limits:{batchSteps:100,queryPage:100,previewEdge:2048,rasterPixels:16000000,sceneRenderObjects:200,sceneModelVertices:1000000,modelFileBytes:67108864},capabilities:{commands:commands.listCommands().length,domains:[...new Set(commands.listCommands().map(c=>c.name.split('.')[0]))]}};
    if(method==='query_objects'||method==='get_object'){
      const doc=project(state),isScene=['sceneObject','camera'].includes(args.kind);
      if(isScene&&!args.nodeId)fail('INVALID_ARGUMENT','查询 3D 物体或机位必须指定 nodeId');
      const list=isScene?sceneNode(doc,args.nodeId).data.scene[args.kind==='camera'?'cameras':'objects']:collection(doc,args.kind);
      if(method==='get_object')return {revision:state.revision,kind:args.kind,object:find(list,args.id)};
      const matched=list.filter(v=>!args.search||[v.id,v.name,v.data?.name,v.data?.text].some(s=>String(s||'').toLowerCase().includes(args.search.toLowerCase()))),offset=args.offset||0,limit=args.limit||50;
      return {revision:state.revision,total:matched.length,offset,nextOffset:offset+limit<matched.length?offset+limit:null,objects:matched.slice(offset,offset+limit).map(v=>summary(v,args.kind))};
    }
    if(method==='preview'){project(state);return ui('preview',args);}
    if(method==='batch'){
      guard(state,args.expectedRevision);const result=commands.batch(project(state),args.steps);
      return {...await commit(state,result.document),results:result.results};
    }
    const name=args.command,input=args.args||{},command=commands.validate(name,input);
    if(!['read','task'].includes(command.effect))guard(state,args.expectedRevision);
    if(command.effect==='document'){
      const result=commands.batch(project(state),[{name:'result',command:name,args:input}]);
      return {...await commit(state,result.document),...result.results.result};
    }
    if(command.effect==='session')return compact(await ui(name,input,state.revision));
    if(name.startsWith('font.'))return fonts.execute(name,input,{filePath,writeNew,journal});
    if(command.effect==='pixels'){
      const doc=project(state);commands.editable(doc,input.ids||[input.id||input.artboardId]);
      const result=await ui(name,input,state.revision);return {...compact(result),...(result.id?{id:result.id}:{})};
    }
    if(name==='project.list')return projects.list();
    if(name==='models.status')return connections.listSuppliers();
    if(name.startsWith('models.')){
      const result=await require('./automation-models.cjs').execute(connections,name,input,commands);
      if(command.effect==='configuration'){
        try{await ui('models.changed');result.uiNotified=true;}catch{result.uiNotified=false;}
      }
      return result;
    }
    if(name==='tools.status')return localAI.status();
    if(name==='task.list')return tasks.list();
    if(name==='task.get')return find(tasks.list(),input.id);
    if(name==='task.cancel'){find(tasks.list(),input.id);return {cancelled:await tasks.cancel(input.id)};}
    if(name==='task.wait'){
      const started=Date.now(),end=started+(input.timeoutMs??1000);let task,last='',notified=-1000;
      do{
        if(signal?.aborted)fail('CANCELLED','已取消等待；生成任务仍按原状态运行');
        task=find(tasks.list(),input.id);const elapsedMs=Date.now()-started,key=JSON.stringify([task.status,task.stage,task.message,task.progress]);
        if(key!==last||elapsedMs-notified>=1000){await onProgress?.({elapsedMs,status:task.status,stage:task.stage,message:task.message,progress:task.progress});last=key;notified=elapsedMs;}
        if(!['queued','running'].includes(task.status)||Date.now()>=end)break;
        try{await delay(Math.min(200,Math.max(1,end-Date.now())),undefined,{signal});}catch(error){if(error.name==='AbortError')fail('CANCELLED','已取消等待；生成任务仍按原状态运行');throw error;}
      }while(true);
      return {task,timedOut:['queued','running'].includes(task.status)};
    }
    const doc=project(state);
    if(name==='asset.details'){find(doc.assets,input.id);return generation.assetDetails(state.projectId,doc,input.id,input.nodeId);}
    if(name==='semantic.read')return semantic.read(state.projectId,input.id);
    if(name==='cloud.cancelBatch'){
      const batch=tasks.list().filter(t=>t.context?.batchId===input.id);
      if(!batch.length||batch.some(t=>t.context.projectId!==state.projectId))fail('INVALID_TARGET','批次不属于当前工程');
      return {cancelled:await cloud.cancelBatch(input.id)};
    }
    if(name==='task.retry'){
      const task=find(tasks.list(),input.id);if(task.context?.projectId!==state.projectId)fail('INVALID_TARGET','任务不属于当前工程');
      const service=task.context.kind==='workflow'?workflow:task.context.kind==='cloud-tool'?cloud:['raster','local-ai'].includes(task.context.engine)?imageTools:null;
      if(!service||!['failed','cancelled','interrupted',...(task.context.kind==='cloud-tool'?['review']:[])].includes(task.status))fail('INVALID_TARGET','此任务不支持按快照重试');
      return journal.execute(`${state.projectId}:${input.requestId}`,{projectId:state.projectId,command:name,args:input},async()=>({taskId:(await service.retry(input.id)).id}));
    }
    if(['cloud.batch','semantic.analyze','semantic.generate'].includes(name)){
      for(const id of input.ids||[input.assetId]){const a=find(doc.assets,id);if(a.kind&&a.kind!=='image')fail('INVALID_TARGET','请选择图片素材');}
      if(name==='semantic.generate')require('./semantic-plan.cjs').semanticItems(input.plan);
      await projects.verifyResources(doc);
      return journal.execute(`${state.projectId}:${input.requestId}`,{projectId:state.projectId,command:name,args:input},async()=>{
        if(name==='cloud.batch')return cloud.startBatch(state.projectId,doc,input.ids,input.settings);
        if(name==='semantic.generate')return semantic.generate(state.projectId,doc,input.assetId,input.plan);
        return {taskId:(await semantic.analyze(state.projectId,doc,input.assetId)).id};
      });
    }
    if(name==='scene.preview'||name==='scene.capture'){
      sceneNode(doc,input.nodeId);const result=await ui(name,input,state.revision);
      return name==='scene.preview'?result:{...compact(result),nodeId:result.nodeId,assetId:result.assetId};
    }
    if(name==='scene.model.import'){
      sceneNode(doc,input.nodeId);const model=await require('./import-model.cjs').importModel(root,await filePath(input.path));
      const result=commands.batch(doc,[{name:'model',command:'scene.object.create',args:{nodeId:input.nodeId,kind:'model',properties:{name:model.name,...input.properties,resource:model.resource}}}]);
      return {...await commit(state,result.document),id:result.results.model.id,resource:model.resource};
    }
    if(name==='analysis.results')return {drafts:await analysis.results(state.projectId)};
    if(name==='analysis.review')return analysis.saveReview(state.projectId,input.id,input.review);
    if(name==='analysis.apply'){
      const draft=find(await analysis.results(state.projectId),input.id);
      if(input.useReview){
        if(!draft.review)fail('INVALID_TARGET','请先保存审阅内容');
        if(['moduleIndices','createRecipe','recipeName','reference'].some(k=>Object.hasOwn(input,k)))fail('INVALID_ARGUMENT','useReview 不与临时选择参数混用');
        return commit(state,require('./analysis-draft.cjs').applyAnalysis(doc,draft,draft.review));
      }
      if(input.moduleIndices?.some(i=>i>=draft.modules.length))fail('INVALID_ARGUMENT','模块索引超出分析结果范围');
      const review={modules:draft.modules.map((m,i)=>({...m,enabled:!input.moduleIndices||input.moduleIndices.includes(i),global:false})),createRecipe:input.createRecipe===true,recipeName:input.recipeName||'分析配方',reference:input.reference===true};
      const document=require('./analysis-draft.cjs').applyAnalysis(doc,draft,review);return commit(state,document);
    }
    if(name==='cloud.review'||name==='cloud.resolve'){
      const task=find(tasks.list(),input.id);if(task.context?.projectId!==state.projectId)fail('INVALID_TARGET','任务不属于当前工程');
      if(name==='cloud.review')return cloud.review(input.id);
      const result=input.action==='keepRaw'?await cloud.keepRaw(input.id):await cloud.resume(input.id,input.fit===true);return {taskId:result.id};
    }
    if(name==='cloud.process')return journal.execute(`${state.projectId}:${input.requestId}`,{projectId:state.projectId,command:name,args:input},async()=>{
      const result=await cloud.start(state.projectId,doc,input.assetId,input.settings);return {taskId:result.id};
    });
    if(name==='canvas.compile'){
      const node=find(doc.tugouCanvas?.nodes||[],input.id);
      return node.type==='recipe'?require('./prompts.cjs').compileNode(doc,input.id):require('./workflow-nodes.cjs').compileWorkflow(doc,input.id);
    }
    if(name==='asset.preview'){
      const asset=find(doc.assets,input.id);if(asset.kind&&asset.kind!=='image')fail('INVALID_TARGET','缩略图仅支持图片素材');
      const bytes=await require('./generation.cjs').referenceBytes(root,asset),max=input.maxSize||1024;
      const {data,info}=await require('sharp')(bytes).resize({width:max,height:max,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
      return {mimeType:'image/png',data:data.toString('base64'),width:info.width,height:info.height,revision:state.revision};
    }
    if(name==='image.process')return journal.execute(`${state.projectId}:${input.requestId}`,{projectId:state.projectId,command:name,args:input},async()=>{
      const result=await imageTools.start(state.projectId,doc,input.ids,input.settings);return {taskId:result.id};
    });
    if(name==='selection.subject'){
      const normalized=require('./artboards.cjs').normalize(doc),layer=find(normalized.layers,input.id);commands.editable(normalized,[layer.id]);
      if(layer.kind!=='image')fail('INVALID_TARGET','请选择图片图层');
      const reference=layer.bitmap||find(doc.assets,layer.assetId),board=require('./artboards.cjs').owner(normalized,layer.id);
      if(!board||board.width*board.height>16000000)fail('RESOURCE_LIMIT','主体选区需在 1600 万像素以内的画板上');
      const ready=require('./subject-readiness.cjs').subjectReadiness(await localAI.status(),reference,require('node:os').freemem());if(!ready.ready)fail('NOT_READY',ready.reason);
      return journal.execute(`${state.projectId}:${input.requestId}`,{projectId:state.projectId,command:name,args:input},async()=>{
        const task=await tasks.start('MCP 主体选区',async signal=>{
          const inspect=bytes=>require('electron').nativeImage.createFromBuffer(bytes).getSize();
          const result=await require('./subject-selection.cjs').selectSubject(localAI,reference,inspect,signal);
          signal.throwIfAborted();
          await ui('selection.subjectResult',{id:layer.id,result},state.revision);
          return undefined;
        },{kind:'local-tool',projectId:state.projectId,operation:'mcp-subject-selection'});
        return {taskId:task.id};
      });
    }
    if(name==='generation.start'||name==='generation.angle'||name==='analysis.start'){
      await projects.verifyResources(doc);
      const key=`${state.projectId}:${input.requestId}`;
      return journal.execute(key,{projectId:state.projectId,command:name,args:input},async()=>{
        const result=name==='analysis.start'?await analysis.start(state.projectId,doc,input.assetId,input.instruction):name==='generation.angle'?await generation.angle(state.projectId,doc,input.nodeId,input.assetId,input.params):find(doc.tugouCanvas?.nodes||[],input.nodeId).type==='recipe'?await generation.start(state.projectId,doc,input.nodeId):await workflow.start(state.projectId,doc,input.nodeId);
        return {taskId:result.id};
      });
    }
    if(name==='asset.import'){
      const file=await filePath(input.path);if((await fs.stat(file)).size>256*1024*1024)fail('RESOURCE_LIMIT','文件超过 256 MiB');
      const inspect=bytes=>require('electron').nativeImage.createFromBuffer(bytes).getSize();
      const assets=await (/\.(png|jpe?g|webp)$/i.test(file)?require('./import-images.cjs').importImages(root,[file],inspect):require('./media.cjs').importMedia(root,[file]));
      return {...await commit(state,{...doc,assets:[...doc.assets,...assets]}),ids:assets.map(a=>a.id)};
    }
    if(name==='asset.export'){
      const asset=find(doc.assets,input.id),bytes=asset.kind==='text'?Buffer.from(asset.text||''):await require('./generation.cjs').referenceBytes(root,asset);
      return writeNew(input.path,bytes);
    }
    if(name==='artboard.export'){
      const result=await ui(name,input,state.revision);return writeNew(input.path,Buffer.from(result.data,'base64'));
    }
    fail('UNKNOWN_COMMAND','命令尚未接入');
  };
}

async function startAutomationHost({window,ipcMain,app,entryUrl,...services}){
  const pending=new Map();let disposed=false,queue=Promise.resolve(),queued=0;
  const reply=(event,id,result)=>{
    if(window.isDestroyed()||event.sender!==window.webContents||event.senderFrame!==window.webContents.mainFrame||event.senderFrame.url!==entryUrl)return;
    const request=pending.get(id);if(!request)return;pending.delete(id);clearTimeout(request.timer);
    if(result?.ok)request.resolve(result.value);else{const e=new Error(result?.error?.message||'界面操作失败');e.code=result?.error?.code||'UI_ERROR';request.reject(e);}
  };
  const ui=(action,args={},expectedRevision)=>new Promise((resolve,reject)=>{
    if(disposed||window.isDestroyed()){reject(Error('会话已关闭'));return;}
    const id=randomUUID(),timer=setTimeout(()=>{pending.delete(id);const e=Error('界面响应超时，请读取状态确认结果后再决定是否重试');e.code='UI_TIMEOUT';reject(e);},45000);
    pending.set(id,{resolve,reject,timer});window.webContents.send('tugou:automation',{id,action,args,expectedRevision});
  });
  const profile=app.getPath('userData'),filesRoot=path.resolve(process.env.TUGOU_MCP_FILES||path.join(profile,'automation'));
  await fs.mkdir(filesRoot,{recursive:true});await safePath(filesRoot,'.');
  const dispatch=await createDispatcher({...services,ui,filesRoot});
  const token=randomBytes(32).toString('hex'),sockets=new Set();
  const server=net.createServer(socket=>{
    if(sockets.size>=8){socket.destroy();return;}sockets.add(socket);const cancelled=new AbortController();socket.on('close',()=>{sockets.delete(socket);cancelled.abort();});socket.on('error',()=>{});
    socket.setTimeout(65000,()=>socket.destroy());let buffer='',bytes=0,received=false;
    socket.setEncoding('utf8');socket.on('data',chunk=>{
      if(received)return;bytes+=Buffer.byteLength(chunk);if(bytes>MAX_BYTES){socket.destroy();return;}buffer+=chunk;
      const end=buffer.indexOf('\n');if(end<0)return;received=true;
      const execute=async()=>{
        try{
          const request=JSON.parse(buffer.slice(0,end)),provided=Buffer.from(String(request.token||''));
          if(provided.length!==64||!timingSafeEqual(provided,Buffer.from(token)))fail('UNAUTHORIZED','会话凭证无效');
          if(queued>=32)fail('BUSY','请求队列已满');
          const operation=()=>dispatch(request.method,request.args||{},{signal:cancelled.signal,onProgress:request.progress===true?progress=>{if(!socket.destroyed)socket.write(JSON.stringify({progress})+'\n');}:undefined});
          // Wait does not hold the edit queue, so another client can cancel the same task.
          let result;
          if(request.method==='run_command'&&request.args?.command==='task.wait')result=await operation();
          else{queued++;const next=queue.then(operation);queue=next.catch(()=>{});try{result=await next;}finally{queued--;}}
          const response=JSON.stringify({ok:true,value:result});if(Buffer.byteLength(response)>MAX_BYTES)fail('RESOURCE_LIMIT','响应过大，请缩小查询或预览');socket.end(response+'\n');
        }catch(e){socket.end(JSON.stringify({ok:false,error:{code:e.code||'OPERATION_FAILED',message:e.message}})+'\n');}
      };execute();
    });
  });
  const descriptor=path.join(profile,'mcp-session.json');
  ipcMain.on('tugou:automation-reply',reply);
  try{
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    await atomicWrite(descriptor,JSON.stringify({version:1,port:server.address().port,token,pid:process.pid,filesRoot}));
  }catch(error){ipcMain.removeListener('tugou:automation-reply',reply);for(const socket of sockets)socket.destroy();server.close();throw error;}
  const close=()=>{if(disposed)return;disposed=true;ipcMain.removeListener('tugou:automation-reply',reply);for(const r of pending.values()){clearTimeout(r.timer);r.reject(Error('会话已关闭'));}pending.clear();for(const s of sockets)s.destroy();server.close();};
  app.once('before-quit',close);window.once('closed',close);
  return {descriptor,close,isBusy:()=>queued>0||pending.size>0,prepareUpdate:async()=>{await atomicWrite(descriptor,JSON.stringify({version:1,port:server.address().port,token,pid:process.pid,filesRoot,updating:true}));close();}};
}
module.exports={startAutomationHost,createDispatcher,RequestJournal,toolSchemas,MAX_BYTES};
