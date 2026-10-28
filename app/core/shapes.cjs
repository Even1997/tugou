const shapes = [['rect','矩形'],['rounded','圆角矩形'],['ellipse','圆形 / 椭圆'],['triangle','三角形'],['diamond','菱形'],['star','星形']];

function shapePoints(shape) {
  if (shape === 'triangle') return [[.5,0],[1,1],[0,1]];
  if (shape === 'diamond') return [[.5,0],[1,.5],[.5,1],[0,.5]];
  if (shape === 'star') {
    const points=Array.from({length:10},(_,i)=>{
      const angle=i*Math.PI/5-Math.PI/2, radius=i%2?.22:.5;
      return [.5+Math.cos(angle)*radius,.5+Math.sin(angle)*radius];
    });
    const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),x=Math.min(...xs),y=Math.min(...ys);
    return points.map(p=>[(p[0]-x)/(Math.max(...xs)-x),(p[1]-y)/(Math.max(...ys)-y)]);
  }
  return null;
}

function shapeBounds(start,end,square=false) {
  const dx=end.x-start.x,dy=end.y-start.y;
  let width=Math.max(1,Math.min(30000,Math.abs(dx))),height=Math.max(1,Math.min(30000,Math.abs(dy)));
  if(square)width=height=Math.max(width,height);
  return {x:dx<0?start.x-width:start.x,y:dy<0?start.y-height:start.y,width,height};
}
module.exports={shapes,shapePoints,shapeBounds};
