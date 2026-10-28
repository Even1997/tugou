import {ColorControl} from './color-control.jsx';
import {CanvasRulers,SelectionSizeBadge,CanvasSelection} from './canvas-chrome.jsx';
import {Select} from './select.jsx';
import {deleteTarget,editorShortcut} from '../core/editor-commands.cjs';
import {commandFor,shortcutBlocked} from '../core/shortcuts.cjs';
import {usePreferences} from './preferences.jsx';
import {maskSelection,maskView} from './mask-view.js';
import {useSubjectStatus} from './use-subject-status.js';
import {Button, Icon, Input, EmptyState} from './components.jsx';
import {Tooltip} from 'antd';
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  createLayer,
  corners,
  localBounds,
  matrix,
  bounds,
  worldMatrix,
  inverse,
  point,
  localPoint,
  roots,
  descendants,
  inherited,
  moveLayers,
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
import {shapeBounds,shapes} from '../core/shapes.cjs';
import {ShapePicker,ShapeOptions,ShapePath,shapeDefaults} from './shape-tools.jsx';
import {NumberField} from './number-field.jsx';
import {LayerProperties, LayerAppearance} from './layer-properties.jsx';
import { LayerTree } from "./layer-tree.jsx";
import {
  selectionCanvas,
  alphaOf,
  alphaCanvas,
  pngBytes,
  calculateSelection,
  surface,
} from "./selection.js";
import { Compositor } from "./composite.js";
import { assetUrl } from "./canvas.jsx";
import { PaintTools, MaskInk, paintDefaults } from './paint-tools.jsx';
import { usePainting } from './use-painting.js';
import { retouchTools, isBrushTool } from './retouch.js';
import { fillImageSelection } from './content-fill.js';
import { paintGeometry, fillMaskSelection } from './paint-target.js';
import {SelectionActions,selectionTools} from './selection-tools.jsx';
import { fields as adjustmentTypes, defaults as adjustmentDefaults } from '../core/adjustments.cjs';
import { AdjustmentTools } from './adjustment-tools.jsx';
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
          if (e.target.closest("button"))
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
  const [inspectorTab,setInspectorTab]=useState('properties'),[layerTab,setLayerTab]=useState('layers');
  const [layerQuery,setLayerQuery]=useState(''),[layerFilter,setLayerFilter]=useState('all'),[searchOpen,setSearchOpen]=useState(false);
  const [autoSelect,setAutoSelect]=useState(true),[selectScope,setSelectScope]=useState('layer'),[showControls,setShowControls]=useState(true);
  const [shapeOptions,setShapeOptions]=useState(shapeDefaults),[shapeDraft,setShapeDraft]=useState(null);
  const [boardTool,setBoardTool]=useState(!selected.length);
  const [exportHost,setExportHost]=useState(null);
  useEffect(()=>setExportHost(window.document.getElementById('composition-export')),[]);
  useEffect(()=>{if(selected.length)setBoardTool(false)},[selected]);
  const [toolbarHost, setToolbarHost] = useState(null);
  const [materialsOpen,setMaterialsOpen]=useState(false);
  const [boardDraft,setBoardDraft]=useState(null);
  const spaceHeld=useRef(false);
  const [merging, setMerging] = useState(false);
  const [effectId,setEffectId]=useState(null);
  const [paintOptions, setPaintOptions] = useState({...paintDefaults,target:workspace?.maskId&&workspace.maskId===selected[0]?'mask':'image'});
  const [paintSource,setPaintSource]=useState(null),[sourceArmed,setSourceArmed]=useState(false);
  const [paintCursor,setPaintCursor]=useState(null);
  const [maskViewId,setMaskViewId]=useState(null);
  const [maskPreviewMode,setMaskPreviewMode]=useState("alone");
  const changeMaskView=(id,mode)=>{setMaskPreviewMode(mode);setMaskViewId(mode==="composite"?null:id)};
  const commands=useRef({});
  const [tool, setTool] = useState(workspace?.maskId&&workspace.maskId===selected[0]?'brush':'select'),
    [view, setView] = useState(workspace?.initialView || { x: 40, y: 40, zoom: 0.45 }),
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
  useEffect(()=>setSourceArmed(false),[tool]);
  const holder = useRef(null),
    canvas = useRef(null),
    drag = useRef(null),
    engine = useRef(null),
    exportAbort = useRef(null),
    latest = useRef(null),
    mounted = useRef(true);
  const selectionAbort = useRef(null),
    selectionPreview = useRef(null),
    selectionCache = useRef(null);
  useEffect(() => () => selectionAbort.current?.abort(), [document]);
  const shown = draft || document;
  useEffect(() => {
    const close = (e) =>
      window.document.querySelectorAll(".layer-menu[open],.composition-more[open],.shape-picker[open]").forEach((menu) => {
        if (!menu.contains(e.target)) menu.open = false;
      });
    window.document.addEventListener("pointerdown", close);
    const escape=e=>{if(e.key==='Escape')window.document.querySelectorAll('.layer-menu[open],.composition-more[open],.shape-picker[open]').forEach(menu=>{menu.open=false})};
    window.document.addEventListener('keydown',escape);
    return () => {window.document.removeEventListener("pointerdown", close);window.document.removeEventListener('keydown',escape)};
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
    paintTarget:paintOptions.target,
    workspace,
  };
  if (!engine.current) engine.current = new Compositor();
  const painting = usePainting({latest,engine,change,setMessage});
  useEffect(()=>{if(selected.length!==1||selected[0]!==maskViewId||paintOptions.target!=='mask'||!document.layers.find(l=>l.id===maskViewId)?.mask)setMaskViewId(null)},[selected,paintOptions.target,document.layers,maskViewId]);
  const single = shown.layers.find(
    (l) => selected.length === 1 && l.id === selected[0],
  );
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
  const commit = (layers) => {
    validateLayers(layers);
    change({ ...latest.current.document, layers });
  };
  const patch = (values) => {
    if (single && !inherited(document.layers, single, "locked"))
      run(() =>
        commit(
          document.layers.map((l) =>
            l.id === single.id ? { ...l, ...values } : l,
          ),
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
    setSelected((previous) =>
      previous.filter((id) => document.layers.some((l) => l.id === id)),
    );
  }, [document.layers]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      exportAbort.current?.abort();
      selectionAbort.current?.abort();
      engine.current.dispose();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController(),
      output = window.document.createElement("canvas");
    if (!size.width || !size.height) return;
    canvas.current.dataset.rendering='true';
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const frame=requestAnimationFrame(()=>{
    const previewDoc=painting.preview?.document||shown;
    const render=maskViewId&&maskPreviewMode==="alone"?async()=>{
      const mask=await maskView(previewDoc,previewDoc.layers.find(l=>l.id===maskViewId),engine.current,{width:Math.ceil(size.width*ratio),height:Math.ceil(size.height*ratio),scale:view.zoom*ratio,transform:[view.zoom*ratio,0,0,view.zoom*ratio,view.x*ratio,view.y*ratio],maskOverrides:painting.preview?.maskOverrides});
      output.width=mask.width;output.height=mask.height;output.getContext('2d').drawImage(mask,0,0);mask.width=mask.height=1;
    }:()=>engine.current
      .render(workspace ? workspace.compose(painting.preview?.document || shown,boardDraft) : painting.preview?.document || shown, output, {
        maskPreview: maskViewId?{id:maskViewId,mode:maskPreviewMode}:undefined,
        overrides: painting.preview?.overrides,
        maskOverrides: painting.preview?.maskOverrides,
        scale: view.zoom * ratio,
        x: -view.x / view.zoom,
        y: -view.y / view.zoom,
        width: size.width / view.zoom,
        height: size.height / view.zoom,
        signal: controller.signal,
      });
    render()
      .then(() => {
        if (controller.signal.aborted) return;
        canvas.current.width = output.width;
        canvas.current.height = output.height;
        canvas.current.getContext("2d").drawImage(output, 0, 0);
        setRenderError("");
        canvas.current.dataset.rendering='false';
      })
      .catch((error) => {
        if (!controller.signal.aborted) setRenderError(error.message);
      })
      .finally(() => {
        output.width = output.height = 1;
      });
    });
    return () => {cancelAnimationFrame(frame);controller.abort()};
  }, [shown, view, size, painting.preview,boardDraft,maskViewId,maskPreviewMode]);
  useEffect(() => {
    let disposed = false;
    if (!selectionPreview.current || !size.width) return;
    const c = selectionPreview.current;
    c.width = size.width;
    c.height = size.height;
    if (!document.selection) return;
    const cache = selectionCache.current;
    if (
      !cache ||
      cache.selection !== document.selection ||
      cache.width !== document.width ||
      cache.height !== document.height
    )
      selectionCache.current = {
        selection: document.selection,
        width: document.width,
        height: document.height,
        promise: selectionCanvas(document, engine.current),
      };
    selectionCache.current.promise
      .then((mask) => {
        if (disposed) return;
        const ctx = c.getContext("2d");
        ctx.drawImage(
          mask,
          view.x,
          view.y,
          document.width * view.zoom,
          document.height * view.zoom,
        );
        ctx.globalCompositeOperation = "source-in";
        ctx.fillStyle = getComputedStyle(holder.current).getPropertyValue(
          "--accent",
        );
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.globalCompositeOperation = "source-over";
      })
      .catch((e) => {
        if (!disposed) setMessage(e.message);
      });
    return () => {
      disposed = true;
    };
  }, [document.selection, document.width, document.height, view, size]);
  useEffect(() => {
    const element = holder.current;
    const wheel = (e) => {
      e.preventDefault();
      const v = latest.current.view;
      if (e.ctrlKey || e.metaKey) {
        const rect = element.getBoundingClientRect(),
          x = e.clientX - rect.left,
          y = e.clientY - rect.top,
          zoom = Math.max(
            0.02,
            Math.min(8, v.zoom * Math.exp(-e.deltaY * 0.002)),
          );
        setView({
          zoom,
          x: x - ((x - v.x) * zoom) / v.zoom,
          y: y - ((y - v.y) * zoom) / v.zoom,
        });
      } else setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  const action = (fn) =>
    run(() => {
      const result = fn();
      if (result.layers) {
        commit(result.layers);
        setSelected(result.ids);
      } else commit(result);
    });
  useEffect(() => {
    const key = (e) => {
      if (
        shortcutBlocked(e) ||
        disabled
      )
        return;
      const v = latest.current;
      const command=editorShortcut(e,window.tugou.platform,preferences.value.shortcuts);
      if(command){e.preventDefault();commands.current[command]?.();return;}
      const shortcut=commandFor(e,window.tugou.platform,preferences.value.shortcuts);
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
        drag.current = null;
        setBoardDraft(null);
        setShapeDraft(null);
        setDraft(null);
        setPathDraft(null);
        setTool("select");
        setPolygon([]);
        selectionAbort.current?.abort();
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        action(() =>
          moveLayers(
            v.document.layers,
            v.selected,
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
            e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
          ),
        );
      }
    };
    window.addEventListener("keydown", key);
    const release=e=>{if(!e||e.type==='blur'||(e.code||e.key)===spaceHeld.current){spaceHeld.current=false;holder.current?.classList.remove('space-pan')}};
    window.addEventListener('keyup',release);window.addEventListener('blur',release);
    return () => {release();window.removeEventListener("keydown", key);window.removeEventListener('keyup',release);window.removeEventListener('blur',release)};
  }, [disabled,preferences.value.shortcuts]);
  const add = (kind, extra = {}) => {
    const layer = createLayer(kind, {
      x: document.width * 0.15,
      y: document.height * 0.15,
      ...extra,
    });
    commit([...document.layers, layer]);
    setSelected([layer.id]);
    setTool("select");
  };
  const addAssets = (assets, dropPoint) => {
    if (!assets.length) return;
    if(assets.some(a=>a.kind&&a.kind!=='image'))throw Error('图层合成仅接受图片，请先从视频提取画面');
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
      if (
        local.x >= 0 &&
        local.y >= 0 &&
        local.x <= l.width &&
        local.y <= l.height
      )
        return l;
    }
    return null;
  };
  const down = (e) => {
    if (disabled || e.button === 2) return;
    const p = at(e),
      handle = e.target.dataset.handle;
    e.preventDefault();
    if(spaceHeld.current||e.button===1||tool==='hand'){
      e.preventDefault();holder.current.setPointerCapture(e.pointerId);drag.current={start:p,view,mode:'pan'};return;
    }
    if(isBrushTool(tool)&&paintOptions.target==='mask'&&single?.mask?.disabled)return;
    if(tool==='shape'){
      const target=workspace?[...workspace.boards].reverse().find(b=>p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height):null;
      if(workspace&&!target){setMessage('请在画板内拖拽绘制');return;}
      if(target?.locked){setMessage('请先解锁画板');return;}
      if(!shapeOptions.fill&&!shapeOptions.strokeWidth){setMessage('请启用填充或设置描边宽度');return;}
      holder.current.setPointerCapture(e.pointerId);holder.current.focus();setMessage('');setSelected([]);
      drag.current={start:p,mode:'shape',options:shapeOptions,board:target};return;
    }
    const boardId=e.target.dataset.boardId;
    if(boardId&&workspace){
      if(workspace.boards.find(b=>b.id===boardId)?.locked){setMessage('请先解锁画板');return;}
      holder.current.setPointerCapture(e.pointerId);setSelected([]);drag.current={start:p,view,mode:e.target.dataset.boardResize?'board-resize':'board',boardId};return;
    }
    if(workspace){const other=[...workspace.boards].reverse().find(b=>b.id!==workspace.board.id&&p.x>=b.x&&p.y>=b.y&&p.x<=b.x+b.width&&p.y<=b.y+b.height);if(other){workspace.activate(other.id);return;}}
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
      holder.current.focus();
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
    const base = { start: p, doc: document, view, ids: selected };
    if (handle?.startsWith("guide-")) drag.current = { ...base, mode: handle };
    else if (e.button === 1 || tool === "hand")
      drag.current = { ...base, mode: "pan" };
    else if (handle && single && !inherited(document.layers, single, "locked"))
      drag.current = { ...base, mode: handle, layer: single };
    else if (["rect", "ellipse", "lasso"].includes(tool)) {
      drag.current = { ...base, mode: tool, points: [p.x, p.y] };
      setPathDraft([p.x, p.y]);
    } else {
      let target = autoSelect ? hit(p) : shown.layers.find(l=>selected.includes(l.id));
      if(autoSelect&&selectScope==='group'&&target){let parent=shown.layers.find(l=>l.id===target.parentId);while(parent){target=parent;parent=shown.layers.find(l=>l.id===parent.parentId)}}
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
    if (!d) return;
    const p = at(e),
      dx = p.x - d.start.x,
      dy = p.y - d.start.y;
    if(d.mode==='shape'){setShapeDraft({...d.options,...shapeBounds(d.start,p,e.shiftKey)});return;}
    if(d.mode==='board'){
      setBoardDraft({id:d.boardId,dx,dy});
      return;
    }
    if(d.mode==='board-resize'){
      const b=workspace.boards.find(b=>b.id===d.boardId),width=Math.min(30000,Math.max(1,Math.round(p.x-b.x))),height=Math.min(30000,Math.max(1,Math.round(e.shiftKey?width*b.height/b.width:p.y-b.y)));
      if(width*height<=100000000)setBoardDraft({id:b.id,width,height});return;
    }
    if (d.mode === "pan") {
      setView({
        ...d.view,
        x: d.view.x + p.sx - d.start.sx,
        y: d.view.y + p.sy - d.start.sy,
      });
      return;
    }
    if (d.mode.startsWith("guide-")) {
      const index = Number(d.mode.split("-")[1]),
        guides = d.doc.layout.guides.map((g, i) =>
          i === index ? { ...g, position: g.axis === "x" ? p.x : p.y } : g,
        );
      setDraft({ ...d.doc, layout: { ...d.doc.layout, guides } });
      return;
    }
    if (d.mode === "move") {
      const delta = snapDelta(
        d.doc.layers,
        d.ids,
        dx,
        dy,
        d.doc.layout,
        view.zoom,
      );
      setDraft({
        ...d.doc,
        layers: moveLayers(d.doc.layers, d.ids, delta.dx, delta.dy),
      });
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
        width = Math.max(1, local.x),
        height = Math.max(
          1,
          e.shiftKey ? (width * l.height) / l.width : local.y,
        );
      patch = {width,height};
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
    if (!d) return;
    drag.current = null;
    holder.current.releasePointerCapture(e.pointerId);
    if(d.mode==='shape'){
      setShapeDraft(null);
      const p=at(e);if(Math.hypot(p.sx-d.start.sx,p.sy-d.start.sy)<3)return;
      const box=shapeBounds(d.start,p,e.shiftKey),layer=createLayer('shape',{...d.options,...box,name:shapes.find(([id])=>id===d.options.shape)?.[1]||'形状'});
      const saved=workspace?workspace.addShape({...layer,x:layer.x-d.board.x,y:layer.y-d.board.y},d.board.id):change({...latest.current.document,layers:[...latest.current.document.layers,layer]});
      if(saved!==false){setSelected([layer.id]);setTool('select');setBoardTool(false);setInspectorTab('properties');}return;
    }
    if(d.mode==='board'){
      const p=at(e),dx=p.x-d.start.x,dy=p.y-d.start.y;
      setBoardDraft(null);
      if(Math.hypot(dx,dy)>2)workspace.move(d.boardId,dx,dy);else workspace.activate(d.boardId);
      return;
    }
    if(d.mode==='board-resize'){
      const p=at(e),b=workspace.boards.find(b=>b.id===d.boardId),width=Math.min(30000,Math.max(1,Math.round(p.x-b.x))),height=Math.min(30000,Math.max(1,Math.round(e.shiftKey?width*b.height/b.width:p.y-b.y)));
      if(width*height<=100000000)workspace.resizeBoard(b.id,width,height);setBoardDraft(null);return;
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
      });
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
          setPaintOptions(options=>({...options,target:'mask'}));setInspectorTab('properties');
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
      setPaintOptions(options=>({...options,target:'mask'}));setInspectorTab('properties');
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
    setSelected([layer.id]);setTool('select');
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
  const relocate = (ids, targetId, placement) =>
    action(() => relocateLayers(document.layers, ids, targetId, placement));
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
  const issues = unsupported(document.layers);
  const maskEditing=Boolean(single)&&paintOptions.target==='mask';
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
    <div className="layer-editor composition-editor" data-dev-update-blocked={painting.busy||selectionBusy||merging||imageImport.importing||exportState||draft||pathDraft||boardDraft||shapeDraft||polygon.length||tool!=='select'?'请先完成合成编辑，并切换到移动工具后更新':undefined}>
      <div className="composition-tools">
        <div className="composition-primary-tools">
          <Button icon="action" aria-pressed={tool==='select'&&!boardTool} onClick={()=>{setTool('select');setBoardTool(false)}}>移动</Button>
          {workspace&&<Button icon="layout" aria-pressed={boardTool&&tool==='select'} onClick={()=>{setSelected([]);setTool('select');setBoardTool(true);setInspectorTab('properties')}}>画板</Button>}
          <Button icon="selection" aria-pressed={selectionTools.some(([id])=>id===tool)} onClick={()=>setTool('rect')}>选区</Button>
          <Button icon="crop" disabled={!document.selection||selectionBusy} onClick={cropSelection}>裁切</Button>
          <Button icon="brush" aria-pressed={tool==='brush'} onClick={()=>setTool('brush')}>画笔</Button>
          <ShapePicker active={tool==='shape'} options={shapeOptions} disabled={disabled} choose={options=>{setShapeOptions(options);setTool('shape');setBoardTool(false)}}/>
          <Button icon="assets" onClick={()=>imageImport.open()} disabled={imageImport.importing}>图片</Button>
          <Button icon="text" onClick={()=>add('text',{name:'文字',text:'输入文字',fontSize:48,color:'#333333',width:600,height:160})}>文字</Button>
          <Button icon="select" aria-pressed={tool==='hand'} onClick={()=>setTool('hand')}>抓手</Button>
          <Button icon="zoomIn" onClick={()=>setView({...view,zoom:Math.min(8,view.zoom*1.25)})}>缩放</Button>
        </div>
        <div className="composition-command-tools" ref={setToolbarHost}/>
      </div>
      {toolbarHost &&
        createPortal(
          <>
            <details className="composition-more"><summary aria-label="更多编辑工具"><Icon name="more"/><span>更多</span></summary><div className="composition-more-body">
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
                    width: 600,
                    height: 160,
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
              {[
                ["x", "start", "左对齐"],
                ["x", "center", "水平居中"],
                ["x", "end", "右对齐"],
                ["y", "start", "顶对齐"],
                ["y", "center", "垂直居中"],
                ["y", "end", "底对齐"],
              ].map(([axis, mode, label]) => (
                <Button
                  key={label}
                  disabled={!selected.length}
                  onClick={() =>
                    action(() => alignLayers(document, selected, axis, mode))
                  }
                >
                  {label}
                </Button>
              ))}
              {[
                ["x", "水平等距"],
                ["y", "垂直等距"],
              ].map(([axis, label]) => (
                <Button
                  key={axis}
                  disabled={selected.length < 3}
                  onClick={() =>
                    action(() =>
                      distributeLayers(document.layers, selected, axis),
                    )
                  }
                >
                  {label}
                </Button>
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
            <Menu name="选区" icon="selection">
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
            <label className="check"><input type="checkbox" checked={transparent} onChange={e=>setTransparent(e.target.checked)}/>透明导出</label>
            </div></details>
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
              <Button icon="export" aria-label="导出 PNG"
                className="primary"
                disabled={disabled || Boolean(renderError) || issues.length > 0}
                onClick={exportPng}
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
      <div className="layer-parameter-row">
        <span className="context-tool"><Icon name={boardTool&&tool==='select'?'layout':isBrushTool(tool)?'brush':tool==='select'?'action':tool==='hand'?'select':'selection'}/>{boardTool&&tool==='select'?'画板':maskEditing?(maskPainting?'蒙版画笔':'蒙版选区'):tool==='select'?(single?.kind==='shape'?'形状':'移动'):tool==='hand'?'抓手':tool==='shape'?'形状':isBrushTool(tool)?'画笔':'选区'}</span>
        {tool==='select'&&!maskEditing&&single?.kind==='shape'?<ShapeOptions options={{...shapeDefaults,...single}} change={({shape,color,fill,stroke,strokeWidth,radius})=>patch({shape,color,fill,stroke,strokeWidth,radius})} disabled={disabled||workspace?.board.locked||inherited(document.layers,single,'locked')}/>:tool==='shape'?<ShapeOptions options={shapeOptions} change={setShapeOptions} disabled={disabled}/>:tool==='select'&&boardTool&&workspace?workspace.parameters:tool==='select'?<div className="move-tool-options">
          <label className="check"><input type="checkbox" checked={autoSelect} onChange={e=>setAutoSelect(e.target.checked)}/>自动选择</label>
          <Select aria-label="自动选择范围" value={selectScope} onChange={e=>setSelectScope(e.target.value)}><option value="layer">图层</option><option value="group">分组</option></Select>
          <label className="check"><input type="checkbox" checked={showControls} onChange={e=>setShowControls(e.target.checked)}/>显示变换控件</label>
          <div className="context-align">{[['x','start','左对齐','align'],['x','center','水平居中','layout'],['y','center','垂直居中','action']].map(([axis,mode,label,icon])=><Button iconOnly icon={icon} key={label} disabled={!selected.length||disabled} onClick={()=>action(()=>alignLayers(document,selected,axis,mode))}>{label}</Button>)}</div>
          <Button icon="mask" disabled={!single||disabled||inherited(document.layers,single,'locked')} onClick={()=>{setPaintOptions({...paintOptions,target:'mask'});setTool('brush');setInspectorTab('properties')}}>编辑蒙版</Button>
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
{isBrushTool(tool) && <PaintTools compact options={paintOptions} onChange={setPaintOptions} onNew={newPaintLayer} busy={painting.busy} maskDisabled={Boolean(maskEditing&&single?.mask?.disabled)} tool={tool} source={paintSource?.layerId===single?.id?paintSource:null} onSample={()=>{setSourceArmed(true);setMessage('')}} onClear={()=>setPaintSource(null)}/>}
{selectionTools.some(([id])=>id===tool)&&<SelectionActions operation={operation} onOperation={setOperation} hasSelection={Boolean(document.selection)} busy={disabled||selectionBusy||painting.busy} canSubject={single?.kind==='image'} subject={selectSubject} subjectStatus={subjectStatus} subjectStage={subjectStage} invert={()=>change({...document,selection:{...document.selection,inverted:!document.selection.inverted}})} clear={()=>change({...document,selection:undefined})}/>}
{document.selection&&single?.kind==='image'&&!maskEditing&&<div className="selection-actions"><ColorControl aria-label="选区填充颜色" value={fillColor} onChange={e=>setFillColor(e.target.value)}/><Button disabled={disabled||selectionBusy||painting.busy||inherited(document.layers,single,'locked')} onClick={()=>fillSelection(false)}>填充图片选区</Button></div>}
{maskEditing&&<div className="mask-selection-actions">
  {!maskPainting&&<MaskInk value={paintOptions.maskMode} onChange={maskMode=>setPaintOptions({...paintOptions,maskMode})} disabled={disabled||selectionBusy||painting.busy||single?.mask?.disabled}/>}
  <Button aria-label="填充蒙版选区" disabled={disabled||selectionBusy||painting.busy||!document.selection||single.mask?.disabled||inherited(document.layers,single,'locked')||inherited(document.layers,single,'hidden')} onClick={()=>fillSelection(false)}>填充选区</Button>
</div>}
{tool==='select'&&single?.kind==='adjustment'&&adjustmentTypes[single.adjustment?.type]&&<AdjustmentTools key={single.id} layer={{...single,locked:inherited(document.layers,single,'locked')||disabled}} patch={patch} onDone={()=>setSelected([])}/>}
{tool==='select'&&single?.kind!=='adjustment'&&single?.effects?.length>0&&<EffectTools key={`${single.id}-${effectId}`} layer={{...single,locked:inherited(document.layers,single,'locked')||disabled}} effectId={effectId} onSelect={setEffectId} patch={patch} onDone={()=>setSelected([])}/>}
{fillProgress !== null ? <><span role="status">内容感知填充 {Math.round(fillProgress * 100)}%</span><Button onClick={() => selectionAbort.current?.abort()}>取消填充</Button></> : null}</div>
      <div className="composition-breadcrumb">
        <Button icon="layout" onClick={()=>fit(true)}>所有画板</Button><span>/</span>
        {workspace?<Select aria-label="当前画板" value={workspace.board.id} onChange={e=>workspace.activate(e.target.value)}>{workspace.boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select>:<span>{document.name}</span>}
        
        <span className="composition-breadcrumb-space"/>
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
      <div className="layer-workspace">
        {materialsOpen&&<aside className="composition-materials">          <details open className="layer-materials"><summary>素材库 · {document.assets.length}</summary>
          <div className="panel-heading">
            <h2>素材库</h2>
            <Button iconOnly icon="import"
              aria-label="导入图层素材"
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
          onPointerMove={move}
          onPointerLeave={()=>setPaintCursor(null)}
          onPointerUp={up}
          onPointerCancel={() => {
            painting.cancel();
            drag.current = null;
            setDraft(null);
            setPathDraft(null);
            setBoardDraft(null);
            setShapeDraft(null);
          }}
          onDoubleClick={() => {
            if (tool === "polygon") finishPolygon();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && tool === "polygon") {
              e.preventDefault();
              finishPolygon();
            }
          }}
        >
          {(single?.kind==='image'||maskEditing)&&<div className="composition-context" onPointerDown={e=>e.stopPropagation()}>
            {maskEditing?<><span className="mask-context-label">{maskViewId?({alone:'单独查看蒙版 · 黑藏白显',original:'原图预览 · 暂时忽略蒙版',overlay:'蒙版叠加 · 红色隐藏'})[maskPreviewMode]:single.mask?.disabled?'蒙版已停用':'正在编辑蒙版 · 黑藏白显'}{maskViewId&&single.mask?.disabled?' · 已停用':''}{document.selection?' · 仅选区内':''}</span>{single.mask?.disabled&&<Button disabled={disabled||inherited(document.layers,single,"locked")} onClick={()=>patch({mask:{...single.mask,disabled:false}})}>启用当前蒙版</Button>}<Button disabled={disabled||selectionBusy||painting.busy||!document.selection} onClick={deselect}>取消选区</Button><Button className="primary" icon="check" onClick={()=>{setPaintOptions({...paintOptions,target:'image'});setTool('select')}}>完成蒙版</Button></>:<><Button icon="replace" onClick={()=>setReplacement({targetId:single.id,assetId:single.assetId})}>替换图片</Button><Button icon="mask" onClick={()=>{setPaintOptions({...paintOptions,target:'mask'});setTool('brush');setInspectorTab('properties')}}>编辑蒙版</Button><Button icon="adjust" onClick={()=>setInspectorTab('adjustments')}>调整</Button></>}
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
              {(workspace?.boards || [{id:'main',x:0,y:0,width:document.width,height:document.height,name:document.name}]).map(original=>{const b=boardDraft?.id===original.id&&boardDraft.width?{...original,width:boardDraft.width,height:boardDraft.height}:original;return <g key={b.id} data-board-label={b.id} transform={boardDraft?.id===b.id&&!boardDraft.width?`translate(${boardDraft.dx} ${boardDraft.dy})`:undefined}>
                <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="none" stroke={workspace?.board.id===b.id?'var(--accent)':'var(--line)'} strokeWidth={1/view.zoom}/>
                <rect className="board-label-hit" data-board-id={b.id} x={b.x} y={b.y-30/view.zoom} width={Math.max(160,b.name.length*14)/view.zoom} height={27/view.zoom} fill="transparent"/>
                <text data-board-id={b.id} x={b.x} y={b.y-10/view.zoom} fontSize={12/view.zoom} fill={workspace?.board.id===b.id?'var(--accent)':'var(--muted)'} style={{cursor:'move'}}>{b.name} · {b.width} × {b.height}</text>
                {workspace?.board.id===b.id&&!selected.length&&!b.locked&&<rect className="board-resize-handle" data-board-id={b.id} data-board-resize="true" x={b.x+b.width-5/view.zoom} y={b.y+b.height-5/view.zoom} width={10/view.zoom} height={10/view.zoom} fill="var(--accent)"/>}
              </g>})}
              {shapeDraft&&<g className="shape-draft" pointerEvents="none" transform={`translate(${shapeDraft.x} ${shapeDraft.y})`}>
                <ShapePath shape={shapeDraft.shape} width={shapeDraft.width} height={shapeDraft.height} radius={shapeDraft.radius} fill={shapeDraft.fill?shapeDraft.color:'none'} stroke={shapeDraft.stroke} strokeWidth={shapeDraft.strokeWidth}/>
                <rect width={shapeDraft.width} height={shapeDraft.height} fill="none" stroke="var(--accent)" strokeWidth={1/view.zoom} strokeDasharray={`${4/view.zoom} ${3/view.zoom}`}/>
                <text x={shapeDraft.width/2} y={shapeDraft.height+20/view.zoom} textAnchor="middle" fontSize={11/view.zoom} fill="var(--accent)">{Math.round(shapeDraft.width)} × {Math.round(shapeDraft.height)} px</text>
              </g>}
              {showControls && tool==='select' && selected.map((id) => {
                const l = shown.layers.find((l) => l.id === id);
                if (!l) return null;
                const pts = corners(shown.layers, l);
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
          {showControls&&single&&tool==='select'&&<SelectionSizeBadge points={corners(shown.layers,shown.layers.find(l=>l.id===single.id)||single)} view={view} size={size}/>}
          <div className="layer-stage-hint">
            {tool === "select"
              ? `Shift 多选 · 拖动移动 · ${window.tugou.platform === "darwin" ? "⌘" : "Ctrl"}+滚轮缩放`
              : tool === "shape"
                ? "拖拽绘制形状 · Shift 等比 · Esc 取消"
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
        <aside className="layer-sidebar">
          <div className="panel-heading inspector-tabs" aria-label="属性面板">
            {[['properties','属性'],['adjustments','调整'],['navigation','导航']].map(([id,label])=><Button key={id} aria-pressed={inspectorTab===id} onClick={()=>setInspectorTab(id)}>{label}</Button>)}
            <Button iconOnly icon="layout" onClick={()=>{setSelected([]);setBoardTool(true);setInspectorTab('properties')}}>画板</Button>
          </div>
          <div className="composition-inspector">
          {inspectorTab==='properties'?<>
            {!single&&workspace?workspace.inspector:<LayerProperties key={single?.id||'empty'} compact boardName={workspace?.board.name} maskEditing={maskEditing} maskPreview={maskViewId===single?.id?maskPreviewMode:"composite"} maskBusy={selectionBusy||painting.busy} onMaskView={mode=>changeMaskView(single?.id,mode)} onLoadMask={loadMaskSelection} layer={single?{...single,locked:disabled||workspace?.board.locked||inherited(document.layers,single,'locked')}:null} patch={patch} document={document} change={change}/>}
            {single&&workspace&&<label className="layer-board-transfer">所属画板<Select aria-label="移动图层到画板" value={workspace.board.id} onChange={e=>workspace.relocate(selected,e.target.value,'inside')} disabled={disabled||inherited(document.layers,single,'locked')}>{workspace.boards.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Select></label>}
          </>:inspectorTab==='adjustments'?<div className="inspector-adjustments"><h3>调整图层</h3><p className="inspector-caption">添加可随时修改的调整图层</p><div className="adjustment-grid">{Object.entries(adjustmentTypes).map(([type,spec])=><Button key={type} icon="adjust" disabled={disabled||selectionBusy} onClick={()=>addAdjustment(type)}>{spec.label}</Button>)}</div></div>:<div className="inspector-navigation"><div className="board-actions"><Button icon="fit" onClick={()=>fit(true)}>所有画板</Button><Button icon="fit" onClick={()=>fit()}>聚焦画板</Button></div>{workspace?.boards.map(b=><Button key={b.id} aria-pressed={workspace.board.id===b.id} onClick={()=>{workspace.activate(b.id);setBoardTool(true)}}><Icon name="layout"/><span>{b.name}<small>{b.width} × {b.height}</small></span></Button>)}</div>}
          </div>
          <div className="composition-layer-heading"><Button aria-pressed={layerTab==='layers'} onClick={()=>setLayerTab('layers')}>图层</Button><Button aria-pressed={layerTab==='history'} onClick={()=>setLayerTab('history')}>历史记录</Button><span/><Button iconOnly icon="search" aria-pressed={searchOpen} onClick={()=>{setSearchOpen(!searchOpen);setLayerTab('layers');if(searchOpen)setLayerQuery('')}}>搜索图层</Button></div>
          {layerTab==='layers'?<>
          {searchOpen&&<div className="layer-search"><Input autoFocus aria-label="搜索图层名称" placeholder="搜索图层…" value={layerQuery} onChange={e=>setLayerQuery(e.target.value)} allowClear/></div>}
          <LayerAppearance layer={single} patch={patch} disabled={disabled||workspace?.board.locked||Boolean(single&&inherited(document.layers,single,'locked'))}/>
          <div className="layer-filter-row"><span>锁定</span><Button iconOnly icon="locked" disabled={!single||disabled} onClick={()=>workspace?workspace.patchLayer(single.id,{locked:!single.locked}):commit(document.layers.map(l=>l.id===single.id?{...l,locked:!l.locked}:l))}>{single?.locked?'解锁所选图层':'锁定所选图层'}</Button><span className="filter-spacer"/><label>筛选<Select aria-label="筛选图层类型" value={layerFilter} onChange={e=>setLayerFilter(e.target.value)}>{[['all','全部'],['image','图片'],['text','文字'],['group','画板与分组'],['shape','形状'],['adjustment','调整']].map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></label></div>
                    <LayerTree
            query={layerQuery} kind={layerFilter}
            layers={workspace?.layers || shown.layers}
            selected={selected.length?selected:workspace?[workspace.board.id]:[]}
            choose={(id,extend)=>{(workspace?.choose||choose)(id,extend);setPaintOptions({...paintOptions,target:'image'});setInspectorTab('properties');setBoardTool(Boolean(workspace?.layers.find(l=>l.id===id)?.artboard))}}
            disabled={disabled}
            relocate={workspace?.relocate || relocate}
            assets={document.assets} paintTarget={paintOptions.target} onMaskView={id=>changeMaskView(id,maskViewId===id&&maskPreviewMode==="alone"?"composite":"alone")} onMask={id=>{const layer=(workspace?.layers||document.layers).find(l=>l.id===id);if(!layer.mask)(workspace?.patchLayer||((id,values)=>change({...document,layers:document.layers.map(l=>l.id===id?{...l,...values}:l)})))(id,{mask:{x:0,y:0,width:1,height:1}});workspace?.selectMask(id);setSelected([id]);setPaintOptions({...paintOptions,target:"mask"});setInspectorTab("properties")}}
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
          </>:<div className="composition-history"><div className="board-actions"><Button icon="undo" disabled={!editHistory?.past.length||disabled} onClick={editHistory?.undo}>撤销</Button><Button icon="redo" disabled={!editHistory?.future.length||disabled} onClick={editHistory?.redo}>重做</Button></div><p className="inspector-caption">本次打开工程的记录 · {editHistory?.past.length||0} 步可撤销</p><div className="history-current"><Icon name="edit"/> 当前状态</div>{[...(editHistory?.past||[])].reverse().map((snapshot,i)=><div className="history-entry" key={i}><Icon name="tasks"/><span>编辑前 {i+1}<small>{snapshot.layers.length} 个图层 · {snapshot.name}</small></span></div>)}</div>}
          <div className="composition-layer-footer">
            <Button iconOnly icon="mask" disabled={!single||disabled||inherited(document.layers,single,'locked')} onClick={()=>{setPaintOptions({...paintOptions,target:'mask'});setTool('brush');setInspectorTab('properties')}}>编辑所选蒙版</Button>
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
