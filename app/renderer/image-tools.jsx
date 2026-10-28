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
import {
  compositionNames,
  compositionDefaults,
} from "../core/image-composition.cjs";
import { CompositionControls, RegionPreview } from "./composition-controls.jsx";
import { ToolBatchDialog } from "./tool-batch-dialog.jsx";
import { GeometryControls } from "./geometry-controls.jsx";
import { CloudControls } from "./cloud-controls.jsx";
import { cloudNames, cloudDefaults } from "../core/cloud-settings.cjs";
const operations = {
  ...cloudNames,
  ...rasterOperations,
  ...compositionNames,
  upscale: "AI 超分辨率",
  cutout: "主体抠图",
};
const defaults = {
  ...cloudDefaults,
  ...rasterDefaults,
  ...compositionDefaults,
  upscale: { model: "general", scale: 4 },
  cutout: {},
};
const regionOperations = ["texture", "crop", "extract", "patch", "cloudEdit"];
function sourceParameters(parameters, source, operation) {
  if (!source) return parameters;
  const keys = operation
    ? [operation]
    : [...regionOperations, "resize", "extend", "cloudExtend"];
  return {
    ...parameters,
    ...Object.fromEntries(
      keys.map((key) => [
        key,
        {
          ...parameters[key],
          width: source.width,
          height: source.height,
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
    [operation, setOperation] = useState(initialOperation),
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
  const latest = useRef(document),
    mounted = useRef(true);
  const selectionController = useRef(null);
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
  const mask =
    document.assets.find((a) => a.id === parameters.cloudEdit.maskId) ||
    (result?.toolResult?.mask?.id === parameters.cloudEdit.maskId
      ? result.toolResult.mask
      : undefined);
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
      }
    }
  }, [tasks, document.assets, sourceId]);
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
      <aside className="tools-navigation"><PanelHeader title="图像工具"/><SearchField label="搜索工具" value={toolQuery} onChange={setToolQuery}/>
        {[["基础处理",rasterOperations],["图像合成",compositionNames],["智能工具",{...cloudNames,upscale:"AI 超分辨率",cutout:"主体抠图"}]].map(([title,entries])=><section key={title}><h3>{title}</h3>{Object.entries(entries).filter(([id,label])=>label.toLowerCase().includes(toolQuery.toLowerCase())).map(([id,label])=><Button key={id} aria-pressed={operation===id} disabled={working} onClick={()=>{setOperation(id);setStatus('');if(source)setParameters(p=>sourceParameters(p,source,id));}}>{label}</Button>)}</section>)}
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
                  }
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
      <aside className="tools-settings" aria-label="输出设置"><PanelHeader title="输出设置"/>{source&&<p className="muted">原尺寸 {source.width} × {source.height} px</p>}
        <div className="tools-setting-fields">        {operation === "resize" && parameters.resize.sizeMode !== "size" && (
          <label>
            倍率
            <Select
              aria-label="缩放倍率"
              value={scale}
              disabled={working}
              onChange={(e) => setScale(Number(e.target.value))}
            >
              {[0.25, 0.5, 1, 2, 4].map((n) => (
                <option key={n} value={n}>
                  {n}×
                </option>
              ))}
            </Select>
          </label>
        )}
        {operation === "extend" && parameters.extend.sizeMode !== "size" && (
          <label>
            扩边
            <input
              aria-label="扩边像素"
              type="number"
              min="0"
              max="5000"
              step="1"
              value={padding}
              disabled={working}
              onChange={(e) => setPadding(Number(e.target.value))}
            />
            px
          </label>
        )}
      {operation === "cloudSplit" ? (
        <SemanticControls
          plan={parameters.cloudSplit.instruction}
          disabled={working || !source}
          analysis={analysis}
          canRead={Boolean(readableAnalysis)}
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
          update={(patch) =>
            setParameters((p) => ({
              ...p,
              [operation]: { ...p[operation], ...patch },
            }))
          }
        />
      ) : ["resize", "extend"].includes(operation) ? (
        <GeometryControls
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
</div><div className="tools-submit">        <Button
          primary
          icon="generate"
          disabled={!source || disabled}
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
        <strong>图像工具</strong>
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
        <Select
          aria-label="处理方式"
          value={operation}
          disabled={working}
          onChange={(e) => {
            setOperation(e.target.value);
            setStatus("");
            if (
              [...regionOperations, "resize", "extend", "cloudExtend"].includes(
                e.target.value,
              ) &&
              source
            )
              setParameters((p) => sourceParameters(p, source, e.target.value));
          }}
        >
          {Object.entries(operations).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        {operation !== 'cloudSplit' && (
          <Button iconOnly icon="layers"
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
          <option value="compare">原图与结果</option>
          <option value="original">原图</option>
          <option value="result">结果</option>
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
        </div>
      )}
      <div className="image-tools-body">
        <div className={`image-comparison view-${view}`}>
          {!source ? (
            <EmptyState
              title="选择一张素材"
              description="处理结果会进入共享素材库，原图保留。"
            />
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
              {view !== "original" && (
                <figure>
                  <figcaption>
                    处理结果
                    {result?.toolResult &&
                      ` · ${operations[result.toolResult.operation] || result.toolResult.operation}`}
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
        <Button iconOnly icon="layers" disabled={!result} onClick={() => addToLayers(result)}>
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
        <Button iconOnly icon="canvas"
          disabled={!result}
          onClick={() => addToCanvas("asset", result.id)}
        >
          加入画布
        </Button>
        {resultGroup.length > 1 && <Button iconOnly icon="canvas" onClick={()=>addToCanvas("asset",resultGroup.map(a=>a.id))}>本组加入画布</Button>}
        <Button iconOnly
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
