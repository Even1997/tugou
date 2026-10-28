import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  syncAll,
  syncCounts,
  emptyCanvas,
  createNode,
  pinRecipe,
} from "../core/prompts.cjs";
import { PromptWorkbench } from "./prompt-workbench.jsx";
import { ConnectionDialog } from "./connection.jsx";
import { ImageTools } from "./image-tools.jsx";
import { AssetLibrary } from "./materials.jsx";
import { StudioHeader, StudioStatus } from "./shell.jsx";
import { ThemeProvider, Button, FormDialog } from "./components.jsx";
import { InfiniteCanvas } from "./canvas.jsx";
import { CompositeWorkspace as LayerEditor } from "./composite-workspace.jsx";
import { AnalysisDialog } from "./analysis.jsx";
import { analysisToCanvas } from "../core/analysis-draft.cjs";
import { MaterialDetails } from "./material-details.jsx";
import { TaskPanel } from "./tasks.jsx";
import { applyResults } from "../core/results.cjs";
import { stageOutputs } from "../core/generation-output.cjs";
import "./ui.css";
import { createLayer, inherited } from "../core/layers.cjs";
import { replaceLayerAsset } from "../core/materials.cjs";
import {extractDeskPrompts} from '../core/desk-prompts.cjs';
import {useAutomation} from './automation.js';

import {FontWorkspace} from './font-workspace.jsx';
import {PreferencesProvider,usePreferences} from './preferences.jsx';
import {commandFor,shortcutBlocked} from '../core/shortcuts.cjs';
import {SettingsWorkspace} from './settings.jsx';
import {useDevPreview} from './dev-preview.jsx';
const api = window.tugou;
let previewBootstrap={enabled:false,snapshot:null};
function prepareRecord(record){
  if(!record)return record;
  const document=extractDeskPrompts(record.document);
  return document===record.document?record:{...record,document,promptsExtracted:true};
}

