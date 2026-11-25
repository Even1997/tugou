import {useEffect,useRef} from 'react';
import {Compositor} from './composite.js';
import {surface,pngBytes,selectionCanvas,selectionKey} from './selection.js';
import {fillMaskSelection,fillPixelsSelection} from './paint-target.js';
import {mergePlan,mergedDocument} from '../core/merge-layers.cjs';
import {maskSelection,maskView} from './mask-view.js';
import * as artboards from '../core/artboards.cjs';
import {worldMatrix,enclosingBox} from '../core/layers.cjs';
import {loadLayerTextFonts,layerTextBounds,textBoxCorners} from './layer-text-layout.js';
import {measureSelection} from './selection-raster-client.js';
import {createStroke} from './painting.js';
import {renderScene} from './scene-render.js';
import {sceneNode,appendCapture} from '../core/automation-scene.cjs';
import {views} from './ui-view.js';
import {inspectUi,navigateUi,prepareCapture,navigationGuard,leaveGuard,settle} from './ui-automation.js';
import {group as pageGroup,kinds as pageKinds} from '../core/pages.cjs';
import {loadPages,suspendPages} from './page-storage.js';
import {printPng} from './print-png.js';
import {runEditingJob,cancelAutomationJob,automationJobStatus} from './automation-editing.js';
import {renderContactSheet} from './contact-sheet.js';
import {originalUrl} from './image-processing.js';

