import {timeline,nextVisibleFrame} from '../core/gif-timeline.cjs';
import {flushSync} from 'react-dom';
import './gif.css';
import {LayerTextEditor} from './layer-text-editor.jsx';
import {fitLayerText,layerTextBounds,loadLayerTextFonts,textBoxCorners} from './layer-text-layout.js';
import {patchText,sameText} from '../core/rich-text.cjs';
import {ColorControl} from './color-control.jsx';
import {CanvasRulers,SelectionSizeBadge,CanvasSelection} from './canvas-chrome.jsx';
import {LayerAlignment,alignmentCommands} from './layer-alignment.jsx';
import {Select} from './select.jsx';
import {deleteTarget,editorShortcut} from '../core/editor-commands.cjs';
import {commandFor,shortcutBlocked} from '../core/shortcuts.cjs';
import {usePreferences} from './preferences.jsx';
import {maskSelection,maskView} from './mask-view.js';
import {useUiView} from './ui-view.js';
import {useSubjectStatus} from './use-subject-status.js';
import {Button, Icon, Input, EmptyState} from './components.jsx';
import {Tooltip} from 'antd';
import React, { useEffect, useLayoutEffect, useRef, useState, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  createLayer,
  corners,
  localBounds,
  matrix,
  bounds,
  enclosingBox,
  worldMatrix,
  inverse,
  point,
  localPoint,
  roots,
  descendants,
  inherited,
  moveLayers,
  moveLineEndpoint,
  deleteLayers,
  duplicateLayers,
  groupLayers,
  ungroupLayers,
  reorder,
  alignLayers,
  distributeLayers,
  validateLayers,
  unsupported,
  snapDelta,
  cropToSelection,
  relocateLayers,
} from "../core/layers.cjs";
import {shapeBounds,lineBounds,lineEndpoints,shapes} from '../core/shapes.cjs';
import {hitVector} from './vector-geometry.js';
import {penShape,moveAnchor,movedPathNode,insertAnchor,removeAnchor} from '../core/vector-path.cjs';
import {PenPreview,AnchorControls,VectorNodeOptions,denseContour,nearestAnchor} from './vector-controls.jsx';
import {ShapePicker,ShapeOptions,ShapePath,shapeDefaults} from './shape-tools.jsx';
import {NumberField} from './number-field.jsx';
import {LayerProperties, LayerAppearance} from './layer-properties.jsx';
import { LayerTree } from "./layer-tree.jsx";
import {
  selectionCanvas,
  selectionKey,
  alphaOf,
  alphaCanvas,
  pngBytes,
  calculateSelection,
  surface,
} from "./selection.js";
import { Compositor,renderPadding } from "./composite.js";
import {createLayerPreviewQueue,previewRegion} from './layer-preview.js';
import {needsLayerViewportRefresh,placeLayerBitmap,useLayerViewport} from './use-layer-viewport.js';
import { assetUrl } from "./canvas.jsx";
import { PaintTools, MaskInk, paintDefaults } from './paint-tools.jsx';
import { usePainting } from './use-painting.js';
import { retouchTools, isBrushTool } from './retouch.js';
import { fillImageSelection } from './content-fill.js';
import {createSelectionRaster,largeSelection,measureSelection} from './selection-raster-client.js';
import { paintGeometry, fillMaskSelection } from './paint-target.js';
import {SelectionActions,selectionTools} from './selection-tools.jsx';
import { fields as adjustmentTypes, defaults as adjustmentDefaults } from '../core/adjustments.cjs';
import { AdjustmentTools } from './adjustment-tools.jsx';
import {retouchCopy} from '../core/retouch-copy.cjs';
import { types as effectTypes, defaults as effectDefaults } from '../core/effects.cjs';
import { EffectTools } from './effect-tools.jsx';
import "./layers.css";
import {ReplaceImageDialog} from './replace-image.jsx';
import {replaceLayerAsset} from '../core/materials.cjs';
import {dragMaterial,readMaterialDrop,materialMime} from './material-drag.js';
import {useImageImport,hasImageFiles} from './use-image-import.js';

