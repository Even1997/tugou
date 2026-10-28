import './mask-selection-engine-entry.js';
import {maskSelection,maskView} from '../renderer/mask-view.js';
import {Compositor} from '../renderer/composite.js';
import {createLayer} from '../core/layers.cjs';
window.maskViewQA=async()=>{
  const engine=new Compositor(),layer=createLayer('image',{x:10,y:10,width:40,height:40,mask:{x:.25,y:.25,width:.5,height:.5,disabled:true}}),doc={width:64,height:64,layers:[layer],assets:[]},before=JSON.stringify(doc),checks=[];
  const check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name)};
  const alpha=await maskSelection(doc,layer,engine),view=await maskView(doc,layer,engine);
  const pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
  check('disabled mask can be inspected and loaded without enabling it',pixel(alpha,30,30)[3]===255&&pixel(alpha,12,12)[3]===0&&JSON.stringify(doc)===before);
  check('mask alone uses opaque white and black',pixel(view,30,30).join(',')==='255,255,255,255'&&pixel(view,12,12).join(',')==='0,0,0,255');
  const inverted=await maskSelection(doc,{...layer,mask:{...layer.mask,inverted:true}},engine);check('loading inverted mask respects effective alpha',pixel(inverted,30,30)[3]===0&&pixel(inverted,12,12)[3]===255);
  const zoomed=await maskView(doc,layer,engine,{width:120,height:120,scale:2,transform:[2,0,0,2,10,5]});check('mask view respects viewport zoom and translation',pixel(zoomed,70,65)[0]===255&&pixel(zoomed,34,29)[0]===0);
  const soft=await maskSelection(doc,{...layer,mask:{...layer.mask,density:50}},engine);check('loading mask retains density as partial selection',Math.abs(pixel(soft,12,12)[3]-128)<=1&&pixel(soft,30,30)[3]===255);
  for(const c of [alpha,view,inverted,zoomed,soft])c.width=c.height=1;engine.dispose();return checks;
};
