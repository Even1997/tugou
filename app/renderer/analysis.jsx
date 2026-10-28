import {Select} from './select.jsx';
import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  FormDialog,
  Input,
  TextArea,
  EmptyState,
} from "./components.jsx";
import { assetUrl } from "./canvas.jsx";
import { analysisKinds, applyAnalysis } from "../core/analysis-draft.cjs";
import "./analysis.css";

const api = window.tugou;
const statuses = {
  queued: "等待分析",
  running: "分析中",
  completed: "待审阅",
  failed: "分析失败",
  cancelled: "已取消",
  interrupted: "已中断",
};
const initialReview = (draft) =>
  draft.review || {
    modules: draft.modules.map((m) => ({ ...m, enabled: true, global: false })),
    recipeName: "参考图配方",
    createRecipe: true,
    reference: false,
  };

export function AnalysisDialog({
  projectId,
  document,
  change,
  tasks,
  refreshTasks,
  close,
  onSelect,
  initialAssetId,
  sendToCanvas,
}) {
  const [assetId, setAssetId] = useState(initialAssetId || document.assets[0]?.id || ""),
    [instruction, setInstruction] = useState("");
  const [results, setResults] = useState([]),
    [draft, setDraft] = useState(null),
    [review, setReview] = useState(null);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [edited, setEdited] = useState(false);
  const current = useRef({ document, change }),
    mounted = useRef(true),
    selected = useRef(null), pending = useRef(null);
  current.current = { document, change };
  selected.current = draft;
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const jobs = tasks.filter(
    (t) => t.context?.kind === "analysis" && t.context.projectId === projectId,
  );
  const revision = jobs.map((t) => `${t.id}:${t.status}`).join("|");
  useEffect(() => {
    let stopped = false;
    api
      .analyses(projectId)
      .then((items) => {
        if (stopped) return;
        setResults(items);
        if(pending.current&&jobs.some(t=>t.id===pending.current&&["failed","cancelled","interrupted"].includes(t.status)))pending.current=null;
        const latest = items.filter(item=>item.assetId===assetId&&(!pending.current||item.id===pending.current)).at(-1);
        if (!selected.current && latest) {
          setDraft(latest);
          setReview(initialReview(latest));
        }
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [projectId, revision, assetId]);
  const run = async (operation) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const choose = (id) => {
    if (edited && !confirm("放弃未保存的分析草稿修改？")) return;
    const item = results.find((r) => r.id === id);
    pending.current=null;
    setDraft(item);
    setAssetId(item.assetId);
    setReview(initialReview(item));
    setEdited(false);
    setNotice("");
    setError("");
  };
  const chooseAsset=id=>{
    if(edited&&!confirm("放弃未保存的分析草稿修改？"))return;
    pending.current=null;selected.current=null;setDraft(null);setReview(null);setEdited(false);setAssetId(id);setError("");setNotice("");
  };
  const patch = (update) => {
    setReview((value) => ({ ...value, ...update }));
    setEdited(true);
  };
  const patchModule = (index, update) =>
    patch({
      modules: review.modules.map((m, i) =>
        i === index ? { ...m, ...update } : m,
      ),
    });
  const leave = () => {
    if (
      !edited ||
      confirm("分析结果已保存，但草稿修改尚未保存。放弃本次修改？")
    )
      close();
  };
  const imported =
    draft &&
    document.tugouAnalysisImports?.some((item) => item.id === draft.id);
  const asset = document.assets.find((a) => a.id === assetId);
  return (
    <FormDialog
      title="参考图分析"
      width={1040}
      className="analysis-dialog"
      close={leave}
    >
      <fieldset className="analysis-content" disabled={busy}>
        <section className="analysis-source">
          <label>
            参考图
            <Select
              aria-label="分析参考图"
              value={assetId}
              onChange={(e) => chooseAsset(e.target.value)}
            >
              <option value="">选择素材</option>
              {document.assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </label>
          {asset ? (
            <img
              className="analysis-image"
              src={assetUrl(asset)}
              alt="分析参考图预览"
            />
          ) : (
            <EmptyState title="选择一张参考图" />
          )}
          <Button
            disabled={busy}
            onClick={() =>
              run(async () => {
                if(edited&&!confirm("放弃未保存的分析草稿修改？"))return;
                const assets = await api.importImage();
                if (!mounted.current || !assets.length) return;
                if (
                  !current.current.change({
                    ...current.current.document,
                    assets: [...current.current.document.assets, ...assets],
                  })
                )
                  throw new Error("工程正在保存，请稍后导入");
                pending.current=null;selected.current=null;setDraft(null);setReview(null);setEdited(false);setAssetId(assets[0].id);
              })
            }
          >
            导入参考图
          </Button>
          <label>
            分析要求
            <TextArea
              aria-label="分析要求"
              rows={3}
              maxLength={4000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="例如：重点提取画风，人物、动作和服饰分开"
            />
          </label>
          <Button
            className="primary"
            disabled={
              busy ||
              !asset ||
              jobs.some(
                (t) =>
                  t.context.assetId === assetId &&
                  ["queued", "running"].includes(t.status),
              )
            }
            onClick={() =>
              run(async () => {
                if(edited&&!confirm("放弃未保存的分析草稿修改？"))return;
                const job=await api.analyze(
                  projectId,
                  current.current.document,
                  assetId,
                  instruction,
                );
                if(!mounted.current)return;
                pending.current=job.id;selected.current=null;setDraft(null);setReview(null);setEdited(false);
                await refreshTasks();
                if (mounted.current)
                  setNotice("分析已提交，可关闭窗口继续编辑");
              })
            }
          >
            开始分析
          </Button>
          <span className="muted">将参考图发送至已配置的视觉模型。</span>
          {jobs
            .slice(-3)
            .reverse()
            .map((job) => (
              <div className="analysis-job" key={job.id}>
                <span>
                  {job.label} · {job.status === "completed" && document.tugouAnalysisImports?.some(item => item.id === job.id) ? "已加入模块" : (statuses[job.status] || job.status)}
                </span>
                {job.message && <small>{job.message}</small>}
                {["queued", "running"].includes(job.status) && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api.cancelTask(job.id);
                        await refreshTasks();
                      })
                    }
                  >
                    取消分析
                  </Button>
                )}
              </div>
            ))}
        </section>
        <section className="analysis-review">
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="message">
              {notice}
            </p>
          )}
          {draft && review ? (
            <>
              <div className="analysis-result-heading">
                <label>
                  分析记录
                  <Select
                    aria-label="分析记录"
                    value={draft.id}
                    onChange={(e) => choose(e.target.value)}
                  >
                    {[...results].reverse().map((r) => (
                      <option key={r.id} value={r.id}>
                        {new Date(r.createdAt).toLocaleString()} ·{" "}
                        {document.assets.find((a) => a.id === r.assetId)
                          ?.name || "参考图"}
                      </option>
                    ))}
                  </Select>
                </label>
                <span className="muted">
                  {imported ? "已加入模块" : edited ? "草稿未保存" : "待审阅"}
                </span>
              </div>
              {draft.summary && <p>{draft.summary}</p>}
              {!!draft.uncertainties.length && (
                <details>
                  <summary>待确认 · {draft.uncertainties.length}</summary>
                  <ul>
                    {draft.uncertainties.map((text, i) => (
                      <li key={i}>{text}</li>
                    ))}
                  </ul>
                </details>
              )}
              {imported&&<p className="muted">已加入的模块可在工作台继续编辑；送入画布使用当前模块内容。</p>}
              <fieldset disabled={Boolean(imported)} style={{border:0,padding:0,margin:0,minWidth:0}}>
              <div className="analysis-modules">
                {review.modules.map((m, i) => (
                  <article className="analysis-module" key={i}>
                    <div className="analysis-module-heading">
                      <input
                        aria-label={`采用分析模块 ${i + 1}`}
                        type="checkbox"
                        checked={m.enabled !== false}
                        onChange={(e) =>
                          patchModule(i, { enabled: e.target.checked })
                        }
                      />
                      <Input
                        aria-label={`分析模块名称 ${i + 1}`}
                        value={m.name}
                        maxLength={120}
                        onChange={(e) =>
                          patchModule(i, { name: e.target.value })
                        }
                      />
                      <Input
                        aria-label={`分析模块分类 ${i + 1}`}
                        list="analysis-kind-list"
                        value={analysisKinds[m.kind] || m.kind}
                        maxLength={40}
                        onChange={(e) =>
                          patchModule(i, { kind: e.target.value })
                        }
                      />
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={m.global === true}
                          onChange={(e) =>
                            patchModule(i, { global: e.target.checked })
                          }
                        />
                        应用全局
                      </label>
                    </div>
                    <TextArea
                      aria-label={`分析提示词 ${i + 1}`}
                      value={m.text}
                      rows={3}
                      maxLength={4000}
                      onChange={(e) => patchModule(i, { text: e.target.value })}
                    />
                  </article>
                ))}
              </div>
              <datalist id="analysis-kind-list">
                {Object.entries(analysisKinds).map(([value, label]) => (
                  <option key={value} value={label} />
                ))}
              </datalist>
              <div className="analysis-recipe">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={review.createRecipe}
                    onChange={(e) => patch({ createRecipe: e.target.checked })}
                  />
                  同时新建配方
                </label>
                {review.createRecipe && (
                  <>
                    <Input
                      aria-label="分析配方名称"
                      value={review.recipeName}
                      maxLength={120}
                      onChange={(e) => patch({ recipeName: e.target.value })}
                    />
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={review.reference}
                        onChange={(e) => patch({ reference: e.target.checked })}
                      />
                      原图作为画风参考
                    </label>
                  </>
                )}
              </div>
              </fieldset>
            </>
          ) : (
            <EmptyState
              title="把图片拆成可替换的模块"
              description="分析完成后，逐项编辑并选择加入。"
            />
          )}
        </section>
      </fieldset>
      {draft && review && (
        <footer className="analysis-footer">
          <Button
            disabled={busy || !edited}
            onClick={() =>
              run(async () => {
                const saved = await api.saveAnalysisReview(
                  projectId,
                  draft.id,
                  review,
                );
                if (!mounted.current) return;
                setReview(saved);
                setResults((rows) =>
                  rows.map((r) =>
                    r.id === draft.id ? { ...r, review: saved } : r,
                  ),
                );
                setEdited(false);
                setNotice("分析草稿已保存");
              })
            }
          >
            保存草稿
          </Button>
          <Button
            className="primary"
            disabled={
              busy ||
              imported ||
              !review.modules.some((m) => m.enabled !== false)
            }
            onClick={() =>
              run(async () => {
                const saved = await api.saveAnalysisReview(
                  projectId,
                  draft.id,
                  review,
                );
                if (!mounted.current) return;
                const next = applyAnalysis(
                  current.current.document,
                  draft,
                  saved,
                );
                setResults((rows) =>
                  rows.map((r) =>
                    r.id === draft.id ? { ...r, review: saved } : r,
                  ),
                );
                if (!current.current.change(next))
                  throw new Error("工程正在保存，请稍后加入模块");
                onSelect(next.tugouAnalysisImports.at(-1).moduleIds[0]);
                setEdited(false);
                setNotice("已加入模块，可撤销；请保存工程");
              })
            }
          >
            {imported ? "已加入模块" : "加入所选模块"}
          </Button>
          {imported&&sendToCanvas&&<Button primary disabled={busy} onClick={()=>run(()=>sendToCanvas(draft.id))}>送入画布</Button>}
        </footer>
      )}
    </FormDialog>
  );
}
