const names={upscale:'AI 超分辨率',cutout:'主体抠图'};
const defaults={upscale:{model:'general',scale:4},cutout:{model:'birefnet',edgeShrink:0,edgeFeather:0}};
function settingsOf(node){
  const operation=node.data.operation,base=defaults[operation];
  if(!base)throw Error('不支持的画布工具');
  return {operation,...Object.fromEntries(Object.keys(base).map(key=>[key,node.data.parameters?.[key]??base[key]]))};
}
function createTool(operation='upscale',position){
  if(!Object.hasOwn(names,operation))throw Error('不支持的画布工具');
  return {id:crypto.randomUUID(),type:'imageTool',position,data:{name:names[operation],operation,parameters:{...defaults[operation]}}};
}
function compileTool(document,id,visiting=new Set()){
  const graph=document.tugouCanvas,node=graph.nodes.find(n=>n.id===id);
  if(node?.type!=='imageTool')throw Error('请选择图像工具节点');
  if(visiting.has(id))throw Error('画布连线形成循环');
  visiting.add(id);
  const inputs=graph.edges.filter(e=>e.target===id);
  if(inputs.length!==1)throw Error('请连接一张图片或一个已有结果的工具节点');
  const source=graph.nodes.find(n=>n.id===inputs[0].source);
  const asset=source?.type==='imageTool'?toolOutput(document,source,visiting):document.assets.find(a=>a.id===(source?.data.assetId||source?.data.outputAssetId));
  if(!asset||asset.kind&&asset.kind!=='image')throw Error('上游尚无图片，请先完成上游处理');
  const settings=settingsOf(node);
  visiting.delete(id);
  return {asset,settings,signature:JSON.stringify({settings,sourceId:source.id,assetId:asset.id,resource:asset.resource,width:asset.width,height:asset.height})};
}
function toolOutput(document,node,visiting=new Set()){
  const compiled=compileTool(document,node.id,visiting),asset=document.assets.find(a=>a.id===node.data.outputAssetId);
  if(!asset||node.data.outputSignature!==compiled.signature)throw Error(`「${node.data.name}」尚无当前结果，输入或参数变化后请重新处理`);
  return asset;
}
module.exports={names,defaults,settingsOf,createTool,compileTool,toolOutput};
