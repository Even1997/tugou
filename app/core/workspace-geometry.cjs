function rulerTicks(length,offset,zoom) {
  if(!(length>0&&zoom>0&&Number.isFinite(offset)))return [];
  const target=80/zoom,power=10**Math.floor(Math.log10(target));
  const major=([1,2,5,10].find(n=>n*power>=target)||10)*power,step=major/5;
  const first=Math.ceil((22-offset)/zoom/step),last=Math.floor((length-offset)/zoom/step);
  return Array.from({length:Math.max(0,last-first+1)},(_,i)=>{
    const index=first+i,value=+(index*step).toPrecision(10);
    return {value,position:offset+value*zoom,major:index%5===0};
  });
}
function selectionMetrics(points) {
  if(!points||points.length!==4)return null;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  return {width:distance(points[0],points[1]),height:distance(points[1],points[2]),left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
}
module.exports={rulerTicks,selectionMetrics};
