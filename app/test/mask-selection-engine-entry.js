import {fillMaskSelection,paintGeometry} from '../renderer/paint-target.js';
import {createStroke} from '../renderer/painting.js';
import {Compositor} from '../renderer/composite.js';
import {createLayer} from '../core/layers.cjs';
import {surface} from '../renderer/selection.js';
import './paint-engine-entry.js';
import './paint-detail-engine-entry.js';
window.maskSelectionQA=async()=>{
  const checks=[],check=(n,v)=>{if(!v)throw Error(n);checks.push(n)},engine=new Compositor();
  const pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
  const image=surface(64,64);image.getContext('2d').fillStyle='#0055ff';image.getContext('2d').fillRect(0,0,64,64);
  for(const variant of [{},{rotation:25,scaleX:1.2,scaleY:.8},{warp:[0,0,1,.1,.9,1,.1,.9]},{mask:{x:0,y:0,width:1,height:1,offset:{x:6,y:5,rotation:15,scale:1}}},{mask:{x:0,y:0,width:1,height:1,inverted:true}}]){
    const layer=createLayer('image',{id:'image',x:90,y:90,width:64,height:64,bitmap:{dataUrl:image.toDataURL()},...variant}),geometry=paintGeometry([layer],layer,true);
    const points=[[.25,.25],[.75,.25],[.75,.75],[.25,.75]].flatMap(([u,v])=>{const p=geometry.world(u,v);return [p.x,p.y]});
    const doc={width:300,height:300,background:'transparent',assets:[],layers:[layer],selection:{paths:[{operation:'add',points}]}},before=JSON.stringify(doc),inverted=Boolean(layer.mask?.inverted);
    const mode=inverted?'reveal':'hide',filled=await fillMaskSelection(doc,layer,engine,mode);
    check('selection fill affects center only '+checks.length,pixel(filled.canvas,32,32)[3]===0&&pixel(filled.canvas,5,5)[3]===255);
    const changed={...layer,mask:{...filled.mask,bitmap:{dataUrl:filled.canvas.toDataURL()}}};filled.canvas.width=filled.canvas.height=1;
    const restored=await fillMaskSelection({...doc,layers:[changed]},changed,engine,inverted?'hide':'reveal');
    check('opposite color restores raw mask '+checks.length,pixel(restored.canvas,32,32).every(n=>n===255));restored.canvas.width=restored.canvas.height=1;
    const stroke=await createStroke(doc,layer,engine,{target:'mask',maskMode:mode,size:100,opacity:100,hardness:100,smoothing:0,pressure:false});const p=geometry.world(.5,.5);stroke.add(p);stroke.render();
    check('mask brush uses identical selection coordinates '+checks.length,pixel(stroke.canvas,32,32)[3]===0&&pixel(stroke.canvas,5,5)[3]===255);stroke.dispose();
    check('source document and original pixels unchanged '+checks.length,JSON.stringify(doc)===before&&pixel(image,32,32)[3]===255);
  }
  const layer=createLayer('image',{x:0,y:0,width:64,height:64,bitmap:{dataUrl:image.toDataURL()}}),doc={width:64,height:64,assets:[],layers:[layer],selection:{paths:[{operation:'add',points:[16,16,48,16,48,48,16,48]}],feather:4}};
  const soft=await fillMaskSelection(doc,layer,engine,'hide');check('feathered selection preserves soft transition',pixel(soft.canvas,16,32)[3]>0&&pixel(soft.canvas,16,32)[3]<255);soft.canvas.width=soft.canvas.height=1;
  for(const [name,source,target] of [['missing selection',{...doc,selection:undefined},layer],['locked layer',doc,{...layer,locked:true}],['disabled mask',doc,{...layer,mask:{disabled:true}}]]){let rejected=false;try{await fillMaskSelection(source,target,engine,'hide')}catch{rejected=true}check(name+' rejected',rejected)}
  checks.push(...(await window.paintQA.verify()).checks,...(await window.detailQA.verify()).checks);
  engine.dispose();image.width=image.height=1;return checks;
};
