import {Compositor} from '../renderer/composite.js';
import {createStroke} from '../renderer/painting.js';
import {pngBytes,surface} from '../renderer/selection.js';
import {createLayer} from '../core/layers.cjs';
window.paintBudgetBench=async(encoder)=>{
  const size=2048,source=surface(size,size),ctx=source.getContext('2d'),data=ctx.createImageData(size,size);
  let seed=421;for(let i=0;i<data.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;data.data[i]=seed&255;data.data[i+1]=(seed>>>8)&255;data.data[i+2]=(seed>>>16)&255;data.data[i+3]=255;}ctx.putImageData(data,0,0);
  const asset=await tugou.storeRaster(await pngBytes(source),'基准图片'),engine=new Compositor(),doc={width:size,height:size,assets:[],layers:[createLayer('image',{id:'bench',width:size,height:size,bitmap:asset})]},times=[],gaps=[];let last=performance.now();const timer=setInterval(()=>{const n=performance.now();gaps.push(n-last);last=n},8);
  try{for(let n=0;n<8;n++){
    const start=performance.now(),stroke=await createStroke(doc,doc.layers[0],engine,{target:'image',size:40,opacity:70,hardness:80,smoothing:0,color:'#ff0000'});
    stroke.add({x:100,y:100+n*100});stroke.add({x:1200,y:100+n*100});stroke.render();
    const encoded=encoder?await encoder.encode(stroke.canvas):{bytes:await pngBytes(stroke.canvas)};
    const bitmap=await tugou.storeRaster(encoded.bytes,'基准笔画');if(encoded.image)engine.prime(bitmap,encoded.image);
    doc.layers=[{...doc.layers[0],bitmap}];await engine.image(bitmap);times.push(performance.now()-start);stroke.dispose();
  }
  const final=await engine.image(doc.layers[0].bitmap);ctx.clearRect(0,0,size,size);ctx.drawImage(final,0,0);const digest=await crypto.subtle.digest('SHA-256',ctx.getImageData(0,0,size,size).data);
  return {size,strokes:8,times,medianMs:[...times].sort((a,b)=>a-b).slice(3,5).reduce((a,b)=>a+b)/2,maxEventGapMs:Math.max(...gaps),pixelHash:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')};
  }finally{clearInterval(timer);source.width=source.height=1;engine.dispose();}
};
