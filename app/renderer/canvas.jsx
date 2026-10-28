import {Select} from './select.jsx';
import { isDeleteKey } from "../core/shortcuts.cjs";
import {
  Button,
  Input,
  TextArea,
  Icon,
  SearchField,
  useTheme,
  ToolPopover,
} from "./components.jsx";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  ReactFlow,
  Background,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  ReactFlowProvider,
  useReactFlow,
  ConnectionLineType,
  getNodesBounds,
  getViewportForBounds,
} from "@xyflow/react";
import {
  emptyCanvas,
  createNode,
  canConnect,
  compileNode,
  nodeStatus,
  refreshNode,
} from "../core/prompts.cjs";
import { CanvasNodeMenu } from './canvas-node-menu.jsx';
import {types as workflowTypes,nodeName,nodeWidth,compileWorkflow,workflowNode,inputsOf} from '../core/workflow-nodes.cjs';
import {CanvasContext,ContentNode,GroupNode} from './canvas-nodes.jsx';
import {WorkflowSettings} from './workflow-settings.jsx';
import {MediaPreview} from './media-preview.jsx';
import {SceneView} from './scene-view.jsx';
import {groupNodes,ungroupNodes} from '../core/canvas-groups.cjs';
import {layoutSelection,arrangeNodes} from '../core/canvas-layout.cjs';
import {MediaTools} from './media-tools.jsx';
import { ReferenceEditor, PromptPreview, statusLabels } from "./recipes.jsx";
import { ReplaceImageDialog } from "./replace-image.jsx";
import { copyAssetPrompt } from "./material-details.jsx";
import { resizeAssetNode } from "../core/canvas-view.cjs";
import { DisplayControls, AngleDialog } from "./canvas-view-tools.jsx";
import { useImageImport, hasImageFiles } from './use-image-import.js';
import "@xyflow/react/dist/style.css";
import "./workflow.css";

export function assetUrl(asset) {
  return asset?.resource
    ? `tugou-media://resource/${asset.resource}`
    : asset?.dataUrl?.startsWith("/api/studio/resource/")
      ? `tugou-media://resource/${asset.dataUrl.split("/").at(-1)}`
      : asset?.dataUrl?.startsWith("data:image/")
        ? asset.dataUrl
        : undefined;
}
const nodeTypes = {
  group:GroupNode,
  module: ContentNode,
  recipe: ContentNode,
  asset: ContentNode,
  text: ContentNode,
  ...Object.fromEntries(workflowTypes.map(type=>[type,ContentNode])),
};

