import {Compositor} from '../renderer/composite.js';
import {createLayer} from '../core/layers.cjs';
window.maskOverlayQA=async()=>{
  const engine=new Compositor(),checks=[],check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name)},pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
  const image=document.createElement('canvas');image.width=image.height=80;const ink=image.getContext('2d');ink.fillStyle='#204080';ink.fillRect(10,10,60,60);ink.clearRect(10,10,10,10);ink.fillStyle='#20408080';ink.fillRect(10,10,10,10);
  const layer=createLayer('image',{id:'image',x:20,y:20,width:80,height:80,bitmap:{dataUrl:image.toDataURL()},mask:{x:.5,y:0,width:.5,height:1}}),doc={width:120,height:120,background:'transparent',assets:[],layers:[layer]},before=JSON.stringify(doc);
  const render=async(mode,document=doc,extra={})=>{const c=window.document.createElement('canvas');await engine.render(document,c,{...(mode?{maskPreview:{id:layer.id,mode}}:{}),...extra});return c};
  const normal=await render(),original=await render('original'),overlay=await render('overlay');
  check('normal output retains mask hiding',pixel(normal,45,45)[3]===0&&pixel(normal,75,45).join()=== '32,64,128,255');
  check('original preview reveals masked source',pixel(original,45,45).join()==='32,64,128,255');
  check('overlay tints hidden pixels red and preserves visible pixels',pixel(overlay,45,45)[0]>140&&pixel(overlay,75,45).join()===pixel(original,75,45).join());
  check('overlay preserves transparent and partial source alpha',pixel(overlay,25,25)[3]===0&&pixel(overlay,35,35)[3]===pixel(original,35,35)[3]);
  const disabled=await render('overlay',{...doc,layers:[{...layer,mask:{...layer.mask,disabled:true}}]});check('disabled mask remains inspectable',pixel(disabled,45,45).join()===pixel(overlay,45,45).join());
  const inverted=await render('overlay',{...doc,layers:[{...layer,mask:{...layer.mask,inverted:true}}]});check('inversion swaps overlay region',pixel(inverted,75,45)[0]>140&&pixel(inverted,45,45)[0]===32);
  const soft=await render('overlay',{...doc,layers:[{...layer,mask:{...layer.mask,density:50,feather:2}}]});check('density and feather create graded overlay',pixel(soft,45,45)[0]>32&&pixel(soft,45,45)[0]<pixel(overlay,45,45)[0]);
  const zoom=await render('overlay',doc,{scale:2,x:10,y:5});check('overlay follows viewport transform',pixel(zoom,70,80).join()===pixel(overlay,45,45).join());
  const board=createLayer('group',{id:'board',artboard:true,x:0,y:0,width:60,height:100,background:'transparent'}),clipped=await render('overlay',{...doc,layers:[board,{...layer,parentId:'board'}]});check('overlay respects artboard clipping',pixel(clipped,75,45)[3]===0&&pixel(clipped,45,45)[0]>140);
  const live=document.createElement('canvas');live.width=live.height=80;live.getContext('2d').fillRect(0,0,80,80);const painted=await render('overlay',doc,{maskOverrides:new Map([[layer.id,live]])});check('live mask stroke overrides update overlay',pixel(painted,45,45)[0]===32);
  const exported=await render();check('preview never mutates document or subsequent export',JSON.stringify(doc)===before&&exported.toDataURL()===normal.toDataURL());
  window.maskOverlayPerformance={};
  for(const mode of ['composite','overlay']){const samples=[];for(let i=0;i<20;i++){const start=performance.now(),c=await render(mode==='composite'?null:mode,doc,{width:150,height:100,scale:8});if(i>=5)samples.push(performance.now()-start);c.width=c.height=1;}samples.sort((a,b)=>a-b);window.maskOverlayPerformance[mode]={viewport:'1200x800',samples:15,medianMs:samples[7],p95Ms:samples[14]};}
  for(const c of [normal,original,overlay,disabled,inverted,soft,zoom,clipped,live,painted,exported,image])c.width=c.height=1;engine.dispose();return checks;
};