function App() {
  const preferences=usePreferences();
  useEffect(()=>{
    const preventFileNavigation=event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();};
    window.addEventListener('dragover',preventFileNavigation);window.addEventListener('drop',preventFileNavigation);
    return()=>{window.removeEventListener('dragover',preventFileNavigation);window.removeEventListener('drop',preventFileNavigation);};
  },[]);
  const [projects, setProjects] = useState(previewBootstrap.snapshot?.projects||[]);
  const [record, setRecord] = useState(previewBootstrap.snapshot?.record||null);
  const [workspace, setWorkspace] = useState(previewBootstrap.snapshot?.workspace||"prompts");

  const [recipeId, setRecipeId] = useState(previewBootstrap.snapshot?.recipeId||null);
  const [moduleId, setModuleId] = useState(previewBootstrap.snapshot?.moduleId||null);
  const [layerSelection,setLayerSelection]=useState(previewBootstrap.snapshot?.layerSelection||[]);
  const [dirty, setDirty] = useState(!!previewBootstrap.snapshot?.dirty);
  const dirtyRef = useRef(!!previewBootstrap.snapshot?.dirty);
  const [busy, setBusy] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [analysisSource,setAnalysisSource]=useState(null), [detailsSession,setDetailsSession]=useState(null);
  const [toolSession, setToolSession] = useState(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tasks, setTasks] = useState([]),
    [tasksOpen, setTasksOpen] = useState(false);
  const seenResults = useRef(new Set(previewBootstrap.snapshot?.seenResults||[]));
  const history = useRef(previewBootstrap.snapshot?.history||{ past: [], future: [] });
  const present = useRef(record),
    busyRef = useRef(busy);
  present.current = record;
  busyRef.current = busy;
  const run = async (operation) => {
    setError("");
    try {
      return await operation();
    } catch (failure) {
      setError(failure.message);
    }
  };
  const refresh = async () => setProjects(await api.list());
  useEffect(() => {
    run(refresh);
    if(!previewBootstrap.snapshot&&!sessionStorage.getItem('tugou-reload-view'))run(async()=>{const restored=prepareRecord(await api.settings('lastProject'));if(restored&&!present.current){present.current=restored;setRecord(restored);if(restored.promptsExtracted)markDirty(true);}});
  }, []);
  useEffect(() => {
    const raw = sessionStorage.getItem("tugou-reload-view");
    if (!raw) return;
    sessionStorage.removeItem("tugou-reload-view");
    run(async () => {
      const view = JSON.parse(raw);
      if (view.id) {
        const next = prepareRecord(await api.open(view.id));
        present.current = next;
        setRecord(next);
        if(next.promptsExtracted)markDirty(true);
      }
      if (
        ["layers", "canvas", "prompts", "assets", "tools", "fonts", "settings"].includes(
          view.workspace,
        )
      )
        setWorkspace(view.workspace);
    });
  }, []);
  const markDirty = (value) => {
    dirtyRef.current = value;
    setDirty(value);
    api.dirty(value).catch((failure) => setError(failure.message));
  };
  const change = (document, options = {}) => {
    if (busyRef.current) return false;
    if (options.history !== false) {
      history.current.past.push(present.current.document);
      history.current.past = history.current.past.slice(-60);
      history.current.future = [];
    }
    present.current = { ...present.current, document };
    setRecord(present.current);
    markDirty(true);
    setNotice("");
    return true;
  };
  const syncOutputs=list=>{
    const current=present.current;if(!current||busyRef.current)return;
    const own=list.filter(t=>t.context?.projectId===current.id),next=stageOutputs(current.document,own);
    if(next!==current.document){
      history.current={past:history.current.past.map(doc=>stageOutputs(doc,own)),future:history.current.future.map(doc=>stageOutputs(doc,own))};
      change(next,{history:false});
    }
  };
  const refreshTasks = async () => {const list=await api.tasks();setTasks(list);syncOutputs(list);};
  useEffect(() => {
    let stopped = false,
      polling = false;
    const poll = async () => {
      if (polling || busyRef.current) return;
      polling = true;
      try {
        const list = await api.tasks();
        if (stopped) return;
        setTasks(list);
        syncOutputs(list);
        const id = present.current?.id;
        if (!id) return;
        const results = await api.results(id);
        if (stopped || busyRef.current || present.current?.id !== id) return;
        const fresh = results.filter(
          (result) => !seenResults.current.has(`${id}:${result.id}`),
        );
        if (fresh.length) {
          const applied = applyResults(present.current.document, history.current, fresh);
          const next = applied.document;
          fresh.forEach((result) =>
            seenResults.current.add(`${id}:${result.id}`),
          );
          if (
            JSON.stringify(next) !== JSON.stringify(present.current.document)
          ) {
            history.current = applied.history;
            change(next, { history: false });
            setNotice("处理结果已入素材库");
          }
        }
      } catch (failure) {
        if (!stopped) setError(failure.message);
      } finally {
        polling = false;
      }
    };
    poll();
    const timer = setInterval(poll, 1200);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [record?.id]);
  const generate = async (nodeId) =>
    run(async () => {
      const current = present.current;
      await api.generate(current.id, current.document, nodeId);
      await refreshTasks();
      setNotice("任务已提交，可继续编辑");
    });
  const travel = (direction) => {
    if (busy || !record) return;
    const from = direction === "undo" ? "past" : "future",
      to = direction === "undo" ? "future" : "past";
    const next = history.current[from].pop();
    if (!next) return;
    history.current[to].push(present.current.document);
    present.current = { ...present.current, document: next };
    setRecord(present.current);
    markDirty(true);
  };
  const addToCanvas = (type, id) => {
    const doc = present.current.document, graph = doc.tugouCanvas || emptyCanvas();
    const anchors = toolSession?.projectId === present.current.id
      ? graph.nodes.filter(n=>toolSession.nodeIds.includes(n.id)) : [];
    const ids = [...new Set(Array.isArray(id) ? id : [id])];
    const nodes = ids.map((sourceId,index)=>createNode(doc,type,sourceId,{
      x: anchors.length ? Math.max(...anchors.map(n=>n.position.x + (n.width || 270))) + 60 : 60 + (graph.nodes.length + index) * 35,
      y: anchors.length ? Math.min(...anchors.map(n=>n.position.y)) + index * 400 : 60 + (graph.nodes.length + index) * 35,
    }));
    if(change({...doc,tugouCanvas:{...graph,nodes:[...graph.nodes,...nodes]}}) === false)return;
    setToolSession(null);
    setWorkspace("canvas");
  };
  const openImageTools = (ids, operation="resize", nodeIds=[]) => {
    const assetIds=[...new Set(ids)].filter(id=>present.current.document.assets.some(a=>a.id===id));
    if(!assetIds.length || assetIds.length>64){setError("请选择 1–64 张有效素材");return;}
    setToolSession({projectId:present.current.id,assetIds,operation,nodeIds});
  };
  const analyzeImage=(assetId,nodeId)=>{setAnalysisSource({assetId,nodeId});setAnalysisOpen(true);};
  const sendAnalysisToCanvas=draftId=>{
    const doc=present.current.document,next=analysisToCanvas(doc,draftId,analysisSource?.nodeId);
    if(next!==doc&&change(next)===false)throw Error("工程正在保存，请稍后加入画布");
    setAnalysisOpen(false);setWorkspace("canvas");
  };
  const generateRecipe = async (recipeId) =>
    run(async () => {
      const current = present.current,
        doc = current.document,
        graph = doc.tugouCanvas || emptyCanvas();
      let node = graph.nodes.find(
        (n) => n.type === "recipe" && n.data.recipeId === recipeId,
      );
      const recipe = doc.recipes.find((r) => r.id === recipeId);
      node = node
        ? { ...node, data: { ...node.data, snapshot: pinRecipe(doc, recipe) } }
        : createNode(doc, "recipe", recipeId, {
            x: 60 + graph.nodes.length * 35,
            y: 60,
          });
      const next = {
        ...doc,
        tugouCanvas: {
          ...graph,
          nodes: [...graph.nodes.filter((n) => n.id !== node.id), node],
        },
      };
      change(next);
      await api.generate(current.id, next, node.id);
      await refreshTasks();
      setNotice("任务已提交，可继续编辑");
    });
  const addAssetLayer = (asset, sourceLayerId) => {
    const doc = present.current.document;
    const assets = Array.isArray(asset) ? asset : [asset];
    if(assets.some(a=>a.kind&&a.kind!=='image')){setNotice('图层合成仅接受图片，请先从视频提取画面');return;}
    const sourceLayer = sourceLayerId && doc.layers.find(l=>l.id===sourceLayerId&&l.kind==='image');
    if (sourceLayerId && (!sourceLayer || assets.some(a=>a.toolResult?.sourceId!==sourceLayer.assetId))) {setNotice('来源图层已变化，请重新选择');return;}
    const pending = sourceLayer ? assets.filter(a=>!doc.layers.some(l=>l.assetId===a.id&&l.semanticSourceLayerId===sourceLayer.id)) : assets;
    if (!pending.length) {setWorkspace('layers');return;}
    if(change({
      ...doc,
      layers: [
        ...doc.layers,
        ...pending.map(asset=>createLayer("image", {
          name: asset.name,
          assetId: asset.id,
          x: 0,
          y: 0,
          width: asset.width,
          height: asset.height,
          ...(sourceLayer ? {
            ...Object.fromEntries(['parentId','x','y','width','height','scaleX','scaleY','rotation','skewX','flipX','flipY','warp'].filter(k=>sourceLayer[k]!==undefined).map(k=>[k,structuredClone(sourceLayer[k])])),
            semanticSourceLayerId: sourceLayer.id,
          } : {}),
        })),
      ],
    })===false)return;
    setLayerSelection(present.current.document.layers.slice(-pending.length).map(l=>l.id));
    setWorkspace("layers");
  };
  const sync = record
    ? syncCounts(record.document)
    : { outdated: 0, conflicts: 0, missing: 0 };
  const replacementTarget=layerSelection.length===1&&record?.document.layers.find(l=>l.id===layerSelection[0]&&l.kind==='image');
  const replaceLayer=assetId=>{
    const doc=present.current.document,layer=doc.layers.find(l=>l.id===layerSelection[0]);
    if(layerSelection.length!==1||!layer)throw Error('请先选择一个图片图层');
    const next=replaceLayerAsset(doc,layer.id,layer.assetId,doc.assets.find(a=>a.id===assetId));
    if(next!==doc&&change(next)===false)throw Error('工程正在保存，请稍后替换');
    setWorkspace('layers');
  };
  const save = async () => {
    if (!record || busy || !dirty) return;
    busyRef.current = true;
    setBusy(true);
    await run(async () => {
      setRecord(await api.save(record.id, record.document, record.revision));
      markDirty(false);
      setNotice("已保存");
      await refresh();
    });
    setBusy(false);
  };
  const hotReload = async () => {
    if(previewBootstrap.enabled){setNotice('开发预览会在安全时机自动更新，无需手动刷新');return;}
    if (busyRef.current) return;
    window.document.activeElement?.blur();
    await new Promise((resolve) => setTimeout(resolve, 0));
    busyRef.current = true;
    setBusy(true);
    await run(async () => {
      const current = present.current;
      if (current) {
        const saved = await api.save(
          current.id,
          current.document,
          current.revision,
        );
        present.current = saved;
        setRecord(saved);
      }
      await api.dirty(false);
      setDirty(false);
      sessionStorage.setItem(
        "tugou-reload-view",
        JSON.stringify({ id: current?.id, workspace }),
      );
      await api.window("reload");
    });
    busyRef.current = false;
    setBusy(false);
  };
  useEffect(() => api.onReload?.(hotReload));
  useEffect(() => api.onCommand?.((command) => {
    const target = document.activeElement;
    if (target?.closest("input,textarea,[contenteditable]")) {
      run(() => api.editCommand(command));
      return;
    }
    if(target?.closest('[role="dialog"]')||document.querySelector('[role="dialog"]'))return;
    if (command === "undo" || command === "redo") {
      if(workspace==='fonts')return;
      travel(command);
      return;
    }
    const key = { copy: "c", cut: "x", paste: "v", selectAll: "a" }[command];
    const surface = workspace === "canvas" ? document.querySelector(".canvas-workspace") : target;
    if (key && surface) surface.dispatchEvent(new KeyboardEvent("keydown", {key, code:'Key'+key.toUpperCase(), metaKey: api.platform==='darwin', ctrlKey:api.platform!=='darwin', bubbles: true, cancelable: true}));
  }));
  useEffect(() => {
    const handler = (event) => {
      if(shortcutBlocked(event)||busy)return;
      const command=commandFor(event,api.platform,preferences.value.shortcuts);
      if (command === 'save') {
        event.preventDefault();
        if(workspace==='fonts')return;
        save();
      }
      if (
        command==='undo'||command==='redo'
      ) {
        event.preventDefault();
        if(workspace==='fonts')return;
        travel(command);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });
  const switchProject = (operation) => {
    if (busy || (dirty && !confirm("放弃当前未保存的修改？"))) return;
    setBusy(true);
    run(async () => {
      const next = prepareRecord(await operation());
      if (next) {
        history.current = { past: [], future: [] };
        present.current = next;
        seenResults.current = new Set();
        setRecord(next);
        setModuleId(null);
        setLayerSelection([]);
        setRecipeId(null);
        setToolSession(null);
        setDetailsSession(null);
        setAnalysisOpen(false);
        setAnalysisSource(null);
        markDirty(next.recovered === true||next.promptsExtracted === true);
        setNotice("");
        await refresh();
      }
    }).finally(() => setBusy(false));
  };
  useAutomation({present,history,seenResults,busyRef,dirtyRef,workspace,layerSelection,change,travel,markDirty,refresh,
    setRecord,setBusy,setWorkspace,setLayerSelection,
    resetPanels:()=>{setModuleId(null);setRecipeId(null);setToolSession(null);setDetailsSession(null);setAnalysisOpen(false);setAnalysisSource(null);}});
  const preview=useDevPreview({enabled:previewBootstrap.enabled,initial:previewBootstrap.snapshot,
    freeze:value=>{busyRef.current=value;setBusy(value);},
    getSnapshot:()=>({record:present.current,projects,workspace,recipeId,moduleId,layerSelection,dirty:dirtyRef.current,history:history.current,seenResults:[...seenResults.current]}),
    blockReason:()=>busyRef.current?'等待当前操作完成':['fonts','tools'].includes(workspace)?'请先完成当前编辑，再切换工作区应用更新':tasks.some(t=>['running','queued'].includes(t.status))?'等待任务完成':''});
  return (
    <div className={"app-shell workspace-" + workspace}>
      <StudioHeader
        rename={(name) => change({ ...present.current.document, name })}
        projects={projects}
        record={record}
        workspace={workspace}
        setWorkspace={setWorkspace}
        busy={busy}
        dirty={dirty}
        save={save}
        create={() => switchProject(() => api.create("未命名创作"))}
        importProject={() => switchProject(() => api.import())}
        hotReload={hotReload}
        openProject={(id) => switchProject(() => api.open(id))}
        connection={() => setConnectionOpen(true)}
        tasks={() => setTasksOpen(true)}
        undo={() => travel("undo")}
        redo={() => travel("redo")}
        canUndo={Boolean(history.current.past.length)}
        canRedo={Boolean(history.current.future.length)}
      />
      {preview}
      {error && (
        <div className="message error" role="alert">
          {error}
          <Button iconOnly icon="close" onClick={() => setError("")} aria-label="关闭错误">
            ×
          </Button>
        </div>
      )}
      {record?.recovered && (
        <div className="message">
          当前从上次备份恢复，请检查后保存。损坏的当前文件尚未被覆盖。
        </div>
      )}
      {record?.origin?.canvasStatus === "external-data-pending" && (
        <div className="message">
          旧版画布关联已保留。可从顶部「⋯」迁移画布内容。
        </div>
      )}
      {record?.document.migrationWarnings?.length > 0 && (
        <div className="message">
          {record.document.migrationWarnings.join("；")}
        </div>
      )}
      <main>
        {record && toolSession?.projectId === record.id && <FormDialog title="图片处理" className="image-processing-dialog" width={1120} close={()=>setToolSession(null)}>
          <div style={{height:"min(68vh, 720px)",minHeight:360}}>
            <ImageTools key={toolSession.assetIds.join(",")+toolSession.operation} projectId={record.id} document={record.document} change={change}
              initialSourceIds={toolSession.assetIds} initialOperation={toolSession.operation}
              tasks={tasks.filter(t=>t.context?.projectId===record.id&&['local-tool','cloud-tool','semantic-analysis'].includes(t.context?.kind))} refreshTasks={refreshTasks}
              addToCanvas={addToCanvas} addToLayers={(...args)=>{if(!busyRef.current){addAssetLayer(...args);setToolSession(null);}}} />
          </div>
        </FormDialog>}
        {workspace === 'settings' ? <SettingsWorkspace openModels={()=>setConnectionOpen(true)} modelsOpen={connectionOpen} /> : workspace === "fonts" ? <FontWorkspace /> : record ? (
          <>
            <div className="document-heading">
              <input
                aria-label="工程名称"
                value={record.document.name}
                disabled={busy}
                onChange={(event) =>
                  change({ ...record.document, name: event.target.value })
                }
              />
              <span>
                {record.document.width} × {record.document.height} px
              </span>
            </div>
            <div
              className={
                workspace === "layers" ? "workflow-toolbar composition-toolbar-placeholder" : workspace === "prompts"
                  ? "workflow-toolbar prompt-toolbar"
                  : "workflow-toolbar"
              }
            >
              <Button
                iconOnly icon="sync" aria-label={`更新引用${sync.outdated ? ` (${sync.outdated})` : ""}`}
                className="sync-action"
                disabled={busy || !sync.outdated}
                onClick={() => {
                  change(syncAll(record.document));
                  setNotice("已更新可同步引用；本地冲突保留");
                }}
              >
                更新引用{sync.outdated ? " (" + sync.outdated + ")" : ""}
              </Button>
              {sync.conflicts > 0 && (
                <span className="state-conflict">
                  {sync.conflicts} 项冲突待选择
                </span>
              )}
              {sync.missing > 0 && (
                <span className="state-missing">
                  {sync.missing} 项来源已删除
                </span>
              )}
              {workspace === "prompts" && <Button iconOnly icon="analyze" disabled={busy} onClick={() => analyzeImage()}>参考图分析</Button>}
              <div id="canvas-actions" />
            </div>
            <fieldset disabled={busy} className="workspace-content">
              {workspace === "prompts" ? (
                <PromptWorkbench
                  key={record.id}
                  activeId={moduleId}
                  onSelect={setModuleId}
                  recipeId={recipeId}
                  onRecipeSelect={setRecipeId}
                  generateRecipe={generateRecipe}
                  openConnection={()=>setConnectionOpen(true)}
                  busy={busy}
                  document={record.document}
                  change={change}
                  addToCanvas={addToCanvas}
                />
              ) : workspace === "canvas" ? (
                <InfiniteCanvas
                  key={record.id}
                  projectId={record.id}
                  openConnection={()=>setConnectionOpen(true)}
                  showDetails={(assetId,nodeId)=>setDetailsSession({assetId,nodeId})}
                  analyzeImage={analyzeImage}
                  generate={generate}
                  refreshTasks={refreshTasks}
                  tasks={tasks.filter(
                    (t) => t.context?.projectId === record.id,
                  )}
                  disabled={busy}
                  editImages={openImageTools}
                  document={record.document}
                  change={change}
                  openRecipe={(id) => {
                    setRecipeId(id);
                    setWorkspace("prompts");
                  }}
                />
              ) : workspace === "layers" ? (
                <LayerEditor
                  key={record.id}
                  projectId={record.id}
                  editHistory={{...history.current,undo:()=>travel('undo'),redo:()=>travel('redo')}}
                  selected={layerSelection}
                  setSelected={setLayerSelection}
                  document={record.document}
                  change={change}
                  disabled={busy}
                />
              ) : workspace === "tools" ? (
                <ImageTools
                  key={record.id}
                  projectId={record.id}
                  tasks={tasks.filter(t => t.context?.projectId === record.id && ['local-tool', 'cloud-tool', 'semantic-analysis'].includes(t.context?.kind))}
                  refreshTasks={refreshTasks}
                  document={record.document}
                  change={change}
                  addToLayers={addAssetLayer}
                  addToCanvas={addToCanvas}
                />
              ) : (
                <AssetLibrary
                  key={record.id}
                  disabled={busy}
                  projectId={record.id}
                  analyzeImage={analyzeImage}
                  replaceLayer={replaceLayer}
                  replacementTarget={replacementTarget?{...replacementTarget,locked:inherited(record.document.layers,replacementTarget,'locked')}:null}
                  document={record.document}
                  change={change}
                  editImages={openImageTools}
                  addToCanvas={addToCanvas}
                  addToLayers={addAssetLayer}
                />
              )}
            </fieldset>
          </>
        ) : (
          <div className="empty welcome">
            <span className="eyebrow">土狗 / 创作空间</span>
            <h1>把想法，拆成可以组合的素材。</h1>
            <p>从提示词模块开始，保存每一次创作。</p>
            <div className="welcome-actions">
              <Button
                className="primary"
                disabled={busy}
                onClick={() => switchProject(() => api.create("未命名创作"))}
              >
                新建工程
              </Button>
              <Button
                disabled={busy}
                onClick={() => switchProject(() => api.import())}
              >
                导入旧工程
              </Button>
            </div>
            <span className="muted">只读导入 · 原工程保持不变</span>
          </div>
        )}
      </main>
      <StudioStatus
        dirty={dirty}
        notice={notice}
        record={record}
        tasks={tasks}
        openTasks={() => setTasksOpen(true)}
        connection={() => setConnectionOpen(true)}
      />
      {detailsSession&&record&&<MaterialDetails {...detailsSession} projectId={record.id} document={record.document} change={change} close={()=>setDetailsSession(null)} editImages={openImageTools} analyzeImage={analyzeImage} addToLayers={addAssetLayer} addToCanvas={addToCanvas}/>}
      {analysisOpen && record && <AnalysisDialog key={record.id+":"+(analysisSource?.assetId||"")} initialAssetId={analysisSource?.assetId} sendToCanvas={sendAnalysisToCanvas} projectId={record.id} document={record.document} change={change} tasks={tasks} refreshTasks={refreshTasks} close={() => setAnalysisOpen(false)} onSelect={setModuleId} />}
      {tasksOpen && (
        <TaskPanel
          tasks={tasks}
          refresh={refreshTasks}
          close={() => setTasksOpen(false)}
          openProject={(id) => {
            setTasksOpen(false);
            switchProject(() => api.open(id));
          }}
        />
      )}
      {connectionOpen && (
        <ConnectionDialog close={() => setConnectionOpen(false)} />
      )}
    </div>
  );
}

async function mount(){
  previewBootstrap=await api.devPreview('restore');
  createRoot(document.getElementById("root")).render(
  <PreferencesProvider><ThemeProvider>
    <App />
  </ThemeProvider></PreferencesProvider>,
);
}
mount().catch(()=>{document.getElementById('root').textContent='编辑现场暂时无法恢复，请保留窗口并修复开发代码后重试。';});
