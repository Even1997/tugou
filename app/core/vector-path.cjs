// Anchors and their absolute control points are fractions of the layer box.
const limit=12000;
function validatePaths(paths){
  if(!Array.isArray(paths)||!paths.length||paths.length>1024)throw Error('路径轮廓数量无效');
  let total=0;
  const valid=v=>Number.isFinite(v)&&Math.abs(v)<=16;
  const validHandle=h=>h===undefined||(Array.isArray(h)&&h.length===2&&valid(h[0])&&valid(h[1]));
  for(const path of paths){
    if(typeof path?.closed!=='boolean'||!Array.isArray(path.nodes)||path.nodes.length<2||(total+=path.nodes.length)>limit)throw Error('路径锚点无效或超过 12000 个');
    for(const n of path.nodes){
      if(!n||!valid(n.x)||!valid(n.y)||!validHandle(n.in)||!validHandle(n.out))throw Error('路径坐标无效');
    }
  }
}
function pathData(paths,w,h){
  const xy=(x,y)=>x*w+' '+y*h;
  return paths.map(({nodes,closed})=>{
    const first=nodes[0];let d='M'+xy(first.x,first.y);
    for(let i=1;i<nodes.length+(closed?1:0);i++){
      const a=nodes[i-1],b=nodes[i%nodes.length];
      if(a.out||b.in){
        d+=' C'+xy(...(a.out||[a.x,a.y]))+' '+xy(...(b.in||[b.x,b.y]))+' '+xy(b.x,b.y);
      }else if(i<nodes.length)d+=' L'+xy(b.x,b.y);
    }
    return d+(closed?' Z':'');
  }).join(' ');
}
function mapNode(node,map){
  const [x,y]=map(node.x,node.y);
  return {x,y,...(node.in&&{in:map(...node.in)}),...(node.out&&{out:map(...node.out)})};
}
function penShape(nodes,closed){
  const pts=nodes.flatMap(n=>[[n.x,n.y],...[n.in,n.out].filter(Boolean)]);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);
  const x=Math.min(...xs),y=Math.min(...ys),width=Math.max(1,Math.ceil(Math.max(...xs)-x)),height=Math.max(1,Math.ceil(Math.max(...ys)-y));
  const paths=[{closed,nodes:nodes.map(n=>mapNode(n,(a,b)=>[(a-x)/width,(b-y)/height]))}];
  validatePaths(paths);return {shape:'path',paths,x,y,width,height};
}
function editableContour(layer,part,index){
  const path=layer.paths?.[part];
  if(layer.shape!=='path'||!Number.isInteger(part)||!Number.isInteger(index)||!path?.nodes[index])throw Error('路径锚点不存在');
  return path;
}
function replaceNodes(layer,part,nodes){
  const paths=layer.paths.slice();
  paths[part]={...paths[part],nodes};
  return {...layer,paths};
}
function movedPathNode(n,handle,x,y){
  if(!Number.isFinite(x)||!Number.isFinite(y))throw Error('路径坐标无效');
  const bound=v=>Math.max(-16,Math.min(16,v));
  x=bound(x);y=bound(y);
  if(handle==='anchor')return mapNode(n,(a,b)=>[bound(a+(x-n.x)),bound(b+(y-n.y))]);
  if(handle==='curve')return {...n,in:[bound(2*n.x-x),bound(2*n.y-y)],out:[x,y]};
  if(handle==='in'||handle==='out')return {...n,[handle]:[x,y]};
  throw Error('未知的路径手柄');
}
function moveAnchor(layer,part,index,handle,x,y){
  const nodes=editableContour(layer,part,index).nodes.slice();
  nodes[index]=movedPathNode(nodes[index],handle,x,y);
  return replaceNodes(layer,part,nodes);
}

function insertAnchor(layer,part,index){
  const path=editableContour(layer,part,index),nodes=path.nodes.slice(),next=(index+1)%nodes.length;
  if(!next&&!path.closed)throw Error('开放路径的末端没有后续曲段');
  if(layer.paths.reduce((sum,p)=>sum+p.nodes.length,0)>=limit)throw Error('路径最多支持 12000 个锚点');
  const a=nodes[index],b=nodes[next],start=[a.x,a.y],end=[b.x,b.y];
  const mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2];
  let center;
  if(a.out||b.in){
    // Subdivide the cubic at t=.5 without changing the rendered curve.
    const u=mid(start,a.out||start),v=mid(a.out||start,b.in||end),w=mid(b.in||end,end);
    const incoming=mid(u,v),outgoing=mid(v,w),[x,y]=mid(incoming,outgoing);
    nodes[index]={...a,out:u};nodes[next]={...b,in:w};center={x,y,in:incoming,out:outgoing};
  }else{const [x,y]=mid(start,end);center={x,y};}
  nodes.splice(index+1,0,center);
  return replaceNodes(layer,part,nodes);
}
function removeAnchor(layer,part,index){
  const path=editableContour(layer,part,index);
  if(path.nodes.length<=2)throw Error('每个轮廓至少保留两个锚点');
  const nodes=path.nodes.slice();nodes.splice(index,1);
  return replaceNodes(layer,part,nodes);
}
const boxes=new WeakMap();
function pathBox(paths){
  let box=boxes.get(paths);
  if(!box){
    let left=0,top=0,right=1,bottom=1;
    const include=(x,y)=>{left=Math.min(x,left);top=Math.min(y,top);right=Math.max(x,right);bottom=Math.max(y,bottom);};
    for(const path of paths)for(const n of path.nodes){include(n.x,n.y);if(n.in)include(...n.in);if(n.out)include(...n.out);}
    box={left,top,right,bottom};boxes.set(paths,box);
  }
  return box;
}
module.exports={insertAnchor,removeAnchor,pathBox,validatePaths,pathData,mapNode,penShape,moveAnchor,movedPathNode};