function failure(code,message){const e=new Error(message);e.code=code;throw e;}
// Shares App's live document and history. Disk records are never used as an editing session.
export function useAutomation(context) {
  const latest=useRef(context),version=useRef({document:null,id:null,n:0,epoch:crypto.randomUUID()});
  const measuredSelection=useRef(null);
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
        workspace:c.workspace,presentation:views.get('ppt')?.get()||null,layerSelection:c.layerSelection,history:{undo:c.history.current.past.length,redo:c.history.current.future.length},document:r?.document||null};
    };
    const guard=()=>{
      if(current().busyRef.current)failure('BUSY','界面正在处理操作，请稍后重试');
      if(request.expectedRevision!==revision())failure('CONFLICT','实时文档已变化，请重新读取状态后重试');
    };
    const commit=doc=>{guard();if(pageKinds.some(kind=>pageGroup(doc,kind).activeId!==pageGroup(current().present.current.document,kind).activeId))navigationGuard(current());if(!current().change(suspendPages(doc)))failure('BUSY','界面正在处理操作');return state();};
    try {
      let value;const {action,args={}}=request;
      if(action==='snapshot')value=state();
      else if(action==='pages.load'){
        guard();value=state();
        for(const kind of pageKinds){
          const ids=args[kind]===true?pageGroup(value.document,kind).items.map(p=>p.id):args[kind]||[];
          value.document=await loadPages(value.projectId,value.document,kind,ids);
        }
        guard();
      }
      else if(action==='layout.measure'){
        guard();
        const {selection,width,height,text}=args;
        const boxes=[];
        for(const {layer,matrix} of text){
          await loadLayerTextFonts(layer);
          const box=layerTextBounds(layer);
          if(!box)continue;
          const points=textBoxCorners(layer,matrix,box);
          boxes.push([layer.id,enclosingBox(points.map(p=>({...p,width:0,height:0})))]);
        }
        let selectionBox;
        if(selection){
          if(selection.bitmap?.width*selection.bitmap?.height>16000000)
            failure('RESOURCE_LIMIT','MCP 选区位图限 1600 万像素');
          const projectId=current().present.current.id,key=selectionKey(selection,width,height);
          const cached=measuredSelection.current;
          if(cached?.projectId===projectId&&cached.key===key)selectionBox=cached.box;
          else{
            const engine=new Compositor(),doc={selection,width,height};
            try{
              selectionBox=await measureSelection(doc,engine,undefined,16000000);
              guard();
              measuredSelection.current={projectId,key,box:selectionBox};
            }catch(error){if(error.message==='选区为空')failure('INVALID_TARGET',error.message);throw error;}
            finally{engine.dispose();}
          }
        }
        guard();value={selectionBox,boxes};
      }
      else if(action==='job.cancel')value={cancelled:cancelAutomationJob(args.taskId)};
      else if(action==='job.status')value=automationJobStatus(args.taskId);
      else if(action==='job.run'){
        guard();const source=current().present.current?.document;if(!source)failure('NO_PROJECT','请先打开工程');
        value=await runEditingJob(args,source,commit,guard);
      }
      else if(action==='ui.inspect')value=inspectUi(state(),args);
      else if(action==='ui.prepareCapture')value=await prepareCapture(state(),args);
      else if(action==='ui.navigate'||action==='ui.restore'){guard();const result=await navigateUi(action,args,current(),state());value={...result,...inspectUi(state())};}
      else if(action==='models.changed'){window.dispatchEvent(new Event('tugou-connection-changed'));value={notified:true};}
      else if(action==='commit')value=commit(args.document);
      else if(['ppt.open','ppt.close','ppt.preview','ppt.present'].includes(action)){
        guard();const c=current();navigationGuard(c,document.querySelector('.ppt-player'));leaveGuard(c,'ppt');c.setWorkspace('ppt');
        for(let i=0;i<100&&!views.has('ppt');i++)await new Promise(r=>setTimeout(r,20));
        if(!views.has('ppt'))failure('UI_NOT_READY','PPT 工作区尚未就绪');
        await views.get('ppt').navigate({command:action,args});await settle();guard();value=state();
      }
      else if(action==='page.activate'){guard();const c=current();navigationGuard(c);leaveGuard(c,args.kind);await c.activatePage(args.kind,args.id);value=state();}
      else if(action==='project.create'||action==='project.open'){
        guard();const c=current();navigationGuard(c);
        c.busyRef.current=true;c.setBusy(true);
        try {
          await c.flushSave();
          const record=c.prepareRecord(await (action==='project.create'?window.tugou.create(args.name):window.tugou.open(args.id)));
          c.present.current=record;c.setRecord(record);c.history.current={past:[],future:[]};c.seenResults.current=new Set();
          c.setLayerSelection([]);c.resetPanels();c.markDirty(record.recovered===true||record.promptsExtracted===true);await c.refresh();
        }finally{c.busyRef.current=false;c.setBusy(false);}
        value=state();
      }else if(action==='project.save'){
        guard();const c=current(),r=c.present.current;if(!r)failure('NO_PROJECT','请先打开工程');
        c.busyRef.current=true;c.setBusy(true);
        try{await c.flushSave();}
        finally{c.busyRef.current=false;c.setBusy(false);}
        value=state();
      }else if(action==='history.undo'||action==='history.redo'){
        guard();const c=current(),direction=action.split('.')[1];
        if(!c.history.current[direction==='undo'?'past':'future'].length)failure('EMPTY_HISTORY','没有可撤销或重做的操作');
        await c.travel(direction);value=state();
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
      }else if(action==='artboard.exportSheet'||action==='asset.exportSheet'){
        guard();
        const source=current().present.current?.document;if(!source)failure('NO_PROJECT','请先打开工程');
        const items=[];
        const engine=action==='artboard.exportSheet'?new Compositor():null;
        try{
          if(action==='artboard.exportSheet'){
            const normalized=artboards.normalize(source);
            for(const id of args.artboardIds){
              const doc=artboards.extract(normalized,id);
              if(doc.width*doc.height>16000000)failure('RESOURCE_LIMIT','MCP 拼图单张画板限 1600 万像素');
              const c=surface(1,1);
              await engine.render(doc,c,{scale:Math.min(1,1120/Math.max(doc.width,doc.height))});
              items.push({title:doc.name,subtitle:`${doc.width} × ${doc.height} px`,canvas:c});
            }
          }else{
            for(const id of args.assetIds){
              const asset=source.assets.find(a=>a.id===id);
              if(!asset||(asset.kind&&asset.kind!=='image'))failure('INVALID_TARGET','审稿拼图仅支持图片素材');
              items.push({title:asset.name,subtitle:`${asset.width} × ${asset.height}`,url:originalUrl(asset)});
            }
          }
          const bytes=await renderContactSheet({
            title:args.title||`${source.name||'工程'} · 审稿拼图`,
            items,
            columns:args.columns||(items.length<=2?items.length:3),
            theme:args.theme||'light',
          });
          if(current().present.current.document!==source)failure('CONFLICT','渲染过程中工程发生变化，请重试');
          const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(new Blob([bytes],{type:'image/png'}));});
          value={mimeType:'image/png',data:dataUrl.slice(dataUrl.indexOf(',')+1),count:items.length,revision:revision()};
        }finally{
          items.forEach(item=>{if(item.canvas)item.canvas.width=item.canvas.height=1;});
          engine?.dispose();
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
            const stroke=await createStroke(doc,layer,engine,{target:args.target,maskMode:args.maskMode||'hide',color:args.color||'#000000',erase:args.erase||false,size:args.size,opacity:args.opacity??100,hardness:args.hardness??80,smoothing:args.smoothing||0,pressure:args.pressure||false,maxPixels:16000000});
            try{
              for(const p of args.points)stroke.add({...p,pointerType:args.pressure?'pen':'mouse'});stroke.finish();stroke.render();
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
            let dataUrl;
            if(action==='artboard.export'&&doc.printSize){
              const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
              if(!blob)throw Error('PNG 编码失败');
              const output=await printPng(blob,doc.printSize.ppi);
              dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(output);});
            }else dataUrl=canvas.toDataURL('image/png');
            if(current().present.current.document!==source)failure('CONFLICT','渲染过程中工程发生变化，请重新预览');
            value={mimeType:'image/png',data:dataUrl.slice(dataUrl.indexOf(',')+1),width:canvas.width,height:canvas.height,revision:revision()};
          }
        }finally{if(canvas)canvas.width=canvas.height=1;engine.dispose();}
      }else failure('UNKNOWN_COMMAND','不支持的界面操作');
      return {ok:true,value};
    }catch(e){return {ok:false,error:{code:e.code||'OPERATION_FAILED',message:e.message}};}
  }),[]);
}
