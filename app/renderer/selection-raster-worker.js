import {renderSelectionMask,selectionBounds} from './selection-raster.js';

let doc,bitmap,mask;
self.onmessage=async({data})=>{
  const {id,action}=data;
  try{
    if(action==='init'){
      doc=data.doc;
      bitmap=data.bitmap;
      if(data.url){
        const response=await fetch(data.url);
        if(!response.ok)throw Error('选区位图加载失败');
        bitmap=await createImageBitmap(await response.blob());
      }
      self.postMessage({id});
    }else if(action==='bounds'){
      const box=await selectionBounds(doc,bitmap,undefined,data.maxPixels);
      self.postMessage({id,value:box});
    }else{
      if(!mask){
        mask=renderSelectionMask(doc,bitmap);
        // Subsequent viewport requests only need the composited mask.
        bitmap?.close();
        bitmap=null;
      }
      const {view,size}=data,canvas=new OffscreenCanvas(size.width,size.height);
      canvas.getContext('2d',{willReadFrequently:true})
        .drawImage(mask,view.x,view.y,doc.width*view.zoom,doc.height*view.zoom);
      const result=canvas.transferToImageBitmap();
      self.postMessage({id,value:result},[result]);
    }
  }catch(error){
    self.postMessage({id,error:{message:error.message,code:error.code}});
  }
};
