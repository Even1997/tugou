const cache=new WeakMap();
export function vectorGeometry(layer){
  let item=cache.get(layer.paths);
  if(item?.width!==layer.width||item.height!==layer.height){
    const path=new Path2D(),w=layer.width,h=layer.height;
    for(const {nodes,closed} of layer.paths){
      path.moveTo(nodes[0].x*w,nodes[0].y*h);
      for(let i=1;i<nodes.length+(closed?1:0);i++){
        const a=nodes[i-1],b=nodes[i%nodes.length];
        if(a.out||b.in)path.bezierCurveTo((a.out?.[0]??a.x)*w,(a.out?.[1]??a.y)*h,(b.in?.[0]??b.x)*w,(b.in?.[1]??b.y)*h,b.x*w,b.y*h);
        else if(i<nodes.length)path.lineTo(b.x*w,b.y*h);
      }
      if(closed)path.closePath();
    }
    item={width:w,height:h,path};
    cache.set(layer.paths,item);
  }
  return item.path;
}
let hitContext;
export function hitVector(layer,p,zoom){
  hitContext??=document.createElement('canvas').getContext('2d');
  const path=vectorGeometry(layer);
  if(layer.fill!==false&&hitContext.isPointInPath(path,p.x,p.y,'evenodd'))return true;
  hitContext.lineJoin='round';hitContext.lineWidth=Math.max(layer.strokeWidth||0,8/zoom);
  return layer.strokeWidth>0&&hitContext.isPointInStroke(path,p.x,p.y);
}

export function shapeStyle(ctx,l){
  let fill = l.color || "#b0bff2";
  if (l.gradient) {
    const angle = (l.gradient.angle * Math.PI) / 180,
      dx = (Math.cos(angle) * l.width) / 2,
      dy = (Math.sin(angle) * l.height) / 2;
    fill = ctx.createLinearGradient(
      l.width / 2 - dx,
      l.height / 2 - dy,
      l.width / 2 + dx,
      l.height / 2 + dy,
    );
    fill.addColorStop(0, l.color || "#b0bff2");
    fill.addColorStop(1, l.gradient.endColor);
  }
  ctx.fillStyle = fill;
  ctx.strokeStyle = l.stroke || "#222222";
  ctx.lineWidth = l.strokeWidth || 0;
  ctx.beginPath();
}
export function paintVector(ctx,l){
  shapeStyle(ctx,l);
  const path=vectorGeometry(l);
  ctx.lineJoin='round';
  if(l.fill!==false)ctx.fill(path,'evenodd');
  if(l.strokeWidth>0)ctx.stroke(path);
}
