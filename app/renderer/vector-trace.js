import {Compositor} from './composite.js';
import {surface} from './selection.js';
import {createLayer,inherited} from '../core/layers.cjs';

export async function traceLayer(doc,id,threshold,signal){
  const layer=doc.layers.find(l=>l.id===id);
  if(layer?.kind!=='image'||inherited(doc.layers,layer,'locked'))throw Error('请选择已解锁的图片图层');
  const engine=new Compositor();let canvas;
  try{
    const image=await engine.image(layer.bitmap||doc.assets.find(a=>a.id===layer.assetId));
    signal.throwIfAborted();
    const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,scale=Math.min(1,1024/Math.max(w,h));
    canvas=surface(Math.max(1,Math.round(w*scale)),Math.max(1,Math.round(h*scale)));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,canvas.width,canvas.height);
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    return await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./vector-trace-worker.js',document.baseURI));
      const close=()=>{worker.terminate();signal.removeEventListener('abort',abort);};
      const abort=()=>{close();reject(new DOMException('已取消','AbortError'));};
      signal.addEventListener('abort',abort,{once:true});
      worker.onmessage=({data})=>{close();if(data.error)reject(Error(data.error));else resolve(data.paths);};
      worker.onerror=e=>{close();reject(Error(e.message||'矢量化失败'));};
      worker.postMessage({image:pixels,threshold},[pixels.data.buffer]);
    });
  }finally{engine.dispose();if(canvas)canvas.width=canvas.height=1;}
}
export function addTracedLayer(doc,id,paths){
  const index=doc.layers.findIndex(l=>l.id===id),source=doc.layers[index];
  if(source?.kind!=='image'||inherited(doc.layers,source,'locked'))throw Error('源图片已变化或被锁定');
  const {parentId,x,y,width,height,rotation,scaleX,scaleY,flipX,flipY,skewX,warp,opacity}=source;
  const layer=createLayer('shape',{name:source.name+' · 矢量',shape:'path',paths,fill:true,color:'#222222',strokeWidth:0,parentId,x,y,width,height,rotation,scaleX,scaleY,flipX,flipY,skewX,warp,opacity});
  return {id:layer.id,document:{...doc,layers:[...doc.layers.slice(0,index+1),layer,...doc.layers.slice(index+1)]}};
}
