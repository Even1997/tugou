const {createLayer, descendants, validateLayers, multiply, matrix, decompose, duplicateLayers, relocateLayers, moveLayers} = require('./layers.cjs');

const boards = doc => doc.layers.filter(l => l.artboard);
function normalize(doc) {
  let list = boards(doc);
  if (!list.length) {
    let id = 'artboard-main';
    while (doc.layers.some(l => l.id === id)) id += '-1';
    const board = createLayer('group', {id, artboard:true, name:'画板 1', x:0, y:0,
      width:doc.width, height:doc.height, background:doc.background, clipContent:true,
      selection:doc.selection, layout:doc.layout});
    return {...doc, selection:undefined, layout:undefined,
      layers:[board, ...doc.layers.map(l => l.parentId ? l : {...l,parentId:id})]};
  }
  // Assets added from another workspace belong to the first artboard.
  if (doc.layers.some(l => !l.parentId && !l.artboard))
    return {...doc, layers:doc.layers.map(l => !l.parentId && !l.artboard ? {...l,parentId:list[0].id} : l)};
  return doc;
}
function owner(doc, id) {
  let l = doc.layers.find(l => l.id === id);
  const seen = new Set();
  while (l && !seen.has(l.id)) {
    if (l.artboard) return l;
    seen.add(l.id); l = doc.layers.find(n => n.id === l.parentId);
  }
}
function anchorTransform(l, transform) {
  if (!l.mask?.anchor) return l;
  return {...l, mask:{...l.mask, anchor:{...l.mask.anchor,matrix:multiply(transform,l.mask.anchor.matrix)}}};
}
function extract(doc, id) {
  const b = boards(doc).find(b => b.id === id);
  if (!b) throw Error('画板不存在');
  const ids = descendants(doc.layers,[id]);
  return {...doc, name:b.name, width:b.width, height:b.height, background:b.background,
    selection:b.selection, layout:b.layout,
    layers:doc.layers.filter(l => l.id !== id && ids.has(l.id)).map(l => {
      const local = anchorTransform(l,[1,0,0,1,-b.x,-b.y]);
      if(l.parentId===id){const root={...local};delete root.parentId;return root;}return local;
    })};
}
function replace(doc, id, edited) {
  const b = boards(doc).find(b => b.id === id);
  if (!b) throw Error('画板不存在');
  const ids = descendants(doc.layers,[id]);
  const nextBoard = {...b,width:edited.width,height:edited.height,background:edited.background,
    selection:edited.selection,layout:edited.layout};
  const children = edited.layers.map(l => anchorTransform({...l,parentId:l.parentId || id},[1,0,0,1,b.x,b.y]));
  const next = {...doc, assets:edited.assets,
    layers:doc.layers.flatMap(l => l.id === id ? [nextBoard,...children] : ids.has(l.id) ? [] : [l])};
  const first = boards(next)[0];
  next.width=first.width; next.height=first.height; next.background=first.background;
  validate(next); return next;
}
function create(doc, {width=1024,height=1536,name} = {}) {
  const list = boards(doc), x = Math.max(0,...list.map(b => b.x+b.width)) + 100;
  const b = createLayer('group',{artboard:true,name:name || `画板 ${list.length+1}`,x,y:list[0]?.y || 0,
    width,height,background:'#ffffff',clipContent:true});
  const next={...doc,layers:[...doc.layers,b]};validate(next);
  return {document:next,id:b.id};
}
function update(doc,id,patch,{scaleContent=false}={}) {
  const b = boards(doc).find(b => b.id === id);
  if (!b) throw Error('画板不存在');
  if(b.locked)throw Error('请先解锁画板');
  const nextBoard={...b,...patch};
  const ids = descendants(doc.layers,[id]);
  const sx=scaleContent ? nextBoard.width/b.width : 1, sy=scaleContent ? nextBoard.height/b.height : 1;
  const transform=[sx,0,0,sy,nextBoard.x-b.x*sx,nextBoard.y-b.y*sy];
  const next={...doc,layers:doc.layers.map(l => {
    if (l.id===id) return {...nextBoard,selection:nextBoard.width!==b.width||nextBoard.height!==b.height ? undefined : b.selection};
    if (!ids.has(l.id)) return l;
    const moved=anchorTransform(l,transform);
    return scaleContent && l.parentId===id ? {...moved,...decompose(multiply([sx,0,0,sy,0,0],matrix(l)))} : moved;
  })};
  const first=boards(next)[0];next.width=first.width;next.height=first.height;next.background=first.background;
  validate(next);return next;
}
function duplicate(doc,id) {
  const b=boards(doc).find(b=>b.id===id);
  const result=duplicateLayers(doc.layers,[id]);
  const next={...doc,layers:result.layers}, copy=boards(next).find(l=>l.id===result.ids[0]);
  if (!copy) throw Error('请先解锁画板');
  // duplicateLayers offsets the board; anchors still refer to the original world.
  next.layers=next.layers.map(l=>l.id===copy.id?{...l,x:b.x,y:b.y}:l);
  return {document:update(next,copy.id,{x:Math.max(...boards(doc).map(l=>l.x+l.width))+100,y:b.y}),id:copy.id};
}
function remove(doc,id) {
  if(boards(doc).find(b=>b.id===id)?.locked)throw Error('请先解锁画板');
  if(boards(doc).length<=1)throw Error('请至少保留一个画板');
  const ids=descendants(doc.layers,[id]);
  const next={...doc,layers:doc.layers.filter(l=>!ids.has(l.id)).map(l=>ids.has(l.maskSourceId)?{...l,maskSourceId:undefined}:l)};
  const first=boards(next)[0];return {...next,width:first.width,height:first.height,background:first.background};
}
function display(doc,id,edited) {
  const combined=replace(doc,id,edited),b=boards(combined).find(b=>b.id===id);
  return {...combined,infiniteWorkspace:true,selection:undefined,layers:combined.layers.map(l=>{
    const local=anchorTransform(l,[1,0,0,1,-b.x,-b.y]);
    return l.artboard?{...local,x:l.x-b.x,y:l.y-b.y}:local;
  })};
}
function relocate(doc,ids,targetId,placement='inside') {
  if(ids.some(id=>boards(doc).some(b=>b.id===id)))throw Error('拖动画板标题可移动整个画板；画板不能嵌套');
  const source=owner(doc,ids[0]),destination=owner(doc,targetId);
  if(!source||!destination)throw Error('请选择目标画板');
  if(ids.some(id=>owner(doc,id)?.id!==source.id))throw Error('请先选择同一画板内的图层');
  const moving=descendants(doc.layers,ids);
  if(doc.layers.some(l=>(moving.has(l.id)&&l.maskSourceId&&!moving.has(l.maskSourceId))||(!moving.has(l.id)&&moving.has(l.maskSourceId))))throw Error('请将关联的蒙版来源图层一同移动');
  if(boards(doc).some(b=>b.id===targetId))placement='inside';
  let layers=relocateLayers(doc.layers,ids,targetId,placement);
  if(source.id!==destination.id){
    const dx=destination.x-source.x,dy=destination.y-source.y;
    layers=moveLayers(layers,ids,dx,dy).map(l=>moving.has(l.id)?anchorTransform(l,[1,0,0,1,dx,dy]):l);
  }
  const next={...doc,layers};validate(next);return next;
}
function validate(doc) {
  validateLayers(doc.layers);
  for(const b of boards(doc)) {
    if(b.kind!=='group'||b.parentId||b.rotation||b.warp||b.flipX||b.flipY||(b.scaleX??1)!==1||(b.scaleY??1)!==1||b.skewX)
      throw Error('画板必须是未旋转的顶层容器');
    if(!Number.isInteger(b.width)||!Number.isInteger(b.height)||b.width>30000||b.height>30000||b.width*b.height>100000000)
      throw Error('画板尺寸需要为整数，单边最多 30000、总计一亿像素');
    if(typeof b.name!=='string'||!b.name.trim())throw Error('请输入画板名称');
    if(b.background!=='transparent'&&!/^#[\da-f]{3}([\da-f]{3})?$/i.test(b.background))throw Error('画板背景颜色无效');
  }
}
module.exports={boards,normalize,owner,extract,replace,create,update,duplicate,remove,display,relocate,validate};