function Menu({ name, icon, children }) {
  return (
    <details className="layer-menu" name="layer-tools">
      <Tooltip title={name} trigger={["hover", "focus"]} mouseEnterDelay={0.35}><summary aria-label={name}><Icon name={icon}/><span>{name}</span></summary></Tooltip>
      <div
        className="layer-menu-body"
        onClick={(e) => {
          if (e.currentTarget.contains(e.target)&&e.target.closest("button")&&!e.target.closest(".color-control-trigger,.ant-select"))
            e.currentTarget.parentElement.open = false;
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function LayerEditor({ projectId, document, change, disabled, selected, setSelected, workspace, editHistory }) {
  const preferences=usePreferences();
  const [replacement,setReplacement]=useState(null);
  const [editingText,setEditingText]=useState(null);
  const [editingDraft,setEditingDraft]=useState(false);
  const [localPropertiesOpen,setLocalPropertiesOpen]=useState(true);
  const propertiesOpen=workspace?.propertiesOpen??localPropertiesOpen,setPropertiesOpen=workspace?.setPropertiesOpen||setLocalPropertiesOpen;
  const [inspectorTab,setInspectorTab]=useState('adjustments'),[layerTab,setLayerTab]=useState('layers');
  const [layerQuery,setLayerQuery]=useState(''),[layerFilter,setLayerFilter]=useState('all'),[searchOpen,setSearchOpen]=useState(false);
  const localSelectionOptions=useState({});
  const [{autoSelect=true,selectScope='layer',showControls=true,alignTo},setSelectionOptions]=workspace?.selectionOptions??localSelectionOptions;
  const selectionOption=(key,value)=>setSelectionOptions(previous=>({...previous,[key]:value}));
  const penBoard=useRef(null);
  const [pen,setPen]=useState([]),[requestedContour,setContour]=useState(0),[anchorIndex,setAnchorIndex]=useState(0);
  const [shapeOptions,setShapeOptions]=useState(shapeDefaults),[shapeDraft,setShapeDraft]=useState(null);
  const [boardTool,setBoardTool]=useState(!selected.length);
  const [exportHost,setExportHost]=useState(null);
  useEffect(()=>setExportHost(window.document.getElementById('composition-export')),[]);
  useEffect(()=>{if(selected.length)setBoardTool(false)},[selected]);
  const [toolbarHost, setToolbarHost] = useState(null);
  const toolRail=useRef(null),[railEdges,setRailEdges]=useState({up:false,down:false});
  useEffect(()=>{
    const rail=toolRail.current;
    const update=()=>{
      const up=rail.scrollTop>1,down=rail.scrollTop+rail.clientHeight<rail.scrollHeight-1;
      setRailEdges(previous=>previous.up===up&&previous.down===down?previous:{up,down});
      const focused=window.document.activeElement;
      if(focused?.parentElement===rail.parentElement){
        const direction=focused.dataset.railDirection;
        if((direction==='up'&&!up)||(direction==='down'&&!down)){
          rail.focus({preventScroll:true});
        }
      }
    };
    const observer=new ResizeObserver(update);observer.observe(rail);
    rail.addEventListener('scroll',update,{passive:true});update();
    return()=>{observer.disconnect();rail.removeEventListener('scroll',update);};
  },[!!workspace]);
  const scrollTools=direction=>toolRail.current.scrollBy({top:direction*Math.max(120,toolRail.current.clientHeight*.6),behavior:preferences.value.reduceMotion?'auto':'smooth'});
  const scrollbarTimer=useRef(null);
  const revealScrollbar=event=>{
    const rail=event.currentTarget;
    rail.dataset.scrollActive='true';clearTimeout(scrollbarTimer.current);
    scrollbarTimer.current=setTimeout(()=>delete rail.dataset.scrollActive,500);
  };
  useEffect(()=>()=>clearTimeout(scrollbarTimer.current),[]);
  const [materialsOpen,setMaterialsOpen]=useState(false);
  const [motionPreview,setMotionPreview]=useState(null);
  const motion=motionPreview?.gesture.doc===document?motionPreview:null;
  const boardDraft=motion?.board;
  const spaceHeld=useRef(false);
  const [merging, setMerging] = useState(false);
  const [effectId,setEffectId]=useState(null);
  const [comparison,setComparison]=useState(null),[adjustmentPreview,setAdjustmentPreview]=useState(null);
  const adjustmentPreviewRef=useRef(null);
  const [paintOptions, setPaintOptions] = useState({...paintDefaults,target:workspace?.maskId&&workspace.maskId===selected[0]?'mask':'image'});
  const [paintSource,setPaintSource]=useState(null),[sourceArmed,setSourceArmed]=useState(false);
  const [paintCursor,setPaintCursor]=useState(null);
  const [maskViewId,setMaskViewId]=useState(null);
  const [maskPreviewMode,setMaskPreviewMode]=useState("alone");
  const changeMaskView=(id,mode)=>{setMaskPreviewMode(mode);setMaskViewId(mode==="composite"?null:id)};
  const commands=useRef({});
  const canvas=useRef(null);
  const {view,rasterView,rasterDraft,setView,moveView,getView}=useLayerViewport(workspace?.initialView||{x:40,y:40,zoom:.45},
    (drawn,next)=>canvas.current?.dataset.rendering==='false'&&needsLayerViewportRefresh(drawn,next,latest.current.size));
  const [tool, setTool] = useState(workspace?.maskId&&workspace.maskId===selected[0]?'brush':'select'),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [draft, setDraft] = useState(null),
    [pathDraft, setPathDraft] = useState(null),
    [message, setMessage] = useState(""),
    [renderError, setRenderError] = useState(""),
    [warp, setWarp] = useState(false),
    [operation, setOperation] = useState("replace"),
    [exportState, setExportState] = useState(null),
    [transparent, setTransparent] = useState(false),
    [selectionBusy, setSelectionBusy] = useState(false),
    [fillProgress, setFillProgress] = useState(null),
    [tolerance, setTolerance] = useState(24),
    [sampleMode, setSampleMode] = useState("all"),
    [grow, setGrow] = useState(5),
    [fillColor, setFillColor] = useState("#b0bff2"),
    [polygon, setPolygon] = useState([]);
  useEffect(()=>{setSourceArmed(false);if(tool!=='pen')setPen([])},[tool]);
  useEffect(()=>{setContour(0);setAnchorIndex(0);},[selected[0]]);
  useEffect(()=>{setComparison(null)},[document,selected.join(','),tool]);
  useEffect(()=>{const clear=()=>setComparison(null);window.addEventListener('blur',clear);return()=>window.removeEventListener('blur',clear)},[]);
  const holder = useRef(null),
    drag = useRef(null),
    engine = useRef(null),
    exportAbort = useRef(null),
    latest = useRef(null),
    mounted = useRef(true);
  const previewQueue=useRef(null),drawnPreview=useRef(null);
  const anchorOverlay=useRef(null),[anchorRelease,setAnchorRelease]=useState(0);
  if(!previewQueue.current)previewQueue.current=createLayerPreviewQueue();
  const clearDrag=finalView=>{
    cancelAnimationFrame(drag.current?.frame);
    if(drag.current?.dense)anchorOverlay.current?.(null);
    if(drag.current?.dense&&drag.current.preview){
      previewQueue.current.cancel();
      engine.current.endVectorDrag();
      drag.current.preview=null;
      setAnchorRelease(n=>n+1);
    }
    if(drag.current?.mode==='pan')setView(finalView);
    drag.current=null;
    setMotionPreview(null);
  };
  const cancelDrag=()=>{
    const gesture=drag.current;
    if(!gesture)return;
    if(gesture.mode==='pen')setPen(gesture.before);
    clearDrag();
    setShapeDraft(null);
    setDraft(null);
    setPathDraft(null);
    if(holder.current?.hasPointerCapture(gesture.pointerId))holder.current.releasePointerCapture(gesture.pointerId);
  };
  const selectionAbort = useRef(null),
    selectionPreview = useRef(null),
    selectionFrame = useRef(null),
    selectionCache = useRef(null);
  useEffect(() => () => selectionAbort.current?.abort(), [document]);
  const shown = motion?.document || draft || document;
  const fixedText=useMemo(()=>document.layers.filter(l=>l.kind==='text'&&!l.textAutoFit&&selected.includes(l.id)),[document.layers,selected]);
  const [fontRevision,setFontRevision]=useState(0);
  useEffect(()=>{
    if(!fixedText.length)return;
    let current=true;
    Promise.all(fixedText.map(loadLayerTextFonts)).then(faces=>{
      if(current&&faces.flat().some(Boolean))setFontRevision(n=>n+1);
    }).catch(()=>{});
    return()=>{current=false;};
  },[fixedText]);
  const textBoxes=useMemo(()=>new Map(fixedText.map(l=>[l.id,layerTextBounds(l)])),[fixedText,fontRevision]);
  const selectionCorners=(layer,layers=shown.layers)=>{
    const box=!warp&&!(draft&&drag.current?.mode==='resize')&&textBoxes.get(layer.id);
    if(!box)return corners(layers,layer);
    return textBoxCorners(layer,worldMatrix(layers,layer),box);
  };
  useEffect(() => {
    const selector='.composition-primary-tools .layer-menu[open],.composition-primary-tools .shape-picker[open]';
    const position=()=>window.document.querySelectorAll(selector).forEach(menu=>{
      const trigger=menu.querySelector('summary'),body=menu.querySelector('.layer-menu-body,.shape-picker-menu'),rect=trigger.getBoundingClientRect(),rail=menu.closest('nav').getBoundingClientRect();
      if(rect.bottom<=rail.top||rect.top>=rail.bottom){menu.open=false;return;}
      body.style.left=`${Math.min(rail.right+6,innerWidth-body.offsetWidth-8)}px`;
      body.style.top=`${Math.max(8,Math.min(rect.top,innerHeight-body.offsetHeight-8))}px`;
    });
    const close=e=>{
      if(e.target.closest('.ant-select-dropdown,.ant-popover'))return;
      window.document.querySelectorAll(selector).forEach(menu=>{if(!menu.contains(e.target))menu.open=false;});
    };
    const escape=e=>{if(e.key==='Escape')window.document.querySelectorAll(selector).forEach(menu=>{menu.open=false;menu.querySelector('summary').focus();});};
    const toggle=e=>{if(e.target.matches('.layer-menu,.shape-picker')){if(e.target.open)e.target.querySelector('summary').scrollIntoView({block:'nearest'});position();}};
    window.document.addEventListener('pointerdown',close);
    window.document.addEventListener('keydown',escape);
    window.document.addEventListener('toggle',toggle,true);
    window.document.addEventListener('scroll',position,true);
    window.addEventListener('resize',position);
    return()=>{window.document.removeEventListener('pointerdown',close);window.document.removeEventListener('keydown',escape);window.document.removeEventListener('toggle',toggle,true);window.document.removeEventListener('scroll',position,true);window.removeEventListener('resize',position);};
  }, []);
  latest.current = {
    document,
    shown,
    selected,
    view,
    size,
    tool,
    operation,
    disabled,
    editingTextId:editingText?.id,
    paintTarget:paintOptions.target,
    workspace,
  };
  if (!engine.current) engine.current = new Compositor(workspace?.images);
  const painting = usePainting({latest,engine,change,setMessage});
  const animationDoc=workspace?.preview||document;
  const animation=useMemo(()=>{try{return {frames:timeline(animationDoc)}}catch(e){return {frames:[{time:0,delay:100}],error:e.message}}},[animationDoc.layers,animationDoc.assets]);
  const [gifFrame,setGifFrame]=useState(0),[gifPlaying,setGifPlaying]=useState(true);
  const gifIndex=Math.min(gifFrame,animation.frames.length-1),gifTime=animation.frames[gifIndex].time;

  useEffect(()=>{if(selected.length!==1||selected[0]!==maskViewId||paintOptions.target!=='mask'||!document.layers.find(l=>l.id===maskViewId)?.mask)setMaskViewId(null)},[selected,paintOptions.target,document.layers,maskViewId]);
  const single = selected.length === 1 ? shown.layers.find(l=>l.id===selected[0]) : undefined;
  const contour=Math.min(requestedContour,(single?.paths?.length||1)-1);
  const contourNodes=single?.paths?.[contour]?.nodes;
  const activeAnchor=Math.min(anchorIndex,(contourNodes?.length||1)-1);
  const subjectImage=single?.bitmap||document.assets.find(a=>a.id===single?.assetId);
  const subjectStatus=useSubjectStatus({width:subjectImage?.width||single?.width,height:subjectImage?.height||single?.height},single?.kind==='image'&&selectionTools.some(([id])=>id===tool));
  const subjectActive=useRef(false),[subjectStage,setSubjectStage]=useState('');
  useEffect(()=>window.tugou.onSubjectProgress(stage=>{if(subjectActive.current)setSubjectStage(stage)}),[]);
  const run = async (action) => {
    setMessage("");
    try {
      return await action();
    } catch (error) {
      if (error.name !== "AbortError") setMessage(error.message);
    }
  };
  const commit = (layers, options) => {
    validateLayers(layers);
    return change({ ...latest.current.document, layers }, options);
  };
  const arrangement=useMemo(()=>{
    const chosen=roots(document.layers,selected), boxes=new Map();
    const ids=new Set(selected), members=document.layers.filter(l=>ids.has(l.id));
    for(const l of members){
      const points=selectionCorners(l,document.layers);
      boxes.set(l.id,enclosingBox(points.map(p=>({...p,width:0,height:0}))));
    }
    return {count:chosen.length,boxes,box:enclosingBox([...boxes.values()]),
      locked:members.some(l=>inherited(document.layers,l,'locked'))};
  },[document.layers,selected,textBoxes,warp]);
  const defaultTarget=arrangement.count>1?'objects':'board';
  const target=(!alignTo||(alignTo==='objects'&&arrangement.count<2)||(alignTo==='selection'&&!document.selection))?defaultTarget:alignTo;
  const [maskExtent,setMaskExtent]=useState(null);
  const {selection,width:boardWidth,height:boardHeight}=document;
  const maskKey=useMemo(()=>selectionKey(selection,boardWidth,boardHeight),[selection,boardWidth,boardHeight]);
  const currentMask=maskExtent?.key===maskKey?maskExtent?.box:null;
  const needsMaskBounds=target==='selection'&&arrangement.count>0&&!!selection&&!currentMask;
  useEffect(()=>{
    if(!needsMaskBounds)return;
    const controller=new AbortController(),{signal}=controller;
    (async()=>{
      const box=await measureSelection({selection,width:boardWidth,height:boardHeight},engine.current,signal);
      if(!signal.aborted)setMaskExtent({key:maskKey,box});
    })().catch(error=>{if(!signal.aborted)setMessage(error.message);});
    return ()=>controller.abort();
  },[maskKey,needsMaskBounds]);
  const layoutDisabled=disabled||workspace?.board.locked||arrangement.locked||!arrangement.count||(target==='selection'&&!currentMask);
  const arrange=(axis,mode)=>run(()=>{
    if(layoutDisabled||drag.current||editingText)return;
    const extent=target==='selection'?currentMask:target==='board'?{x:0,y:0,width:boardWidth,height:boardHeight}:null;
    const layers=mode==='space'?distributeLayers(document.layers,selected,axis,extent,arrangement.boxes)
      :alignLayers(document,selected,axis,mode,extent,arrangement.boxes);
    if(layers!==document.layers)commit(layers);
  });
  const patch = (values) => {
    if (single && !inherited(document.layers, single, "locked"))
      run(() =>
        commit(
          document.layers.map(l=>{
            if(l.id!==single.id)return l;
            const next=patchText(l,values);
            if(!l.textAutoFit)return next;
            if('width' in values||'height' in values){delete next.textAutoFit;return next;}
            const affectsSize=['text','textRuns','fontSize','fontFamily','fontSource','fontResource','fontWeight','fontStyle','lineHeight','letterSpacing'].some(key=>key in values);
            return affectsSize?fitLayerText(next,document.width):next;
          }),
        ),
      );
  };
  const choose = (id, extend) =>
    setSelected((previous) =>
      extend
        ? previous.includes(id)
          ? previous.filter((x) => x !== id)
          : [...previous, id]
        : [id],
    );
  const previewAdjustment=adjustment=>{
    const next=adjustment?{id:single.id,adjustment,source:document}:null;
    adjustmentPreviewRef.current=next;setAdjustmentPreview(next);
  };
  const closeProperties=(restoreFocus=true)=>{setPropertiesOpen(false);setComparison(null);previewAdjustment(null);if(restoreFocus)window.document.querySelector('.layer-inspector-toggle')?.focus();};
  const commitAdjustment=adjustment=>{
    const preview=adjustmentPreviewRef.current;previewAdjustment(null);
    if(preview&&preview.source!==latest.current.document){setMessage('工程已变化，本次调色预览已取消');return;}
    patch({adjustment});
  };
  const copyForRetouch=()=>run(()=>{
    if(disabled||painting.busy)return;
    const result=retouchCopy(document.layers,single?.id);
    if(change({...document,layers:result.layers})===false)throw Error('工程正在保存，请稍后重试');
    setSelected([result.id]);setPaintSource(null);setSourceArmed(false);setPaintOptions(options=>({...options,target:'image'}));
    setMessage('正在修图副本上编辑；原层已隐藏保留，可撤销恢复');
  });
  const fit = (all = false) => {
    const v = latest.current;
    const viewport={width:holder.current?.clientWidth||v.size.width,height:holder.current?.clientHeight||v.size.height};
    if(viewport.width<=100||viewport.height<=100)return;
    const list=all===true&&v.workspace ? v.workspace.boards : [{x:0,y:0,width:v.document.width,height:v.document.height}];
    const left=Math.min(...list.map(b=>b.x)),top=Math.min(...list.map(b=>b.y));
    const width=Math.max(...list.map(b=>b.x+b.width))-left,height=Math.max(...list.map(b=>b.y+b.height))-top;
    const zoom = Math.min(
      (viewport.width - 100) / width,
      (viewport.height - 100) / height,
      1,
    );
    setView({
      zoom,
      x: (viewport.width - width * zoom) / 2-left*zoom,
      y: (viewport.height - height * zoom) / 2-top*zoom,
    });
  };
  useUiView('layers',{get:()=>({view,tool}),restore:v=>{setView(v.view);setTool(v.tool);},blocked:()=>editingText||draft||pathDraft||selectionBusy||painting.busy||merging||imageImport.importing||exportState||drag.current||pen.length||shapeDraft||polygon.length?'图层编辑尚未完成，请先完成当前操作':null});
  useEffect(() => {
    let previous;
    const observer = new ResizeObserver(([entry]) => {
      const next={
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      };
      if(previous){const dx=(next.width-previous.width)/2,dy=(next.height-previous.height)/2;setView(v=>({...v,x:v.x+dx,y:v.y+dy}));}
      previous=next;
      setSize(next);
    });
    observer.observe(holder.current);
    return () => observer.disconnect();
  }, []);
  const fitted = useRef(Boolean(workspace?.initialView));
  const boardOrigin=useRef({x:workspace?.board.x||0,y:workspace?.board.y||0});
  useEffect(()=>{
    if(!workspace)return;
    const dx=workspace.board.x-boardOrigin.current.x,dy=workspace.board.y-boardOrigin.current.y;
    boardOrigin.current={x:workspace.board.x,y:workspace.board.y};
    if(dx||dy)setView(v=>({...v,x:v.x+dx*v.zoom,y:v.y+dy*v.zoom}));
  },[workspace?.board.x,workspace?.board.y]);
  useEffect(()=>{if(size.width)workspace?.onView(view)},[view,size]);
  useEffect(() => {
    if (!fitted.current && size.width > 100 && size.height > 100) {
      fit(true);
      fitted.current = true;
    }
  }, [size]);
  useEffect(() => {
    setSelected(previous=>{
      const available=new Set(document.layers.map(l=>l.id)),next=previous.filter(id=>available.has(id));
      return next.length===previous.length?previous:next;
    });
  }, [document.layers]);
  const editingId=editingDraft?editingText?.id:undefined;
  const syncTextPreview=()=>{
    const id=latest.current.editingTextId;
    holder.current?.toggleAttribute('data-keep-preview',!!id&&drawnPreview.current?.editingId!==id);
  };
  useLayoutEffect(syncTextPreview,[editingText?.id]);
  const previewCanvas=workspace?.previewCanvas;
  useLayoutEffect(()=>{
    if(!previewCanvas)return;
    const previous=previewCanvas.current,target=canvas.current;
    // The editor remounts per board, so carry the visible pixels across before paint.
    if(previous&&previous!==target){
      target.width=previous.width;
      target.height=previous.height;
      target.getContext('2d').drawImage(previous,0,0);
      target.style.transform=previous.style.transform;
    }
    previewCanvas.current=target;
  },[previewCanvas]);
  useLayoutEffect(()=>{
    placeLayerBitmap(canvas.current,drawnPreview.current?.view,view);
    placeLayerBitmap(selectionPreview.current,selectionFrame.current,view);
  },[view]);
  const compared=tool==='select'&&selected.length===1&&comparison===selected[0]?comparison:null;
  const adjusted=tool==='select'&&selected.length===1&&adjustmentPreview?.source===document&&adjustmentPreview.id===selected[0]?adjustmentPreview:null;
  const playing=gifPlaying&&animation.frames.length>1&&tool==='select'&&!disabled;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      previewQueue.current.cancel();
      cancelAnimationFrame(drag.current?.frame);
      exportAbort.current?.abort();
      selectionAbort.current?.abort();
      selectionCache.current?.raster?.dispose();
      selectionCache.current=null;
      engine.current.dispose();
    };
  }, []);
  const drawPreview=(motion)=>{
    let animationTimer;
    const target=canvas.current,view=rasterView;
    if(!size.width||!size.height){previewQueue.current.cancel();drawnPreview.current=null;return;}
    target.dataset.rendering='true';
    const anchorDrag=motion?.gesture.mode==='anchor'?motion.gesture:null;
    const denseDrag=anchorDrag?.dense;
    const ratio = rasterDraft ? .75 : Math.min(window.devicePixelRatio || 1,denseDrag?(anchorDrag.rasterRatio||1):2);
    const scale=view.zoom*ratio,gesture=motion?.gesture,paintingPreview=painting.preview;
    const plainPreview=!draft&&!paintingPreview&&!adjusted&&!compared&&!editingId&&!maskViewId&&!playing;
    previewQueue.current.request(gesture,async(signal,isLatest)=>{
      const output=window.document.createElement('canvas');
      const valid=()=>!signal.aborted&&(!gesture||drag.current===gesture&&latest.current.document===document);
      try{
        if(!valid())return;
        let previewDoc=paintingPreview?.document||motion?.document||draft||document;
        if(adjusted||compared||editingId)previewDoc={...previewDoc,layers:previewDoc.layers.map(l=>{
          if(l.id===compared||l.id===editingId)return {...l,visible:false};
          return l.id===adjusted?.id?{...l,adjustment:adjusted.adjustment}:l;
        })};
        const previous=drawnPreview.current,visibleGifs=new Set();
        let region;
        if(gesture&&!anchorDrag&&plainPreview&&previous?.plainPreview&&previous.document===document&&previous.workspace===workspace?.preview
           &&previous.view===view&&previous.size===size&&previous.ratio===ratio&&previous.gifTime===gifTime&&(!previous.motion||previous.motion.gesture===gesture)){
          if(gesture.bounds===undefined){
            const layers=(workspace?.preview||document).layers;
            const local=gesture.mode==='board'?layers:document.layers;
            const boardLayers=gesture.mode==='board'?descendants(layers,[gesture.boardId]):null;
            // Other artboards' adjustments are isolated inside their own groups.
            const unbounded=layers.some(l=>l.maskSourceId||l.artboard&&l.clipContent===false)||
              local.some(l=>l.kind==='adjustment'&&l.visible!==false&&l.opacity>0&&(!boardLayers||boardLayers.has(l.id)));
            gesture.bounds=unbounded?null:bounds(local,gesture.mode==='board'?[gesture.boardId]:roots(local,gesture.ids).map(l=>l.id));
            if(gesture.bounds)gesture.padding=renderPadding(layers);
          }
          if(gesture.bounds)region=previewRegion(gesture.bounds,Math.ceil(gesture.padding*scale)+4,motion,previous.motion||{dx:0,dy:0},view,ratio,target.width,target.height);
        }
        if(maskViewId&&maskPreviewMode==='alone'){
          const mask=await maskView(previewDoc,previewDoc.layers.find(l=>l.id===maskViewId),engine.current,{width:Math.ceil(size.width*ratio),height:Math.ceil(size.height*ratio),scale,transform:[scale,0,0,scale,view.x*ratio,view.y*ratio],maskOverrides:paintingPreview?.maskOverrides});
          output.width=mask.width;output.height=mask.height;output.getContext('2d').drawImage(mask,0,0);mask.width=mask.height=1;
        }else if(!region||region.width&&region.height){
          await engine.current.render(workspace?workspace.compose(previewDoc,boardDraft):previewDoc,output,{
            time:gifTime,onGif:playing?gif=>visibleGifs.add(gif):undefined,
            maskPreview:maskViewId?{id:maskViewId,mode:maskPreviewMode}:undefined,
            overrides:paintingPreview?.overrides,maskOverrides:paintingPreview?.maskOverrides,
            vectorDrag:denseDrag?anchorDrag:undefined,
            scale,x:((region?.left||0)/ratio-view.x)/view.zoom,y:((region?.top||0)/ratio-view.y)/view.zoom,
            width:region?region.width/scale:size.width/view.zoom,height:region?region.height/scale:size.height/view.zoom,signal,interactive:true,
          });
        }
        if(!valid())return;
        if(!region){
          if(target.width!==output.width)target.width=output.width;
          if(target.height!==output.height)target.height=output.height;
          const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);ctx.drawImage(output,0,0);
        }else if(region.width&&region.height){
          const {left,top,width,height}=region,ctx=target.getContext('2d');
          ctx.clearRect(left,top,width,height);
          ctx.drawImage(output,0,0,width,height,left,top,width,height);
        }
        drawnPreview.current={document,workspace:workspace?.preview,view,size,ratio,gifTime,plainPreview,motion,editingId};
        placeLayerBitmap(target,view,latest.current.view);
        // Switch the editor ink with the frame that shows or removes the original.
        syncTextPreview();
        if(isLatest()){
          setRenderError('');target.dataset.rendering='false';
          const next=nextVisibleFrame(animation.frames,gifIndex,visibleGifs);
          if(next)animationTimer=setTimeout(()=>setGifFrame(next.index),next.delay);
        }
      }catch(error){
        if(valid()&&isLatest()){setRenderError(error.message);target.dataset.rendering='false';}
      }finally{output.width=output.height=1;}
    });
    return()=>clearTimeout(animationTimer);
  };
  useEffect(()=>drawPreview((drag.current?.doc===document&&drag.current.preview)||motion),
    [editingId,document,shown,rasterView,rasterDraft,size,painting.preview,workspace?.preview,motion,maskViewId,maskPreviewMode,gifTime,gifIndex,playing,animation,compared,adjusted,anchorRelease]);
  useEffect(() => {
    let disposed = false;
    if (!selectionPreview.current || !size.width) return;
    const c = selectionPreview.current,view=rasterView;
    if (!maskKey){
      selectionCache.current?.raster?.dispose();
      selectionCache.current=null;
      if(selectionFrame.current){c.width=c.height=1;selectionFrame.current=null;}
      return;
    }
    if (selectionCache.current?.key!==maskKey){
      selectionCache.current?.raster?.dispose();
      const raster=largeSelection(document)?createSelectionRaster(document,engine.current):null;
      selectionCache.current = {
        key:maskKey,
        raster,
        promise: raster?.ready||selectionCanvas(document, engine.current),
      };
    }
    const cache=selectionCache.current;
    cache.promise
      .then(async (mask) => {
        if (disposed) return;
        const bitmap=cache.raster?await cache.raster.preview(view,size):null;
        if(disposed){bitmap?.close();return;}
        c.width=size.width;c.height=size.height;
        const ctx = c.getContext("2d", bitmap ? {willReadFrequently:true} : undefined);
        if(bitmap){try{ctx.drawImage(bitmap,0,0);}finally{bitmap.close();}}
        else ctx.drawImage(mask,view.x,view.y,document.width*view.zoom,document.height*view.zoom);
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = getComputedStyle(holder.current).getPropertyValue(
          "--accent",
        );
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.globalCompositeOperation = "source-over";
        selectionFrame.current=view;
        placeLayerBitmap(c,view,latest.current.view);
      })
      .catch((e) => {
        if(selectionCache.current===cache){cache.raster?.dispose();selectionCache.current=null;}
        if (!disposed) setMessage(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [maskKey, rasterView, size]);
  useEffect(() => {
    const element = holder.current;
    const wheel = (e) => {
      if(e.target.closest('.layer-text-editor')&&!e.ctrlKey&&!e.metaKey)return;
      e.preventDefault();
      if(drag.current)return;
      if (e.ctrlKey || e.metaKey) {
        const rect = element.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top, delta=e.deltaY;
        moveView(v=>{
          const zoom=Math.max(.02,Math.min(8,v.zoom*Math.exp(-delta*.002)));
          return {zoom,x:x-(x-v.x)*zoom/v.zoom,y:y-(y-v.y)*zoom/v.zoom};
        },true);
      } else {
        const {deltaX,deltaY}=e;
        moveView(v=>({...v,x:v.x-deltaX,y:v.y-deltaY}),true);
      }
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const action = (fn, options) =>
    run(() => {
      const result = fn();
      if (result.layers) {
        commit(result.layers, options);
        setSelected(result.ids);
      } else commit(result, options);
    });
  useEffect(() => {
    const key = (e) => {
      if (
        shortcutBlocked(e) ||
        disabled
      )
        return;
      const v = latest.current;
      const shortcut=commandFor(e,window.tugou.platform,preferences.value.shortcuts);
      if(drag.current&&shortcut&&!['save','undo','redo'].includes(shortcut)){e.preventDefault();return;}
      const command=editorShortcut(e,window.tugou.platform,preferences.value.shortcuts);
      if(command){e.preventDefault();commands.current[command]?.();return;}
      if(shortcut==='pan'){e.preventDefault();spaceHeld.current=e.code||e.key;holder.current?.classList.add('space-pan');return}
      if(shortcut==='group'||shortcut==='ungroup'){
        e.preventDefault();action(()=>shortcut==='ungroup'?ungroupLayers(v.document.layers,v.selected[0]):groupLayers(v.document.layers,v.selected));return;
      }
      const tools={toolMove:'select',toolHand:'hand',toolBrush:'brush',toolEraser:'eraser',toolSelection:'rect',toolLasso:'lasso',toolShape:'shape'};
      if(tools[shortcut]){e.preventDefault();setTool(tools[shortcut]);return;}
      if (e.key === "Escape") {
        painting.cancel();
        setSourceArmed(false);
        setMessage('');
        cancelDrag();
        setTool("select");
        setPen([]);
        setPolygon([]);
        selectionAbort.current?.abort();
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        if(!v.selected.length)return;
        e.preventDefault();
        if(drag.current)return;
        const step = e.shiftKey ? 10 : 1;
        run(() => {
          const layers=moveLayers(
            v.document.layers,
            v.selected,
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
            e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
          );
          if(layers.some((layer,i)=>layer!==v.document.layers[i]))commit(layers);
        });
      }
    };
    window.addEventListener("keydown", key);
    const release=e=>{if(!e||e.type==='blur'||(e.code||e.key)===spaceHeld.current){spaceHeld.current=false;holder.current?.classList.remove('space-pan')}};
    const blur=e=>{release(e);cancelDrag();};
    window.addEventListener('keyup',release);window.addEventListener('blur',blur);
    return () => {release();window.removeEventListener("keydown", key);window.removeEventListener('keyup',release);window.removeEventListener('blur',blur)};
  }, [disabled,preferences.value.shortcuts]);
  const add = (kind, extra = {}) => run(async()=>{
    let layer = createLayer(kind, {
      x: document.width * 0.15,
      y: document.height * 0.15,
      ...extra,
    });
    if(kind==='text'){
      await loadLayerTextFonts(layer).catch(()=>{});
      if(!mounted.current||latest.current.disabled)return;
      layer=fitLayerText({...layer,textAutoFit:true},latest.current.document.width);
    }
    if(commit([...latest.current.document.layers, layer])===false)return;
    setSelected([layer.id]);
    setTool("select");
  });
  const addAssets = (assets, dropPoint) => {
    if (!assets.length) return;
    if(assets.some(a=>a.kind&&a.kind!=='image'))throw Error('图层编辑器仅接受图片，请先从视频提取画面');
    const v = latest.current.document;
    const added = assets.map((asset, i) => {
      const scale = Math.min(
        (v.width * 0.7) / asset.width,
        (v.height * 0.7) / asset.height,
        1,
      );
      return createLayer("image", {
        name: asset.name,
        assetId: asset.id,
        width: asset.width * scale,
        height: asset.height * scale,
        x: (dropPoint ? dropPoint.x - asset.width * scale/2 : (v.width - asset.width * scale) / 2) + i * 20,
        y: (dropPoint ? dropPoint.y - asset.height * scale/2 : (v.height - asset.height * scale) / 2) + i * 20,
      });
    });
    change({
      ...v,
      assets: [
        ...v.assets,
        ...assets.filter((a) => !v.assets.some((old) => old.id === a.id)),
      ],
      layers: [...v.layers, ...added],
    });
    setSelected(added.map((l) => l.id));
    setTool("select");
  };
  const imageImport=useImageImport((assets,point)=>{addAssets(assets,point);setMessage('');},setMessage,disabled);
  const newPaintLayer = () => run(async () => {
    const source=latest.current.document;
    const blank=surface(source.width,source.height);
    const bitmap=await window.tugou.storeRaster(await pngBytes(blank),'绘画图层');
    blank.width=blank.height=1;
    if(!mounted.current || latest.current.document!==source) throw new Error('工程已变化，请重新新建绘画图层');
    const layer=createLayer('image',{name:'绘画图层',x:0,y:0,width:source.width,height:source.height,bitmap});
    if(change({...source,layers:[...source.layers,layer]})!==false) setSelected([layer.id]);
  });
  const at = (e) => {
    const r = holder.current.getBoundingClientRect(),
      v = latest.current.view;
    return {
      x: (e.clientX - r.left - v.x) / v.zoom,
      y: (e.clientY - r.top - v.y) / v.zoom,
      sx: e.clientX - r.left,
      sy: e.clientY - r.top,
    };
  };
  const motionDelta=(gesture,position)=>{
    if(!gesture.moved){
      if(Math.hypot(position.sx-gesture.start.sx,position.sy-gesture.start.sy)<3)return {dx:0,dy:0};
      gesture.moved=true;
    }
    const dx=position.x-gesture.start.x,dy=position.y-gesture.start.y;
    return gesture.mode==='move'&&gesture.doc.layout?.snap&&(dx||dy)?snapDelta(gesture.doc.layers,gesture.ids,dx,dy,gesture.doc.layout,latest.current.view.zoom):{dx,dy};
  };
  const panView=(gesture,event)=>({...gesture.view,
    x:gesture.view.x+event.clientX-gesture.clientX,y:gesture.view.y+event.clientY-gesture.clientY});
  const ordered = (parentId, depth = 0) =>
    shown.layers
      .filter((l) => l.parentId === parentId)
      .reverse()
      .flatMap((l) => [
        { layer: l, depth },
        ...(l.kind === "group" ? ordered(l.id, depth + 1) : []),
      ]);
  const hit = (p) => {
    for (const { layer: l } of ordered()) {
      if (
        l.kind === "group" || l.kind === 'adjustment' ||
        inherited(shown.layers, l, "hidden") ||
        inherited(shown.layers, l, "locked")
      )
        continue;
      const local = localPoint(shown.layers, l, p.x, p.y);
      if(l.shape==='path'){if(hitVector(l,local,view.zoom))return l;continue;}
      if(l.kind==='shape'&&l.shape==='line'&&!l.warp){
        const m=worldMatrix(shown.layers,l),[a,b]=lineEndpoints(l.width,l.height,l.linePoints).map(q=>point(m,q.x,q.y)),dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/(dx*dx+dy*dy||1)));
        if(Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy)<=Math.max(6/view.zoom,(l.strokeWidth||0)*Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3]))/2))return l;
        continue;
      }
      if (
        local.x >= 0 &&
        local.y >= 0 &&
        local.x <= l.width &&
        local.y <= l.height
      ) {
        const box=l.kind==='text'&&!l.textAutoFit?(textBoxes.get(l.id)??layerTextBounds(l)):null;
        const margin=4/view.zoom;
        if(!box||local.x>=box.x-margin&&local.x<=box.x+box.width+margin&&local.y>=box.y-margin&&local.y<=box.y+box.height+margin)return l;
      }
    }
    return null;
  };
  const pickLayer=(p,scope)=>{
    let target=hit(p);
    if(scope==='group'&&target){
      const byId=new Map(shown.layers.map(layer=>[layer.id,layer]));
      while(byId.has(target.parentId))target=byId.get(target.parentId);
    }
    return target;
  };
  useLayoutEffect(()=>{
    const pick=workspace?.pendingPick?.current;
    if(!pick||pick.boardId!==workspace.board.id)return;
    workspace.pendingPick.current=null;
    const target=pickLayer(pick.start,selectScope);
    if(!target)return;
    const ids=[target.id];
    setSelected(ids);
    holder.current.focus({preventScroll:true});
    try{holder.current.setPointerCapture(pick.pointerId);}
    catch(error){if(error.name==='NotFoundError')return;throw error;}
    drag.current={start:pick.start,doc:document,ids,mode:'move',pointerId:pick.pointerId};
  },[workspace?.board.id]);
  const finishPen=closed=>run(()=>{
    if(disabled||pen.length<2)return;
    const layer=createLayer('shape',{...penShape(pen,closed),name:'矢量路径',color:shapeOptions.color,fill:closed,stroke:shapeOptions.stroke,strokeWidth:closed?shapeOptions.strokeWidth:shapeOptions.strokeWidth||2});
    const target=workspace?.boards.find(b=>b.id===penBoard.current);
    if(workspace&&!target)return;
    const saved=target?workspace.addShape({...layer,x:layer.x-target.x,y:layer.y-target.y},target.id):commit([...document.layers,layer]);
    if(saved===false)return;
    setSelected([layer.id]);setTool('nodes');setBoardTool(false);setPen([]);
  });
  const penNode=(d,p)=>{
    const {x,y}=d.start,dx=p.x-x,dy=p.y-y;
    return Math.hypot(dx,dy)*d.zoom<3?{x,y}:{x,y,in:[x-dx,y-dy],out:[x+dx,y+dy]};
  };
  const anchorPosition=(d,p)=>{
    const q=localPoint(d.doc.layers,d.layer,p.x,p.y);
    return [q.x/d.layer.width+d.offset.x,q.y/d.layer.height+d.offset.y];
  };
  const editAnchor=(d,position)=>{
    const next=moveAnchor(d.layer,d.part,d.index,d.handle,...position);
    return {...d.doc,layers:d.doc.layers.map(l=>l.id===next.id?next:l)};
  };
  const selectAnchorNumber=i=>{
    setAnchorIndex(i);
    const n=contourNodes[i],v=getView(),p=point(worldMatrix(shown.layers,single),n.x*single.width,n.y*single.height);
    const x=p.x*v.zoom+v.x,y=p.y*v.zoom+v.y;
    if(x<6||x>size.width-6||y<6||y>size.height-6)setView({...v,x:size.width/2-p.x*v.zoom,y:size.height/2-p.y*v.zoom});
  };
  const changeAnchorCount=insert=>run(()=>{
    if(!contourNodes||disabled||workspace?.board.locked||inherited(document.layers,single,'locked')||drag.current||single.warp)return;
    const next=(insert?insertAnchor:removeAnchor)(single,contour,activeAnchor);
    if(commit(document.layers.map(l=>l.id===single.id?next:l))!==false)setAnchorIndex(insert?activeAnchor+1:Math.min(activeAnchor,next.paths[contour].nodes.length-1));
  });
  const down = (e) => {
    if(editingText){holder.current.querySelector('.layer-text-editor .tiptap')?.blur();return;}
    if (disabled || e.button === 2 || drag.current) return;
    const p = at(e);
    let handle=e.target.dataset.handle;
    e.preventDefault();
    holder.current.focus({preventScroll:true});
    if(spaceHeld.current||e.button===1||tool==='hand'){
      holder.current.setPointerCapture(e.pointerId);
      drag.current={view:getView(),mode:'pan',pointerId:e.pointerId,clientX:e.clientX,clientY:e.clientY};return;
    }
    if(tool==='pen'){
      if(workspace&&!pen.length){
        const b=workspace.boards.findLast(b=>b.visible!==false&&p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height);
        if(!b||b.locked){setMessage(b?'请先解锁画板':'请在画板内开始绘制');return;}
        penBoard.current=b.id;setMessage('');
      }
      if(pen.length>=3&&Math.hypot(p.x-pen[0].x,p.y-pen[0].y)*view.zoom<=7){finishPen(true);return;}
      if(pen.length>=12000){setMessage('单条路径最多 12000 个锚点');return;}
      holder.current.setPointerCapture(e.pointerId);
      drag.current={mode:'pen',doc:document,before:pen,start:p,pointerId:e.pointerId,zoom:view.zoom};
      setPen([...pen,{x:p.x,y:p.y}]);return;
    }
    if(tool==='nodes'&&!handle&&single?.shape==='path'&&!single.warp&&denseContour(contourNodes)){
      const i=nearestAnchor(single,contourNodes,worldMatrix(shown.layers,single),p,view.zoom);
      if(i>=0)handle='vector:'+contour+':'+i+':anchor';
    }
    if(tool==='nodes'&&handle?.startsWith('vector:')&&single?.shape==='path'&&!workspace?.board.locked&&!inherited(document.layers,single,'locked')){
      holder.current.setPointerCapture(e.pointerId);
      const [,part,index,type]=handle.split(':'),n=single.paths[+part].nodes[+index],q=localPoint(document.layers,single,p.x,p.y);
      const [x,y]=type==='anchor'?[n.x,n.y]:n[type];
      setAnchorIndex(+index);
      drag.current={mode:'anchor',doc:document,start:p,pointerId:e.pointerId,layer:single,
        part:+part,index:+index,handle:e.altKey&&type==='anchor'?'curve':type,dense:denseContour(single.paths[+part].nodes),
        offset:{x:x-q.x/single.width,y:y-q.y/single.height}};
      return;
    }
    if(isBrushTool(tool)&&paintOptions.target==='mask'&&single?.mask?.disabled)return;
    if(tool==='shape'){
      const target=workspace?[...workspace.boards].reverse().find(b=>p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height):null;
      if(workspace&&!target){setMessage('请在画板内拖拽绘制');return;}
      if(target?.locked){setMessage('请先解锁画板');return;}
      if(!shapeOptions.fill&&!shapeOptions.strokeWidth){setMessage('请启用填充或设置描边宽度');return;}
      holder.current.setPointerCapture(e.pointerId);setMessage('');setSelected([]);
      drag.current={start:p,mode:'shape',pointerId:e.pointerId,options:shapeOptions,board:target};return;
    }
    const boardId=e.target.dataset.boardId;
    if(boardId&&workspace){
      if(workspace.boards.find(b=>b.id===boardId)?.locked){setMessage('请先解锁画板');return;}
      holder.current.setPointerCapture(e.pointerId);setSelected([]);drag.current={start:p,doc:document,mode:'board',boardId,pointerId:e.pointerId};return;
    }
    if(workspace&&!handle){
      const board=workspace.boards.findLast(b=>b.visible!==false&&p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height);
      if(board&&board.id!==workspace.board.id){
        if(tool==='select'&&autoSelect&&!board.locked){
          workspace.pendingPick.current={boardId:board.id,pointerId:e.pointerId,start:{...p,x:p.x-board.x,y:p.y-board.y}};
        }
        workspace.activate(board.id);return;
      }
    }
    if (e.button === 0 && isBrushTool(tool)) {
      if(paintOptions.target==='mask'&&!['brush','eraser'].includes(tool)){setMessage('请先完成蒙版编辑，再使用修图工具');return;}
      let source=paintSource?.layerId===single?.id?paintSource:null;
      if(['clone','heal'].includes(tool) && (e.altKey || sourceArmed)) {
        if(!single || single.kind!=='image'){setMessage('请选择图片图层取样');return;}
        const q=localPoint(document.layers,single,p.x,p.y);
        if(q.x<0||q.y<0||q.x>=single.width||q.y>=single.height){setMessage('请在当前图层范围内取样');return;}
        setPaintSource({layerId:single.id,u:q.x/single.width,v:q.y/single.height});setSourceArmed(false);setMessage('');return;
      }
      if(source && paintOptions.aligned && !source.offset) {
        const q=localPoint(document.layers,single,p.x,p.y);
        source={...source,offset:{u:source.u-q.x/single.width,v:source.v-q.y/single.height}};
        setPaintSource(source);
      }
      holder.current.setPointerCapture(e.pointerId);
      setMessage('');
      painting.begin({...p,pressure:e.pressure,pointerType:e.pointerType},{...paintOptions,tool,source,erase:tool==='eraser',line:paintOptions.line || e.shiftKey,connect:e.shiftKey});
      return;
    }
    if (tool === "polygon") {
      setPolygon((old) => [...old, p.x, p.y]);
      return;
    }
    if (tool === "wand" || tool === "range") {
      sample(p, e.shiftKey);
      return;
    }
    holder.current.setPointerCapture(e.pointerId);
    setMessage("");
    const base = { start: p, doc: document, view, ids: selected, pointerId:e.pointerId };
    if (handle?.startsWith("guide-")) drag.current = { ...base, mode: handle };
    else if (handle && single && !inherited(document.layers, single, "locked"))
      drag.current = { ...base, mode: handle, layer: single };
    else if (["rect", "ellipse", "lasso"].includes(tool)) {
      drag.current = { ...base, mode: tool, points: [p.x, p.y] };
      setPathDraft([p.x, p.y]);
    } else {
      const target = autoSelect ? pickLayer(p,selectScope) : shown.layers.find(l=>selected.includes(l.id));
      if (target) {
        const ids = e.shiftKey
          ? selected.includes(target.id)
            ? selected.filter((id) => id !== target.id)
            : [...selected, target.id]
          : descendants(document.layers, selected).has(target.id)
            ? selected
            : [target.id];
        setSelected(ids);
        drag.current = { ...base, ids, mode: "move" };
      } else {
        if (!e.shiftKey) setSelected([]);
        drag.current = {
          ...base,
          ids: e.shiftKey ? selected : [],
          mode: "marquee",
        };
      }
    }
  };
  const move = (e) => {
    if(isBrushTool(tool))setPaintCursor(at(e));
    if (isBrushTool(tool) && e.buttons===1 && !drag.current) {
      const events=e.nativeEvent.getCoalescedEvents?.() || [];
      for(const event of events.length?events:[e]) painting.move({...at(event),pressure:event.pressure,pointerType:event.pointerType});
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId!==e.pointerId) return;
    if(d.mode==='pen'){setPen([...d.before,penNode(d,at(e))]);return;}
    if(d.mode==='anchor'){
      if(latest.current.document!==d.doc)return;
      d.position=anchorPosition(d,at(e));
      if(d.dense){
        // Update only the active cubic on pointer input. The full path is copied at most once per frame.
        const node=movedPathNode(d.layer.paths[d.part].nodes[d.index],d.handle,...d.position);
        flushSync(()=>anchorOverlay.current?.({base:d.layer,index:d.index,contour:d.part,handle:d.handle,node}));
      }
      if(d.frame===undefined)d.frame=requestAnimationFrame(()=>{
        d.frame=undefined;if(drag.current!==d||latest.current.document!==d.doc)return;
        const preview={gesture:d,document:editAnchor(d,d.position),dx:0,dy:0};
        if(!d.dense){setMotionPreview(preview);return;}
        // Only the active control and the canvas change while editing dense geometry.
        d.preview=preview;
        drawPreview(preview);
      });
      return;
    }
    if(d.mode==='pan'){moveView(panView(d,e));return;}
    if(d.mode==='move'||d.mode==='board'){
      d.position={clientX:e.clientX,clientY:e.clientY};
      if(d.frame===undefined)d.frame=requestAnimationFrame(()=>{
        d.frame=undefined;
        if(drag.current!==d||latest.current.document!==d.doc)return;
        const {dx,dy}=motionDelta(d,at(d.position));
        if(dx===(d.delta?.dx||0)&&dy===(d.delta?.dy||0))return;
        d.delta={dx,dy};
        if(d.mode==='board')setMotionPreview({gesture:d,dx,dy,board:{id:d.boardId,dx,dy}});
        else setMotionPreview({gesture:d,dx,dy,document:{...d.doc,layers:moveLayers(d.doc.layers,d.ids,dx,dy)}});
      });
      return;
    }
    const p = at(e),
      dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if(d.mode==='shape'){setShapeDraft({...d.options,...(d.options.shape==='line'?lineBounds:shapeBounds)(d.start,p,e.shiftKey)});return;}
    if(d.mode==='line-0'||d.mode==='line-1'){
      const next=moveLineEndpoint(d.doc.layers,d.layer,Number(d.mode.at(-1)),p,e.shiftKey);
      setDraft({...d.doc,layers:d.doc.layers.map(l=>l.id===next.id?next:l)});return;
    }
    if (d.mode.startsWith("guide-")) {
      const index = Number(d.mode.split("-")[1]),
        guides = d.doc.layout.guides.map((g, i) =>
          i === index ? { ...g, position: g.axis === "x" ? p.x : p.y } : g,
        );
      setDraft({ ...d.doc, layout: { ...d.doc.layout, guides } });
      return;
    }
    if (["marquee", "rect", "ellipse", "lasso"].includes(d.mode)) {
      if (d.mode === "lasso") {
        d.points.push(p.x, p.y);
        setPathDraft([...d.points]);
      } else if (d.mode === "ellipse")
        setPathDraft(
          Array.from({ length: 48 }, (_, i) => {
            const angle = (i / 48) * Math.PI * 2;
            return [
              (d.start.x + p.x) / 2 + (Math.cos(angle) * Math.abs(dx)) / 2,
              (d.start.y + p.y) / 2 + (Math.sin(angle) * Math.abs(dy)) / 2,
            ];
          }).flat(),
        );
      else
        setPathDraft([
          d.start.x,
          d.start.y,
          p.x,
          d.start.y,
          p.x,
          p.y,
          d.start.x,
          p.y,
        ]);
      return;
    }
    const l = d.layer;
    let patch = {};
    if (d.mode === "resize") {
      const local = localPoint(d.doc.layers, l, p.x, p.y),
        start = l.kind==='text'?localPoint(d.doc.layers,l,d.start.x,d.start.y):null,
        width = Math.max(1, start?l.width+local.x-start.x:local.x),
        height = Math.max(
          1,
          e.shiftKey ? (width * l.height) / l.width : (start?l.height+local.y-start.y:local.y),
        );
      patch = {width,height};
      if(l.textAutoFit)patch.textAutoFit=false;
      if(l.kind==='group'){
        const box=localBounds(d.doc.layers,l),sx=Math.max(1,local.x-box.x)/box.width,
          sy=e.shiftKey?sx:Math.max(1,local.y-box.y)/box.height,m=matrix(l),
          dx=box.x*(1-sx),dy=box.y*(1-sy);
        patch={scaleX:(l.scaleX??1)*sx,scaleY:(l.scaleY??1)*sy,x:l.x+m[0]*dx+m[2]*dy,y:l.y+m[1]*dx+m[3]*dy};
      }
    } else if (d.mode === "rotate") {
      const origin = point(worldMatrix(d.doc.layers, l), 0, 0);
      patch = {
        rotation:
          l.rotation +
          ((Math.atan2(p.y - origin.y, p.x - origin.x) -
            Math.atan2(d.start.y - origin.y, d.start.x - origin.x)) *
            180) /
            Math.PI,
      };
    } else if (d.mode.startsWith("warp-")) {
      const index = Number(d.mode.split("-")[1]),
        q = [...(l.warp || [0, 0, 1, 0, 1, 1, 0, 1])],
        local = point(inverse(worldMatrix(d.doc.layers, l)), p.x, p.y);
      q[index * 2] = local.x / l.width;
      q[index * 2 + 1] = local.y / l.height;
      patch = { warp: q };
    }
    const layers = d.doc.layers.map((n) =>
      n.id === l.id ? { ...l, ...patch } : n,
    );
    try {
      validateLayers(layers);
      setDraft({ ...d.doc, layers });
    } catch {
      /* Keep the last convex perspective during a folded drag. */
    }
  };
  const up = (e) => {
    if (isBrushTool(tool) && e.button===0 && !drag.current) {
      if(holder.current.hasPointerCapture(e.pointerId)) holder.current.releasePointerCapture(e.pointerId);
      painting.end({...at(e),pressure:e.pressure,pointerType:e.pointerType});
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId!==e.pointerId) return;
    clearDrag(d.mode==='pan'?panView(d,e):undefined);
    if(holder.current.hasPointerCapture(e.pointerId))holder.current.releasePointerCapture(e.pointerId);
    if(d.mode==='pen'){setPen([...d.before,penNode(d,at(e))]);return;}
    if(d.mode==='anchor'){
      setDraft(null);const p=at(e);
      if(d.doc===latest.current.document&&!latest.current.disabled&&Math.hypot(p.sx-d.start.sx,p.sy-d.start.sy)>=1)change(editAnchor(d,anchorPosition(d,p)),{deferSave:true});
      return;
    }
    if(d.mode==='pan')return;
    if(d.mode==='move'||d.mode==='board'){
      if(d.doc!==latest.current.document||latest.current.disabled)return;
      const {dx,dy}=motionDelta(d,at(e));
      if(d.mode==='board'){
        if(dx||dy)workspace.move(d.boardId,dx,dy);else workspace.activate(d.boardId);
      }else if(dx||dy){
        const layers=moveLayers(d.doc.layers,d.ids,dx,dy);
        if(layers.some((l,i)=>l!==d.doc.layers[i])){
          validateLayers(layers);
          change({...d.doc,layers},{deferSave:true});
        }
      }
      return;
    }
    if(d.mode==='line-0'||d.mode==='line-1'){
      setDraft(null);const p=at(e);if(Math.hypot(p.sx-d.start.sx,p.sy-d.start.sy)<1)return;
      const next=moveLineEndpoint(d.doc.layers,d.layer,Number(d.mode.at(-1)),p,e.shiftKey),layers=d.doc.layers.map(l=>l.id===next.id?next:l);
      validateLayers(layers);change({...latest.current.document,layers},{deferSave:true});return;
    }
    if(d.mode==='shape'){
      setShapeDraft(null);
      const p=at(e);if(Math.hypot(p.sx-d.start.sx,p.sy-d.start.sy)<3)return;
      const box=(d.options.shape==='line'?lineBounds:shapeBounds)(d.start,p,e.shiftKey),layer=createLayer('shape',{...d.options,...box,name:shapes.find(([id])=>id===d.options.shape)?.[1]||'形状'});
      const saved=workspace?workspace.addShape({...layer,x:layer.x-d.board.x,y:layer.y-d.board.y},d.board.id):change({...latest.current.document,layers:[...latest.current.document.layers,layer]});
      if(saved!==false){setSelected([layer.id]);setTool('select');setBoardTool(false);}return;
    }
    if (d.mode === "marquee" && pathDraft) {
      const xs = pathDraft.filter((_, i) => i % 2 === 0),
        ys = pathDraft.filter((_, i) => i % 2 === 1),
        x = Math.min(...xs),
        y = Math.min(...ys),
        r = Math.max(...xs),
        b = Math.max(...ys);
      const ids = roots(
        document.layers,
        document.layers
          .filter(
            (l) => !inherited(document.layers, l, "hidden") && !l.parentId,
          )
          .map((l) => l.id),
      )
        .filter((l) => {
          const box = bounds(document.layers, [l.id]);
          return (
            box.x >= x &&
            box.y >= y &&
            box.x + box.width <= r &&
            box.y + box.height <= b
          );
        })
        .map((l) => l.id);
      setSelected([...new Set([...d.ids, ...ids])]);
    } else if (
      ["rect", "ellipse", "lasso"].includes(d.mode) &&
      pathDraft?.length >= 6
    ) {
      applyPath(pathDraft, e.shiftKey);
    } else if (draft) {
      validateLayers(draft.layers);
      change({
        ...latest.current.document,
        layers: draft.layers,
        ...(draft.layout ? { layout: draft.layout } : {}),
      }, {deferSave:true});
    }
    setDraft(null);
    setPathDraft(null);
  };
  const makeMask = () =>
    run(async () => {
      if (!single || !document.selection)
        throw new Error("请先绘制选区，再选择图层");
      if (inherited(document.layers, single, "locked"))
        throw new Error("请先解锁图层或所属分组");
      if (document.selection.bitmap) {
        await selectionTask(async (source, signal) => {
          const mask = await selectionCanvas(source, engine.current),
            local = localSelection(
              mask,
              single,
              Math.ceil(single.width),
              Math.ceil(single.height),
            );
          const bitmap = await window.tugou.storeRaster(
            await pngBytes(local),
            "选区蒙版",
          );
          signal.throwIfAborted();
          assertCurrent(source);
          change({
            ...source,
            layers: source.layers.map((l) =>
              l.id === single.id
                ? { ...l, mask: { x: 0, y: 0, width: 1, height: 1, bitmap } }
                : l,
            ),
          });
          setPaintOptions(options=>({...options,target:'mask'}));setPropertiesOpen(true);
        });
        return;
      }
      const paths = document.selection.paths.map((path) => ({
        ...path,
        points: path.points.flatMap((_, i, all) => {
          if (i % 2) return [];
          const p = localPoint(document.layers, single, all[i], all[i + 1]);
          return [p.x / single.width, p.y / single.height];
        }),
      }));
      patch({
        mask: {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
          paths,
          inverted: Boolean(document.selection.inverted),
          feather: document.selection.feather || 0,
        },
      });
      setPaintOptions(options=>({...options,target:'mask'}));setPropertiesOpen(true);
    });
  const assertCurrent = (source) => {
    if (latest.current.document !== source || !mounted.current)
      throw new Error("工程已变化，计算结果未覆盖当前编辑");
  };
  const selectionTask = async (work) => {
    if (selectionAbort.current) return;
    const controller = new AbortController();
    selectionAbort.current = controller;
    setSelectionBusy(true);
    try {
      await work(latest.current.document, controller.signal);
    } finally {
      selectionAbort.current = null;
      if (mounted.current) setSelectionBusy(false);
    }
  };
  const storeSelection = async (source, alpha, signal) => {
    const c = alphaCanvas(alpha, source.width, source.height);
    let bitmap;
    try {bitmap = await window.tugou.storeRaster(await pngBytes(c), "选区");}
    finally {c.width = c.height = 1;}
    signal.throwIfAborted();
    assertCurrent(source);
    change({
      ...source,
      selection: {
        ...source.selection,
        paths: undefined,
        bitmap,
        feather: 0,
        grow: 0,
        inverted: false,
      },
    });
  };
  const contentFill = () => run(() => selectionTask(async (source, signal) => {
    if(paintOptions.target==='mask')throw new Error('内容感知填充仅支持图片，请先点击图片缩略图');
    let output;
    setFillProgress(0);
    try {
      const layer = source.layers.find(l => l.id === selected[0]);
      const result = await fillImageSelection(source, layer, engine.current, signal,
        progress => { if (mounted.current) setFillProgress(progress * .9); });
      output = result.canvas;
      const bytes = await pngBytes(output);
      signal.throwIfAborted();
      assertCurrent(source);
      const bitmap = await window.tugou.storeRaster(bytes, `${layer.name} · 内容感知填充`);
      signal.throwIfAborted();
      assertCurrent(source);
      if (!change({...source, layers: source.layers.map(l => l.id === layer.id ? {...l, bitmap} : l)}))
        throw new Error('工程正在保存，请稍后重试');
    } finally {
      if (output) output.width = output.height = 1;
      if (mounted.current) setFillProgress(null);
    }
  }));
  const selectSubject = () => run(() => selectionTask(async (source,signal) => {
    const layer=source.layers.find(l=>l.id===single?.id);
    if(layer?.kind!=='image')throw Error('请先选择图片图层');
    if(!subjectStatus.ready)throw Error(subjectStatus.reason);
    const cancel=()=>{window.tugou.cancelSubject().catch(()=>{})};
    signal.addEventListener('abort',cancel,{once:true});
    let out;
    try {
      subjectActive.current=true;setSubjectStage('检查模型与资源');
      setMessage('正在本地识别主体…');
      const result=await window.tugou.selectSubject(layer.bitmap||source.assets.find(a=>a.id===layer.assetId));
      signal.throwIfAborted();assertCurrent(source);
      setSubjectStage('生成选区');
      out=surface(source.width,source.height);
      engine.current.geometry(out.getContext('2d'),await engine.current.image(result),layer,worldMatrix(source.layers,layer));
      const alpha=alphaOf(out);
      if(!alpha.some(value=>value>0))throw Error('没有识别到主体，请使用套索补选');
      const previous=source.selection?await selectionCanvas(source,engine.current):null;
      const base=previous?alphaOf(previous):undefined;
      if(previous)previous.width=previous.height=1;
      await storeSelection(source,base?await calculateSelection({alpha,base,operation,width:source.width,height:source.height},signal):alpha,signal);
      setTool('lasso');setMessage('已选中主体，可用套索增减；反选后点击蒙版缩略图，再填黑隐藏背景');
    } finally {subjectActive.current=false;setSubjectStage('');signal.removeEventListener('abort',cancel);if(out)out.width=out.height=1;}
  }));
  const addAdjustment = (type) => run(() => selectionTask(async (source,signal) => {
    const selectedLayer=source.layers.find(l=>l.id===selected[0]);
    if(selectedLayer&&inherited(source.layers,selectedLayer,'locked'))throw new Error('请先解锁图层或所属分组');
    const layer=createLayer('adjustment',{name:adjustmentTypes[type].label,x:0,y:0,width:source.width,height:source.height,parentId:selectedLayer?.kind==='group'?selectedLayer.id:selectedLayer?.parentId,adjustment:adjustmentDefaults(type)});
    if(source.selection) {
      const anchor={matrix:[1,0,0,1,0,0],width:source.width,height:source.height};
      if(source.selection.bitmap || source.selection.grow) {
        const mask=await selectionCanvas(source,engine.current);
        try {layer.mask={bitmap:await window.tugou.storeRaster(await pngBytes(mask),'调整蒙版'),anchor};}
        finally {mask.width=mask.height=1;}
      } else layer.mask={anchor,paths:source.selection.paths.map(p=>({...p,points:p.points.map((n,i)=>n/(i%2?source.height:source.width))})),inverted:Boolean(source.selection.inverted),feather:source.selection.feather||0};
    }
    signal.throwIfAborted();assertCurrent(source);
    const index=selectedLayer&&selectedLayer.kind!=='group'?source.layers.indexOf(selectedLayer)+1:source.layers.length;
    if(change({...source,layers:[...source.layers.slice(0,index),layer,...source.layers.slice(index)]})===false)throw new Error('工程正在保存，请稍后重试');
    setSelected([layer.id]);setTool('select');setPaintOptions(options=>({...options,target:'image'}));setPropertiesOpen(true);
  }));
  const applyPath = (points, extend = false) => {
    if (document.selection?.bitmap || document.selection?.inverted) {
      run(() =>
        selectionTask(async (source, signal) => {
          const old = await selectionCanvas(source, engine.current),
            added = await selectionCanvas(
              {
                ...source,
                selection: { paths: [{ operation: "add", points }] },
              },
              engine.current,
            );
          try {
          const ctx = old.getContext("2d");
          const op = extend && operation === "replace" ? "add" : operation;
          if (op === "replace") ctx.clearRect(0, 0, old.width, old.height);
          ctx.globalCompositeOperation =
            op === "subtract"
              ? "destination-out"
              : op === "intersect"
                ? "destination-in"
                : "source-over";
          ctx.drawImage(added, 0, 0);
          await storeSelection(source, alphaOf(old), signal);
          } finally {old.width=old.height=added.width=added.height=1;}
        }),
      );
    } else
      change({
        ...document,
        selection: {
          ...document.selection,
          paths: [
            ...(operation === "replace" && !extend
              ? []
              : document.selection?.paths || []),
            { operation: operation === "replace" ? "add" : operation, points },
          ],
          feather: document.selection?.feather || 0,
        },
      });
  };
  const sample = (p, extend) =>
    run(() =>
      selectionTask(async (source, signal) => {
        const out = surface(source.width, source.height);
        if (sampleMode === "layer") {
          if (!single) throw new Error("请选择取样图层");
          const c = await engine.current.node(single, source, {
            width: source.width,
            height: source.height,
            scale: 1,
            transform: [1, 0, 0, 1, 0, 0],
            signal,
          });
          out.getContext("2d").drawImage(c, 0, 0);
          c.width = c.height = 1;
        } else
          await engine.current.render(source, out, {
            transparent: true,
            signal,
          });
        const rgba = out
          .getContext("2d")
          .getImageData(0, 0, out.width, out.height).data;
        const base = source.selection
          ? alphaOf(await selectionCanvas(source, engine.current))
          : undefined;
        const alpha = await calculateSelection(
          {
            rgba,
            width: source.width,
            height: source.height,
            x: Math.floor(p.x),
            y: Math.floor(p.y),
            tolerance,
            contiguous: tool === "wand",
            base,
            operation: extend && operation === "replace" ? "add" : operation,
          },
          signal,
        );
        await storeSelection(source, alpha, signal);
      }),
    );
  const expandSelection = (radius) =>
    run(() =>
      selectionTask(async (source, signal) => {
        const alpha = alphaOf(await selectionCanvas(source, engine.current));
        await storeSelection(
          source,
          await calculateSelection(
            { alpha, width: source.width, height: source.height, radius },
            signal,
          ),
          signal,
        );
      }),
    );
  const localSelection = (mask, l, width, height) => {
    const out = surface(width, height),
      q = [
        [0, 0],
        [document.width, 0],
        [document.width, document.height],
        [0, document.height],
      ].flatMap(([x, y]) => {
        const p = localPoint(document.layers, l, x, y);
        return [p.x / l.width, p.y / l.height];
      });
    engine.current.geometry(
      out.getContext("2d", { willReadFrequently: true }),
      mask,
      { width, height, warp: q },
      [1, 0, 0, 1, 0, 0],
    );
    return out;
  };
  const fillSelection = (clear) =>
    run(() =>
      selectionTask(async (source, signal) => {
        if(paintOptions.target==='mask') {
          const layer=source.layers.find(l=>l.id===single?.id);
          const result=await fillMaskSelection(source,layer,engine.current,clear?'hide':paintOptions.maskMode);
          try {
            signal.throwIfAborted();assertCurrent(source);
            const bitmap=await window.tugou.storeRaster(await pngBytes(result.canvas),'蒙版选区填充');
            signal.throwIfAborted();assertCurrent(source);
            change({...source,layers:source.layers.map(l=>l.id===layer.id?{...l,mask:{...result.mask,bitmap}}:l)});
          } finally {result.canvas.width=result.canvas.height=1;}
          return;
        }
        const mask = await selectionCanvas(source, engine.current);
        let out;
        if (clear || single?.kind==='image') {
          if (
            !single ||
            single.kind !== "image" ||
            inherited(source.layers, single, "locked")
          )
            throw new Error("请选择未锁定的图片图层");
          const image = await engine.current.image(
            single.bitmap || source.assets.find((a) => a.id === single.assetId),
          );
          out = surface(image.naturalWidth, image.naturalHeight);
          const ctx = out.getContext("2d");
          ctx.drawImage(image, 0, 0);
          const selected=localSelection(mask,single,out.width,out.height);
          if(!clear){const ink=selected.getContext('2d');ink.globalCompositeOperation='source-in';ink.fillStyle=fillColor;ink.fillRect(0,0,selected.width,selected.height);}
          ctx.globalCompositeOperation = clear ? "destination-out" : "source-over";
          ctx.drawImage(selected,0,0);selected.width=selected.height=1;
        } else {
          out = mask;
          const ctx = out.getContext("2d");
          ctx.globalCompositeOperation = "source-in";
          ctx.fillStyle = fillColor;
          ctx.fillRect(0, 0, out.width, out.height);
        }
        const asset = await window.tugou.storeRaster(
          await pngBytes(out),
          clear ? "选区清除" : "选区填色",
        );
        signal.throwIfAborted();
        assertCurrent(source);
        const layers = clear || single?.kind==='image'
          ? source.layers.map((l) =>
              l.id === single.id ? { ...l, bitmap: asset } : l,
            )
          : [
              ...source.layers,
              createLayer("image", {
                name: asset.name,
                x: 0,
                y: 0,
                width: source.width,
                height: source.height,
                assetId: asset.id,
              }),
            ];
        change({
          ...source,
          layers,
          assets: clear || single?.kind==='image' ? source.assets : [...source.assets, asset],
        });
        if (!clear && single?.kind!=='image') setSelected([layers.at(-1).id]);
        out.width=out.height=mask.width=mask.height=1;
      }),
    );
  const relocate = (ids, targetId, placement, options) =>
    action(() => relocateLayers(document.layers, ids, targetId, placement), options);
  const deselect=()=>{if(document.selection)change({...document,selection:undefined})};
  const inverseSelection=()=>{if(document.selection)change({...document,selection:{...document.selection,inverted:!document.selection.inverted}})};
  const deleteCurrent=()=>{
    if(disabled||selectionBusy||painting.busy)return;
    const target=deleteTarget({selection:document.selection,mask:paintOptions.target==='mask',hasMask:single?.mask});
    if(target==='selection'){fillSelection(true);return;}
    if(target==='mask'){patch({mask:undefined});return;}
    if(target==='layers')action(()=>deleteLayers(document.layers,selected));
  };
  const loadMaskSelection=()=>run(()=>selectionTask(async(source,signal)=>{
    const layer=source.layers.find(l=>l.id===single?.id),mask=await maskSelection(source,layer,engine.current);
    try{await storeSelection(source,alphaOf(mask),signal);setMessage('已从蒙版载入选区');}
    finally{mask.width=mask.height=1;}
  }));
  commands.current={
    delete:deleteCurrent,
    deselect:()=>{if(!selectionBusy&&!painting.busy)deselect()},
    inverse:()=>{if(!selectionBusy&&!painting.busy)inverseSelection()},
    duplicate:()=>{if(!selectionBusy&&!painting.busy)action(()=>duplicateLayers(document.layers,selected))},
    swapMaskInk:()=>{if(paintOptions.target==='mask')setPaintOptions({...paintOptions,maskMode:paintOptions.maskMode==='hide'?'reveal':'hide'})},
  };
  const finishPolygon = () => {
    if (polygon.length >= 6) {
      applyPath(polygon);
      setPolygon([]);
    }
  };
  const cropSelection = () =>
    run(() =>
      selectionTask(async (source, signal) => {
        if (!source.selection.bitmap && !source.selection.inverted) {
          change(cropToSelection(source));
          return;
        }
        const alpha = alphaOf(await selectionCanvas(source, engine.current));
        let x = source.width,
          y = source.height,
          r = 0,
          b = 0;
        for (let i = 0; i < alpha.length; i++)
          if (alpha[i]) {
            const px = i % source.width,
              py = Math.floor(i / source.width);
            x = Math.min(x, px);
            y = Math.min(y, py);
            r = Math.max(r, px + 1);
            b = Math.max(b, py + 1);
          }
        if (r <= x || b <= y) throw new Error("选区为空");
        signal.throwIfAborted();
        assertCurrent(source);
        change(
          cropToSelection({
            ...source,
            selection: {
              paths: [{ operation: "add", points: [x, y, r, y, r, b, x, b] }],
            },
          }),
        );
      }),
    );
  const exportPng = () =>
    run(async () => {
      const choice = await window.tugou.chooseExport(document.name);
      if (!choice) return;
      const controller = new AbortController();
      exportAbort.current = controller;
      setExportState({ progress: 0, phase: "render" });
      try {
        const bytes = await engine.current.export(document, {
          transparent,
          signal: controller.signal,
          progress: (value) =>
            mounted.current &&
            setExportState({ progress: value, phase: "render" }),
        });
        controller.signal.throwIfAborted();
        setExportState({ progress: 1, phase: "save" });
        const result = await window.tugou.writeExport(choice.token, bytes);
        if (mounted.current)
          setMessage(
            `已导出 ${result.name} · ${document.width} × ${document.height}`,
          );
      } finally {
        await window.tugou.cancelExport(choice.token);
        if (mounted.current) setExportState(null);
        exportAbort.current = null;
      }
    });
  const layout = shown.layout || {
    grid: false,
    snap: false,
    gridSize: 20,
    guides: [],
  };
  const updateLayout = (patch) =>
    change({ ...document, layout: { ...layout, ...patch } });
  const merge = () =>
    run(async () => {
      const source = latest.current.document,
        chosen = roots(source.layers, selected),
        selectedIds = descendants(
          source.layers,
          chosen.map((l) => l.id),
        );
      if (
        !chosen.length ||
        chosen.some(
          (l) => l.parentId || l.blend !== "source-over" || l.clipping,
        )
      )
        throw new Error("请合并顶层、正常混合且未剪贴的相邻图层或分组");
      const top = source.layers.filter((l) => !l.parentId),
        indices = chosen.map((l) => top.indexOf(l)).sort((a, b) => a - b);
      if (indices.at(-1) - indices[0] + 1 !== indices.length)
        throw new Error("请先将要合并的图层排为相邻，避免改变叠放外观");
      if(chosen.some(l=>l.kind==='adjustment'&&l.visible!==false) && (indices[0]!==0 || source.background!=='transparent'))throw new Error('调整层合并需包含全部下方内容并使用透明画布；也可先将内容与调整层编组后合并');
      if (
        top[indices.at(-1) + 1]?.clipping ||
        source.layers.some(
          (l) =>
            l.maskSourceId &&
            selectedIds.has(l.id) !== selectedIds.has(l.maskSourceId),
        )
      )
        throw new Error("所选图层与外部图层存在剪贴或蒙版关联，请先解除关联");
      setMerging(true);
      try {
        const bytes = await engine.current.export(
          {
            ...source,
            layers: source.layers.filter((l) => selectedIds.has(l.id)),
          },
          { transparent: true },
        );
        const asset = await window.tugou.storeRaster(bytes, "合并图层");
        if (latest.current.document !== source)
          throw new Error("合并期间工程已变化，原图层保留，请重新合并");
        const layer = createLayer("image", {
            name: asset.name,
            assetId: asset.id,
            x: 0,
            y: 0,
            width: source.width,
            height: source.height,
          }),
          last = chosen.at(-1).id;
        const layers = source.layers.flatMap((l) =>
          l.id === last ? [layer] : selectedIds.has(l.id) ? [] : [l],
        );
        change({ ...source, layers, assets: [...source.assets, asset] });
        setSelected([layer.id]);
      } finally {
        if (mounted.current) setMerging(false);
      }
    });
  const issues = useMemo(()=>unsupported(document.layers),[document.layers]);
  const treeLayers=workspace?.layers||document.layers;
  const layerTree=useMemo(()=>(
      <LayerTree
            query={layerQuery} kind={layerFilter} propertiesOpen={propertiesOpen}
            layers={treeLayers}
            selected={selected.length?selected:workspace?[workspace.board.id]:[]}
            choose={(id,extend,inspect)=>{if(inspect||(workspace?.layers||document.layers).find(l=>l.id===id)?.kind==='adjustment'){setTool('select');setMaskViewId(null)}(workspace?.choose||choose)(id,extend);setPaintOptions({...paintOptions,target:'image'});if(inspect){const same=selected.length===1?selected[0]===id:!selected.length&&workspace?.board.id===id;if(same&&propertiesOpen&&paintOptions.target!=='mask')closeProperties(false);else setPropertiesOpen(true);}setBoardTool(Boolean(workspace?.layers.find(l=>l.id===id)?.artboard))}}
            disabled={disabled}
            relocate={(ids,target,placement)=>(workspace?.relocate||relocate)(ids,target,placement,{deferSave:true})}
            assets={document.assets} paintTarget={paintOptions.target} onMaskView={id=>changeMaskView(id,maskViewId===id&&maskPreviewMode==="alone"?"composite":"alone")} onMask={id=>{const layer=(workspace?.layers||document.layers).find(l=>l.id===id);if(!layer.mask)(workspace?.patchLayer||((id,values)=>change({...document,layers:document.layers.map(l=>l.id===id?{...l,...values}:l)})))(id,{mask:{x:0,y:0,width:1,height:1}});workspace?.selectMask(id);setSelected([id]);setPaintOptions({...paintOptions,target:"mask"});setPropertiesOpen(true)}}
            patch={workspace?.patchLayer || ((id, values) =>
              run(() =>
                commit(
                  document.layers.map((l) =>
                    l.id === id ? { ...l, ...values } : l,
                  ),
                ),
              )
            )}
          />
  ),[treeLayers,document,workspace,change,selected,setSelected,layerQuery,layerFilter,propertiesOpen,disabled,paintOptions,maskViewId,maskPreviewMode]);
  const maskEditing=Boolean(single)&&paintOptions.target==='mask';
  // Anchor previews only change path geometry. The inspector can keep its committed fields until release.
  const inspected=drag.current?.mode==='anchor'?drag.current.layer:single;
  const inspectorLocked=disabled||workspace?.board.locked||Boolean(inspected&&inherited(document.layers,inspected,'locked'));
  const appearancePanel=useMemo(()=><LayerAppearance layer={inspected} patch={patch} disabled={inspectorLocked}/>,[inspected,document,change,inspectorLocked]);
  const propertiesPanel=useMemo(()=>!inspected&&workspace?workspace.inspector:<LayerProperties key={inspected?.id||'empty'} compact boardName={workspace?.board.name} maskEditing={maskEditing} maskPreview={maskViewId===inspected?.id?maskPreviewMode:"composite"} maskBusy={selectionBusy||painting.busy} onMaskView={mode=>changeMaskView(inspected?.id,mode)} onLoadMask={loadMaskSelection} layer={inspected?{...inspected,locked:inspectorLocked}:null} patch={patch} document={document} change={change}/>,
    [inspected,document,workspace,change,inspectorLocked,maskEditing,maskViewId,maskPreviewMode,selectionBusy,painting.busy]);
  const maskPainting=['brush','eraser'].includes(tool)&&maskEditing;
  let brushOutline,sourceMarker;
  if(isBrushTool(tool)&&single&&(single.kind==='image'||maskPainting)) {
    const geometry=paintGeometry(shown.layers,single,maskPainting),asset=(maskPainting?single.mask?.bitmap:null)||single.bitmap||shown.assets.find(a=>a.id===single.assetId);
    if(paintCursor) {
      const q=geometry.local(paintCursor.x,paintCursor.y),radius=paintOptions.size/2;
      if(Number.isFinite(q.x)&&Number.isFinite(q.y))brushOutline=Array.from({length:48},(_,i)=>{
        const angle=i/48*Math.PI*2,p=geometry.world(q.x+Math.cos(angle)*radius/(asset?.width||geometry.width),q.y+Math.sin(angle)*radius/(asset?.height||geometry.height));return `${p.x},${p.y}`;
      }).join(' ');
    }
    if(['clone','heal'].includes(tool)&&paintSource?.layerId===single.id)sourceMarker=geometry.world(paintSource.u,paintSource.v);
  }
  return (
    <div className="layer-editor composition-editor" data-properties-open={propertiesOpen||undefined} onContextMenu={e=>{const row=e.target.closest('[data-tree-id]');if(row&&workspace)workspace.contextMenu(e,row.dataset.treeId,gifTime);}} data-dev-update-blocked={editingText||painting.busy||selectionBusy||merging||imageImport.importing||exportState||draft||pathDraft||motion||shapeDraft||polygon.length||tool!=='select'?'请先完成图层编辑，并切换到移动工具后更新':undefined}>

      <div className="composition-tool-rail">
        <Button aria-label="向上滚动工具" title="向上滚动工具" icon="collapse" className="tool-rail-scroll tool-rail-scroll-up" data-rail-direction="up" aria-hidden={!railEdges.up} disabled={!railEdges.up} tabIndex={railEdges.up?0:-1} style={{visibility:railEdges.up?'visible':'hidden'}} onClick={()=>scrollTools(-1)} />
        <nav ref={toolRail} tabIndex={-1} className="composition-primary-tools" aria-label="图层工具" onMouseEnter={revealScrollbar} onScroll={revealScrollbar} onFocus={revealScrollbar} onClickCapture={e=>{const button=e.target.closest('button');if(button&&!['抓手','缩放'].includes(button.getAttribute('aria-label')))setPropertiesOpen(true)}}>
          <Button iconOnly icon="action" aria-pressed={tool==='select'&&!boardTool} onClick={()=>{setTool('select');setBoardTool(false)}}>移动</Button>
          {workspace&&<Button iconOnly icon="layout" aria-pressed={boardTool&&tool==='select'} onClick={()=>{setSelected([]);setTool('select');setBoardTool(true);setPropertiesOpen(true)}}>画板</Button>}
          <Button iconOnly icon="selection" aria-pressed={selectionTools.some(([id])=>id===tool)} onClick={()=>setTool('rect')}>选区</Button>
          <Button iconOnly icon="crop" disabled={!document.selection||selectionBusy} onClick={cropSelection}>裁切</Button>
          <Button iconOnly icon="brush" aria-pressed={tool==='brush'} onClick={()=>setTool('brush')}>画笔</Button>
          <Button iconOnly icon="edit" aria-pressed={tool==='pen'} disabled={disabled} onClick={()=>{setTool('pen');setBoardTool(false)}}>钢笔</Button>
          <ShapePicker active={tool==='shape'} options={shapeOptions} disabled={disabled} choose={options=>{setShapeOptions(options);setTool('shape');setBoardTool(false)}}/>
          <Button iconOnly icon="assets" loading={imageImport.importing} onClick={()=>imageImport.open()} disabled={imageImport.importing}>{imageImport.importing?'导入中…':'图片'}</Button>
          <Button iconOnly icon="text" onClick={()=>add('text',{name:'文字',text:'输入文字',fontSize:48,color:'#333333'})}>文字</Button>
          <Button iconOnly icon="select" aria-pressed={tool==='hand'} onClick={()=>setTool('hand')}>抓手</Button>
          <Button iconOnly icon="zoomIn" onClick={()=>setView({...view,zoom:Math.min(8,view.zoom*1.25)})}>缩放</Button>
          <hr className="tool-rail-divider"/>
            {workspace?.importPsd&&<Menu name="PSD" icon="layers"><Button disabled={disabled||imageImport.importing||painting.busy} onClick={()=>workspace.importPsd()}>导入 PSD</Button><Button disabled={disabled||painting.busy||!!renderError} onClick={()=>workspace.exportPsd()}>导出 PSD</Button></Menu>}
            <Menu name="修图" icon="tools">{retouchTools.map(([id,name])=><Button key={id} aria-pressed={tool===id} onClick={()=>setTool(id)}>{name}</Button>)}<Button disabled={disabled || selectionBusy || !document.selection || single?.kind !== 'image' || maskEditing} onClick={contentFill}>内容感知填充</Button></Menu>
            <Menu name="添加" icon="add">
              <Button
                disabled={imageImport.importing||disabled}
                onClick={() =>
                  imageImport.open()
                }
              >
                导入图片
              </Button>
              <Button
                onClick={() =>
                  add("text", {
                    name: "文字",
                    text: "输入文字",
                    fontSize: 40,
                    color: "#333333",
                  })
                }
              >
                文字
              </Button>
              {[
                ["rect", "矩形"],
                ["ellipse", "椭圆"],
                ["line", "直线"],
              ].map(([shape, name]) => (
                <Button
                  key={shape}
                  onClick={() =>
                    add("shape", {
                      shape,
                      name,
                      color: "#b0bff2",
                      stroke: "#333333",
                      strokeWidth: shape === "line" ? 4 : 0,
                    })
                  }
                >
                  {name}
                </Button>
              ))}
            </Menu>
            <Menu name="调整" icon="adjust">{Object.entries(adjustmentTypes).map(([type,spec])=><Button key={type} disabled={disabled||selectionBusy} onClick={()=>addAdjustment(type)}>{spec.label}</Button>)}</Menu>
            <Menu name="特效" icon="decoration">{Object.entries(effectTypes).map(([type,spec])=><Button key={type} disabled={disabled||!single||single.kind==='adjustment'||inherited(document.layers,single,'locked')} onClick={()=>{const effect=effectDefaults(type);patch({effects:[...(single.effects||[]),effect]});setEffectId(effect.id);setTool('select');}}>{spec.label}</Button>)}</Menu>
            <Menu name="图层" icon="layers">
              <label>
                移入分组
                <Select
                  aria-label="移入分组"
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      relocate(
                        selected,
                        e.target.value === "root" ? undefined : e.target.value,
                        "inside",
                      );
                  }}
                >
                  <option value="">选择目标…</option>
                  <option value="root">移至顶层</option>
                  {document.layers
                    .filter(
                      (l) =>
                        l.kind === "group" &&
                        !descendants(document.layers, selected).has(l.id),
                    )
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </Select>
              </label>
              <Button disabled={!selected.length || merging} onClick={merge}>
                {merging ? "合并中" : "合并所选"}
              </Button>
              <Button
                disabled={!selected.length}
                onClick={() =>
                  action(() => duplicateLayers(document.layers, selected))
                }
              >
                复制
              </Button>
              <Button
                disabled={!selected.length}
                onClick={() =>
                  deleteCurrent()
                }
              >
                删除
              </Button>
              <Button
                disabled={!selected.length}
                onClick={() =>
                  action(() => groupLayers(document.layers, selected))
                }
              >
                编组
              </Button>
              <Button
                disabled={single?.kind !== "group"}
                onClick={() =>
                  action(() => ungroupLayers(document.layers, single.id))
                }
              >
                取消编组
              </Button>
              {[
                ["up", "上移"],
                ["down", "下移"],
                ["top", "置顶"],
                ["bottom", "置底"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  disabled={!selected.length}
                  onClick={() =>
                    action(() => reorder(document.layers, selected, value))
                  }
                >
                  {label}
                </Button>
              ))}
            </Menu>
            <Menu name="排版" icon="layout">
              <label className="check">
                <input
                  type="checkbox"
                  checked={layout.grid || false}
                  onChange={(e) => updateLayout({ grid: e.target.checked })}
                />
                显示网格
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={layout.snap || false}
                  onChange={(e) => updateLayout({ snap: e.target.checked })}
                />
                吸附网格与参考线
              </label>
              <NumberField
                label="网格间距"
                value={layout.gridSize || 20}
                min={1}
                max={1000}
                onChange={(gridSize) => updateLayout({ gridSize })}
              />
              <Button
                onClick={() =>
                  updateLayout({
                    guides: [
                      ...(layout.guides || []),
                      { axis: "x", position: document.width / 2 },
                    ],
                  })
                }
              >
                添加垂直参考线
              </Button>
              <Button
                onClick={() =>
                  updateLayout({
                    guides: [
                      ...(layout.guides || []),
                      { axis: "y", position: document.height / 2 },
                    ],
                  })
                }
              >
                添加水平参考线
              </Button>
              <Button onClick={() => updateLayout({ guides: [] })}>
                清除参考线
              </Button>
              {alignmentCommands.map(([axis,mode,label])=>(
                <Button key={label} disabled={layoutDisabled||(mode==='space'&&arrangement.count<3)}
                  onClick={()=>arrange(axis,mode)}>{label}</Button>
              ))}
            </Menu>
            <Menu name="变换" icon="transform">
              <Button
                disabled={!single}
                onClick={() => patch({ flipX: !single.flipX })}
              >
                水平翻转
              </Button>
              <Button
                disabled={!single}
                onClick={() => patch({ flipY: !single.flipY })}
              >
                垂直翻转
              </Button>
              <Button
                disabled={!single || single.kind === "group"}
                onClick={() => setWarp(!warp)}
              >
                {warp ? "退出透视" : "四角透视"}
              </Button>
              <Button
                disabled={!single?.warp}
                onClick={() => patch({ warp: undefined })}
              >
                重置透视
              </Button>
            </Menu>
            <Menu name="选区操作" icon="selection">
              <NumberField
                label="羽化像素"
                value={document.selection?.feather || 0}
                min={0}
                max={200}
                disabled={!document.selection}
                onChange={(feather) =>
                  change({
                    ...document,
                    selection: { ...document.selection, feather },
                  })
                }
              />
              <NumberField
                label="扩缩像素"
                value={grow}
                min={1}
                max={500}
                onChange={setGrow}
              />
              <Button
                disabled={!document.selection || selectionBusy}
                onClick={() => expandSelection(grow)}
              >
                扩展选区
              </Button>
              <Button
                disabled={!document.selection || selectionBusy}
                onClick={() => expandSelection(-grow)}
              >
                收缩选区
              </Button>
              {!maskEditing&&<label>
                填充颜色
                <ColorControl
                  aria-label="选区填充颜色"
                  value={fillColor}
                  onChange={(e) => setFillColor(e.target.value)}
                />
              </label>}
              <Button
                disabled={!document.selection || selectionBusy}
                onClick={() => fillSelection(false)}
              >
                {maskEditing?'填充蒙版选区':single?.kind==='image'?'填充图片选区':'选区填色（新图层）'}
              </Button>
              <Button
                disabled={
                  !document.selection ||
                  (maskEditing?!single:single?.kind !== "image") ||
                  selectionBusy
                }
                onClick={() => fillSelection(true)}
              >
                {maskEditing?'隐藏蒙版选区':'清除图片选区'}
              </Button>
              <Button disabled={disabled || selectionBusy || !document.selection || single?.kind !== 'image' || maskEditing} onClick={contentFill}>内容感知填充</Button>
              {[
                ["rect", "矩形选区"],
                ["ellipse", "椭圆选区"],
                ["lasso", "套索选区"],
                ["polygon", "多边形选区"],
                ["wand", "魔棒选区"],
                ["range", "颜色范围"],
              ].map(([value, label]) => (
                <Button key={value} onClick={() => setTool(value)}>
                  {label}
                </Button>
              ))}
              <label>
                运算
                <Select
                  aria-label="选区运算"
                  value={operation}
                  onChange={(e) => setOperation(e.target.value)}
                >
                  <option value="replace">新选区（Shift 累加）</option><option value="add">添加选区</option>
                  <option value="subtract">减去</option>
                  <option value="intersect">相交</option>
                </Select>
              </label>
              <Button
                disabled={!document.selection}
                onClick={() =>
                  change({
                    ...document,
                    selection: {
                      ...document.selection,
                      inverted: !document.selection.inverted,
                    },
                  })
                }
              >
                反选
              </Button>
              <Button
                disabled={!document.selection || selectionBusy}
                onClick={cropSelection}
              >
                按选区裁切画布
              </Button>
              <Button
                disabled={!document.selection}
                onClick={() => change({ ...document, selection: undefined })}
              >
                取消选区
              </Button>
            </Menu>
            <Menu name="蒙版" icon="mask">
              <Button disabled={!single} onClick={()=>{setPaintOptions({...paintOptions,target:'mask'});setTool('brush');}}>绘制蒙版</Button>
              <Button
                disabled={
                  !single ||
                  !document.selection ||
                  selectionBusy ||
                  inherited(document.layers, single, "locked")
                }
                onClick={makeMask}
              >
                选区生成蒙版
              </Button>
              <Button
                disabled={!single}
                onClick={() => patch({ clipping: !single.clipping })}
              >
                {single?.clipping ? "取消剪贴" : "剪贴到下层"}
              </Button>
              <Button
                disabled={!single?.mask}
                onClick={() => patch({ mask: undefined })}
              >
                删除蒙版
              </Button>
            </Menu>
            <Menu name="导出选项" icon="export"><label className="check"><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/>透明导出</label></Menu>
        </nav>
        <Button aria-label="向下滚动工具" title="向下滚动工具" icon="collapse" className="tool-rail-scroll" data-rail-direction="down" aria-hidden={!railEdges.down} disabled={!railEdges.down} tabIndex={railEdges.down?0:-1} style={{visibility:railEdges.down?'visible':'hidden'}} onClick={()=>scrollTools(1)} />
      </div>
      <div className="composition-tools">
      <div className="composition-breadcrumb">
        <Button icon="layout" onClick={()=>fit(true)}>所有画板</Button><span>/</span>
        {workspace?<Select aria-label="当前画板" value={workspace.board.id} onChange={e=>workspace.activate(e.target.value)}>{workspace.boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select>:<span>{document.name}</span>}

        <span className="composition-breadcrumb-space"/>
        <Button icon="adjust" aria-label={propertiesOpen?'收起属性面板':'展开属性面板'} aria-expanded={propertiesOpen} onClick={()=>propertiesOpen?closeProperties():setPropertiesOpen(true)}>属性</Button>
        <Button icon="assets" aria-pressed={materialsOpen} onClick={()=>setMaterialsOpen(!materialsOpen)}>素材</Button>
        <Button icon="fit" onClick={()=>fit()}>聚焦画板</Button>
            <Select
              aria-label="编辑缩放"
              value={view.zoom}
              onChange={(e) =>
                setView({ ...view, zoom: Number(e.target.value) })
              }
            >
              <option value={view.zoom}>{Math.round(view.zoom * 100)}%</option>
              {[0.25, 0.5, 1, 2, 4, 8]
                .filter((z) => z !== view.zoom)
                .map((z) => (
                  <option value={z} key={z}>
                    {z * 100}%
                  </option>
                ))}
            </Select>

      </div>

        <div className="composition-command-tools" ref={setToolbarHost}/>
      </div>
      {toolbarHost &&
        createPortal(
          <>

            {tool === "polygon" && (
              <Button iconOnly icon="check" disabled={polygon.length < 6} onClick={finishPolygon}>
                完成多边形
              </Button>
            )}
            {selectionBusy && fillProgress === null && (
              <Button iconOnly icon="stop" onClick={() => selectionAbort.current?.abort()}>
                取消选区处理
              </Button>
            )}

            {createPortal(exportState ? (
              <Button iconOnly icon="stop"
                disabled={exportState.phase === "save"}
                onClick={() => exportAbort.current?.abort()}
              >
                {exportState.phase === "save"
                  ? "写入中"
                  : `取消导出 ${Math.round(exportState.progress * 100)}%`}
              </Button>
            ) : (
              <Button icon="export" aria-label="导出图片"
                className="primary"
                disabled={disabled || Boolean(renderError) || issues.length > 0}
                onClick={()=>workspace?.export?workspace.export(gifIndex):exportPng()}
              >
                导出
              </Button>
            ), exportHost||toolbarHost)}
          </>,
          toolbarHost,
        )}
      {(message || renderError || issues.length > 0) && (
        <div className={`message ${renderError ? "error" : ""}`} role="status">
          {renderError || message || issues.join("；")}
        </div>
      )}
      <div className="layer-workspace">
        {materialsOpen&&<aside className="composition-materials">          <details open className="layer-materials"><summary>素材库 · {document.assets.length}</summary>
          <div className="panel-heading">
            <h2>素材库</h2>
            <Button iconOnly icon="import" loading={imageImport.importing}
              aria-label={imageImport.importing?'导入中':'导入图层素材'}
              disabled={imageImport.importing||disabled}
              onClick={() =>
                imageImport.open()
              }
            >
              ＋
            </Button>
          </div>
          {!document.assets.some(a=>!a.kind||a.kind==='image') && (
            <EmptyState compact title="暂无图片素材" description="导入图片，或从画布生图后加入排版。" />
          )}
          {document.assets.filter(a=>!a.kind||a.kind==='image').map((asset) => (
            <Button
              key={asset.id}
              className="layer-asset"
              title={`添加 ${asset.name}`}
              draggable
              onDragStart={e=>dragMaterial(e,projectId,asset.id)}
              onClick={() => addAssets([asset])}
            >
              <img src={assetUrl(asset)} alt="" loading="lazy" draggable={false}/>
              <span>{asset.name}</span>
            </Button>
          ))}
          </details>
</aside>}
 <div
          className={`layer-stage tool-${tool}`}
          ref={holder}
          tabIndex={0}
          onDragOver={e=>{if(hasImageFiles(e)){imageImport.over(e);return;}if(!disabled&&e.dataTransfer.types.includes(materialMime)){e.preventDefault();e.dataTransfer.dropEffect='copy';}}}
          onDrop={e=>{if(hasImageFiles(e)){imageImport.drop(e,at(e));return;}if(disabled||!e.dataTransfer.types.includes(materialMime))return;e.preventDefault();run(()=>addAssets([readMaterialDrop(e,projectId,latest.current.document)],at(e)));}}
          onPointerDown={down}
          onContextMenu={e=>{if(!workspace)return;const p=at(e),id=e.target.closest('[data-board-id]')?.dataset.boardId||hit(p)?.id||[...workspace.boards].reverse().find(b=>p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height)?.id;if(id)workspace.contextMenu(e,id,gifTime);}}
          onPointerMove={move}
          onPointerLeave={()=>setPaintCursor(null)}
          onPointerUp={up}
          onGotPointerCapture={e=>{if(e.target===holder.current)holder.current.dataset.layoutGesture="";}}
          onLostPointerCapture={e=>{if(e.target===holder.current)delete holder.current.dataset.layoutGesture;if(drag.current?.pointerId===e.pointerId)cancelDrag();}}
          onPointerCancel={e => {
            if(drag.current){if(drag.current.pointerId===e.pointerId)cancelDrag();}
            else painting.cancel();
          }}
          onDoubleClick={e => {
            if (tool === "polygon") {finishPolygon();return;}
            if(disabled||tool!=='select'||workspace?.board.locked||e.target.closest('button,input,textarea'))return;
            const layer=hit(at(e));
            if(layer?.kind==='text'){clearDrag();setDraft(null);setSelected([layer.id]);setEditingDraft(false);setEditingText(layer);}
          }}
          onKeyDown={(e) => {
            if(e.key==='Enter'&&tool==='pen'&&!drag.current){e.preventDefault();finishPen(false);return;}
            if (e.key === "Enter" && tool === "polygon") {
              e.preventDefault();
              finishPolygon();
            }
          }}
        >
          {(single?.kind==='image'||maskEditing)&&<div className="composition-context" onPointerDown={e=>e.stopPropagation()}>
            {maskEditing?<><span className="mask-context-label">{maskViewId?({alone:'单独查看蒙版 · 黑藏白显',original:'原图预览 · 暂时忽略蒙版',overlay:'蒙版叠加 · 红色隐藏'})[maskPreviewMode]:single.mask?.disabled?'蒙版已停用':'正在编辑蒙版 · 黑藏白显'}{maskViewId&&single.mask?.disabled?' · 已停用':''}{document.selection?' · 仅选区内':''}</span>{single.mask?.disabled&&<Button disabled={disabled||inherited(document.layers,single,"locked")} onClick={()=>patch({mask:{...single.mask,disabled:false}})}>启用当前蒙版</Button>}<Button disabled={disabled||selectionBusy||painting.busy||!document.selection} onClick={deselect}>取消选区</Button><Button className="primary" icon="check" onClick={()=>{setPaintOptions({...paintOptions,target:'image'});setTool('select')}}>完成蒙版</Button></>:<><Button icon="replace" onClick={()=>setReplacement({targetId:single.id,assetId:single.assetId})}>替换图片</Button><Button icon="mask" onClick={()=>{setPaintOptions({...paintOptions,target:'mask'});setTool('brush');setPropertiesOpen(true)}}>编辑蒙版</Button><Button icon="adjust" onClick={()=>setInspectorTab('adjustments')}>调整</Button></>}
          </div>}
          {painting.busy&&<div className="painting-status" role="status">{painting.pending?`正在保存笔触 · 后续 ${painting.pending} 笔等待`:'正在保存笔触…'}</div>}
          <canvas ref={canvas} aria-label="图层画布" data-mask-view={maskViewId||undefined} data-mask-mode={maskViewId?maskPreviewMode:"composite"} />
          <canvas
            className="selection-preview" style={{visibility:maskViewId?"hidden":undefined}}
            ref={selectionPreview}
            aria-hidden="true"
          />
          <svg className="layer-overlay" width="100%" height="100%">
            <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
              <defs>
                <pattern
                  id="layer-grid"
                  width={
                    (layout.gridSize || 20) *
                    Math.max(
                      1,
                      Math.ceil(5 / ((layout.gridSize || 20) * view.zoom)),
                    )
                  }
                  height={
                    (layout.gridSize || 20) *
                    Math.max(
                      1,
                      Math.ceil(5 / ((layout.gridSize || 20) * view.zoom)),
                    )
                  }
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d={`M 0 0 H ${(layout.gridSize || 20) * Math.max(1, Math.ceil(5 / ((layout.gridSize || 20) * view.zoom)))} M 0 0 V ${(layout.gridSize || 20) * Math.max(1, Math.ceil(5 / ((layout.gridSize || 20) * view.zoom)))}`}
                    stroke="var(--muted)"
                    strokeWidth={0.5 / view.zoom}
                  />
                </pattern>
              </defs>
              {layout.grid && (
                <rect
                  width={document.width}
                  height={document.height}
                  fill="url(#layer-grid)"
                  opacity=".4"
                />
              )}
              {(layout.guides || []).map((g, i) => (
                <line
                  key={i}
                  data-handle={`guide-${i}`}
                  style={{ cursor: g.axis === "x" ? "ew-resize" : "ns-resize" }}
                  x1={g.axis === "x" ? g.position : 0}
                  y1={g.axis === "y" ? g.position : 0}
                  x2={g.axis === "x" ? g.position : document.width}
                  y2={g.axis === "y" ? g.position : document.height}
                  stroke="var(--accent)"
                  strokeWidth={3 / view.zoom}
                  opacity=".7"
                />
              ))}
              {(workspace?.boards || [{id:'main',x:0,y:0,width:document.width,height:document.height,name:document.name}]).map(b=><g key={b.id} data-board-label={b.id} transform={boardDraft?.id===b.id?`translate(${boardDraft.dx} ${boardDraft.dy})`:undefined}>
                <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke={workspace?.board.id===b.id?'var(--accent)':'var(--line)'} strokeWidth={1/view.zoom}/>
                <rect className="board-label-hit" data-board-id={b.id} x={b.x} y={b.y-30/view.zoom} width={Math.max(160,b.name.length*14)/view.zoom} height={27/view.zoom} fill="transparent"/>
                <text data-board-id={b.id} x={b.x} y={b.y-10/view.zoom} fontSize={12/view.zoom} fill={workspace?.board.id===b.id?'var(--accent)':'var(--muted)'} style={{cursor:'move'}}>{b.name} · {b.width} × {b.height}</text>
              </g>)}
              {tool==='pen'&&<PenPreview nodes={pen} zoom={view.zoom}/>}
              {tool==='nodes'&&single?.shape==='path'&&!single.warp&&!inherited(shown.layers,single,'locked')&&<AnchorControls ref={anchorOverlay} layer={single} base={drag.current?.mode==='anchor'?drag.current.layer:single} matrix={worldMatrix(shown.layers,single)} view={view} size={size} contour={contour} active={activeAnchor}/>}
              {shapeDraft&&<g className="shape-draft" pointerEvents="none" transform={`translate(${shapeDraft.x} ${shapeDraft.y})`}>
                <ShapePath shape={shapeDraft.shape} linePoints={shapeDraft.linePoints} width={shapeDraft.width} height={shapeDraft.height} radius={shapeDraft.radius} fill={shapeDraft.fill?shapeDraft.color:'none'} stroke={shapeDraft.stroke} strokeWidth={shapeDraft.strokeWidth}/>
                <rect width={shapeDraft.width} height={shapeDraft.height} fill="none" stroke="var(--accent)" strokeWidth={1/view.zoom} strokeDasharray={`${4/view.zoom} ${3/view.zoom}`}/>
                <text x={shapeDraft.width/2} y={shapeDraft.height+20/view.zoom} textAnchor="middle" fontSize={11/view.zoom} fill="var(--accent)">{Math.round(shapeDraft.width)} × {Math.round(shapeDraft.height)} px</text>
              </g>}
              {showControls && tool==='select' && selected.map((id) => {
                const l = shown.layers.find((l) => l.id === id);
                if (!l||editingText?.id===id) return null;
                if(l.kind==='shape'&&l.shape==='line'&&!l.warp&&!warp&&single?.id===id&&!inherited(shown.layers,l,'locked')){const m=worldMatrix(shown.layers,l),ends=lineEndpoints(l.width,l.height,l.linePoints).map(p=>point(m,p.x,p.y));return <g key={id}>{single?.id===id&&!inherited(shown.layers,l,'locked')&&ends.map((p,i)=><circle key={i} data-handle={`line-${i}`} aria-label={i?'直线终点':'直线起点'} cx={p.x} cy={p.y} r={6/view.zoom} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.5/view.zoom} style={{cursor:'crosshair'}}/>)}</g>;}
                const pts = selectionCorners(l);
                return <CanvasSelection key={id} points={pts} zoom={view.zoom} editable={single?.id===id&&!inherited(shown.layers,l,'locked')} warp={warp&&l.kind!=='group'}/>;
              })}
              {brushOutline&&<polygon points={brushOutline} fill="none" stroke="var(--text)" strokeWidth={1/view.zoom} style={{pointerEvents:'none'}}/>}
              {painting.guide&&<line aria-label="直线绘画引导" x1={painting.guide.from.x} y1={painting.guide.from.y} x2={painting.guide.to.x} y2={painting.guide.to.y} stroke="var(--accent)" strokeWidth={1.5/view.zoom} strokeDasharray={`${5/view.zoom} ${3/view.zoom}`} style={{pointerEvents:'none'}}/>}
              {sourceMarker&&<path aria-label="修图来源" d={`M ${sourceMarker.x-8/view.zoom} ${sourceMarker.y} h ${16/view.zoom} M ${sourceMarker.x} ${sourceMarker.y-8/view.zoom} v ${16/view.zoom}`} stroke="var(--accent)" strokeWidth={1.5/view.zoom} style={{pointerEvents:'none'}}/>}
              {[
                ...(document.selection?.paths || []),
                ...(pathDraft ? [{ points: pathDraft }] : []),
                ...(polygon.length ? [{ points: polygon }] : []),
              ].map((path, i) => (
                <polygon
                  key={i}
                  points={path.points
                    .reduce(
                      (pairs, n, index, all) =>
                        index % 2
                          ? pairs
                          : [...pairs, `${n},${all[index + 1]}`],
                      [],
                    )
                    .join(" ")}
                  fill="none"
                  stroke={
                    document.selection?.inverted
                      ? "var(--danger)"
                      : "var(--accent)"
                  }
                  strokeWidth={1 / view.zoom}
                  strokeDasharray={`${4 / view.zoom} ${4 / view.zoom}`}
                />
              ))}
            </g>
          </svg>
          {workspace&&<CanvasRulers view={view} size={size}/>}
          {arrangement.box&&!editingText&&tool!=='nodes'&&!maskEditing&&!draft&&!motion&&!pathDraft&&!shapeDraft&&
            !pen.length&&!polygon.length&&!painting.busy&&!selectionBusy&&view===rasterView&&!rasterDraft&&
            <LayerAlignment box={arrangement.box} view={view} size={size} boards={workspace?.boards} imageTools={single?.kind==='image'}
              count={arrangement.count} target={target} choose={value=>selectionOption('alignTo',value)} hasSelection={!!selection}
              disabled={layoutDisabled} apply={arrange}/>}
          {showControls&&single&&!editingText&&tool==='select'&&<SelectionSizeBadge points={selectionCorners(single)} view={view} size={size}/>}
          {editingText&&<LayerTextEditor key={editingText.id} layer={editingText} layers={document.layers} view={view} maxWidth={document.width} draft={editingDraft} onDraft={setEditingDraft}
            onCancel={()=>{setEditingText(null);holder.current?.focus({preventScroll:true});}}
            onCommit={value=>{
              const now=latest.current.document,layer=now.layers.find(l=>l.id===editingText.id);
              if(!layer||latest.current.disabled||inherited(now.layers,layer,'locked')||latest.current.workspace?.board.locked){setEditingText(null);return;}
              if(!sameText(layer,editingText)){setMessage('文字已被其他操作修改，请复制当前输入后按 Esc 取消，再重新编辑。');return false;}
              if(!sameText(value,editingText)){
                try{
                  const next={...layer,...value};
                  const measured=next.textAutoFit?fitLayerText(next,now.width):next;
                  const layers=now.layers.map(l=>l.id===layer.id?measured:l);
                  validateLayers(layers);if(change({...now,layers})===false)return false;
                }
                catch(error){setMessage(error.message);return false;}
              }
              setEditingText(null);
            }}/> }
          <div className="layer-stage-hint">
            {editingText ? '正在编辑文字 · Enter 换行 · Ctrl/⌘＋Enter 完成 · Esc 取消' : tool === "select"
              ? `双击文字编辑 · Shift 多选 · 拖动移动 · ${window.tugou.platform === "darwin" ? "⌘" : "Ctrl"}+滚轮缩放`
              : tool==='pen'?'点击加点 · 拖出手柄 · 点首节点闭合 · Enter 完成':tool==='nodes'?'拖动锚点或曲线手柄': tool === "shape"
                ? (shapeOptions.shape==='line'?"拖拽绘制直线 · Shift 约束角度 · Esc 取消":"拖拽绘制形状 · Shift 等比 · Esc 取消")
              : tool === "hand"
                ? "拖动平移"
                : retouchTools.some(([id])=>id===tool)
                  ? `${sourceArmed?'点击设置来源 · ':['clone','heal'].includes(tool)?'Alt 点击取样 · ':''}拖动修图 · Esc 取消笔触`
                : ['brush','eraser'].includes(tool)
                  ? "拖动绘画 · Shift 点击连线 · Esc 取消笔触"
                : tool === "polygon"
                  ? "逐点点击 · Enter 或顶部按钮完成 · Esc 取消"
                  : ["wand", "range"].includes(tool)
                    ? "点击颜色取样 · Shift 累加 · Esc 返回"
                    : `${tool === "lasso" ? "套索" : tool === "ellipse" ? "椭圆" : "矩形"}选区 · 拖动绘制 · Esc 返回`}
          </div>
        </div>
        {propertiesOpen&&<aside className="layer-sidebar layer-property-sidebar" aria-label="图层属性">
          <div className="panel-heading layer-property-heading"><strong>{maskEditing?'蒙版属性':tool!=='select'?'工具与属性':'属性'}</strong><Button iconOnly icon="close" onClick={closeProperties}>关闭属性面板</Button></div>
          <div className="composition-inspector">
      {(animation.frames.length>1||animation.error)&&<div className="gif-timeline">{animation.error?<span role="alert">{animation.error}</span>:<><Button onClick={()=>setGifPlaying(v=>!v)}>{gifPlaying?'暂停动画':'播放动画'}</Button><input aria-label="图层动画帧" type="range" min={1} max={animation.frames.length} value={gifIndex+1} onChange={e=>{setGifPlaying(false);setGifFrame(+e.target.value-1)}}/><span>第 {gifIndex+1} / {animation.frames.length} 帧 · {gifTime} ms</span></>}</div>}
            <details className="layer-tool-settings" key={tool+'-'+boardTool+'-'+maskEditing+'-'+single?.kind} open={tool!=='select'}><summary>{tool==='shape'?'绘制选项':'工具选项'}</summary>
<div className="layer-parameter-row">
        <span className="context-tool"><Icon name={boardTool&&tool==='select'?'layout':isBrushTool(tool)?'brush':tool==='select'?'action':tool==='hand'?'select':'selection'}/>{boardTool&&tool==='select'?'画板':maskEditing?(maskPainting?'蒙版画笔':'蒙版选区'):tool==='select'?(single?.kind==='shape'?'形状':single?.kind==='adjustment'?'调色':'移动'):tool==='hand'?'抓手':tool==='pen'?'钢笔':tool==='nodes'?'锚点':tool==='shape'?'形状':isBrushTool(tool)?'画笔':'选区'}</span>
        {tool==='pen'?<div><Button disabled={pen.length<2} onClick={()=>finishPen(false)}>完成开放路径</Button><Button disabled={pen.length<3} onClick={()=>finishPen(true)}>闭合路径</Button></div>:tool==='nodes'?<VectorNodeOptions layer={single} contour={contour} active={activeAnchor} locked={inspectorLocked||!!single?.warp} selectContour={i=>{setContour(i);setAnchorIndex(0);}} selectAnchor={selectAnchorNumber} edit={changeAnchorCount} done={()=>setTool('select')}/>:tool==='shape'?<ShapeOptions options={shapeOptions} change={setShapeOptions} disabled={disabled}/>:tool==='select'&&single?.kind==='adjustment'?null:tool==='select'?<div className="move-tool-options">
          <label className="check"><input type="checkbox" checked={autoSelect} onChange={e=>selectionOption('autoSelect',e.target.checked)}/>自动选择</label>
          <Select aria-label="自动选择范围" value={selectScope} onChange={e=>selectionOption('selectScope',e.target.value)}><option value="layer">图层</option><option value="group">分组</option></Select>
          <label className="check"><input type="checkbox" checked={showControls} onChange={e=>selectionOption('showControls',e.target.checked)}/>显示变换控件</label>
          <Button icon="mask" disabled={!single||disabled||inherited(document.layers,single,'locked')} onClick={()=>{setPaintOptions({...paintOptions,target:'mask'});setTool('brush');setPropertiesOpen(true)}}>编辑蒙版</Button>
          <Button icon="adjust" onClick={()=>setInspectorTab('adjustments')}>调整</Button>
        </div>:<label className="tool-choice"><Select aria-label="当前编辑工具" value={tool} onChange={e=>setTool(e.target.value)}>{[['hand','平移'],['brush','画笔'],['eraser','橡皮'],...(maskEditing?[]:retouchTools),...selectionTools].map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label>}
            {["wand", "range"].includes(tool) && (
              <>
                <NumberField
                  label="容差"
                  value={tolerance}
                  min={0}
                  max={255}
                  onChange={setTolerance}
                />
                <Select
                  aria-label="取样范围"
                  value={sampleMode}
                  onChange={(e) => setSampleMode(e.target.value)}
                >
                  <option value="all">可见图层</option>
                  <option value="layer">当前图层</option>
                </Select>
              </>
            )}
{isBrushTool(tool) && <PaintTools compact options={paintOptions} onChange={setPaintOptions} onNew={newPaintLayer} onCopy={copyForRetouch} canCopy={!disabled&&single?.kind==='image'&&!inherited(document.layers,single,'locked')&&!inherited(document.layers,single,'hidden')} busy={painting.busy} maskDisabled={Boolean(maskEditing&&single?.mask?.disabled)} tool={tool} source={paintSource?.layerId===single?.id?paintSource:null} onSample={()=>{setSourceArmed(true);setMessage('')}} onClear={()=>setPaintSource(null)}/>}
{selectionTools.some(([id])=>id===tool)&&<SelectionActions operation={operation} onOperation={setOperation} hasSelection={Boolean(document.selection)} busy={disabled||selectionBusy||painting.busy} canSubject={single?.kind==='image'} subject={selectSubject} subjectStatus={subjectStatus} subjectStage={subjectStage} invert={()=>change({...document,selection:{...document.selection,inverted:!document.selection.inverted}})} clear={()=>change({...document,selection:undefined})}/>}
{document.selection&&single?.kind==='image'&&!maskEditing&&<div className="selection-actions"><ColorControl aria-label="选区填充颜色" value={fillColor} onChange={e=>setFillColor(e.target.value)}/><Button disabled={disabled||selectionBusy||painting.busy||inherited(document.layers,single,'locked')} onClick={()=>fillSelection(false)}>填充图片选区</Button></div>}
{maskEditing&&<div className="mask-selection-actions">
  {!maskPainting&&<MaskInk value={paintOptions.maskMode} onChange={maskMode=>setPaintOptions({...paintOptions,maskMode})} disabled={disabled||selectionBusy||painting.busy||single?.mask?.disabled}/>}
  <Button aria-label="填充蒙版选区" disabled={disabled||selectionBusy||painting.busy||!document.selection||single.mask?.disabled||inherited(document.layers,single,'locked')||inherited(document.layers,single,'hidden')} onClick={()=>fillSelection(false)}>填充选区</Button>
</div>}

{tool==='select'&&single?.kind!=='adjustment'&&single?.effects?.length>0&&<EffectTools key={`${single.id}-${effectId}`} layer={{...single,locked:inherited(document.layers,single,'locked')||disabled}} effectId={effectId} onSelect={setEffectId} patch={patch} onDone={()=>setSelected([])}/>}
{fillProgress !== null ? <><span role="status">内容感知填充 {Math.round(fillProgress * 100)}%</span><Button onClick={() => selectionAbort.current?.abort()}>取消填充</Button></> : null}</div>
            </details>
            {appearancePanel}
            {tool==='select'&&!maskEditing&&single?.kind==='adjustment'&&adjustmentTypes[single.adjustment?.type]&&<AdjustmentTools key={'adjustment-'+single.id} layer={{...single,locked:inherited(document.layers,single,'locked')||workspace?.board.locked||disabled}} patch={patch} onCompare={held=>setComparison(held?single.id:null)} comparing={comparison===single.id} onPreview={previewAdjustment} onAdjustmentCommit={commitAdjustment} onDone={closeProperties}/>}
            {propertiesPanel}
            {single?.shape==='path'&&tool!=='nodes'&&<Button icon="edit" disabled={disabled||!!single.warp||inherited(document.layers,single,'locked')} onClick={()=>setTool('nodes')}>编辑锚点</Button>}
            {single&&workspace&&<label className="layer-board-transfer">所属画板<Select aria-label="移动图层到画板" value={workspace.board.id} onChange={e=>workspace.relocate(selected,e.target.value,'inside')} disabled={disabled||inherited(document.layers,single,'locked')}>{workspace.boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></label>}
          </div>
        </aside>}
        <aside className="layer-sidebar" aria-label="图层与历史记录">
          <div className="panel-heading inspector-tabs" aria-label="图层辅助面板">
            {[['adjustments','调整'],['navigation','导航']].map(([id,label])=><Button key={id} aria-pressed={inspectorTab===id} onClick={()=>setInspectorTab(id)}>{label}</Button>)}
            <Button className="layer-inspector-toggle" aria-label="打开所选属性" icon="adjust" aria-expanded={propertiesOpen} onClick={()=>setPropertiesOpen(true)}>属性</Button>
          </div>
          <div className="layer-dock-inspector">{inspectorTab==='adjustments'?<div className="inspector-adjustments"><h3>调整图层</h3><p className="inspector-caption">添加可随时修改的调整图层</p><div className="adjustment-grid">{Object.entries(adjustmentTypes).map(([type,spec])=><Button key={type} icon="adjust" disabled={disabled||selectionBusy} onClick={()=>addAdjustment(type)}>{spec.label}</Button>)}</div></div>:<div className="inspector-navigation"><div className="board-actions"><Button icon="fit" onClick={()=>fit(true)}>所有画板</Button><Button icon="fit" onClick={()=>fit()}>聚焦画板</Button></div>{workspace?.boards.map(b=><Button key={b.id} aria-pressed={workspace.board.id===b.id} onClick={()=>{workspace.activate(b.id);setBoardTool(true)}}><Icon name="layout"/><span>{b.name}<small>{b.width} × {b.height}</small></span></Button>)}</div>}</div>
          <div className="composition-layer-heading"><Button aria-pressed={layerTab==='layers'} onClick={()=>setLayerTab('layers')}>图层</Button><Button aria-pressed={layerTab==='history'} onClick={()=>setLayerTab('history')}>历史记录</Button><span/><Button iconOnly icon="search" aria-pressed={searchOpen} onClick={()=>{setSearchOpen(!searchOpen);setLayerTab('layers');if(searchOpen)setLayerQuery('')}}>搜索图层</Button></div>
          {layerTab==='layers'?<>
          {searchOpen&&<div className="layer-search"><Input autoFocus aria-label="搜索图层名称" placeholder="搜索图层…" value={layerQuery} onChange={e=>setLayerQuery(e.target.value)} allowClear/></div>}
          <div className="layer-filter-row"><span>锁定</span><Button iconOnly icon="locked" disabled={!single||disabled} onClick={()=>workspace?workspace.patchLayer(single.id,{locked:!single.locked}):commit(document.layers.map(l=>l.id===single.id?{...l,locked:!l.locked}:l))}>{single?.locked?'解锁所选图层':'锁定所选图层'}</Button><span className="filter-spacer"/><label>筛选<Select aria-label="筛选图层类型" value={layerFilter} onChange={e=>setLayerFilter(e.target.value)}>{[['all','全部'],['image','图片'],['text','文字'],['group','画板与分组'],['shape','形状'],['adjustment','调整']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label></div>
          {layerTree}
          </>:<div className="composition-history"><div className="board-actions"><Button icon="undo" disabled={!editHistory?.past.length||disabled} onClick={editHistory?.undo}>撤销</Button><Button icon="redo" disabled={!editHistory?.future.length||disabled} onClick={editHistory?.redo}>重做</Button></div><p className="inspector-caption">本次打开工程的记录 · {editHistory?.past.length||0} 步可撤销</p><div className="history-current"><Icon name="edit"/> 当前状态</div>{[...(editHistory?.past||[])].reverse().map((snapshot,i)=><div className="history-entry" key={i}><Icon name="clock"/><span>编辑前 {i+1}<small>{snapshot.layers.length} 个图层 · {snapshot.name}</small></span></div>)}</div>}
          <div className="composition-layer-footer">
            <Button iconOnly icon="mask" disabled={!single||disabled||inherited(document.layers,single,'locked')} onClick={()=>{setPaintOptions({...paintOptions,target:'mask'});setTool('brush');setPropertiesOpen(true)}}>编辑所选蒙版</Button>
            <Button iconOnly icon="adjust" onClick={()=>setInspectorTab('adjustments')}>添加调整图层</Button>
            <Button iconOnly icon="open" disabled={!selected.length||disabled} onClick={()=>action(()=>groupLayers(document.layers,selected))}>编组所选图层</Button>
            <Button iconOnly icon="copy" disabled={!selected.length||disabled} onClick={()=>action(()=>duplicateLayers(document.layers,selected))}>复制所选图层</Button>
            <Button iconOnly icon="add" onClick={()=>add('text',{name:'文字',text:'输入文字',fontSize:48,color:'#333333'})}>新建文字图层</Button>
            <Button iconOnly icon="delete" disabled={!selected.length||disabled} onClick={deleteCurrent}>{document.selection?"清除选区内容":paintOptions.target==="mask"?"删除所选蒙版":"删除所选图层"}</Button>
          </div>


        </aside>
      </div>
      {replacement&&<ReplaceImageDialog document={document} change={change} {...replacement} replaceDocument={replaceLayerAsset} description="保留中心、宽度、旋转、蒙版和特效，按新图片比例替换；已有笔刷结果保留到素材库。" close={()=>setReplacement(null)}/>}
    </div>
  );
}
