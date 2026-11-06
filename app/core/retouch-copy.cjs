const {inherited}=require('./layers.cjs');
function retouchCopy(layers,id){
  const source=layers.find(l=>l.id===id);
  if(source?.kind!=='image')throw Error('请选择一张图片图层');
  if(inherited(layers,source,'locked')||inherited(layers,source,'hidden'))throw Error('请先显示并解锁图片及所属分组');
  if(layers.some(l=>l.maskSourceId===id))throw Error('此图片是关联蒙版来源，请先解除关联，再创建修图副本');
  const copy={...structuredClone(source),id:crypto.randomUUID(),name:`${source.name} · 修图`};
  // Hide the original to avoid doubling translucent pixels and blend/effect strength.
  return {layers:layers.flatMap(l=>l.id===id?[{...l,visible:false},copy]:[l]),id:copy.id};
}
module.exports={retouchCopy};
