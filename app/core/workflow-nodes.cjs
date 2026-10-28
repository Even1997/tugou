const types=['textgen','image','video','audio','panorama','config','director'];
// Keep legacy types readable in saved projects, but never create or run them.
const retiredMode=node=>['video','audio'].includes(modeOf(node));
const nodeWidth=type=>types.includes(type)&&type!=='director'?400:300;
const labels={textgen:'文本生成',image:'图片生成',video:'视频生成',audio:'音频参考',panorama:'全景图',config:'生成台',director:'3D 导演台'};
const nodeName=node=>node.type==='config'&&node.data.name==='配置节点'?'生成台':node.data.name;
const modeOf=node=>node.type==='config'?(node.data.mode||'image'):node.type==='textgen'?'text':node.type==='panorama'?'image':node.type;
function workflowNode(type,position){
  if(!types.includes(type)||['video','audio'].includes(type))throw Error('节点类型无效：仅支持图片与文本创作');
  return {id:crypto.randomUUID(),type,position,data:{name:labels[type],prompt:'',model:'',size:type==='panorama'?'2048x1024':'1024x1536',count:1,mode:'image',quality:'auto',inputOrder:[],scene:{objects:[],cameras:[{id:'camera',name:'主机位',position:[5,3,7],target:[0,1,0],fov:45}],activeCamera:'camera'}}};
}
function inputsOf(graph,node){
  const edges=graph.edges.filter(e=>e.target===node.id),order=node.data.inputOrder||[];
  return [...edges].sort((a,b)=>{const ai=order.indexOf(a.source),bi=order.indexOf(b.source);return (ai<0?order.length:ai)-(bi<0?order.length:bi);});
}
function canLink(graph,source,target){
  const a=graph.nodes.find(n=>n.id===source),b=graph.nodes.find(n=>n.id===target);
  if(!a||!b||source===target||graph.edges.some(e=>e.source===source&&e.target===target))return false;
  if(retiredMode(b)||a.type==='group'||b.type==='group'||(a.type==='config'&&b.type==='config'))return false;
  if(b.type==='director'&&!['asset','image','panorama'].includes(a.type))return false;
  if(!['recipe',...types].includes(b.type))return false;
  const visited=new Set();
  const reaches=id=>{if(id===source)return true;if(visited.has(id))return false;visited.add(id);return graph.edges.filter(e=>e.source===id).some(e=>reaches(e.target));};
  return !reaches(target);
}
function compileWorkflow(document,id){
  const graph=document.tugouCanvas,node=graph.nodes.find(n=>n.id===id);
  if(!node||!types.includes(node.type)||node.type==='director')throw Error('请选择生成节点');
  if(retiredMode(node))throw Error('视频和音频生成已移除，已有结果仍可查看');
  const active=new Set(),done=new Set();
  const checkCycle=id=>{if(active.has(id))throw Error('画布连线形成循环');if(done.has(id))return;active.add(id);for(const e of graph.edges.filter(e=>e.target===id))checkCycle(e.source);active.delete(id);done.add(id);};checkCycle(id);
  const assembling=node.type==='config';
  const promptNode=graph.edges.some(e=>e.target===id&&e.source===node.data.promptNodeId)&&graph.nodes.find(n=>n.id===node.data.promptNodeId&&n.type==='text');
  const sourcePrompt=promptNode?promptNode.data.text:node.data.prompt||'';
  const mentions=[...sourcePrompt.matchAll(/@\[node:([^\]]+)\]/g)].map(m=>m[1]);
  const visiting=new Set(),seen=new Set(),texts=[],refs=[],configs=[],sources=[];
  const visit=(id,edge)=>{
    if(visiting.has(id))throw Error('画布连线形成循环');
    if(seen.has(id))return;
    const n=graph.nodes.find(x=>x.id===id);if(!n)throw Error('输入节点不存在');
    visiting.add(id);
    const generatedConfig=n.type==='config'&&!!n.data.outputAssetId;
    if(assembling&&!generatedConfig&&n.type!=='asset')for(const e of inputsOf(graph,n))visit(e.source,e);
    const addText=(text,origin='prompt')=>{
      if(!assembling||!mentions.includes(id))texts.push(text);
      if(assembling&&text)sources.push({nodeId:id,name:n.data.binding?.snapshot.name||n.data.snapshot?.name||nodeName(n)||labels[n.type]||'文字节点',category:n.data.binding?.snapshot.kind||n.data.kind||'text',text,origin:mentions.includes(id)?'mention':origin});
    };
    const addAsset=asset=>{
      if(asset.kind==='text')addText(n.data.resultText??asset.text??'','result');
      else {
        const ref={assetId:asset.id,nodeId:n.id,kind:asset.kind||'image',role:node.data.inputRoles?.[n.id]||edge?.role||n.data.role||'参考内容'};
        refs.push(ref);
        if(assembling)sources.push({...ref,name:nodeName(n)||asset.name||'素材节点',assetName:asset.name,category:'reference',origin:'reference'});
      }
    };
    if(n.type==='config')configs.push(n.data);
    if(generatedConfig){
      const asset=document.assets.find(a=>a.id===n.data.outputAssetId);
      if(!asset)throw Error(`输入「${nodeName(n)}」尚无可用结果，请先添加素材或生成内容`);
      addAsset(asset);
    }else if(n.type==='config'){
      if(!assembling)for(const e of inputsOf(graph,n))visit(e.source,e);
      if(n.data.prompt)addText(n.data.prompt);
    }else if(n.type==='module')addText(n.data.binding.overrideText??n.data.binding.snapshot.text);
    else if(n.type==='text'){if(n.id!==promptNode?.id)addText(n.data.text);}
    else if(n.type==='recipe')addText(n.data.snapshot.output||'');
    else if(n.type==='textgen'){
      if(!n.data.resultText&&!assembling)throw Error('请先生成上游文本');
      addText(n.data.resultText||n.data.prompt||'',n.data.resultText?'result':'prompt');
    }else{
      const asset=document.assets.find(a=>a.id===(n.type==='asset'?n.data.assetId:n.data.outputAssetId));
      if(!asset&&(!assembling||n.type==='asset'||n.data.outputAssetId))throw Error(`输入「${nodeName(n)||n.data.binding?.snapshot?.name||'图片'}」尚无可用结果，请先添加素材或生成内容`);
      if(!asset)addText(n.data.prompt||'');
      else addAsset(asset);
    }
    visiting.delete(id);seen.add(id);
  };
  for(const e of inputsOf(graph,node))visit(e.source,e);
  const data={...configs.at(-1),...Object.fromEntries(Object.entries(node.data).filter(([k,v])=>!['scene','inputOrder'].includes(k)&&v!==''&&v!==undefined))};
  // A linked configuration owns generation parameters; node prompt and requested mode stay local.
  if(configs.length&&!assembling)for(const key of ['model','size','quality','count','negativePrompt','camera'])if(configs.at(-1)[key]!==undefined)data[key]=configs.at(-1)[key];
  const mode=modeOf(node),count=Number(data.count??1);
  if(!['text','image'].includes(mode)||!Number.isInteger(count)||count<1||count>15)throw Error('生成模式或数量无效（1–15）');
  if(typeof data.size!=='string'||!(/^(auto|\d{1,5}x\d{1,5})$/.test(data.size)))throw Error('尺寸请填写宽x高或 auto');
  if(data.size!=='auto'){const [w,h]=data.size.split('x').map(Number);if(w<1||h<1||w*h>100000000)throw Error('图片尺寸需在一亿像素以内');}
  for(const id of mentions)if(!seen.has(id)){if(id===node.id||!done.has(id))throw Error('提示词引用了未连接的节点');visit(id);}
  const localPrompt=sourcePrompt.replace(/@\[node:([^\]]+)\]/g,(_,id)=>{const n=graph.nodes.find(n=>n.id===id),output=n.type==='config'&&document.assets.find(a=>a.id===n.data.outputAssetId);return n.type==='text'?n.data.text:n.type==='textgen'?(n.data.resultText||n.data.prompt||''):n.type==='module'?(n.data.binding.overrideText??n.data.binding.snapshot.text):output?.kind==='text'?(n.data.resultText??output.text??''):`【参考：${nodeName(n)||document.assets.find(a=>a.id===n.data.assetId)?.name||n.type}】`;});
  if(assembling&&localPrompt)sources.push({nodeId:node.id,name:nodeName(node),category:'other',text:localPrompt,origin:'local'});
  let prompt=(assembling?[...texts,localPrompt]:[localPrompt,...(node.data.excludeUpstreamText||mentions.length?[]:texts)]).filter(Boolean).join('\n\n').trim();
  for(const ref of refs)ref.role=node.data.inputRoles?.[ref.nodeId]||ref.role;
  if(mode==='image'&&refs.length)prompt+='\n\n参考图职责：\n'+refs.map((r,i)=>`${i+1}. ${r.role}`).join('\n');
  const globals=document.modules.filter(m=>(m.global??m.kind==='style')&&!graph.nodes.some(n=>seen.has(n.id)&&n.type==='module'&&n.data.binding.moduleId===m.id));
  if(globals.length)prompt+='\n\n'+globals.map(m=>`【${m.name}】\n${m.text}`).join('\n\n');
  if(assembling)for(const m of globals)sources.push({moduleId:m.id,name:m.name,category:m.kind||'other',text:m.text,origin:'global'});
  if(!prompt)throw Error('请填写提示词或连接文本输入');
  if(prompt.length>100000)throw Error('提示词过长');
  if(refs.length>16)throw Error('最多连接 16 个媒体输入');
  if(mode==='image'&&refs.some(r=>r.kind!=='image'))throw Error('图片模型只接受图片参考，请移除视频/音频输入');
  if(mode==='text'&&refs.some(r=>r.kind!=='image'))throw Error('当前文本接口支持文字和图片输入');
  if(node.type==='panorama'){data.size='2048x1024';prompt+='\n\n输出一张 2:1 等距柱状投影全景，水平360度、垂直180度，地平线居中，左右无缝衔接；保持参考场景，不拉伸参考图、不拼贴、不加文字和边框。';}
  if(data.negativePrompt)prompt+='\n避免：'+data.negativePrompt;
  if(data.camera)prompt+='\n镜头要求：'+data.camera;
  if(assembling)for(const [key,name] of [['negativePrompt','负面提示词'],['camera','镜头要求']])if(data[key])sources.push({nodeId:node.id,name,category:'other',text:data[key],origin:'local'});
  return {...data,mode,count:mode==='image'?count:1,prompt,references:refs,sources,parameterSourceId:!assembling&&configs.length?graph.nodes.find(n=>n.type==='config'&&n.data===configs.at(-1))?.id:undefined,projection:node.type==='panorama'?'equirectangular':undefined};
}
module.exports={types,retiredMode,nodeWidth,labels,nodeName,modeOf,workflowNode,inputsOf,canLink,compileWorkflow};
