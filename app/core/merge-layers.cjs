const {roots,descendants,inherited,createLayer}=require('./layers.cjs');

// Input coordinates are local to one extracted artboard, matching the UI compositor.
function mergePlan(doc,ids){
  if(ids.some(id=>!doc.layers.some(l=>l.id===id)))throw Error('请选择同一画板内的图层');
  const chosen=roots(doc.layers,ids),selected=descendants(doc.layers,chosen.map(l=>l.id));
  if(!chosen.length||chosen.some(l=>l.parentId||l.blend!=='source-over'||l.clipping))throw Error('请合并顶层、正常混合且未剪贴的相邻图层或分组');
  if(doc.layers.some(l=>selected.has(l.id)&&inherited(doc.layers,l,'locked')))throw Error('请先解锁所选图层及子层');
  const top=doc.layers.filter(l=>!l.parentId),indices=chosen.map(l=>top.indexOf(l)).sort((a,b)=>a-b);
  if(indices.at(-1)-indices[0]+1!==indices.length)throw Error('请先将要合并的图层排为相邻');
  if(chosen.some(l=>l.kind==='adjustment'&&l.visible!==false)&&(indices[0]!==0||doc.background!=='transparent'))throw Error('调整层合并需包含全部下方内容并使用透明画布');
  if(top[indices.at(-1)+1]?.clipping||doc.layers.some(l=>l.maskSourceId&&selected.has(l.id)!==selected.has(l.maskSourceId)))throw Error('所选图层与外部图层存在剪贴或蒙版关联');
  return {selected,last:top[indices.at(-1)].id,document:{...doc,layers:doc.layers.filter(l=>selected.has(l.id))}};
}
function mergedDocument(doc,plan,asset){
  const layer=createLayer('image',{name:asset.name,assetId:asset.id,x:0,y:0,width:doc.width,height:doc.height});
  return {id:layer.id,document:{...doc,layers:doc.layers.flatMap(l=>l.id===plan.last?[layer]:plan.selected.has(l.id)?[]:[l]),assets:[...doc.assets,asset]}};
}
module.exports={mergePlan,mergedDocument};
