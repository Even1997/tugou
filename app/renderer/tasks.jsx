import { Button, FormDialog } from "./components.jsx";
import React, { useState } from "react";
import { CloudReview } from "./cloud-review.jsx";
const labels = {
  queued: "等待中",
  running: "生成中",
  completed: "已入库",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  review: "待确认",
};
export function TaskPanel({ tasks, close, refresh, openProject }) {
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(null);
  const [reviewId, setReviewId] = useState(null);
  return (
    <>
      {reviewId && (
        <CloudReview
          taskId={reviewId}
          close={() => setReviewId(null)}
          refresh={refresh}
        />
      )}
      <FormDialog
        className="task-dialog"
        title="任务"
        close={close}
        width={640}
      >
        {error && <p role="alert">{error}</p>}
        {!tasks.length && (
          <p className="empty-small">生成、分析和图像处理任务会显示在这里。</p>
        )}
        <div className="task-list">
          {[...tasks].reverse().map((task) => (
            <article className="task-row" data-status={task.status} key={task.id}>
              <div>
                <strong>{task.label}</strong>
                <span>
                  {["analysis", "semantic-analysis"].includes(
                    task.context?.kind,
                  )
                    ? { running: "分析中", completed: "已分析" }[task.status] ||
                      labels[task.status]
                    : task.context?.kind === "runtime-install"
                      ? { running: "安装中", completed: "已安装" }[
                          task.status
                        ] || labels[task.status]
                      : task.context?.kind === "local-tool" &&
                          task.status === "running"
                        ? "处理中"
                        : labels[task.status] || task.status}
                </span>
              </div>
              <p className="muted">
                {task.context?.batchCount ? `批量 ${task.context.batchIndex + 1}/${task.context.batchCount} · ` : ''}
                {task.context?.model}
                {task.context?.requestedSize
                  ? ` · ${task.context.requestedSize}`
                  : ""}{" "}
                · {new Date(task.createdAt).toLocaleString()}
              </p>
              {task.status==="running"&&Number.isFinite(task.progress)&&<progress aria-label="任务进度" max="100" value={task.progress}/>}
              {task.message && <p>{task.message}</p>}
              {task.context?.kind==='workflow'&&['failed','cancelled','interrupted'].includes(task.status)&&<Button disabled={!!retrying} onClick={async()=>{setRetrying(task.id);try{await window.tugou.retryWorkflow(task.id);await refresh();}catch(e){setError(e.message);}finally{setRetrying(null);}}}>按原参数重试</Button>}
              {task.context?.kind === 'cloud-tool' && task.context.batchId &&
                tasks.find(t => t.context?.batchId === task.context.batchId && ['queued', 'running'].includes(t.status))?.id === task.id && (
                <Button onClick={async () => {
                  try { await window.tugou.cancelCloudBatch(task.context.batchId); await refresh(); }
                  catch (e) { setError(e.message); }
                }}>取消整个批次</Button>
              )}
              {task.context?.kind === "runtime-install" &&
                ["failed", "cancelled", "interrupted"].includes(
                  task.status,
                ) && (
                  <Button
                    disabled={Boolean(retrying)}
                    onClick={async () => {
                      setRetrying(task.id);
                      try {
                        await window.tugou.retryRuntimeInstall(task.id);
                        await refresh();
                        setError("");
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setRetrying(null);
                      }
                    }}
                  >
                    继续安装
                  </Button>
                )}
              {task.context?.hasRaw && (
                <Button onClick={() => setReviewId(task.id)}>查看原始图</Button>
              )}
              {task.context?.kind === "cloud-tool" &&
                ["failed", "cancelled", "interrupted", "review"].includes(
                  task.status,
                ) && (
                  <Button
                    disabled={Boolean(retrying)}
                    title="按原始参数再次请求原模型，可能再次计费"
                    onClick={async () => {
                      if (retrying) return;
                      setRetrying(task.id);
                      try {
                        await window.tugou.retryCloudTool(task.id);
                        await refresh();
                        setError("");
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setRetrying(null);
                      }
                    }}
                  >
                    {retrying === task.id ? "正在提交" : "重新请求模型"}
                  </Button>
                )}
              {["raster", "local-ai"].includes(task.context?.engine) &&
                ["failed", "cancelled", "interrupted"].includes(
                  task.status,
                ) && (
                  <Button
                    disabled={Boolean(retrying)}
                    onClick={async () => {
                      if (retrying) return;
                      setRetrying(task.id);
                      try {
                        await window.tugou.retryImageTool(task.id);
                        await refresh();
                        setError("");
                      } catch (e) {
                        setError(e.message);
                      } finally {
                        setRetrying(null);
                      }
                    }}
                  >
                    {retrying === task.id ? "正在准备" : "按原参数重试"}
                  </Button>
                )}
              {["running", "queued"].includes(task.status) ? (
                <Button
                  onClick={async () => {
                    try {
                      await window.tugou.cancelTask(task.id);
                      await refresh();
                    } catch (e) {
                      setError(e.message);
                    }
                  }}
                >
                  取消任务
                </Button>
              ) : (
                task.context?.projectId && (
                  <Button onClick={() => openProject(task.context.projectId)}>
                    打开工程
                  </Button>
                )
              )}
            </article>
          ))}
        </div>
      </FormDialog>
    </>
  );
}
