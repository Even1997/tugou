const {operations,defaults:rasterDefaults}=require('./image-tools.cjs');
const {compositionNames,compositionDefaults}=require('./image-composition.cjs');
const {cleanupNames,cleanupDefaults}=require('./cleanup-settings.cjs');
const {cloudDefaults}=require('./cloud-settings.cjs');
const groups=[
  ['智能工具',{cloudExtend:'AI 扩图',upscale:'AI 超分辨率',cutout:'主体抠图',watermark:cleanupNames.watermark}],
  ['基础处理',{...operations,metadata:cleanupNames.metadata}],
  ['素材处理',Object.fromEntries(Object.entries(compositionNames).filter(([id])=>!['extract','patch'].includes(id)))],
  ['动图',{gif:'GIF 动图制作'}],
];
const names=Object.assign({},...groups.map(([,items])=>items));
const icons={cloudExtend:'maximize',upscale:'zoomIn',cutout:'mask',watermark:'brush',gif:'assets',crop:'fit',rotate:'replace',mirror:'replace'};
const defaults={...rasterDefaults,...compositionDefaults,...cleanupDefaults,mirror:{},rotate:{},
  resize:{...rasterDefaults.resize,scale:2},extend:{...rasterDefaults.extend,padding:128},
  upscale:{model:'general',scale:4},cutout:{model:'birefnet',edgeShrink:0,edgeFeather:0},
  cloudExtend:cloudDefaults.cloudExtend,gif:{width:512,height:512,delay:100,loop:0,frameDelays:{}},
};
function inputLimit(operation){return operation==='gif'?240:['mattePair','texture'].includes(operation)?2:1;}
function settingsOf(node,source){
  const operation=node.data.operation;
  if(!Object.hasOwn(names,operation))throw Error('不支持的画布工具');
  const base={...defaults[operation]};
  if(source&&['resize','extend','crop','texture','gif','cloudExtend','watermark'].includes(operation)){
    base.width=source.width;base.height=source.height;
    if(operation==='cloudExtend'){base.width+=256;base.height+=256;}
    if(operation==='gif'){base.width=Math.min(4096,base.width);base.height=Math.min(4096,base.height);}
    if(operation==='watermark'){base.width=Math.min(128,source.width);base.height=Math.min(128,source.height);}
  }
  return {operation,...Object.fromEntries(Object.entries(base).map(([key,value])=>[key,node.data.parameters?.[key]??value]))};
}
function validateTool(node){
  const s=settingsOf(node),base=defaults[s.operation];
  if(node.data.parameters!==undefined&&(!node.data.parameters||typeof node.data.parameters!=='object'||Array.isArray(node.data.parameters)))throw Error('工具参数格式无效');
  for(const [key,value] of Object.entries(node.data.parameters||{})){
    if(!Object.hasOwn(base,key))throw Error('工具参数无效：'+key);
    if(key==='frameDelays'){
      if(!value||Array.isArray(value)||typeof value!=='object'||Object.keys(value).length>240||Object.values(value).some(n=>!Number.isInteger(n)||n<20||n>60000||n%10))throw Error('GIF 帧时长无效');
    }else if(typeof value!==typeof base[key]||typeof value==='number'&&!Number.isFinite(value)||typeof value==='string'&&value.length>4000)throw Error('工具参数无效：'+key);
  }
  if(node.data.inputOrder!==undefined&&(!Array.isArray(node.data.inputOrder)||node.data.inputOrder.length>240||node.data.inputOrder.some(id=>typeof id!=='string')||new Set(node.data.inputOrder).size!==node.data.inputOrder.length))throw Error('工具输入顺序无效');
}
function createTool(operation='upscale',position){
  if(!Object.hasOwn(names,operation))throw Error('不支持的画布工具');
  return {id:crypto.randomUUID(),type:'imageTool',position,data:{name:names[operation],operation,parameters:{}}};
}
function toolInputs(document,node,visiting=new Set()){
  const graph=document.tugouCanvas,order=node.data.inputOrder||[];
  const edges=graph.edges.filter(e=>e.target===node.id);
  const rank=id=>{const i=order.indexOf(id);return i<0?order.length:i;};
  return edges.sort((a,b)=>rank(a.source)-rank(b.source)).map(edge=>{
    const source=graph.nodes.find(n=>n.id===edge.source);
    const asset=source?.type==='imageTool'?toolOutput(document,source,visiting):document.assets.find(a=>a.id===(source?.data.assetId||source?.data.outputAssetId));
    if(!asset||asset.kind&&asset.kind!=='image')throw Error('上游尚无图片，请先完成上游处理');
    return {nodeId:source.id,asset};
  });
}
function compileTool(document,id,visiting=new Set()){
  const node=document.tugouCanvas.nodes.find(n=>n.id===id);
  if(node?.type!=='imageTool')throw Error('请选择图像工具节点');
  if(visiting.has(id))throw Error('画布连线形成循环');
  visiting.add(id);validateTool(node);
  const inputs=toolInputs(document,node,visiting),operation=node.data.operation,limit=inputLimit(operation);
  if(operation==='gif'?(inputs.length<2||inputs.length>limit):inputs.length!==limit)throw Error(operation==='gif'?'请连接 2–240 张图片作为 GIF 帧':limit===2?'请连接两张图片，并在参数中确认输入顺序':'请连接一张图片或一个已有结果的工具节点');
  const asset=inputs[0].asset,settings=settingsOf(node,asset);
  if(limit===2)settings.secondaryId=inputs[1].asset.id;
  if(operation==='gif')settings.delays=inputs.map(i=>settings.frameDelays[i.nodeId]??settings.delay);
  const mask=document.assets.find(a=>a.id===settings.maskId),lut=document.imageToolLuts?.find(l=>l.id===settings.lutId);
  visiting.delete(id);
  return {asset,inputs,settings,signature:JSON.stringify({settings,sourceId:inputs[0].nodeId,assetId:asset.id,resource:asset.resource,width:asset.width,height:asset.height,...(inputs.length>1?{inputs:inputs.map(i=>({nodeId:i.nodeId,assetId:i.asset.id,resource:i.asset.resource,width:i.asset.width,height:i.asset.height}))}:{}),...(mask?{mask:mask.resource}:{}),...(lut?{lut:lut.text}:{})})};
}
function toolOutput(document,node,visiting=new Set()){
  const compiled=compileTool(document,node.id,visiting),asset=document.assets.find(a=>a.id===node.data.outputAssetId);
  if(!asset||node.data.outputSignature!==compiled.signature)throw Error(`「${node.data.name}」尚无当前结果，输入或参数变化后请重新处理`);
  return asset;
}
module.exports={groups,names,icons,defaults,inputLimit,settingsOf,validateTool,createTool,toolInputs,compileTool,toolOutput};
