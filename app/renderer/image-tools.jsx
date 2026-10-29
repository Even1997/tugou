import {Select} from './select.jsx';
import React, { useState, useRef, useEffect } from "react";
import { Button, PanelHeader, EmptyState, ToolPopover, SearchField } from "./components.jsx";
import {
  originalUrl,
  exportMaterial,
  loadOriginal,
} from "./image-processing.js";
import { pngBytes } from "./selection.js";
import { sourceSelection } from "./selection-source.js";
import { CloudMaskPreview } from "./cloud-mask-preview.jsx";
import { CloudMaskEditor } from './cloud-mask-editor.jsx';
import { SemanticControls } from "./semantic-controls.jsx";
import { semanticItems } from "../core/semantic-plan.cjs";
import "./image-tools.css";
import { assetUrl } from "./canvas.jsx";
import {
  operations as rasterOperations,
  defaults as rasterDefaults,
  parseCube,
} from "../core/image-tools.cjs";
import { ImageToolControls } from "./image-tool-controls.jsx";
import { LocalAIControls } from "./local-ai-controls.jsx";
import { localToolReadiness } from "../core/local-readiness.cjs";
import {
  compositionNames,
  compositionDefaults,
} from "../core/image-composition.cjs";
import { CompositionControls, RegionPreview } from "./composition-controls.jsx";
import { ToolBatchDialog } from "./tool-batch-dialog.jsx";
import { GeometryControls } from "./geometry-controls.jsx";
import { CloudControls } from "./cloud-controls.jsx";
import { cloudNames, cloudDefaults } from "../core/cloud-settings.cjs";
import { cloudToolReadiness } from "../core/cloud-readiness.cjs";
import { ConnectionDialog } from "./connection.jsx";
import { useImageImport } from './use-image-import.js';
import { ImageComparison } from './image-comparison.jsx';
const operations = {
  cloudEdit: cloudNames.cloudEdit,
  cloudExtend: cloudNames.cloudExtend,
  ...rasterOperations,
  ...compositionNames,
  upscale: "AI 超分辨率",
  cutout: "主体抠图",
};
const defaults = {
  ...cloudDefaults,
  cloudEdit: { ...cloudDefaults.cloudEdit, maskMode: 'asset' },
  ...rasterDefaults,
  ...compositionDefaults,
  upscale: { model: "general", scale: 4 },
  cutout: { model: 'u2netp', edgeShrink: 0, edgeFeather: 0 },
};
const regionOperations = ["texture", "crop", "extract", "patch", "cloudEdit"];
function sourceParameters(parameters, source) {
  if (!source) return parameters;
  const keys = [...regionOperations, "resize", "extend", "cloudExtend"];
  return {
    ...parameters,
    ...Object.fromEntries(
      keys.map((key) => [
        key,
        {
          ...parameters[key],
          width: source.width,
          height: source.height,
          ...(key === 'cloudEdit' ? {maskId:''} : {}),
          ...(key !== "resize" ? { left: 0, top: 0 } : {}),
          ...(key === "cloudExtend"
            ? {
                width: source.width + 256,
                height: source.height + 256,
                left: 128,
                top: 128,
              }
            : {}),
        },
      ]),
    ),
  };
}
export function ImageTools({
  projectId,
  document,
  change,
  addToLayers,
  addToCanvas,
  tasks = [],
  refreshTasks,
  initialSourceIds = [],
  initialOperation = "resize",
}) {
  const imageAssets=document.assets.filter(a=>!a.kind||a.kind==='image');
  const initialSource = imageAssets.find(a=>a.id===initialSourceIds[0]) || imageAssets[0];
  const [sourceId, setSourceId] = useState(initialSource?.id || ""),
    [operation, setOperation] = useState(operations[initialOperation] ? initialOperation : 'cloudEdit'),
    [scale, setScale] = useState(2),
    [padding, setPadding] = useState(128),
    [resultId, setResultId] = useState(null),
    [view, setView] = useState("original"),
    [toolQuery,setToolQuery]=useState(""),
    [status, setStatus] = useState(""),
    [working, setWorking] = useState(false),
    [batchOpen, setBatchOpen] = useState(false);
  const [parameters, setParameters] = useState(() =>
    sourceParameters(structuredClone(defaults), initialSource),
  );
  const [aiStatus, setAIStatus] = useState(null);
  const [paintOpen, setPaintOpen] = useState(false);
  const latest = useRef(document),
    mounted = useRef(true);
  const selectionController = useRef(null);
  const settingsPanel = useRef(null);
  useEffect(() => { if(settingsPanel.current) settingsPanel.current.scrollTop=0; setView(v=>v==='edit'&&!regionOperations.includes(operation)?'original':v); }, [operation]);
  latest.current = document;
  const context = useRef({ sourceId, operation });
  context.current = { sourceId, operation };
  useEffect(() => {
    setParameters((p) => ({
      ...p,
      cloudSplit: {
        instruction: document.imageToolSemanticPlans?.[sourceId] || "",
      },
    }));
  }, [sourceId]);
  useEffect(
    () => () => {
      mounted.current = false;
      selectionController.current?.abort();
    },
    [],
  );
  const result = document.assets.find((a) => a.id === resultId),
    source =
      document.assets.find((a) => a.id === sourceId) ||
      (result?.toolResult?.source?.id === sourceId
        ? result.toolResult.source
        : undefined);
  const isCloud = Boolean(cloudNames[operation]);
  const [connections, setConnections] = useState(null),
    [connectionError, setConnectionError] = useState(''),
    [connectionOpen, setConnectionOpen] = useState(false),
    [connectionRefresh, setConnectionRefresh] = useState(0);
  useEffect(() => {
    if (!isCloud) return;
    let active = true, version = 0;
    const refresh = async () => {
      const current = ++version;
      setConnections(null); setConnectionError('');
      try {
        const value = await window.tugou.listConnections();
        if (active && current === version) setConnections(value);
      } catch { if (active && current === version) setConnectionError('无法读取模型配置，请刷新重试'); }
    };
    refresh();
    window.addEventListener('tugou-connection-changed', refresh);
    return () => { active = false; window.removeEventListener('tugou-connection-changed', refresh); };
  }, [isCloud, connectionRefresh]);
  const mask =
    document.assets.find((a) => a.id === parameters.cloudEdit.maskId) ||
    (result?.toolResult?.mask?.id === parameters.cloudEdit.maskId
      ? result.toolResult.mask
      : undefined);
  const cloudReady = isCloud ? cloudToolReadiness(connections, { operation, ...parameters[operation] }, source, mask) : null;
  const analysisReady = cloudToolReadiness(connections, {}, source, null, 'analysis');
  const [selectionLayerId, setSelectionLayerId] = useState("");
  const selectionLayers = document.layers.filter(l => l.kind === 'image' && l.assetId === sourceId && !l.bitmap);
  const selectionLayer = selectionLayers.find(l => l.id === selectionLayerId);
  const selectionAvailable = Boolean(
    document.selection &&
    source &&
    (selectionLayer || (!selectionLayerId && document.width === source.width && document.height === source.height)),
  );
  useEffect(() => setSelectionLayerId(""), [sourceId]);
  const isAI = ["upscale", "cutout"].includes(operation);
  const isComposition = Boolean(compositionNames[operation]);
  const secondary =
    document.assets.find((a) => a.id === parameters[operation]?.secondaryId) ||
    (parameters[operation]?.secondaryId &&
    result?.toolResult?.secondary?.id === parameters[operation]?.secondaryId
      ? result.toolResult.secondary
      : undefined);
  const resultGroup = result?.toolResult?.batchId
    ? document.assets.filter(
        (a) => a.toolResult?.batchId === result.toolResult.batchId,
      )
    : [];
  const activeTask = tasks.find(
    (t) =>
      t.context?.projectId === projectId &&
      (t.context?.sourceId === sourceId ||
        t.context?.sourceIds?.includes(sourceId)) &&
      ["queued", "running"].includes(t.status),
  );
  const lastTask = tasks
    .filter(
      (t) =>
        t.context?.projectId === projectId &&
        (t.context?.sourceId === sourceId ||
          t.context?.sourceIds?.includes(sourceId)),
    )
    .at(-1);
  const disabled = working || Boolean(activeTask);
  const imageImport = useImageImport(added => {
    if(change({...latest.current, assets:[...latest.current.assets,...added]}) === false)
      throw Error('工程正在保存，请稍后重新导入');
    setSourceId(added[0].id);
    setResultId(null);
    setView('original');
    setParameters(p=>sourceParameters(p,added[0]));
    setStatus(`已导入 ${added.length} 张图片${added.length>1?'，已选中第一张，可使用批量处理':''}`);
  },setStatus,disabled);
  const analysis = tasks
    .filter(
      (t) =>
        t.context?.kind === "semantic-analysis" &&
        t.context.sourceId === sourceId,
    )
    .at(-1);
  const observed = useRef(new Set());
  const readableAnalysis = tasks.filter(t=>t.context?.kind==="semantic-analysis"&&t.context.sourceId===sourceId&&t.status==="completed").at(-1);
  useEffect(() => {
    for (const task of tasks) {
      const asset = document.assets.find(
        (a) =>
          a.toolResult?.taskId === task.id &&
          a.toolResult.sourceId === sourceId,
      );
      if (asset && !observed.current.has(task.id)) {
        observed.current.add(task.id);
        setResultId(asset.id);
        if (asset.toolResult.operation === operation) setView("compare");
      }
    }
  }, [tasks, document.assets, sourceId, operation]);
  const history = document.assets
    .filter((a) => a.toolResult)
    .slice()
    .reverse();
  const importLut = (file) =>
    run(async () => {
      if (file.size > 16 * 1024 * 1024)
        throw new Error("LUT 文件须小于 16 MiB");
      const text = await file.text();
      parseCube(text);
      if (!mounted.current) return;
      const luts = latest.current.imageToolLuts || [],
        lut = luts.find((l) => l.text === text) || {
          id: crypto.randomUUID(),
          name: file.name,
          text,
        };
      if (
        !luts.includes(lut) &&
        change({ ...latest.current, imageToolLuts: [...luts, lut] }) === false
      )
        throw new Error("工程正在保存，请稍后导入");
      setParameters((p) => ({ ...p, lut: { ...p.lut, lutId: lut.id } }));
      setStatus("LUT 已导入工程");
    });
  const run = async (operation) => {
    try {
      await operation();
    } catch (e) {
      if (mounted.current)
        setStatus(e.name === "AbortError" ? "已取消" : e.message);
    }
  };
  const process = (ids) =>
    run(async () => {
      if (!source || working) return;
      setWorking(true);
      setStatus("正在提交任务");
      try {
        if (operation === "cloudSplit") {
          const plan = semanticItems(parameters.cloudSplit.instruction).join(
            "\n",
          );
          const next = {
            ...latest.current,
            imageToolSemanticPlans: {
              ...latest.current.imageToolSemanticPlans,
              [sourceId]: plan,
            },
          };
          if (change(next) === false)
            throw new Error("工程正在保存，请稍后提交");
          const submitted = await window.tugou.splitCategories(
            projectId,
            next,
            sourceId,
            plan,
          );
          if (submitted.error) {
            await refreshTasks();
            throw new Error(
              `已提交 ${submitted.ids.length} 类；${submitted.error}`,
            );
          }
        } else if (isCloud) {
          const submitted = await window.tugou[Array.isArray(ids) ? 'startCloudBatch' : 'startCloudTool'](
            projectId,
            latest.current,
            Array.isArray(ids) ? ids : source.id,
            { operation, ...parameters[operation] },
          );
          if (submitted.error) {
            await refreshTasks();
            throw Error(`已提交 ${submitted.ids.length} 张；${submitted.error}`);
          }
        } else if (isAI)
          await window.tugou.startLocalTool(
            projectId,
            latest.current,
            Array.isArray(ids) ? ids : [source.id],
            { operation, ...parameters[operation] },
          );
        else
          await window.tugou.startRasterTool(
            projectId,
            latest.current,
            Array.isArray(ids) ? ids : [source.id],
            { operation, scale, padding, ...parameters[operation] },
          );
        await refreshTasks();
        if (mounted.current) setStatus("");
      } finally {
        if (mounted.current) setWorking(false);
      }
    });

  const captureSelection = () =>
    run(async () => {
      if (working || !selectionAvailable) return;
      const snapshot = latest.current;
      setWorking(true);
      const controller = new AbortController();
      selectionController.current = controller;
      let canvas;
      try {
        canvas = await sourceSelection(snapshot, source, selectionLayerId, { image: loadOriginal }, controller.signal);
        controller.signal.throwIfAborted();
        const asset = await window.tugou.storeRaster(
          await pngBytes(canvas),
          "画面选区",
        );
        if (!mounted.current) return;
        if (latest.current !== snapshot)
          throw new Error("画面已变化，请重新读取选区");
        if (
          change({ ...snapshot, assets: [...snapshot.assets, asset] }) === false
        )
          throw new Error("工程正在保存，请稍后读取");
        setParameters((p) => ({
          ...p,
          cloudEdit: {
            ...p.cloudEdit,
            maskMode: "asset",
            maskId: asset.id,
            maskChannel: "alpha",
            invertMask: false,
          },
        }));
        setStatus("已读取选区快照，可在素材库复用");
      } finally {
        selectionController.current = null;
        if (canvas) canvas.width = canvas.height = 1;
        if (mounted.current) setWorking(false);
      }
    });

  return (
    <section className="image-tools">
      {paintOpen && source && <CloudMaskEditor source={source} mask={parameters.cloudEdit.maskMode==='asset'?mask:null} settings={parameters.cloudEdit} close={()=>setPaintOpen(false)} apply={async bytes=>{
        const snapshot=latest.current,id=source.id;
        const asset=await window.tugou.storeRaster(bytes,`修改区域 · ${source.name}`);
        if(!mounted.current||latest.current!==snapshot||context.current.sourceId!==id)throw Error('画面已变化，请重新应用修改区域');
        if(change({...snapshot,assets:[...snapshot.assets,asset]})===false)throw Error('工程正在保存，请稍后应用');
        setParameters(p=>({...p,cloudEdit:{...p.cloudEdit,maskMode:'asset',maskId:asset.id,maskChannel:'alpha',invertMask:false}}));
        setView('original');setStatus('修改区域已保存，请填写修改要求后提交');
      }}/>}
      <aside className="tools-navigation"><PanelHeader title="图像工具"/><SearchField label="搜索工具" value={toolQuery} onChange={setToolQuery}/>
        {[["基础处理",rasterOperations],["图像合成",compositionNames],["智能工具",{cloudEdit:cloudNames.cloudEdit,cloudExtend:cloudNames.cloudExtend,upscale:"AI 超分辨率",cutout:"主体抠图"}]].map(([title,entries])=><section key={title}><h3>{title}</h3>{Object.entries(entries).filter(([id,label])=>label.toLowerCase().includes(toolQuery.toLowerCase())).map(([id,label])=><Button key={id} aria-pressed={operation===id} disabled={working} onClick={()=>{setOperation(id);setStatus('');}}>{label}</Button>)}</section>)}
                <details className="processing-history"><summary>处理记录 · {history.length}</summary>
          <PanelHeader title="处理记录" count={history.length} />
          {history.length ? (
            history.map((a) => (
              <Button
                className={`processing-item ${a.id === resultId ? "selected" : ""}`}
                key={a.id}
                onClick={() => {
                  setResultId(a.id);
                  setSourceId(a.toolResult.sourceId);
                  setParameters(p=>sourceParameters(p,a.toolResult.source||document.assets.find(item=>item.id===a.toolResult.sourceId)));
                  if (operations[a.toolResult.operation]) {
                    setOperation(a.toolResult.operation);
                    const {
                      sourceId,
                      createdAt,
                      operation: op,
                      ...options
                    } = a.toolResult;
                    if (defaults[op])
                      setParameters((p) => ({
                        ...p,
                        [op]: Object.fromEntries(
                          Object.entries(defaults[op]).map(([key, value]) => [
                            key,
                            options[key] ?? value,
                          ]),
                        ),
                      }));
                    if (options.scale !== undefined) setScale(options.scale);
                    if (options.padding !== undefined)
                      setPadding(options.padding);
                  } else { setOperation('resize'); setView('result'); }
                }}
              >
                <img src={assetUrl(a)} alt="" />
                <span>
                  {a.name}
                  <small>
                    {a.width} × {a.height}
                  </small>
                </span>
              </Button>
            ))
          ) : (
            <EmptyState compact icon="assets" title="暂无处理结果" description="处理后的素材将显示在这里。" />
          )}
        </details>
      </aside>
      <aside className="tools-settings" aria-label="输出设置">
        <header className="tools-settings-heading"><span className="muted">{isCloud ? '云端 AI' : isAI ? '本地 AI' : isComposition ? '图像合成' : '基础处理'}</span><h2>{operations[operation]}</h2><p>{source ? `原尺寸 ${source.width} × ${source.height} px` : '选择素材后开始处理'}</p></header>
        <div className="tools-setting-fields" ref={settingsPanel}>
      {operation === "cloudSplit" ? (
        <SemanticControls
          plan={parameters.cloudSplit.instruction}
          disabled={working || !source}
          analysis={analysis}
          canRead={Boolean(readableAnalysis)}
          analysisReady={analysisReady}
          update={(instruction) =>
            setParameters((p) => ({ ...p, cloudSplit: { instruction } }))
          }
          save={() =>
            run(async () => {
              const plan = semanticItems(
                parameters.cloudSplit.instruction,
                true,
              ).join("\n");
              if (
                change({
                  ...latest.current,
                  imageToolSemanticPlans: {
                    ...latest.current.imageToolSemanticPlans,
                    [sourceId]: plan,
                  },
                }) === false
              )
                throw new Error("工程正在保存");
              setStatus("类别方案已保存到工程");
            })
          }
          analyze={() =>
            run(async () => {
              setWorking(true);
              try {
                await window.tugou.analyzeCategories(
                  projectId,
                  latest.current,
                  sourceId,
                );
                await refreshTasks();
                setStatus("");
              } finally {
                if (mounted.current) setWorking(false);
              }
            })
          }
          read={() =>
            run(async () => {
              const draft = await window.tugou.readCategories(
                projectId,
                readableAnalysis.id,
              );
              if (
                !mounted.current ||
                context.current.sourceId !== sourceId ||
                context.current.operation !== "cloudSplit"
              )
                return;
              setParameters((p) => ({
                ...p,
                cloudSplit: { instruction: draft.categories.join("\n") },
              }));
              setStatus("已读取类别建议，请审阅后保存或提交");
            })
          }
        />
      ) : isCloud ? (
        <CloudControls
          operation={operation}
          value={parameters[operation]}
          source={source}
          disabled={working}
          assets={imageAssets}
          mask={mask}
          selectionAvailable={selectionAvailable}
                selectionLayers={selectionLayers}
                selectionLayerId={selectionLayerId}
                setSelectionLayerId={setSelectionLayerId}
          captureSelection={captureSelection}
          paintMask={()=>setPaintOpen(true)}
          update={(patch) =>
            setParameters((p) => ({
              ...p,
              [operation]: { ...p[operation], ...patch },
            }))
          }
        />
      ) : ["resize", "extend"].includes(operation) ? (
        <GeometryControls
          scale={scale} setScale={setScale} padding={padding} setPadding={setPadding}
          operation={operation}
          value={parameters[operation]}
          source={source}
          disabled={working}
          update={(patch) =>
            setParameters((p) => ({
              ...p,
              [operation]: { ...p[operation], ...patch },
            }))
          }
        />
      ) : isComposition ? (
        <CompositionControls
          operation={operation}
          value={parameters[operation]}
          source={source}
          secondary={secondary}
          assets={imageAssets}
          disabled={working}
          update={(patch) =>
            setParameters((p) => ({
              ...p,
              [operation]: { ...p[operation], ...patch },
            }))
          }
        />
      ) : isAI ? (
        <LocalAIControls
          onStatus={setAIStatus}
          source={source}
          operation={operation}
          value={parameters[operation]}
          disabled={working}
          update={(patch) =>
            setParameters((p) => ({
              ...p,
              [operation]: { ...p[operation], ...patch },
            }))
          }
        />
      ) : (
        <ImageToolControls
          operation={operation}
          value={parameters[operation]}
          disabled={working}
          update={(patch) =>
            setParameters((p) => ({
              ...p,
              [operation]: patch
                ? { ...p[operation], ...patch }
                : { ...defaults[operation] },
            }))
          }
          luts={document.imageToolLuts || []}
          importLut={importLut}
        />
      )}
      {isCloud && <div className="cloud-tool-status">
        <p role="status">{connectionError || cloudReady.reason}</p>
        <Button onClick={() => setConnectionOpen(true)}>配置模型</Button>
        <Button icon="refresh" aria-label="刷新云端工具状态" onClick={() => setConnectionRefresh(n => n + 1)}>刷新</Button>
        <p className="muted">提交后可能产生费用；已配置不代表供应商支持编辑或当前尺寸。</p>
      </div>}
      {connectionOpen && <ConnectionDialog close={() => setConnectionOpen(false)} />}
</div><div className="tools-submit"><p className="muted">{!source ? "请先在上方选择处理素材" : "生成新素材，原图保留"}</p><Button
          primary
          icon="generate"
          disabled={!source || disabled || imageImport.importing || (isCloud && !cloudReady.ready) || (isAI && !localToolReadiness(aiStatus, {operation, ...parameters[operation]}, source).ready)}
          onClick={process}
        >
          {disabled ? "处理中" : isCloud ? "提交云端" : "开始处理"}
        </Button>
</div>
      </aside>
      {batchOpen && (
        <ToolBatchDialog
          assets={imageAssets}
          sourceId={sourceId}
          initialIds={initialSourceIds}
          operation={operations[operation]}
          close={() => setBatchOpen(false)}
          submit={(ids) => {
            setBatchOpen(false);
            void process(ids);
          }}
        />
      )}
      <div className="image-tools-toolbar">
        <strong>素材预览</strong>
        <Button icon="import" disabled={disabled || imageImport.importing} onClick={imageImport.open}>{imageImport.importing ? '导入中…' : '上传图片'}</Button>
        <Select
          aria-label="处理来源"
          value={sourceId}
          disabled={working}
          onChange={(e) => {
            setSourceId(e.target.value);
            setResultId(null);
            setStatus("");
            const a = document.assets.find((a) => a.id === e.target.value);
            if (a) setParameters((p) => sourceParameters(p, a));
          }}
        >
          <option value="">选择素材</option>
          {source && !document.assets.some((a) => a.id === sourceId) && (
            <option value={sourceId}>{source.name} · 历史原图</option>
          )}
          {imageAssets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        {operation !== 'cloudSplit' && (
          <Button icon="layers"
            disabled={working || !document.assets.length}
            onClick={() => setBatchOpen(true)}
          >
            批量处理
          </Button>
        )}
        {activeTask && (
          <Button iconOnly icon="stop"
            onClick={() =>
              run(async () => {
                if (activeTask.context?.batchId && activeTask.context.kind === 'cloud-tool')
                  await window.tugou.cancelCloudBatch(activeTask.context.batchId);
                else await window.tugou.cancelTask(activeTask.id);
                await refreshTasks();
              })
            }
          >
            {["cloud-tool", "semantic-analysis"].includes(
              activeTask.context?.kind,
            )
              ? activeTask.context?.batchId ? "取消云端批次" : "取消云端任务"
              : "取消本地任务"}
          </Button>
        )}
        <div className="tools-spacer" />
        <Select
          aria-label="预览方式"
          value={view}
          onChange={(e) => setView(e.target.value)}
        >
          <option value="compare" disabled={!result}>并排对比</option>
          <option value="swipe" disabled={!result}>滑动对比</option>
          <option value="original">原图</option>
          <option value="result" disabled={!result}>结果</option>
          {result&&regionOperations.includes(operation)&&<option value="edit">编辑区域</option>}
        </Select>
        <ToolPopover label="工具说明" icon="info">
          <p>
            本地任务可切换页面继续，整批完成后进入素材库。关闭应用会中断任务，可按原参数手动重试。分辨率调整使用插值；AI
            超分与主体抠图使用本机模型。
          </p>
        </ToolPopover>
      </div>
      {(status || lastTask) && (
        <div className="message" role="status">
          {status ||
            (lastTask.context?.kind === "semantic-analysis" && lastTask.status === "completed"
              ? "类别识别已完成，请读取结果并审阅"
              : lastTask.status === "queued"
              ? lastTask.context?.kind === "cloud-tool"
                ? "等待请求模型"
                : "等待本地处理"
              : lastTask.message ||
                (lastTask.status === "running"
                  ? lastTask.context?.kind === "cloud-tool"
                    ? "模型处理中"
                    : "本地处理中"
                  : "本地处理结束"))}
          {activeTask && Number.isFinite(activeTask.progress) && <progress className="tool-task-progress" aria-label="图像处理进度" max="100" value={activeTask.progress} />}
        </div>
      )}
      <div className="image-tools-body">
        <div className={`image-comparison view-${view}`}>
          {!source ? (
            <EmptyState
              title="选择一张素材"
              description="上传本地 PNG、JPEG、WebP，或从上方素材库选择。"
            ><Button primary icon="import" disabled={disabled || imageImport.importing} onClick={imageImport.open}>{imageImport.importing ? '导入中…' : '上传图片'}</Button></EmptyState>
          ) : result && view !== 'edit' ? (
            <ImageComparison key={`${source.id}:${result.id}`} source={source} result={result} mode={view}/>
          ) : (
            <>
              {view !== "result" && (
                <figure>
                  <figcaption>
                    {operation === "mattePair"
                      ? "黑底原图"
                      : operation === "cloudEdit" &&
                          parameters.cloudEdit.maskMode === "asset"
                        ? "原图 · 蓝色为修改区"
                        : "原图"}
                    <span>
                      {source.width} × {source.height}
                    </span>
                  </figcaption>
                  {operation === "cloudEdit" &&
                  parameters.cloudEdit.maskMode === "asset" ? (
                    <CloudMaskPreview
                      source={source}
                      mask={mask}
                      settings={parameters.cloudEdit}
                    />
                  ) : regionOperations.includes(operation) ? (
                    <RegionPreview
                      source={source}
                      region={parameters[operation]}
                      label={
                        operation === "texture"
                          ? "材质框选区域"
                          : "工具框选区域"
                      }
                      disabled={working}
                      update={(patch) =>
                        setParameters((p) => ({
                          ...p,
                          [operation]: { ...p[operation], ...patch },
                        }))
                      }
                    />
                  ) : (
                    <img src={originalUrl(source)} alt="处理原图" />
                  )}
                </figure>
              )}
              {view !== "original" && view !== 'edit' && (
                <figure>
                  <figcaption>
                    处理结果
                    {result?.toolResult &&
                      ` · ${operations[result.toolResult.operation] || cloudNames[result.toolResult.operation] || result.toolResult.operation}`}
                    <span>
                      {result
                        ? `${result.width} × ${result.height}`
                        : "等待处理"}
                    </span>
                  </figcaption>
                  {result ? (
                    <img src={originalUrl(result)} alt="处理结果" />
                  ) : (
                    <EmptyState
                      title="准备就绪"
                      description="在右侧选择参数，开始处理。"
                    />
                  )}
                </figure>
              )}
            </>
          )}
        </div>

      </div>
      <div className="image-tools-footer">
        <span className="muted">
          {source
            ? `${source.name} · 原尺寸 ${source.width} × ${source.height}`
            : "来源：共享素材库"}
        </span>
        <Button icon="layers" disabled={!result} onClick={() => addToLayers(result)}>
          加入画面
        </Button>
        {result?.toolResult?.operation === "cloudSplit" && document.layers.some(l=>l.kind==="image"&&l.assetId===result.toolResult.sourceId) && (
          <ToolPopover label="对齐入层" icon="layers">
            <div className="image-tool-detail">
              {document.layers.filter(l=>l.kind==="image"&&l.assetId===result.toolResult.sourceId).map(l=><Button key={l.id} onClick={()=>addToLayers(result,l.id)}>对齐：{l.name}</Button>)}
              <p>沿用所选来源图层的坐标、分组和几何变换，原图层保留。</p>
            </div>
          </ToolPopover>
        )}
        {resultGroup.length > 1 && (
          <Button iconOnly icon="layers" onClick={() => addToLayers(resultGroup)}>本组加入画面</Button>
        )}
        <Button icon="canvas"
          disabled={!result}
          onClick={() => addToCanvas("asset", result.id)}
        >
          加入画布
        </Button>
        {resultGroup.length > 1 && <Button iconOnly icon="canvas" onClick={()=>addToCanvas("asset",resultGroup.map(a=>a.id))}>本组加入画布</Button>}
        <Button
          icon="export"
          disabled={!result}
          onClick={() =>
            run(async () => {
              if (await exportMaterial(result)) setStatus("已导出 PNG");
            })
          }
        >
          导出结果
        </Button>
      </div>
    </section>
  );
}
