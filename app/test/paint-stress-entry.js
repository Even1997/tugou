import {Compositor} from '../renderer/composite.js';
import {RasterEncoder} from '../renderer/raster-encoder.js';
import {createStroke} from '../renderer/painting.js';
import {surface,pngBytes} from '../renderer/selection.js';
import {createLayer} from '../core/layers.cjs';

window.paintStress=async({width,height,count})=>{
  const source=surface(width,height),ctx=source.getContext('2d');
  ctx.fillStyle='#315cf5';ctx.fillRect(0,0,width,height);
  const gradient=ctx.createLinearGradient(0,0,width,height);gradient.addColorStop(0,'#315cf5');gradient.addColorStop(1,'#c6d1ff');ctx.fillStyle=gradient;ctx.fillRect(0,0,width,height);
  const asset=await tugou.storeRaster(await pngBytes(source),'大图压力底图'),engine=new Compositor(),encoder=new RasterEncoder(),doc={width,height,assets:[],layers:[createLayer('image',{id:'image',x:0,y:0,width,height,bitmap:asset})]},samples=[];
  source.width=source.height=1;
  const position=i=>({x:80+(i%10)*350,y:80+Math.floor(i/10)*32});
  try{
    for(let i=0;i<count;i++){
      const started=performance.now(),stroke=await createStroke(doc,doc.layers[0],engine,{target:'image',size:20,opacity:100,hardness:100,smoothing:0,color:'#ff0000'}),created=performance.now();
      const {x,y}=position(i);await stroke.add({x,y});await stroke.add({x:x+160,y});stroke.render();const drawn=performance.now();
      const result=await encoder.encode(stroke.canvas),encoded=performance.now(),bitmap=await tugou.storeRaster(result.bytes,'大图压力笔画');engine.prime(bitmap,result.image);doc.layers=[{...doc.layers[0],bitmap}];stroke.dispose();
      samples.push({createMs:created-started,drawMs:drawn-created,encodeMs:encoded-drawn,totalMs:performance.now()-started,cacheBytes:engine.images.bytes});
      window.__stressProgress={width,height,completed:i+1,count};
    }
    const last=await engine.image(doc.layers[0].bitmap),probe=surface(1,1),p=probe.getContext('2d'),colors=[];
    for(let i=0;i<count;i++){const {x,y}=position(i);p.clearRect(0,0,1,1);p.drawImage(last,x+80,y,1,1,0,0,1,1);colors.push([...p.getImageData(0,0,1,1).data]);}
    probe.width=probe.height=1;
    return {width,height,count,samples,allStrokesPresent:colors.every(c=>c[0]===255&&c[1]===0&&c[2]===0&&c[3]===255),maxCacheBytes:Math.max(...samples.map(s=>s.cacheBytes)),evictions:engine.images.evictions,final:doc.layers[0].bitmap};
  }finally{engine.dispose();encoder.dispose();}
};
