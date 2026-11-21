export function surface(width, height) {
  if(typeof document==="undefined")return new OffscreenCanvas(width,height);
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
function fillSelectionPath(ctx,points,x,y){
  if(points.length<6)return;
  if(x||y)ctx.translate(-x,-y);
  ctx.beginPath();
  ctx.moveTo(points[0],points[1]);
  for(let i=2;i<points.length;i+=2)ctx.lineTo(points[i],points[i+1]);
  ctx.closePath();
  ctx.fill();
}
function compositeSelectionPaths(ctx,paths,x,y,contextOptions,feather){
  for(const {points,operation} of paths||[]){
    ctx.globalCompositeOperation=operation==='subtract'?'destination-out':operation==='intersect'?'destination-in':'source-over';
    const integerRect=points.length===8&&points.every(Number.isInteger)&&
      points[0]===points[6]&&points[2]===points[4]&&points[1]===points[3]&&points[5]===points[7];
    if(integerRect&&operation!=='intersect'&&!feather){
      ctx.fillRect(Math.min(points[0],points[2])-x,Math.min(points[1],points[5])-y,
        Math.abs(points[2]-points[0]),Math.abs(points[5]-points[1]));
    }else{
      // Keep antialiased path coverage and transparent pixels outside an intersection.
      const tmp=surface(ctx.canvas.width,ctx.canvas.height);
      fillSelectionPath(tmp.getContext('2d',contextOptions),points,x,y);
      ctx.drawImage(tmp,0,0);
      tmp.width=tmp.height=1;
    }
  }
  ctx.globalCompositeOperation='source-over';
}
export function renderSelectionMask(doc, bitmap) {
  const out = surface(doc.width, doc.height),
    ctx = out.getContext("2d", { willReadFrequently: true }),
    s = doc.selection;
  if (!s) return out;
  if (s.bitmap)
    ctx.drawImage(bitmap, 0, 0, doc.width, doc.height);
  compositeSelectionPaths(ctx,s.paths,0,0,{willReadFrequently:true},s.feather);
  if (s.inverted) {
    ctx.globalCompositeOperation = "source-out";
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.globalCompositeOperation = "source-over";
  }
  if (s.feather) {
    const tmp = surface(doc.width, doc.height),
      c = tmp.getContext("2d");
    c.filter = `blur(${s.feather}px)`;
    c.drawImage(out, 0, 0);
    ctx.clearRect(0, 0, doc.width, doc.height);
    ctx.drawImage(tmp, 0, 0);
    tmp.width = tmp.height = 1;
  }
  return out;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
export function maskRegion(doc, bitmap, box, readback=false) {
  const contextOptions=readback?{willReadFrequently:true}:undefined;
  const margin = Math.ceil((doc.selection.feather || 0) * 3) + 2,
    base = surface(box.width + margin * 2, box.height + margin * 2),
    ctx = base.getContext("2d",contextOptions),
    x = box.x - margin,
    y = box.y - margin;
  ctx.beginPath();
  ctx.rect(-x, -y, doc.width, doc.height);
  ctx.clip();
  if (bitmap) ctx.drawImage(bitmap, -x, -y, doc.width, doc.height);
  compositeSelectionPaths(ctx,doc.selection.paths,x,y,contextOptions,doc.selection.feather);
  if (doc.selection.inverted) {
    ctx.globalCompositeOperation = "source-out";
    ctx.fillRect(-x, -y, doc.width, doc.height);
  }
  const out = surface(box.width, box.height),
    c = out.getContext("2d",contextOptions);
  if (doc.selection.feather) c.filter = `blur(${doc.selection.feather}px)`;
  c.drawImage(base, -margin, -margin);
  base.width = base.height = 1;
  return out;
}
function alphaBounds(rgba, w, h) {
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for(let y=0,start=3;y<h;y++,start+=w*4){
    let first=0;
    while(first<w&&!rgba[start+first*4])first++;
    if(first===w)continue;
    left=Math.min(left,first);
    top=Math.min(top,y);
    bottom=y+1;
    let last=w-1;
    while(last>=right&&!rgba[start+last*4])last--;
    right=Math.max(right,last+1);
  }
  return right
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}
export async function selectionBounds(doc, bitmap, signal, maxPixels=Infinity) {
  let rough = { x: 0, y: 0, width: doc.width, height: doc.height };
  if (!bitmap && !doc.selection.inverted) {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const path of doc.selection.paths || [])
      for (let i = 0; i < path.points.length; i += 2) {
        left = Math.min(left, path.points[i]);
        right = Math.max(right, path.points[i]);
        top = Math.min(top, path.points[i + 1]);
        bottom = Math.max(bottom, path.points[i + 1]);
      }
    if (!Number.isFinite(left)) throw new Error("选区为空");
    const margin = Math.ceil((doc.selection.feather || 0) * 3) + 2,
      x = Math.max(0, Math.floor(left - margin)),
      y = Math.max(0, Math.floor(top - margin));
    rough = {
      x,
      y,
      width: Math.min(doc.width, Math.ceil(right + margin)) - x,
      height: Math.min(doc.height, Math.ceil(bottom + margin)) - y,
    };
  }
  if(rough.width<=0||rough.height<=0)throw new Error("选区为空");
  if(rough.width*rough.height>maxPixels){
    const error=new Error("选区扫描范围超出像素预算");error.code="RESOURCE_LIMIT";throw error;
  }
  let left = Infinity,
    top = Infinity,
    right = 0,
    bottom = 0;
  signal?.throwIfAborted();
  let deadline=performance.now()+6;
  const tileSize=256,columns=Math.ceil(rough.width/tileSize),rows=Math.ceil(rough.height/tileSize);
  const fromEdges=(index,count)=>index%2?count-1-Math.floor(index/2):index/2;
  // Discover the outside edges first. A tile already inside the measured box
  // cannot contribute to any of the four extrema.
  for(let row=0;row<rows;row++){
    const y=rough.y+fromEdges(row,rows)*tileSize;
    for(let column=0;column<columns;column++){
      const x=rough.x+fromEdges(column,columns)*tileSize;
      const width=Math.min(tileSize,rough.x+rough.width-x),height=Math.min(tileSize,rough.y+rough.height-y);
      if(x>=left&&x+width<=right&&y>=top&&y+height<=bottom)continue;
      if(performance.now()>=deadline){
        await (globalThis.scheduler?.yield?.()||pause());
        signal?.throwIfAborted();
        deadline=performance.now()+6;
      }
      const box = {x,y,width,height},
        c = maskRegion(doc, bitmap, box, true),
        b = alphaBounds(
          c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
          c.width,
          c.height,
        );
      c.width = c.height = 1;
      if (b) {
        left = Math.min(left, x + b.x);
        top = Math.min(top, y + b.y);
        right = Math.max(right, x + b.x + b.width);
        bottom = Math.max(bottom, y + b.y + b.height);
      }
    }
  }
  if (!right) throw new Error("选区为空");
  return { x: left, y: top, width: right - left, height: bottom - top };
}
