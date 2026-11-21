import {traceImage} from '../core/trace-image.cjs';
self.onmessage=({data:{image,threshold}})=>{
  try{self.postMessage({paths:traceImage(image,threshold)});}
  catch(e){self.postMessage({error:e.message});}
};
