import {originalUrl} from './composite.js';
import {selectionBounds} from './selection-raster.js';

export const largeSelection=({width,height})=>width*height>=4000000;

export function createSelectionRaster({selection,width,height},engine){
  const worker=new Worker(new URL('./selection-raster-worker.js',document.baseURI),{type:'module'});
  const pending=new Map();
  let next=0,failure;
  const dispose=(error=new DOMException('已取消','AbortError'))=>{
    failure=error;
    worker.terminate();
    for(const {reject} of pending.values())reject(error);
    pending.clear();
  };
  worker.onerror=event=>{event.preventDefault();dispose(new Error(event.message||'选区线程不可用'));};
  worker.onmessage=({data:{id,value,error}})=>{
    const reply=pending.get(id);
    if(!reply){value?.close?.();return;}
    pending.delete(id);
    if(error)reply.reject(Object.assign(new Error(error.message),{code:error.code}));
    else reply.resolve(value);
  };
  const request=(action,args,transfer=[])=>new Promise((resolve,reject)=>{
    if(failure){reject(failure);return;}
    const id=++next;
    pending.set(id,{resolve,reject});
    try{worker.postMessage({id,action,...args},transfer);}
    catch(error){pending.delete(id);reject(error);}
  });
  const doc={selection,width,height};
  const ready=(async()=>{
    const url=originalUrl(selection.bitmap);
    if(!selection.bitmap||url?.startsWith('tugou-media:'))
      return request('init',{doc,url});
    const bitmap=await createImageBitmap(await engine.image(selection.bitmap));
    try{await request('init',{doc,bitmap},[bitmap]);}
    catch(error){bitmap.close();throw error;}
  })();
  return {
    ready,dispose,
    preview:(view,size)=>request('preview',{view,size}),
    bounds:maxPixels=>request('bounds',{maxPixels}),
  };
}

export async function measureSelection(doc,engine,signal,maxPixels){
  if(!largeSelection(doc)){
    const bitmap=doc.selection.bitmap?await engine.image(doc.selection.bitmap):null;
    return selectionBounds(doc,bitmap,signal,maxPixels);
  }
  signal?.throwIfAborted();
  const raster=createSelectionRaster(doc,engine);
  const cancel=()=>raster.dispose();
  signal?.addEventListener('abort',cancel,{once:true});
  try{await raster.ready;return await raster.bounds(maxPixels);}
  finally{signal?.removeEventListener('abort',cancel);raster.dispose();}
}
