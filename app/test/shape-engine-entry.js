import {Compositor} from '../renderer/composite.js';
import {createLayer} from '../core/layers.cjs';
import {surface} from '../renderer/selection.js';
import {defaults as adjustment} from '../core/adjustments.cjs';
window.shapeQA={verify:async()=>{
  const checks=[],check=(name,ok)=>{if(!ok)throw Error(name);checks.push(name)},pixel=(c,x,y)=>[...c.getContext('2d').getImageData(x,y,1,1).data];
  const engine=new Compositor(),before=new window.BeforeComposite.Compositor(),out=surface(1,1),old=surface(1,1);
  const shape=extra=>createLayer('shape',{x:20,y:20,width:200,height:200,color:'#ff0000',...extra});
  const doc=layers=>({width:256,height:256,background:'transparent',assets:[],layers});
  for(const type of ['rect','rounded','ellipse','triangle','diamond','star']){
    const source=doc([shape({shape:type,radius:type==='rounded'?35:0})]);
    await engine.render(source,out);check(type+' renders opaque center',pixel(out,120,120)[3]===255);
    if(type!=='rect')check(type+' preserves transparent exterior corner',pixel(out,21,21)[3]===0);
    const png=await engine.export(source,{transparent:true}),bitmap=await createImageBitmap(new Blob([png],{type:'image/png'})),exported=surface(256,256);
    exported.getContext('2d').drawImage(bitmap,0,0);check(type+' export matches preview pixels',out.toDataURL()===exported.toDataURL());bitmap.close();exported.width=exported.height=1;
  }
  await engine.render(doc([shape({shape:'triangle',fill:false,stroke:'#0000ff',strokeWidth:8})]),out);
  check('unfilled triangle has transparent center and blue stroke',pixel(out,120,120)[3]===0&&pixel(out,120,218)[2]===255);
  const same=async(name,source)=>{await before.render(source,old);await engine.render(source,out);check(name,out.toDataURL()===old.toDataURL())};
  await same('offscreen clipping base keeps visible clipped shape transparent',doc([shape({x:400,shape:'rect'}),shape({shape:'rect',clipping:true})]));
  await same('offscreen mask source clears target as before',doc([shape({id:'mask',x:400,shape:'rect'}),shape({shape:'rect',maskSourceId:'mask'})]));
  await same('clipped adjustment on offscreen base matches original pixels',doc([shape({shape:'rect'}),shape({x:400,shape:'rect'}),createLayer('adjustment',{clipping:true,adjustment:adjustment('invert')})]));
  await same('feathered mask and blend match original pixels',doc([shape({shape:'ellipse',color:'#0000ff'}),shape({shape:'rect',opacity:.6,blend:'multiply',mask:{x:0,y:0,width:.5,height:1,feather:4}})]));
  const board=createLayer('group',{id:'outside',artboard:true,x:-500,y:0,width:200,height:200,background:'#ffffff',clipContent:false});
  const overflow={...doc([board,shape({parentId:board.id,x:520,y:20,shape:'rect'})]),infiniteWorkspace:true};
  await engine.render(overflow,out);check('unclipped offscreen board retains visible overflowing child',pixel(out,30,30)[0]===255&&pixel(out,30,30)[3]===255);
  const blank={...doc([createLayer('group',{...board,id:'empty',x:0})]),infiniteWorkspace:true};await engine.render(blank,out);check('unclipped empty board retains its background',pixel(out,30,30)[3]===255);
  // Measure allocation volume, not RSS: canvas surfaces are short-lived and GC timing varies.
  const many={...doc([shape({shape:'rect'}),...Array.from({length:120},(_,i)=>shape({shape:'rect',x:3000+i*250}))]),width:1200,height:800};
  const measure=async compositor=>{
    const descriptor=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'height');let pixels=0;
    Object.defineProperty(HTMLCanvasElement.prototype,'height',{...descriptor,set(value){descriptor.set.call(this,value);if(this.width>1&&this.height>1)pixels+=this.width*this.height;}});
    const times=[];try{for(let i=0;i<5;i++){const start=performance.now();await compositor.render(many,out);times.push(performance.now()-start);}}finally{Object.defineProperty(HTMLCanvasElement.prototype,'height',descriptor);}
    return {medianMs:times.sort((a,b)=>a-b)[2],allocatedPixelsPerFrame:pixels/5};
  };
  await before.render(many,old);await engine.render(many,out);check('120 offscreen layers keep exact output pixels',old.toDataURL()===out.toDataURL());
  const baseline=await measure(before),optimized=await measure(engine);
  check('offscreen temporary allocation drops over 90 percent',optimized.allocatedPixelsPerFrame<baseline.allocatedPixelsPerFrame*.1);
  engine.dispose();before.dispose();old.width=old.height=out.width=out.height=1;
  return {checks,performance:{layers:121,viewport:[1200,800],baseline,optimized}};
}};
