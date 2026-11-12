const shapes = [['rect','矩形'],['rounded','圆角矩形'],['ellipse','圆形 / 椭圆'],['triangle','三角形'],['diamond','菱形'],['star','星形'],['line','直线']];

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
const validLinePoints=p=>Array.isArray(p)&&p.length===4&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1);
const lineEndpoints=(width,height,p=[0,0,1,1])=>[{x:p[0]*width,y:p[1]*height},{x:p[2]*width,y:p[3]*height}];
function lineBounds(start,end,snap=false,max=30000){
  let dx=end.x-start.x,dy=end.y-start.y;
  if(snap){const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/4))*Math.PI/4,length=Math.hypot(dx,dy);dx=Math.cos(angle)*length;dy=Math.sin(angle)*length;}
  const scale=Math.min(1,max/Math.max(Math.abs(dx),Math.abs(dy)));dx*=scale;dy*=scale;
  if(Math.abs(dx)<1e-8)dx=0;if(Math.abs(dy)<1e-8)dy=0;
  const width=Math.max(1,Math.abs(dx)),height=Math.max(1,Math.abs(dy)),x=start.x+Math.min(0,dx)-(width-Math.abs(dx))/2,y=start.y+Math.min(0,dy)-(height-Math.abs(dy))/2;
  return {x,y,width,height,linePoints:[(start.x-x)/width,(start.y-y)/height,(start.x+dx-x)/width,(start.y+dy-y)/height].map(n=>Math.max(0,Math.min(1,n)))};
}
module.exports={shapes,shapePoints,shapeBounds,lineBounds,lineEndpoints,validLinePoints};