function CanvasWorkspace({
  projectId,
  document,
  change,
  openRecipe,
  generate,
  refreshTasks,
  tasks = [],
  disabled,
  editImages,
  showDetails,
  openConnection,
  analyzeImage,
}) {
  const graph = document.tugouCanvas || emptyCanvas();
  const [nodes, setNodes] = useState(graph.nodes);
  const [edges, setEdges] = useState(graph.edges);
  const displayedEdges=useMemo(()=>edges.map(edge=>({...edge,type:'default',interactionWidth:24})),[edges]);
  const [palette, setPalette] = useState("node"),
    [query, setQuery] = useState(""),
    [minimap, setMinimap] = useState(false),
    [toolbarHost, setToolbarHost] = useState(null);
  const theme = useTheme(),
    [clipboard, setClipboard] = useState(null),
    mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  useEffect(
    () => setToolbarHost(window.document.getElementById("canvas-actions")),
    [],
  );
  const [message, setMessage] = useState("");
  const [createMenu,setCreateMenu] = useState(null);
  const [insertPoint,setInsertPoint] = useState(null);
  const selectAfterAdd = useRef(null);
  const pendingLink=useRef(null);
  useEffect(() => {
    const close = event => { if(event.key==='Escape'){setCreateMenu(null);setInsertPoint(null);pendingLink.current=null;} };
    window.addEventListener('keydown',close);
    return () => window.removeEventListener('keydown',close);
  },[]);
  const [replacement,setReplacement]=useState(null);
  const [angleSource,setAngleSource]=useState(null);
  const [sceneNode,setSceneNode]=useState(null);
  const [mediaTool,setMediaTool]=useState(null);
  const [zoom, setZoom] = useState(graph.viewport.zoom);
  const [submittingIds,setSubmittingIds]=useState(new Set()),pendingSubmissions=useRef(new Set());
  const [connection,setConnection]=useState(null);
  const [nodeErrors,setNodeErrors]=useState({});
  const refreshConnection=useCallback(()=>window.tugou.connection().then(setConnection).catch(()=>{}),[]);
  useEffect(()=>{refreshConnection();window.addEventListener('focus',refreshConnection);window.addEventListener('tugou-connection-changed',refreshConnection);return()=>{window.removeEventListener('focus',refreshConnection);window.removeEventListener('tugou-connection-changed',refreshConnection);};},[refreshConnection]);
  const flow = useReactFlow();
  const holder = useRef(null),
    current = useRef({ document, nodes, edges });
  current.current = { document, nodes, edges };
  const fitCanvas=()=>{
    const visible=current.current.nodes.filter(n=>!n.parentId);
    if(!visible.length)return;
    const bounds=getNodesBounds(visible.map(n=>({...n,width:n.width||n.measured?.width||nodeWidth(n.type),height:n.height||n.measured?.height||400})));
    const viewport=holder.current.getBoundingClientRect();
    flow.setViewport(getViewportForBounds(bounds,viewport.width,viewport.height,.15,1,.2));
  };
  useEffect(() => {
    const addedId=selectAfterAdd.current;
    setNodes((previous) =>
      graph.nodes.map((node) => ({
        ...node,
        measured: node.width && node.height ? {width:node.width,height:node.height} : previous.find(entry=>entry.id===node.id)?.measured,
        selected:
          addedId ? node.id===addedId : previous.find((entry) => entry.id === node.id)?.selected || false,
      })),
    );
    selectAfterAdd.current=null;
    setEdges((previous) =>
      graph.edges.map((edge) => ({
        ...edge,
        selected:
          previous.find((entry) => entry.id === edge.id)?.selected || false,
      })),
    );
    if (JSON.stringify(flow.getViewport()) !== JSON.stringify(graph.viewport))
      flow.setViewport(graph.viewport);
  }, [document.tugouCanvas]);
  const commit = (nextNodes, nextEdges, viewport, history = true, source = current.current.document) => {
    const clean = nextNodes.map(
      ({ selected, dragging, measured, resizing, ...node }) => node,
    );
    change(
      {
        ...source,
        tugouCanvas: {
          ...(source.tugouCanvas || emptyCanvas()),
          nodes: clean,
          edges: nextEdges.map(({ selected, ...edge }) => edge),
          viewport: viewport || flow.getViewport(),
        },
      },
      { history },
    );
  };
  const commitRef = useRef(commit);commitRef.current=commit;
  const resize = useCallback((id,rect) => {
    try {
      const next = current.current.nodes.map(n=>n.id===id?resizeAssetNode(n,rect):n);
      commitRef.current(next,current.current.edges);setMessage('');
    } catch(e) {setMessage(e.message);}
  },[]);
  const previewResize = useCallback((id,rect) => setNodes(previous=>previous.map(n=>n.id===id?resizeAssetNode(n,rect):n)),[]);
  const add = (type, id, point, source = current.current.document) => {
    if(disabled)return;
    const bounds = holder.current.getBoundingClientRect();
    const position =
      point || insertPoint ||
      flow.screenToFlowPosition({
        x: bounds.x + bounds.width / 2 - 100,
        y: bounds.y + 110,
      });
    if(!point&&!insertPoint){
      const width=nodeWidth(type),height=workflowTypes.includes(type)||type==='asset'?400:230;
      const occupied=current.current.nodes.filter(n=>!n.parentId).map(n=>({...n.position,width:n.width||n.measured?.width||nodeWidth(n.type),height:n.height||n.measured?.height||400})).sort((a,b)=>a.x-b.x);
      for(const r of occupied)if(position.x<r.x+r.width+40&&position.x+width+40>r.x&&position.y<r.y+r.height+40&&position.y+height+40>r.y)position.x=r.x+r.width+50;
      const screen=flow.flowToScreenPosition(position);
      if(screen.x+width*zoom>bounds.right||screen.y+height*zoom>bounds.bottom)requestAnimationFrame(()=>flow.setCenter(position.x+width/2,position.y+height/2,{zoom:Math.min(zoom,1),duration:200}));
    }
    const node = createNode(source, type, id, position);
    let nextEdges=current.current.edges;
    if(pendingLink.current){const link=pendingLink.current,edge={id:crypto.randomUUID(),source:link.type==='source'?link.id:node.id,target:link.type==='source'?node.id:link.id};pendingLink.current=null;if(!canConnect({nodes:[...current.current.nodes,node],edges:nextEdges},edge.source,edge.target)){setMessage('此节点类型不能连接，请重新选择');return;}nextEdges=[...nextEdges,edge];}
    selectAfterAdd.current=node.id;
    commit([...current.current.nodes, node], nextEdges, undefined, true, source);
    setInsertPoint(null);
    setMessage("");
  };
  const chooseNode = (type,point) => {
    setCreateMenu(null);setInsertPoint(null);
    if(disabled)return;
    if(workflowTypes.includes(type))return add(type,undefined,point);
    if(type==='media')return importMediaAt(point);
    if(type==='text')return add('text',undefined,point);
    if(type==='emptyImage')return add('asset',undefined,point);
    if(type==='import')return imageImport.openAt(point);
    const bounds=holder.current.getBoundingClientRect();
    setInsertPoint(point||flow.screenToFlowPosition({x:bounds.x+bounds.width/2-100,y:bounds.y+110}));
    setPalette(type);setQuery('');
  };
  const canCreateLinked=type=>{
    const link=pendingLink.current;if(!link)return true;
    if(type==='import'||type==='media')return false;
    const candidate={id:'__new_canvas_node__',type:type==='emptyImage'?'asset':type};
    return canConnect({nodes:[...nodes,candidate],edges},link.type==='source'?link.id:candidate.id,link.type==='source'?candidate.id:link.id);
  };
  const remove = () => {
    const ids = new Set(
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    nodes.filter(n=>ids.has(n.parentId)).forEach(n=>ids.add(n.id));
    commit(
      nodes.filter((node) => !ids.has(node.id)),
      edges.filter(
        (edge) =>
          !edge.selected && !ids.has(edge.source) && !ids.has(edge.target),
      ),
    );
  };
  const selected = nodes.filter((node) => node.selected);
  const layoutNodes=layoutSelection(nodes,selected.map(n=>n.id));
  const layoutSameParent=new Set(layoutNodes.map(n=>n.parentId||null)).size<=1;
  const canGroup=selected.length>=2&&selected.every(n=>n.type!=='group'&&!n.parentId);
  const node = selected.length === 1 ? selected[0] : null;
  const selectedMedia=document.assets.find(a=>a.id===(node?.data.assetId||node?.data.outputAssetId)&&['video','audio'].includes(a.kind));
  const selectedImages=selected.filter(n=>document.assets.some(a=>a.id===(n.data.assetId||n.data.outputAssetId)&&(!a.kind||a.kind==='image')));
  const selectedImage=node&&selectedImages.length===1?document.assets.find(a=>a.id===(node.data.assetId||node.data.outputAssetId)):null;
  const editSelectedImages=operation=>editImages(selectedImages.map(n=>n.data.assetId||n.data.outputAssetId),operation,selectedImages.map(n=>n.id));
  const activeTask = tasks.find(
    (task) =>
      task.context?.nodeId === node?.id &&
      ["running", "queued"].includes(task.status),
  );
  const patchById=(id,data)=>{
    if(disabled)return;
    setNodeErrors(previous=>previous[id]?{...previous,[id]:''}:previous);
    const source=current.current.document,target=current.current.nodes.find(n=>n.id===id);
    if(!target)return;
    const next=target.type==='recipe'&&data.snapshot?{...source,recipes:source.recipes.map(r=>r.id===target.data.recipeId?{...r,output:data.snapshot.output}:r)}:source;
    commit(current.current.nodes.map(n=>n.id===id?{...n,data:{...n.data,...data}}:n),current.current.edges,undefined,true,next);
  };
  const patchNode=data=>node&&patchById(node.id,data);
  const inputLocked=id=>disabled||pendingSubmissions.current.has(id)||tasks.some(t=>t.context?.nodeId===id&&['queued','running'].includes(t.status));
  const moveInput=(id,sourceId,to)=>{
    if(inputLocked(id))return;
    const graph=current.current,target=graph.nodes.find(n=>n.id===id);
    if(!target)return;
    const order=inputsOf(graph,target).map(e=>e.source),from=order.indexOf(sourceId);
    if(from<0||to<0||to>=order.length||from===to)return;
    order.splice(to,0,order.splice(from,1)[0]);patchById(id,{inputOrder:order});
  };
  const removeInput=(id,sourceId)=>{
    if(inputLocked(id))return;
    const graph=current.current,target=graph.nodes.find(n=>n.id===id);
    if(!target||!graph.edges.some(e=>e.target===id&&e.source===sourceId))return;
    const data={...target.data,inputOrder:(target.data.inputOrder||[]).filter(value=>value!==sourceId),inputRoles:{...target.data.inputRoles},prompt:(target.data.prompt||'').split(`@[node:${sourceId}]`).join('')};
    delete data.inputRoles[sourceId];
    for(const key of ['firstFrameId','lastFrameId','promptNodeId'])if(data[key]===sourceId)data[key]='';
    setNodeErrors(previous=>({...previous,[id]:''}));
    commit(graph.nodes.map(n=>n.id===id?{...n,data}:n.id===target.data.promptNodeId?{...n,data:{...n.data,text:n.data.text.split(`@[node:${sourceId}]`).join('')}}:n),graph.edges.filter(e=>e.target!==id||e.source!==sourceId));
  };
  const items = (
    palette === "module"
      ? document.modules
      : palette === "recipe"
        ? document.recipes
        : palette === "asset"
          ? document.assets
          : nodes.map((n) => ({
              id: n.id,
              name:
                n.type === "module"
                  ? n.data.binding.snapshot.name
                  : n.type === "recipe"
                    ? n.data.snapshot.name
                    : n.type === "asset"
                      ? document.assets.find((a) => a.id === n.data.assetId)
                          ?.name || (n.data.assetId?"缺失素材":"图片")
                      : nodeName(n),
            }))
  ).filter((item) => item.name?.includes(query));
  const copy = () => {
    const ids = new Set(selected.map((n) => n.id));
    nodes.filter(n=>ids.has(n.parentId)).forEach(n=>ids.add(n.id));
    setClipboard({
      nodes: structuredClone(nodes.filter(n=>ids.has(n.id)).map(n=>{if(!n.parentId||ids.has(n.parentId))return n;const parent=nodes.find(p=>p.id===n.parentId),{parentId,...child}=n;return {...child,position:{x:n.position.x+parent.position.x,y:n.position.y+parent.position.y}};})),
      edges: structuredClone(
        edges.filter((e) => ids.has(e.source) && ids.has(e.target)),
      ),
    });
  };
  const paste = () => {
    if (!clipboard) return;
    const ids = new Map(
      clipboard.nodes.map((n) => [n.id, crypto.randomUUID()]),
    );
    commit(
      [
        ...nodes,
        ...clipboard.nodes.map((n) => ({
          ...n,
          ...(n.parentId?{parentId:ids.get(n.parentId)}:{}),
          data:{...n.data,...(n.data.promptNodeId?{promptNodeId:ids.get(n.data.promptNodeId)||n.data.promptNodeId}:{}),...(n.type==='text'&&n.data.text?{text:n.data.text.replace(/@\[node:([^\]]+)\]/g,(_,id)=>`@[node:${ids.get(id)||id}]`)}:{}),...(n.data.prompt?{prompt:n.data.prompt.replace(/@\[node:([^\]]+)\]/g,(_,id)=>`@[node:${ids.get(id)||id}]`)}:{}),...(n.data.inputOrder?{inputOrder:n.data.inputOrder.map(id=>ids.get(id)||id)}:{}),...(n.data.firstFrameId?{firstFrameId:ids.get(n.data.firstFrameId)||n.data.firstFrameId}:{}),...(n.data.lastFrameId?{lastFrameId:ids.get(n.data.lastFrameId)||n.data.lastFrameId}:{}),...(n.data.inputRoles?{inputRoles:Object.fromEntries(Object.entries(n.data.inputRoles).map(([id,role])=>[ids.get(id)||id,role]))}:{})},
          id: ids.get(n.id),
          selected: false,
          position: { x: n.position.x + (n.parentId?0:40), y: n.position.y + (n.parentId?0:40) },
        })),
      ],
      [
        ...edges,
        ...clipboard.edges.map((e) => ({
          ...e,
          id: crypto.randomUUID(),
          source: ids.get(e.source),
          target: ids.get(e.target),
        })),
      ],
    );
  };
  const imageImport = useImageImport((assets,point) => {
      const doc = current.current.document,
        next = { ...doc, assets: [...doc.assets, ...assets] },
        graph = doc.tugouCanvas || emptyCanvas();
      change({
        ...next,
        tugouCanvas: {
          ...graph,
          nodes: [
            ...graph.nodes,
            ...assets.map((a, i) =>
              createNode(next, "asset", a.id, { x: (point?.x ?? 80) + i * 260, y: point?.y ?? 80 }),
            ),
          ],
        },
      });
      setMessage(`已导入 ${assets.length} 张图片`);
  },setMessage,disabled);
  const run=async (fn,onError)=>{try{await fn();setMessage('');}catch(e){setMessage(e.message);onError?.(e);}};
  const createGroup=()=>{
    if(disabled||!canGroup)return;
    run(()=>{const next=groupNodes(nodes,selected.map(n=>n.id));selectAfterAdd.current=next[0].id;commit(next,edges);});
  };
  const dissolveGroup=()=>{
    if(disabled||node?.type!=='group')return;
    run(()=>commit(ungroupNodes(nodes,node.id),edges));
  };
  const arrange=mode=>{
    if(disabled)return;
    run(()=>{const next=arrangeNodes(nodes,selected.map(n=>n.id),mode,edges);if(next!==nodes)commit(next,edges);});
  };
  const addMediaAssets=(assets,point,targetId,updateOutput=true)=>{
    const source=current.current.document,graph=source.tugouCanvas||emptyCanvas();
    const target=graph.nodes.find(n=>n.id===targetId);
    const parent=graph.nodes.find(n=>n.id===target?.parentId);
    const next={...source,assets:[...source.assets,...assets]};
    const position=point||{x:(parent?.position.x||0)+(target?.position.x??80)+300,y:(parent?.position.y||0)+(target?.position.y??80)};
    const added=assets.map((a,i)=>createNode(next,'asset',a.id,{x:position.x+i*280,y:position.y}));
    change({...next,tugouCanvas:{...graph,nodes:[...graph.nodes.map(n=>n.id===targetId&&updateOutput?{...n,data:{...n.data,outputAssetId:assets[0]?.id,outputAssetIds:assets.map(a=>a.id)}}:n),...added]}});
  };
  const importMediaAt=(point,targetId)=>run(async()=>{const assets=await window.tugou.importMedia();if(mounted.current&&assets.length)addMediaAssets(assets,point,targetId);});
  const runNode=async id=>{
    if(disabled||pendingSubmissions.current.has(id)||tasks.some(t=>t.context?.nodeId===id&&['queued','running'].includes(t.status)))return;
    setNodeErrors(previous=>({...previous,[id]:''}));
    pendingSubmissions.current.add(id);setSubmittingIds(new Set(pendingSubmissions.current));
    try{await run(async()=>{const target=current.current.nodes.find(n=>n.id===id);if(target?.type==='recipe')await generate(id);else await window.tugou.generateWorkflow(projectId,current.current.document,id);await refreshTasks();},e=>setNodeErrors(previous=>({...previous,[id]:e.message})));}
    finally{pendingSubmissions.current.delete(id);if(mounted.current)setSubmittingIds(new Set(pendingSubmissions.current));}
  };
  const cancelNode=id=>run(async()=>{const task=tasks.find(t=>t.context?.nodeId===id&&['queued','running'].includes(t.status));if(task){await window.tugou.cancelTask(task.id);await refreshTasks();}});
  const importingNodes=useRef(new Set());
  const importNodeImage=async(id,files)=>{
    if(disabled||importingNodes.current.has(id))return;
    importingNodes.current.add(id);
    try{await run(async()=>{
      const assets=await (files?window.tugou.importDroppedImages(files):window.tugou.importImage());
      if(!mounted.current||!assets.length)return;
      const source=current.current.document,target=current.current.nodes.find(n=>n.id===id);if(!target)return;
      const next={...source,assets:[...source.assets,...assets]};
      const parent=current.current.nodes.find(n=>n.id===target.parentId);
        const added=assets.slice(1).map((a,i)=>createNode(next,'asset',a.id,{x:target.position.x+(parent?.position.x||0)+(i+1)*300,y:target.position.y+(parent?.position.y||0)}));
      commit([...current.current.nodes.map(n=>n.id===id?{...n,data:{...n.data,assetId:assets[0].id}}:n),...added],current.current.edges,undefined,true,next);
    });}finally{importingNodes.current.delete(id);}
  };
  const compiled = useMemo(() => {
    if (node?.type !== "recipe"&&!workflowTypes.includes(node?.type)) return null;
    if(node.type==='director')return null;
    try {
      return {
        result: (node.type==='recipe'?compileNode:compileWorkflow)(
          { ...document, tugouCanvas: { ...graph, nodes, edges } },
          node.id,
        ),
      };
    } catch (error) {
      return { error: error.message };
    }
  }, [document, node?.id, node?.data, edges]);
  const sizedKey=nodes.filter(n=>n.width&&n.height).map(n=>n.id).join('|');
  const locateNode=useCallback(id=>{
    if(!current.current.nodes.some(n=>n.id===id))return;
    setNodes(previous=>previous.map(n=>({...n,selected:n.id===id})));
    flow.fitView({nodes:[{id}],padding:.4,maxZoom:1,duration:200});
  },[flow]);
  const nodeContext=useMemo(()=>({document:document.tugouCanvas?document:{...document,tugouCanvas:graph},resize,previewResize,disabled,tasks,patch:patchById,runNode,cancelNode,submittingIds,connection,refreshConnection,run,importNodeImage,openNodeScene:setSceneNode,showDetails,openConnection,openRecipe,nodeErrors,locateNode,moveInput,removeInput,replaceImage:(nodeId,assetId)=>setReplacement({nodeId,assetId}),updateReference:id=>commit(current.current.nodes.map(n=>n.id===id?refreshNode(current.current.document,n):n),current.current.edges),sizedIds:new Set(sizedKey?sizedKey.split('|'):[])}),[document,disabled,tasks,submittingIds,connection,nodeErrors,sizedKey,resize,previewResize,showDetails,openConnection,openRecipe,projectId,locateNode]);
  return (
    <CanvasContext.Provider value={nodeContext}>
      <div
        className="canvas-workspace"
        tabIndex={-1}
        onPointerDownCapture={event=>{if(event.target.closest('.react-flow')&&!event.target.closest('input,textarea,select,button,a,[contenteditable]'))event.currentTarget.focus({preventScroll:true});}}
        onKeyDown={(event) => {
          if(event.key==='Tab'&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&!disabled&&!createMenu&&
            (event.target===event.currentTarget||event.target.classList.contains('react-flow__node'))){
            event.preventDefault();
            const r=holder.current.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+Math.min(160,r.height/3);
            pendingLink.current=null;setInsertPoint(null);
            setCreateMenu({x,y,point:flow.screenToFlowPosition({x,y})});
            return;
          }
          if (
            (event.ctrlKey || event.metaKey) &&
            !event.target.closest("input,textarea,select,[contenteditable]")
          ) {
            if(event.key.toLowerCase()==='g'){
              event.preventDefault();
              if(!event.repeat&&!event.altKey){if(event.shiftKey)dissolveGroup();else createGroup();}
            }
            if (["c", "x"].includes(event.key.toLowerCase())) {
              event.preventDefault();
              copy();
              if (event.key.toLowerCase() === "x") remove();
            }
            if (event.key.toLowerCase() === "v") {
              event.preventDefault();
              paste();
            }
            if (event.key.toLowerCase() === "a") {
              event.preventDefault();
              setNodes(nodes.map((n) => ({ ...n, selected: true })));
            }
          }
          if (
            isDeleteKey(event, window.tugou.platform) &&
            !event.target.closest("input,textarea,select,[contenteditable]")
          ) {
            event.preventDefault();
            remove();
          }
        }}
      >
        {toolbarHost &&
          createPortal(
            <>
              <span className="toolbar-divider" />
              <Button
                iconOnly icon="generate"
                className="primary"
                disabled={
                  disabled ||
                  submittingIds.has(node?.id) ||
                  (node?.type !== "recipe" && (!workflowTypes.includes(node?.type)||node?.type==='director')) ||
                  Boolean(activeTask) ||
                  Boolean(compiled?.error)
                }
                onClick={()=>runNode(node.id)}
              >
                {activeTask
                  ? activeTask.status === "queued"
                    ? "等待中"
                    : "生成中"
                  : submittingIds.has(node?.id)
                    ? "提交中"
                  : node?.type==='config'?'开始生成':node?.type==='textgen'?'生成文本':node?.type==='video'?'生成视频':node?.type==='audio'?'生成语音':"生成图片"}
              </Button>
              {activeTask&&<Button iconOnly icon="stop" onClick={()=>run(async()=>{await window.tugou.cancelTask(activeTask.id);await refreshTasks();})}>取消生成</Button>}
              {node?.type==='director'&&<Button iconOnly icon="camera" onClick={()=>setSceneNode(node.id)}>打开导演台</Button>}
              {selectedMedia&&<><Button iconOnly icon="tools" onClick={()=>setMediaTool({asset:selectedMedia,nodeId:node.id})}>媒体工具</Button><Button iconOnly icon="export" onClick={()=>run(()=>window.tugou.exportAsset(projectId,current.current.document,selectedMedia.id))}>导出媒体</Button></>}
              {node?.type==='panorama'&&node.data.outputAssetId&&<Button iconOnly icon="camera" onClick={()=>setSceneNode(node.id)}>环视全景</Button>}
              {node?.type==='asset'&&document.assets.find(a=>a.id===node.data.assetId)?.projection&&<Button iconOnly icon="camera" onClick={()=>setSceneNode(node.id)}>环视全景</Button>}
              <Button iconOnly icon="text" onClick={() => add("text")}>
                文字
              </Button>
              <CanvasNodeMenu close={()=>{setCreateMenu(null);pendingLink.current=null;}} choose={chooseNode} disabled={disabled}/>
              <Button iconOnly icon="import" aria-label={imageImport.importing?"导入中":"图片"} disabled={imageImport.importing||disabled} onClick={imageImport.open}>
                {imageImport.importing?'导入中':'图片'}
              </Button>
              {selectedImages.length > 0 && <>
                <Button iconOnly icon="replace" disabled={disabled||!selectedImage} onClick={()=>setReplacement({nodeId:node.id,assetId:selectedImage.id})}>替换图片</Button>
                <Button iconOnly icon="crop" disabled={disabled} onClick={()=>editSelectedImages("crop")}>裁剪</Button>
                <Button iconOnly icon="zoomIn" disabled={disabled} onClick={()=>editSelectedImages("resize")}>放大</Button>
                {selectedImage&&<DisplayControls node={node} resize={resize} patch={patchNode} disabled={disabled}/>}
                <ToolPopover label="图片工具" icon="tools">
                  <div className="image-tool-detail">
                    <Button disabled={disabled||!selectedImage||Boolean(activeTask)} onClick={()=>setAngleSource({nodeId:node.id,asset:selectedImage})}>AI 多角度</Button>
                    <Button disabled={disabled||!selectedImage} onClick={()=>showDetails(selectedImage.id,node.id)}>原图与提示词</Button>
                    <Button disabled={disabled||!selectedImage} onClick={async()=>{
                      try{await copyAssetPrompt(await window.tugou.assetDetails(projectId,current.current.document,selectedImage.id,node.id));if(mounted.current)setMessage("提示词已复制");}
                      catch(e){if(mounted.current)setMessage(e.message);}
                    }}>复制提示词</Button>
                    <Button disabled={disabled||!selectedImage} onClick={()=>analyzeImage(selectedImage.id,node.id)}>图片反推</Button>
                    <Button disabled={disabled} onClick={()=>editSelectedImages("upscale")}>AI 超分辨率</Button>
                    <Button disabled={disabled} onClick={()=>editSelectedImages("cutout")}>主体抠图</Button>
                    <Button disabled={disabled} onClick={()=>editSelectedImages("cloudEdit")}>局部修改</Button>
                    <Button disabled={disabled} onClick={()=>editSelectedImages("split")}>切图</Button>
                    <Button disabled={disabled} onClick={()=>editSelectedImages("resize")}>全部图像工具</Button>
                  </div>
                </ToolPopover>
              </>}
              <Button iconOnly icon="copy" disabled={!selected.length} onClick={copy}>
                复制
              </Button>
              <ToolPopover label="分组" icon="layers">
                <Button disabled={disabled||!canGroup} title="Ctrl+G / ⌘G" onClick={createGroup}>创建分组</Button>
                <Button disabled={disabled||node?.type!=='group'} title="Ctrl+Shift+G / ⌘⇧G" onClick={dissolveGroup}>解散分组</Button>
              </ToolPopover>
              <ToolPopover label="整理选中节点" icon="align" className="canvas-arrange-menu">
                <small className="muted">{!layoutSameParent?'请选择同组节点，或选择整个组合':layoutNodes.length<2?'选择至少两个节点后整理':`整理 ${layoutNodes.length} 个节点 / 组合`}</small>
                {[
                  ['flow','按连接整理',2],['left','左对齐',2],['top','顶部对齐',2],
                  ['horizontal','水平等间距',3],['vertical','垂直等间距',3],['grid','按行整理',2],
                ].map(([mode,label,min])=><Button key={mode} disabled={disabled||!layoutSameParent||layoutNodes.length<min} onClick={()=>arrange(mode)}>{label}</Button>)}
              </ToolPopover>
              <Button iconOnly icon="paste" onClick={paste} disabled={!clipboard}>
                粘贴
              </Button>
              <Button iconOnly icon="delete"
                disabled={
                  !selected.length && !edges.some((edge) => edge.selected)
                }
                onClick={remove}
              >
                删除所选
              </Button>
              <span className="toolbar-divider" />
              <Button iconOnly icon="zoomOut" aria-label="缩小画布" onClick={() => flow.zoomOut()}>−</Button>
              <span>{Math.round(zoom * 100)}%</span>
              <Button iconOnly icon="zoomIn" aria-label="放大画布" onClick={() => flow.zoomIn()}>＋</Button>
              <Button iconOnly
                icon="fit"
                onClick={fitCanvas}
              >
                适应画布
              </Button>
              <Button iconOnly icon="layout"
                aria-pressed={minimap}
                onClick={() => setMinimap(!minimap)}
              >
                小地图
              </Button>
              <Select
                aria-label="画布背景"
                value={graph.background || "dots"}
                onChange={(e) =>
                  change({
                    ...document,
                    tugouCanvas: { ...graph, background: e.target.value },
                  })
                }
              >
                <option value="dots">点阵</option>
                <option value="lines">网格</option>
                <option value="none">空白</option>
              </Select>
            </>,
            toolbarHost,
          )}
        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}
        <div className="canvas-body">
          <aside className="canvas-palette">
            <div className="palette-tabs">
              {[
                ["node", "画布"],
                ["asset", "素材"],
                ["module", "模块"],
                ["recipe", "配方"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  iconOnly
                  icon={{node:"canvas",asset:"assets",module:"prompts",recipe:"layers"}[value]}
                  aria-pressed={palette === value}
                  onClick={() => {setPalette(value);setInsertPoint(null);}}
                >
                  {label}
                </Button>
              ))}
            </div>
            <SearchField
              label="搜索画布内容"
              value={query}
              onChange={setQuery}
            />
            <p className="muted">
              {insertPoint ? '选择内容，添加到刚才的位置（Esc 取消）' : palette === "node"
                ? `画布元素 ${nodes.length}`
                : "拖入画布，或点击添加"}
            </p>
            {palette!=="node"&&!items.length&&<p className="muted">{query?'没有匹配内容':`暂无${{module:'模块，请先在提示词工作台创建',recipe:'配方，可通过“图片生成”新建',asset:'素材，请先导入图片'}[palette]}`}</p>}
            {items.map((item) => (
              <Button
                className="palette-item"
                key={item.id}
                draggable={palette !== "node"}
                onDragStart={(event) =>
                  event.dataTransfer.setData(
                    "application/x-tugou",
                    JSON.stringify({ projectId, type: palette, id: item.id }),
                  )
                }
                onClick={() =>
                  palette === "node"
                    ? setNodes(
                        nodes.map((n) => ({
                          ...n,
                          selected: n.id === item.id,
                        })),
                      )
                    : add(palette, item.id)
                }
              >
                {palette === "asset" ? (
                  <MediaPreview thumbnail asset={item} className="palette-thumbnail"/>
                ) : (
                  <Icon
                    name={
                      palette === "node"
                        ? "canvas"
                        : palette === "module"
                          ? "prompts"
                          : "other"
                    }
                  />
                )}{" "}
                {item.name}
              </Button>
            ))}
          </aside>
          <div
            className="flow-surface"
            ref={holder}
            onDoubleClick={event=>{
              if(disabled||!event.target.closest('.react-flow__pane')||event.target.closest('.react-flow__node,.react-flow__edge'))return;
              event.preventDefault();
              pendingLink.current=null;
              setInsertPoint(null);
              setCreateMenu({x:event.clientX,y:event.clientY,point:flow.screenToFlowPosition({x:event.clientX,y:event.clientY})});
            }}
            onDragOver={(event) => {
              if(hasImageFiles(event)){imageImport.over(event);return;}
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              if(hasImageFiles(event)&&[...event.dataTransfer.files].some(f=>/\.(mp4|webm|weba|mp3|wav|ogg|m4a|flac)$/i.test(f.name))){event.preventDefault();event.stopPropagation();const point=flow.screenToFlowPosition({x:event.clientX,y:event.clientY}),files=[...event.dataTransfer.files];run(async()=>{const assets=await window.tugou.importDroppedMedia(files);if(mounted.current)addMediaAssets(assets,point);});return;}
              if(hasImageFiles(event)){imageImport.drop(event,flow.screenToFlowPosition({x:event.clientX,y:event.clientY}));return;}
              event.preventDefault();
              try {
                const data = JSON.parse(
                  event.dataTransfer.getData("application/x-tugou"),
                );
                if(data.projectId!==projectId)throw Error('请从当前工程拖入');
                add(
                  data.type,
                  data.id,
                  flow.screenToFlowPosition({
                    x: event.clientX,
                    y: event.clientY,
                  }),
                );
              } catch {
                setMessage("无法添加，请从左侧模块、配方或素材库重新拖入。");
              }
            }}
          >
            <ReactFlow
              onlyRenderVisibleElements
              zoomOnDoubleClick={false}
              onMoveStart={()=>setCreateMenu(null)}
              onPaneClick={()=>setCreateMenu(null)}
              onNodeClick={()=>setCreateMenu(null)}
              onNodeDoubleClick={(_,n)=>{if(n.type==='director'||n.type==='panorama'&&n.data.outputAssetId)setSceneNode(n.id);}}
              onConnectEnd={(event,state)=>{
                if(disabled||state.isValid||!state.fromNode||!event.target.closest('.react-flow__pane'))return;
                const p=event.changedTouches?.[0]||event;
                pendingLink.current={id:state.fromNode.id,type:state.fromHandle?.type||'source'};
                setCreateMenu({x:p.clientX,y:p.clientY,point:flow.screenToFlowPosition({x:p.clientX,y:p.clientY})});
              }}
              nodes={nodes}
              edges={displayedEdges}
              nodeTypes={nodeTypes}
              defaultViewport={graph.viewport}
              minZoom={0.15}
              maxZoom={3}
              colorMode={theme.mode}
              deleteKeyCode={null}
              multiSelectionKeyCode="Shift"
              selectionKeyCode={null}
              selectionOnDrag
              panOnDrag={false}
              panActivationKeyCode="Space"
              nodeDragThreshold={3}
              connectionDragThreshold={3}
              defaultEdgeOptions={{ type: "default", interactionWidth: 24 }}
              connectionLineType={ConnectionLineType.Bezier}
              connectionLineStyle={{stroke:'var(--accent)',strokeWidth:2}}
              connectionRadius={32}
              connectOnClick
              onNodesChange={(changes) =>
                setNodes((previous) => applyNodeChanges(changes, previous))
              }
              onEdgesChange={(changes) =>
                setEdges((previous) => applyEdgeChanges(changes, previous))
              }
              onNodeDragStop={(_event, _node, moved) => {
                const positions = new Map(
                  moved.map((entry) => [entry.id, entry.position]),
                );
                commit(
                  current.current.nodes.map((entry) =>
                    positions.has(entry.id)
                      ? { ...entry, position: positions.get(entry.id) }
                      : entry,
                  ),
                  current.current.edges,
                );
              }}
              onMoveEnd={(_event, viewport) => {
                setZoom(viewport.zoom);
                const source = current.current.document.tugouCanvas;
                if (
                  source &&
                  JSON.stringify(source.viewport) !== JSON.stringify(viewport)
                )
                  commit(
                    current.current.nodes,
                    current.current.edges,
                    viewport,
                    false,
                  );
              }}
              isValidConnection={(connection) =>
                canConnect(
                  { nodes, edges },
                  connection.source,
                  connection.target,
                )
              }
              onConnect={(connection) => {
                if (
                  canConnect(
                    { nodes, edges },
                    connection.source,
                    connection.target,
                  )
                )
                  commit(nodes, [
                    ...edges,
                    {
                      id: crypto.randomUUID(),
                      source: connection.source,
                      target: connection.target,
                    },
                  ]);
              }}
            >
              {graph.background !== "none" && (
                <Background
                  variant={graph.background === "lines" ? "lines" : "dots"}
                  gap={24}
                  size={1}
                />
              )}{" "}
              {minimap && (
                <MiniMap pannable zoomable nodeColor="var(--accent)" />
              )}
            </ReactFlow>
            {createMenu&&<CanvasNodeMenu position={createMenu} close={()=>{setCreateMenu(null);pendingLink.current=null;}} choose={chooseNode} disabled={disabled} canChoose={pendingLink.current?canCreateLinked:undefined}/>}
          </div>
          <aside
            className={`canvas-inspector ${selected.length ? "" : "collapsed"}`}
          >
            {node ? (
              <>
                <div className="panel-heading">
                  <h2>节点设置</h2>
                  {nodeStatus(document, node) === "outdated" && (
                    <Button
                      onClick={() =>
                        commit(
                          nodes.map((entry) =>
                            entry.id === node.id
                              ? refreshNode(document, entry)
                              : entry,
                          ),
                          edges,
                        )
                      }
                    >
                      更新引用
                    </Button>
                  )}
                </div>
                {node.type === "module" && (
                  <ReferenceEditor
                    key={node.id}
                    document={document}
                    binding={node.data.binding}
                    change={(binding) => patchNode({ binding })}
                  />
                )}
                {node.type === "text" && (
                  <>
                    <label>
                      名称
                      <Input
                        value={node.data.name}
                        onChange={(event) =>
                          patchNode({ name: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      提示词
                      <TextArea
                        aria-label="画布自由提示词"
                        value={node.data.text}
                        onChange={(event) =>
                          patchNode({ text: event.target.value })
                        }
                      />
                    </label>
                  </>
                )}
                {node.type==='group'&&<label>分组名称<Input aria-label="分组名称" disabled={disabled} value={node.data.name} onChange={e=>patchNode({name:e.target.value})}/></label>}
                {workflowTypes.includes(node.type)&&<WorkflowSettings node={node} compiled={compiled?.result} document={{...document,tugouCanvas:{...graph,nodes,edges}}} patch={patchNode} disabled={disabled} task={tasks.filter(t=>t.context?.nodeId===node.id).at(-1)} run={run} importMedia={()=>importMediaAt(undefined,node.id)} openScene={()=>setSceneNode(node.id)} openPanorama={()=>setSceneNode(node.id)}/>}
                {workflowTypes.includes(node.type)&&node.type!=='director'&&(compiled.error?<p role="alert">{compiled.error}</p>:<details><summary>合成提示词</summary><PromptPreview document={document} result={compiled.result}/></details>)}
                {node.type === "asset" && (
                  <label>
                    参考图职责
                    <Input
                      aria-label="画布参考图职责"
                      value={node.data.role}
                      onChange={(event) =>
                        patchNode({ role: event.target.value })
                      }
                    />
                  </label>
                )}
                {node.type === "recipe" && (
                  <>
                    <label>生成提示词<TextArea aria-label="画布生成提示词" value={node.data.snapshot.output||''} onChange={event=>{
                      const output=event.target.value,source=current.current.document;
                      commit(current.current.nodes.map(n=>n.id===node.id?{...n,data:{...n.data,snapshot:{...n.data.snapshot,output}}}:n),current.current.edges,undefined,true,{...source,recipes:source.recipes.map(r=>r.id===node.data.recipeId?{...r,output}:r)});
                    }}/></label>
                    <p className={`state-${nodeStatus(document, node)}`}>
                      {statusLabels[nodeStatus(document, node)]} ·
                      连入的模块和素材会参与合成
                    </p>
                    <Button onClick={() => openRecipe(node.data.recipeId)}>
                      在工作台编辑配方
                    </Button>
                    <p className="muted">
                      单次修改可连接模块或文字节点；配方中的冲突在工作台处理。
                    </p>
                    {compiled.error ? (
                      <p role="alert">{compiled.error}</p>
                    ) : (
                      <PromptPreview
                        document={document}
                        result={compiled.result}
                      />
                    )}
                  </>
                )}
              </>
            ) : (
              <div className="empty-small">
                {selected.length > 1
                  ? `已选择 ${selected.length} 个节点，可一起移动或删除。`
                  : "选择节点以编辑内容、查看引用状态。"}
              </div>
            )}
          </aside>
        </div>
      </div>
      {replacement&&<ReplaceImageDialog document={document} change={change} targetId={replacement.nodeId} assetId={replacement.assetId} close={()=>setReplacement(null)}/>}
      {angleSource&&<AngleDialog source={angleSource.asset} sourceUrl={assetUrl(angleSource.asset)} close={()=>setAngleSource(null)} submit={async params=>{
        await window.tugou.generateAngle(projectId,current.current.document,angleSource.nodeId,angleSource.asset.id,params);
        await refreshTasks();
        if(mounted.current)setMessage('多角度任务已提交，可在任务中取消');
      }}/>}
      {sceneNode&&(()=>{
        const n=nodes.find(n=>n.id===sceneNode);if(!n)return null;
        const panorama=n.type!=='director',scene=n.data.scene||workflowNode('director',{x:0,y:0}).data.scene;
        const ids=panorama?[n.data.outputAssetId||n.data.assetId]:edges.filter(e=>e.target===n.id).map(e=>{const src=nodes.find(x=>x.id===e.source);return src?.data.outputAssetId||src?.data.assetId;});
        const backgrounds=ids.map(id=>document.assets.find(a=>a.id===id)).filter(a=>a&&(!a.kind||a.kind==='image'));
        return <SceneView key={n.id} scene={scene} panorama={panorama} backgrounds={backgrounds} close={()=>setSceneNode(null)} change={scene=>commit(current.current.nodes.map(x=>x.id===n.id?{...x,data:{...x.data,scene}}:x),current.current.edges)} capture={async images=>{const assets=[];for(const [i,bytes] of images.entries())assets.push(await window.tugou.storeRaster([...bytes],images.length===1?'场景截图':`场景截图 ${i+1}`));if(mounted.current)addMediaAssets(assets,undefined,n.id,!panorama);}} record={async(bytes,format)=>{const asset=await window.tugou.storeMedia([...bytes],'机位录制.'+format);if(mounted.current)addMediaAssets([asset],undefined,n.id);}}/>;
      })()}
      {mediaTool&&<MediaTools asset={mediaTool.asset} close={()=>setMediaTool(null)} receive={asset=>addMediaAssets([asset],undefined,mediaTool.nodeId,false)}/>}
    </CanvasContext.Provider>
  );
}

export function InfiniteCanvas(props) {
  return (
    <ReactFlowProvider>
      <CanvasWorkspace {...props} />
    </ReactFlowProvider>
  );
}
