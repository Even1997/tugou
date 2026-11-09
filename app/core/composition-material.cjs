const {normalize,owner,extract}=require('./artboards.cjs');
const {descendants,inherited}=require('./layers.cjs');

function materialPlan(document,id){
  const doc=normalize(document),target=doc.layers.find(l=>l.id===id),board=owner(doc,id);
  if(!target||!board)throw Error('图层或画板已不存在');
  const local=extract(doc,board.id);
  if(target.artboard)return {document:local,name:target.name,boardId:board.id,kind:'board'};
  if(target.kind==='adjustment')throw Error('调整图层没有独立图像，请保存包含它的分组或画板');
  const included=descendants(local.layers,[id]),ancestors=new Set();
  let parent=local.layers.find(l=>l.id===target.parentId);
  while(parent&&!ancestors.has(parent.id)){ancestors.add(parent.id);included.add(parent.id);parent=local.layers.find(l=>l.id===parent.parentId);}
  const layers=local.layers.filter(l=>included.has(l.id)).map(l=>l.id===id||ancestors.has(l.id)?{...l,visible:true}:l);
  for(const layer of layers){
    if(inherited(layers,layer,'hidden'))continue;
    if(layer.maskSourceId&&!included.has(layer.maskSourceId))throw Error('此图层依赖外部蒙版，请保存包含关联图层的分组或画板');
    if(layer.clipping){
      const previous=local.layers.slice(0,local.layers.findIndex(l=>l.id===layer.id)).reverse();
      const base=previous.find(l=>l.parentId===layer.parentId&&!l.clipping&&l.visible!==false);
      if(!base||!included.has(base.id))throw Error('此图层依赖剪贴底层，请保存包含底层的分组或画板');
    }
  }
  return {document:{...local,background:'transparent',layers},name:target.name,boardId:board.id,kind:'layer'};
}
module.exports={materialPlan};
