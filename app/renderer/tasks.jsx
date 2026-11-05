import { Button, FormDialog, EmptyState, Icon } from "./components.jsx";
import React, { useState } from "react";
import { CloudReview } from "./cloud-review.jsx";
import './tasks.css';
const labels = {
  queued: "排队中",
  running: "生成中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  review: "待确认",
};
const filters=[['all','全部',()=>true],['active','进行中',task=>['queued','running'].includes(task.status)],['attention','需关注',task=>['failed','interrupted','review'].includes(task.status)],['completed','已完成',task=>task.status==='completed']];
const taskIcon=task=>['analysis','semantic-analysis'].includes(task.context?.kind)?'analyze':task.context?.kind==='runtime-install'?'cloudDownload':['local-tool','cloud-tool'].includes(task.context?.kind)?'tools':'generate';
export function TaskPanel({ tasks, close, refresh, openProject }) {
  const [error, setError] = useState("");
  const [retrying, setRetrying] = useState(null);
  const [reviewId, setReviewId] = useState(null);
  const [filter,setFilter]=useState('all');
  const visible=tasks.filter(filters.find(([id])=>id===filter)[2]).slice().reverse();
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
        width={900}
      >
        <div className="task-toolbar"><div className="task-filters" role="group" aria-label="筛选任务状态">{filters.map(([id,label,matches])=><button key={id} aria-pressed={filter===id} onClick={()=>setFilter(id)}>{label}<span>{tasks.filter(matches).length}</span></button>)}</div><span className="task-order">最新任务在前</span></div>
        {error && <p className="task-error" role="alert">{error}</p>}
        <div className="task-list" role="region" aria-label="任务记录" tabIndex={0}>
          {!visible.length&&<EmptyState compact icon="tasks" title={tasks.length?'暂无此类任务':'暂无任务'} description={tasks.length?'可以切换筛选查看其他记录。':'生成、分析和图像处理任务会显示在这里。'}/>}
          {visible.map((task) => (
            <article className="task-row" data-status={task.status} data-task-id={task.id} key={task.id}>
              <span className="task-type-icon" aria-hidden="true"><Icon name={taskIcon(task)}/></span>
              <div className="task-main"><div className="task-row-heading">
                <strong title={task.label}>{task.label}</strong>
                <span className="task-state">
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
              <p className="task-metadata">{[task.context?.batchCount?`批量 ${task.context.batchIndex+1}/${task.context.batchCount}`:'',task.context?.model,task.context?.requestedSize,Number.isFinite(Date.parse(task.createdAt))?new Date(task.createdAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}):'时间未记录'].filter(Boolean).join(' · ')}</p>
              {task.status==="running"&&Number.isFinite(task.progress)&&<progress aria-label="任务进度" max="100" value={task.progress}/>}
              {task.message&&(task.message.length>80?<details className="task-message-details"><summary title={task.message}>{task.message}</summary><p>{task.message}</p></details>:<p className="task-message">{task.message}</p>)}
              {task.imageTimings?.length>0&&<details className="task-timings">
                <summary>生图耗时详情</summary>
                {task.imageTimings.map((timing,index)=><p className="muted" key={index}>
                  请求 {index+1}：{[['排队','queued','sent'],['等待响应','sent','headers'],['接收响应','headers','body'],['下载 / 解码','body','ready'],['保存图片','ready','saved']].map(([label,from,to])=>`${label} ${Number.isFinite(timing[to])&&Number.isFinite(timing[from])?((timing[to]-timing[from])/1000).toFixed(1)+' 秒':'—'}`).join(' · ')}
                </p>)}
                <p className="muted">等待响应包含上传、服务端处理及网络等待；以上为客户端计时。</p>
              </details>}
              </div><div className="task-actions">
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
              </div>
            </article>
          ))}
        </div>
      </FormDialog>
    </>
  );
}
