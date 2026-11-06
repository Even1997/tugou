import {Compositor} from '../renderer/composite.js';
import {createLayer} from '../core/layers.cjs';
import {retouchCopy} from '../core/retouch-copy.cjs';
import {defaults,adjustPixels} from '../core/adjustments.cjs';
import './retouch-engine-entry.js';
import {createRetouchStroke} from '../renderer/retouch.js';
import {surface} from '../renderer/selection.js';
window.photoQA={Compositor};
window.photoQA.verify=async()=>{
  const checks=[],check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name);},engine=new Compositor();
  const source=surface(64,48),ctx=source.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,32,48);ctx.fillStyle='#00ff00';ctx.fillRect(32,0,32,48);
  const original=createLayer('image',{id:'original',name:'原图',x:0,y:0,width:64,height:48,opacity:.65,bitmap:{dataUrl:source.toDataURL()},mask:{x:0,y:0,width:1,height:.8}});
  const doc={name:'像素验收',width:64,height:48,background:'transparent',assets:[],layers:[original]};
  const render=async d=>{const c=surface(64,48);await engine.render(d,c);return c;};
  const pixels=c=>[...c.getContext('2d').getImageData(0,0,64,48).data];
  try{
    const result=retouchCopy(doc.layers,original.id),copyDoc={...doc,layers:result.layers},before=await render(doc),after=await render(copyDoc);
    check('in-place retouch copy preserves translucent mask composition exactly',JSON.stringify(pixels(before))===JSON.stringify(pixels(after)));
    const clipped=createLayer('shape',{shape:'rect',color:'#4060a0',x:0,y:0,width:40,height:48,clipping:true}),clipDoc={...doc,layers:[original,clipped]};
    check('retouch copy preserves the following clipping chain',JSON.stringify(pixels(await render(clipDoc)))===JSON.stringify(pixels(await render({...clipDoc,layers:retouchCopy(clipDoc.layers,original.id).layers}))));
    const copy=copyDoc.layers.find(l=>l.id===result.id),stroke=await createRetouchStroke(copyDoc,copy,engine,{tool:'clone',size:12,opacity:100,hardness:100,smoothing:0,pressure:false,aligned:false,source:{u:.25,v:.5}});
    try{await stroke.add({x:48,y:24});check('retouch writes clone pixels on copy',stroke.canvas.getContext('2d').getImageData(48,24,1,1).data[0]===255);const bitmap={dataUrl:stroke.canvas.toDataURL()};copyDoc.layers=copyDoc.layers.map(l=>l.id===copy.id?{...l,bitmap}:l);}finally{stroke.dispose();}
    check('retouch copy leaves original image pixels intact',JSON.stringify(pixels(await render(doc)))===JSON.stringify(pixels(before)));
    const back=createLayer('shape',{shape:'rect',x:0,y:0,width:64,height:48,fill:true,color:'#204080'}),front=createLayer('shape',{shape:'rect',x:0,y:0,width:48,height:48,fill:true,color:'#608090'}),adjust=createLayer('adjustment',{x:0,y:0,width:64,height:48,clipping:true,mask:{x:0,y:0,width:.5,height:1},adjustment:{...defaults('photo'),exposure:1}});
    const toned={...doc,layers:[back,front,adjust]},out=await render(toned),pixel=(x,y)=>[...out.getContext('2d').getImageData(x,y,1,1).data];
    check('photo adjustment respects clip base and selection-derived mask',pixel(10,10)[0]===192&&pixel(40,10)[0]===96&&pixel(55,10)[0]===32);
    const start=performance.now(),png=await engine.export(toned);const image=await engine.image({dataUrl:'data:image/png;base64,'+btoa(String.fromCharCode(...png))}),saved=surface(64,48);saved.getContext('2d').drawImage(image,0,0);
    check('photo preview and exported PNG match',JSON.stringify(pixels(saved))===JSON.stringify(pixels(out)));
    const exportMs=performance.now()-start;
    const data=new Uint8ClampedArray(2048*2048*4);for(let i=0;i<data.length;i+=4)data.set([80,120,160,255],i);
    const timing=performance.now();adjustPixels(data,2048,{...defaults('photo'),temperature:25,shadows:40,vibrance:25});const photo4MPMs=performance.now()-timing;
    check('4 MP photo adjustment completes within interactive preview budget',photo4MPMs<500);
    return {checks,exportMs,photo4MPMs};
  }finally{engine.dispose();}
};
