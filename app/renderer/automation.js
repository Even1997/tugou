import {useEffect,useRef} from 'react';
import {Compositor} from './composite.js';
import {surface,pngBytes,selectionCanvas} from './selection.js';
import {fillMaskSelection,fillPixelsSelection} from './paint-target.js';
import {mergePlan,mergedDocument} from '../core/merge-layers.cjs';
import {maskSelection,maskView} from './mask-view.js';
import * as artboards from '../core/artboards.cjs';
import {worldMatrix} from '../core/layers.cjs';
import {createStroke} from './painting.js';
import {renderScene} from './scene-render.js';
import {sceneNode,appendCapture} from '../core/automation-scene.cjs';

function failure(code,message){const e=new Error(message);e.code=code;throw e;}
// Shares App's live document and history. Disk records are never used as an editing session.
export function useAutomation(context) {
  const latest=useRef(context),version=useRef({document:null,id:null,n:0,epoch:crypto.randomUUID()});
  latest.current=context;
  useEffect(()=>window.tugou.onAutomation?.(async request=>{
    const current=()=>latest.current;
    const revision=()=>{
      const r=current().present.current,v=version.current;
      if(v.document!==r?.document||v.id!==r?.id){v.document=r?.document;v.id=r?.id;v.n++;}
      return `${v.epoch}:${v.n}`;
    };
    const state=()=>{
      const c=current(),r=c.present.current;
      return {revision:revision(),projectId:r?.id||null,savedRevision:r?.revision,dirty:c.dirtyRef.current,busy:c.busyRef.current,
        workspace:c.workspace,layerSelection:c.layerSelection,history:{undo:c.history.current.past.length,redo:c.history.current.future.length},document:r?.document||null};
    };
    const guard=()=>{
      if(current().busyRef.current)failure('BUSY','界面正在处理操作，请稍后重试');
      if(request.expectedRevision!==revision())failure('CONFLICT','实时文档已变化，请重新读取状态后重试');
    };
    const commit=doc=>{guard();if(!current().change(doc))failure('BUSY','界面正在处理操作');return state();};
    try {
      let value;const {action,args={}}=request;
      if(action==='snapshot')value=state();
      else if(action==='models.changed'){window.dispatchEvent(new Event('tugou-connection-changed'));value={notified:true};}
      else if(action==='commit')value=commit(args.document);
      else if(action==='project.create'||action==='project.open'){
        guard();const c=current();if(c.dirtyRef.current)failure('UNSAVED_CHANGES','请先保存当前工程');
        c.busyRef.current=true;c.setBusy(true);
        try {
          const record=await (action==='project.create'?window.tugou.create(args.name):window.tugou.open(args.id));
          c.present.current=record;c.setRecord(record);c.history.current={past:[],future:[]};c.seenResults.current=new Set();
          c.setLayerSelection([]);c.resetPanels();c.markDirty(record.recovered===true);await c.refresh();
        }finally{c.busyRef.current=false;c.setBusy(false);}
        value=state();
      }else if(action==='project.save'){
        guard();const c=current(),r=c.present.current;if(!r)failure('NO_PROJECT','请先打开工程');
        c.busyRef.current=true;c.setBusy(true);
        try{const saved=await window.tugou.save(r.id,r.document,r.revision);c.present.current=saved;c.setRecord(saved);c.markDirty(false);await c.refresh();}
        finally{c.busyRef.current=false;c.setBusy(false);}
        value=state();
      }else if(action==='history.undo'||action==='history.redo'){
        guard();const c=current(),direction=action.split('.')[1];
        if(!c.history.current[direction==='undo'?'past':'future'].length)failure('EMPTY_HISTORY','没有可撤销或重做的操作');
        c.travel(direction);value=state();
      }else if(action==='workspace.show'){
        guard();const c=current();for(const id of args.layerIds||[])if(!c.present.current?.document.layers.some(l=>l.id===id))failure('NOT_FOUND','图层不存在');
        c.setWorkspace(args.workspace);if(args.layerIds)c.setLayerSelection(args.layerIds);value={workspace:args.workspace};
      }else if(action==='scene.preview'||action==='scene.capture'){
        if(action==='scene.capture')guard();
        const source=current().present.current?.document;if(!source)failure('NO_PROJECT','请先打开工程');
        const result=await renderScene(sceneNode(source,args.nodeId).data.scene,source.assets,args);
        if(current().present.current.document!==source)failure('CONFLICT','渲染过程中工程发生变化，请重试');
        if(action==='scene.preview')value={...result,revision:revision()};
        else{
          guard();const bytes=Uint8Array.from(atob(result.data),c=>c.charCodeAt(0));
          const asset=await window.tugou.storeRaster([...bytes],args.name||'导演台截图');
          const next=appendCapture(source,args.nodeId,asset);value={...commit(next.document),nodeId:next.nodeId,assetId:next.assetId};
        }
      }else if(['preview','artboard.export','mask.fill','image.fillSelection','layer.merge','mask.loadSelection','selection.rasterize','selection.subjectResult','paint.stroke'].includes(action)){
        if(action!=='preview')guard();
        const source=current().present.current?.document;if(!source)failure('NO_PROJECT','请先打开工程');
        const normalized=artboards.normalize(source),boardId=args.artboardId||artboards.owner(normalized,args.id||args.ids?.[0])?.id;
        const doc=artboards.extract(normalized,boardId),layer=doc.layers.find(l=>l.id===args.id);
        // Raster operations retain the existing renderer's bounded memory budget.
        if(doc.width*doc.height>16000000&&action!=='preview')failure('RESOURCE_LIMIT','MCP 像素操作限 1600 万像素，请缩小画板');
        const sourceBitmap=layer?.mask?.bitmap||layer?.bitmap||doc.assets.find(a=>a.id===layer?.assetId);
        if(sourceBitmap?.width*sourceBitmap?.height>16000000&&!['preview','paint.stroke','mask.fill'].includes(action))failure('RESOURCE_LIMIT','MCP 像素编辑的原图限 1600 万像素');
        const engine=new Compositor();let canvas;
        try{
          if(action==='layer.merge'){
            const plan=mergePlan(doc,args.ids);
            if(normalized.layers.find(l=>l.id===boardId)?.clipContent===false)failure('INVALID_TARGET','请先启用画板内容裁切再合并，避免丢失画板外内容');
            for(const l of plan.document.layers)for(const asset of [l.bitmap,doc.assets.find(a=>a.id===l.assetId),l.mask?.bitmap])if(asset?.width*asset?.height>16000000)failure('RESOURCE_LIMIT','合并源图片或蒙版限 1600 万像素');
            canvas=surface(1,1);await engine.render(plan.document,canvas,{transparent:true});
            guard();const asset=await window.tugou.storeRaster(await pngBytes(canvas),'合并图层');
            const merged=mergedDocument(doc,plan,asset);
            value={...commit(artboards.replace(normalized,boardId,merged.document)),id:merged.id};
          }else if(action==='image.fillSelection'){
            canvas=await fillPixelsSelection(doc,layer,engine,args);
            guard();const bitmap=await window.tugou.storeRaster(await pngBytes(canvas),'图片选区编辑');
            value=commit(artboards.replace(normalized,boardId,{...doc,layers:doc.layers.map(l=>l.id===args.id?{...l,bitmap}:l)}));
          }else if(action==='paint.stroke'){
            if(args.target==='mask'&&!layer?.mask)failure('INVALID_TARGET','请先添加蒙版');
            let length=0;for(let i=1;i<args.points.length;i++)length+=Math.hypot(args.points[i].x-args.points[i-1].x,args.points[i].y-args.points[i-1].y);
            if(length>20000)failure('RESOURCE_LIMIT','单次笔画过长，请拆分笔画');
            const stroke=await createStroke(doc,layer,engine,{target:args.target,maskMode:args.maskMode||'hide',color:args.color||'#000000',erase:args.erase||false,size:args.size,opacity:args.opacity??100,hardness:args.hardness??80,smoothing:0,pressure:false,maxPixels:16000000});
            try{
              for(const p of args.points)stroke.add(p);stroke.finish();stroke.render();
              const bitmap=await window.tugou.storeRaster(await pngBytes(stroke.canvas),'MCP 笔画');
              value=commit(artboards.replace(normalized,boardId,{...doc,layers:doc.layers.map(l=>l.id===args.id?{...l,...(stroke.mask?{mask:{...stroke.mask,bitmap}}:{bitmap})}:l)}));
            }finally{stroke.dispose();}
          }else if(action==='mask.fill'){
            const result=await fillMaskSelection(doc,layer,engine,args.mode,16000000);canvas=result.canvas;
            const bitmap=await window.tugou.storeRaster(await pngBytes(canvas),'MCP 蒙版');
            value=commit(artboards.replace(normalized,boardId,{...doc,layers:doc.layers.map(l=>l.id===args.id?{...l,mask:{...result.mask,bitmap}}:l)}));
          }else if(['mask.loadSelection','selection.rasterize','selection.subjectResult'].includes(action)){
            if(action==='selection.subjectResult'){
              canvas=surface(doc.width,doc.height);engine.geometry(canvas.getContext('2d'),await engine.image(args.result),layer,worldMatrix(doc.layers,layer));
            }else canvas=action==='mask.loadSelection'?await maskSelection(doc,layer,engine):await selectionCanvas(doc,engine);
            const bitmap=await window.tugou.storeRaster(await pngBytes(canvas),'MCP 选区');
            value=commit(artboards.replace(normalized,boardId,{...doc,selection:{bitmap}}));
          }else{
            const maxSize=args.maxSize||1024,scale=action==='artboard.export'?1:Math.min(1,maxSize/Math.max(doc.width,doc.height));
            if(args.mode&&args.mode!=='composite'&&!layer?.mask)failure('INVALID_TARGET','请指定该画板内已有蒙版的图层 id');
            if(args.mode==='mask')canvas=await maskView(doc,layer,engine,{width:Math.ceil(doc.width*scale),height:Math.ceil(doc.height*scale),scale,transform:[scale,0,0,scale,0,0]});
            else{canvas=surface(1,1);await engine.render(doc,canvas,{scale,...(['overlay','original'].includes(args.mode)?{maskPreview:{id:layer.id,mode:args.mode}}:{})});}
            if(current().present.current.document!==source)failure('CONFLICT','渲染过程中工程发生变化，请重新预览');
            const dataUrl=canvas.toDataURL('image/png');value={mimeType:'image/png',data:dataUrl.slice(dataUrl.indexOf(',')+1),width:canvas.width,height:canvas.height,revision:revision()};
          }
        }finally{if(canvas)canvas.width=canvas.height=1;engine.dispose();}
      }else failure('UNKNOWN_COMMAND','不支持的界面操作');
      return {ok:true,value};
    }catch(e){return {ok:false,error:{code:e.code||'OPERATION_FAILED',message:e.message}};}
  }),[]);
}
