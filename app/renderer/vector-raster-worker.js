import {paintVector} from './vector-geometry.js';

let layer,canvas;
self.onmessage=({data})=>{
  try{
    const {base,part,index,node,transform,width,height}=data;
    if(base)layer=base;
    // Only the dragged node changes between frames in a gesture.
    layer.paths[part].nodes[index]=node;
    layer.paths=layer.paths.slice();
    if(canvas?.width!==width||canvas.height!==height)canvas=new OffscreenCanvas(width,height);
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.setTransform(...transform);
    paintVector(ctx,layer);
    const bitmap=canvas.transferToImageBitmap();
    self.postMessage({bitmap},[bitmap]);
  }catch(e){self.postMessage({error:e.message});}
};
