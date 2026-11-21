const {DOMImplementation,XMLSerializer}=require('@xmldom/xmldom');
const {worldMatrix,point}=require('./layers.cjs');
const {pathData,validatePaths,pathBox}=require('./vector-path.cjs');

function pathSvg(layers,id){
  const byId=new Map(layers.map(l=>[l.id,l])),root=byId.get(id),children=new Map();
  if(!root||root.artboard)throw Error('请选择路径或路径分组');
  for(const l of layers){if(!children.has(l.parentId))children.set(l.parentId,[]);children.get(l.parentId).push(l);}
  const ns='http://www.w3.org/2000/svg',doc=new DOMImplementation().createDocument(ns,'svg',null),svg=doc.documentElement;
  const element=(name,attrs,parent=svg)=>{
    const item=doc.createElementNS(ns,name);
    for(const [key,value] of Object.entries(attrs))item.setAttribute(key,String(value));
    parent.appendChild(item);return item;
  };
  const paint=(value,fallback)=>{
    if(value==null)return fallback;
    if(!/^(#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent)$/i.test(value))throw Error('SVG 颜色无效');
    return value;
  };
  let left=Infinity,top=Infinity,right=-Infinity,bottom=-Infinity,gradient=0;
  function append(l,parent){
    if(l.warp||l.mask||l.maskSourceId||l.clipping||l.effects?.some(e=>e.enabled)||!['source-over','pass-through',undefined].includes(l.blend))throw Error('SVG 导出支持普通路径；请先移除蒙版、特殊混合、透视或特效');
    if(l.kind==='group'){
      const g=element('g',{opacity:l.opacity},parent);
      for(const child of children.get(l.id)||[])if(child.visible!==false)append(child,g);
      return;
    }
    if(l.shape!=='path')throw Error('请选择矢量路径或仅含路径的分组');
    validatePaths(l.paths);
    let fill=paint(l.color,'#b0bff2');
    if(l.fill===false)fill='none';
    else if(l.gradient){
      const rad=l.gradient.angle*Math.PI/180,dx=Math.cos(rad)/2,dy=Math.sin(rad)/2;
      const id='fill'+(++gradient),g=element('linearGradient',{id,gradientUnits:'userSpaceOnUse',x1:(.5-dx)*l.width,y1:(.5-dy)*l.height,x2:(.5+dx)*l.width,y2:(.5+dy)*l.height},element('defs',{}));
      element('stop',{offset:0,'stop-color':fill},g);element('stop',{offset:1,'stop-color':paint(l.gradient.endColor,'#ffffff')},g);fill='url(#'+id+')';
    }
    const m=worldMatrix(byId,l),pad=(l.strokeWidth||0)/2;
    const b=pathBox(l.paths);
    for(const x of [b.left*l.width-pad,b.right*l.width+pad])for(const y of [b.top*l.height-pad,b.bottom*l.height+pad]){
      const p=point(m,x,y);left=Math.min(left,p.x);top=Math.min(top,p.y);right=Math.max(right,p.x);bottom=Math.max(bottom,p.y);
    }
    element('path',{d:pathData(l.paths,l.width,l.height),transform:'matrix('+m.join(' ')+')',fill,'fill-rule':'evenodd',stroke:paint(l.stroke,'#222222'),'stroke-width':l.strokeWidth||0,'stroke-linejoin':'round',opacity:l.opacity},parent);
  }
  append(root,svg);
  if(!Number.isFinite(left))throw Error('分组内没有可见路径');
  svg.setAttribute('viewBox',[left,top,right-left,bottom-top].join(' '));svg.setAttribute('width',String(right-left));svg.setAttribute('height',String(bottom-top));
  return new XMLSerializer().serializeToString(doc);
}
module.exports={pathSvg};
