import {RasterEncoder} from '../renderer/raster-encoder.js';
import {Compositor} from '../renderer/composite.js';
window.makeRasterEncoder=()=>new RasterEncoder();
window.encoderAlphaQA=async()=>{
 const c=document.createElement('canvas');c.width=256;c.height=32;const ctx=c.getContext('2d');
 for(let x=0;x<256;x++){ctx.fillStyle=`rgba(60,120,200,${x/255})`;ctx.fillRect(x,0,1,32);}
 const before=ctx.getImageData(0,0,256,32).data,encoder=new RasterEncoder();
 const baselineBlob=await new Promise(r=>c.toBlob(r)),baseline=await createImageBitmap(baselineBlob);
 try{const result=await encoder.encode(c),stored=await createImageBitmap(new Blob([result.bytes],{type:'image/png'}));const read=image=>{ctx.clearRect(0,0,256,32);ctx.drawImage(image,0,0);return ctx.getImageData(0,0,256,32).data;};const after=read(stored),cached=read(result.image),expected=read(baseline);stored.close();baseline.close();result.image.close();return {pngMatchesBaseline:expected.every((v,i)=>v===after[i]),cachedMatchesSaved:after.every((v,i)=>v===cached[i]),differences:[...before].map((v,i)=>v===after[i]?null:{index:i,before:v,baseline:expected[i],after:after[i],cached:cached[i]}).filter(Boolean).slice(0,12)};}finally{encoder.dispose()}
};
window.cacheBudgetQA=async()=>{
 const engine=new Compositor({imageBudget:2*256*256*4}),assets=[];
 for(let i=0;i<6;i++){const c=document.createElement('canvas');c.width=c.height=256;const ctx=c.getContext('2d');ctx.fillStyle=`rgb(${i*30},10,20)`;ctx.fillRect(0,0,256,256);assets.push({dataUrl:c.toDataURL()});await engine.image(assets.at(-1));}
 const result={bytes:engine.images.bytes,count:engine.images.size,evictions:engine.images.evictions};
 const image=await engine.image(assets[0]);result.reloaded=image.naturalWidth===256;engine.dispose();result.released=engine.images.bytes===0;return result;
};
