import {Compositor} from './composite.js';
import {surface,pngBytes,selectionCanvas,alphaOf,alphaCanvas,calculateSelection} from './selection.js';
import {fillImageSelection} from './content-fill.js';
import {createRetouchStroke} from './retouch.js';
import {maskSelection} from './mask-view.js';
import {createLayer,cropToSelection,localPoint,bounds} from '../core/layers.cjs';
import * as boards from '../core/artboards.cjs';
import {defaults as adjustmentDefaults,validateAdjustment} from '../core/adjustments.cjs';
import {timeline} from '../core/gif-timeline.cjs';
import {sceneNode,appendCapture} from '../core/automation-scene.cjs';
import {renderScene} from './scene-render.js';

const jobs=new Map();
export function cancelAutomationJob(id){const job=jobs.get(id);if(!job)return false;job.controller.abort();return true;}
export function automationJobStatus(id){return jobs.get(id)?.status||null;}
const fail=message=>{throw Error(message);};
const budget=(w,h,count=1,max=16000000)=>{if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>30000||h>30000||w*h*count>max)fail('处理尺寸超出内存预算，请减少像素或帧数');};

export async function runEditingJob({taskId,command,input:a},source,commit,guard){
  const controller=new AbortController(),signal=controller.signal,job={controller,status:{progress:0,message:'准备处理'}};jobs.set(taskId,job);
  const progress=(value,message='正在处理')=>{job.status={progress:value,message};};
  const check=()=>{signal.throwIfAborted();guard();};
  const save=async(canvas,name)=>{check();const bytes=await pngBytes(canvas);check();return window.tugou.storeRaster(bytes,name);};
  const apply=(doc,result={})=>{check();const state=commit(doc);return {...result,revision:state.revision};};
  let engine,canvas,temporary;
  try{
    check();
    if(command==='gif.create'){
      budget(a.width,a.height,a.frames.length,64*1024*1024);
      const frames=a.frames.map(f=>{const asset=source.assets.find(v=>v.id===f.assetId);if(!asset?.resource||asset.kind&&asset.kind!=='image')fail('请选择有效的图片素材');return asset.resource;});
      progress(.2,'正在编码 GIF');const bytes=await window.tugou.encodeGif(frames,{width:a.width,height:a.height,delays:a.frames.map(f=>f.delay),loop:a.loop??0});check();
      const asset=await window.tugou.storeRaster(bytes,a.name||'GIF 动图');return apply({...source,assets:[...source.assets,asset]},{assetId:asset.id});
    }
    if(command==='scene.captureAngles'||command==='scene.record'){
      const scene=sceneNode(source,a.nodeId).data.scene;let next=source;const ids=[],nodeIds=[];
      const append=asset=>{const result=appendCapture(next,a.nodeId,asset);next=result.document;ids.push(asset.id);nodeIds.push(result.nodeId);};
      if(command==='scene.record'){
        const result=await renderScene(scene,source.assets,{...a,record:true,signal,progress});check();
        if(!result.bytes?.length)fail('视频字节为空');append(await window.tugou.storeMedia([...result.bytes],'机位动画.'+result.extension));
      }else{
        const original=scene.cameras.find(c=>c.id===scene.activeCamera),[x,y,z]=original.position,[tx,ty,tz]=original.target;
        const radius=Math.hypot(x-tx,y-ty,z-tz);
        for(let i=0;i<a.count;i++){
          check();const angle=i/a.count*Math.PI*2,camera={...original,position:[tx+Math.sin(angle)*radius,y,tz+Math.cos(angle)*radius]};
          const result=await renderScene({...scene,cameras:scene.cameras.map(c=>c.id===camera.id?camera:c)},source.assets,{...a,signal});check();
          append(await window.tugou.storeRaster(Uint8Array.from(atob(result.data),c=>c.charCodeAt(0)),`方位 ${i+1}`));progress((i+1)/a.count,'正在拍摄方位');
        }
      }
      Object.assign(sceneNode(next,a.nodeId).data,{outputAssetIds:ids,outputAssetId:ids[0]});return apply(next,{assetIds:ids,nodeIds});
    }
    const normalized=boards.normalize(source),boardId=a.artboardId||boards.owner(normalized,a.id)?.id;
    if(!boards.boards(normalized).some(b=>b.id===boardId))fail('画板不存在');
    const doc=boards.extract(normalized,boardId),layer=doc.layers.find(l=>l.id===a.id);budget(doc.width,doc.height);
    if(a.id&&!layer)fail('图层不属于此画板');
    for(const asset of [layer?.bitmap,layer?.mask?.bitmap,doc.assets.find(v=>v.id===layer?.assetId)])if(asset)budget(asset.width,asset.height);
    for(const l of doc.layers)for(const ref of [l.bitmap,l.mask?.bitmap,doc.assets.find(v=>v.id===l.assetId)])if(ref)budget(ref.width,ref.height);
    engine=new Compositor();
    const applyLocal=(next,result)=>apply(boards.replace(normalized,boardId,next),result);
    const replaceLayer=(patch,result)=>applyLocal({...doc,layers:doc.layers.map(l=>l.id===layer.id?{...l,...patch}:l)},result);
    if(command==='artboard.exportAnimation'){
      const frames=timeline(doc);let selected;
      if(a.format==='png'){
        if(a.startFrame!==undefined||a.endFrame!==undefined)fail('PNG 请选择单帧 frame');
        selected=[frames[(a.frame||1)-1]];
      }else{
        if(a.frame!==undefined)fail('GIF 请选择 startFrame 和 endFrame');
        const start=a.startFrame||1,end=a.endFrame||frames.length;
        if(start>end||end>frames.length)fail('帧范围超出时间轴');selected=frames.slice(start-1,end);
      }
      if(!selected.length||selected.some(f=>!f))fail('帧号超出时间轴');
      budget(doc.width,doc.height,selected.length,64*1024*1024);
      if(a.format==='gif'&&(doc.width>4096||doc.height>4096))fail('GIF 单边不能超过 4096 像素');
      const images=[];for(let i=0;i<selected.length;i++){
        check();images.push(await engine.export(doc,{signal,time:selected[i].time,progress:v=>progress((i+v)/selected.length*.8,'渲染导出帧')}));
      }
      check();progress(.85,'编码导出文件');const bytes=a.format==='gif'?await window.tugou.encodeGif(images,{width:doc.width,height:doc.height,delays:selected.map(f=>f.delay),loop:a.loop??0}):images[0];
      check();const resource=await window.tugou.storeRaster(bytes,'MCP 导出');check();return {...resource,frameCount:selected.length,revision:undefined};
    }
    if(command==='paint.create'){
      canvas=surface(doc.width,doc.height);const asset=await save(canvas,a.name||'绘画图层');
      const added=createLayer('image',{name:a.name||'绘画图层',assetId:asset.id,width:doc.width,height:doc.height,x:0,y:0});
      return applyLocal({...doc,assets:[...doc.assets,asset],layers:[...doc.layers,added]},{id:added.id,assetId:asset.id});
    }
    if(command==='image.contentFill'){
      const result=await fillImageSelection(doc,layer,engine,signal,v=>progress(v,'内容识别填充'));canvas=result.canvas;
      return replaceLayer({bitmap:await save(canvas,'内容识别填充')},{id:layer.id});
    }
    if(command==='paint.retouch'){
      let length=0;for(let i=1;i<a.points.length;i++)length+=Math.hypot(a.points[i].x-a.points[i-1].x,a.points[i].y-a.points[i-1].y);
      if(length>20000)fail('单次笔画过长，请拆分笔画');
      const stroke=await createRetouchStroke(doc,layer,engine,{opacity:100,hardness:80,smoothing:0,blurRadius:5,...a});
      const abort=()=>stroke.dispose();signal.addEventListener('abort',abort,{once:true});
      try{for(let i=0;i<a.points.length;i++){check();await stroke.add({...a.points[i],pointerType:a.pressure?'pen':'mouse'});progress((i+1)/a.points.length,'处理修图笔画');}check();return replaceLayer({bitmap:await save(stroke.render(),'修图笔画')},{id:layer.id});}
      finally{signal.removeEventListener('abort',abort);stroke.dispose();}
    }
    if(command==='mask.relink'){
      if(!layer.mask?.anchor)fail('请先选择解除链接的蒙版');
      const box=bounds(doc.layers,[layer.id]),padding=Math.ceil((layer.mask.feather||0)*4)+2;
      const x=Math.floor(box.x)-padding,y=Math.floor(box.y)-padding,width=Math.ceil(box.x+box.width)-x+padding,height=Math.ceil(box.y+box.height)-y+padding;
      budget(width,height);
      temporary=await maskSelection(doc,layer,engine,{width,height,scale:1,transform:[1,0,0,1,-x,-y]});
      budget(Math.ceil(layer.width),Math.ceil(layer.height));canvas=surface(Math.ceil(layer.width),Math.ceil(layer.height));
      const warp=[[x,y],[x+width,y],[x+width,y+height],[x,y+height]].flatMap(([x,y])=>{const p=localPoint(doc.layers,layer,x,y);return [p.x/layer.width,p.y/layer.height];});
      engine.geometry(canvas.getContext('2d'),temporary,{width:canvas.width,height:canvas.height,warp},[1,0,0,1,0,0]);
      return replaceLayer({mask:{bitmap:await save(canvas,'重新链接蒙版'),disabled:layer.mask.disabled}},{id:layer.id});
    }
    if(command==='selection.color'){
      if(a.x>=doc.width||a.y>=doc.height)fail('采样位置超出画板');
      if(layer)canvas=await engine.node(layer,doc,{width:doc.width,height:doc.height,scale:1,transform:[1,0,0,1,0,0],signal});
      else{canvas=surface(doc.width,doc.height);await engine.render(doc,canvas,{transparent:true,signal});}
      temporary=doc.selection?await selectionCanvas(doc,engine):null;
      const alpha=await calculateSelection({rgba:canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data,width:doc.width,height:doc.height,x:a.x,y:a.y,tolerance:a.tolerance??32,contiguous:a.contiguous??true,operation:a.operation||'replace',base:temporary?alphaOf(temporary):undefined},signal);
      canvas.width=canvas.height=1;canvas=alphaCanvas(alpha,doc.width,doc.height);
      return applyLocal({...doc,selection:{bitmap:await save(canvas,'色彩选区')}});
    }
    if(!doc.selection)fail('请先创建选区');
    canvas=await selectionCanvas(doc,engine);check();
    if(command==='selection.grow'){
      const alpha=await calculateSelection({alpha:alphaOf(canvas),width:doc.width,height:doc.height,radius:a.radius},signal);canvas.width=canvas.height=1;canvas=alphaCanvas(alpha,doc.width,doc.height);
      return applyLocal({...doc,selection:{bitmap:await save(canvas,'扩展收缩选区')}});
    }
    if(command==='layer.adjustmentFromSelection'){
      const adjustment={...adjustmentDefaults(a.adjustment.type),...a.adjustment};validateAdjustment(adjustment);
      const added=createLayer('adjustment',{name:a.name||'选区调整',x:0,y:0,width:doc.width,height:doc.height,adjustment,mask:{bitmap:await save(canvas,'调整蒙版'),anchor:{matrix:[1,0,0,1,0,0],width:doc.width,height:doc.height}}});
      return applyLocal({...doc,layers:[...doc.layers,added]},{id:added.id});
    }
    if(command==='artboard.cropSelection'){
      const alpha=alphaOf(canvas);let x=doc.width,y=doc.height,r=0,b=0;
      for(let i=0;i<alpha.length;i++)if(alpha[i]){const px=i%doc.width,py=Math.floor(i/doc.width);x=Math.min(x,px);y=Math.min(y,py);r=Math.max(r,px+1);b=Math.max(b,py+1);}
      if(r<=x||b<=y)fail('选区为空');return applyLocal(cropToSelection({...doc,selection:{paths:[{operation:'add',points:[x,y,r,y,r,b,x,b]}]}}));
    }
    fail('未接入此处理命令');
  }finally{if(canvas)canvas.width=canvas.height=1;if(temporary)temporary.width=temporary.height=1;engine?.dispose();jobs.delete(taskId);}
}
