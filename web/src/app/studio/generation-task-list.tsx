"use client";
import { useState } from "react";
import { Button, Popconfirm } from "antd";
import type { GenerationJob } from "./generation-schema";
import type { useQueuedTasks } from "./use-tool-tasks";
import { useStudio } from "./store";
import { thumbnailUrl } from "./resource-url.js";
import { generationReviewSize } from "./cloud-tool-input.js";
import { collectRawGeneration } from "./collect-generation";
import { studioRequest } from "./client-api";
import { ToolImagePreview } from "./tool-image-preview";

export type GenerationTasks = ReturnType<typeof useQueuedTasks<GenerationJob>>;
const labels = { queued: "排队中", running: "生成中", completed: "已完成", failed: "失败", cancelled: "已停止", interrupted: "已中断", review: "待确认" };
export function GenerationTaskList({ tasks, onCollect, onPreview }: { tasks: GenerationTasks; onCollect: (job: GenerationJob) => void; onPreview?: (job: GenerationJob) => void }) {
    const assets = useStudio(s => s.project.assets);
    const [error, setError] = useState(""), [pending, setPending] = useState("");
    const [rawPreview, setRawPreview] = useState("");
    const act = async (id: string, action: () => void | Promise<void>) => {
        setPending(id); setError(""); try { await action(); } catch (e) { setError((e as Error).message); } finally { setPending(""); }
    };
    return <div className="flex flex-col gap-4" aria-label="云端生成任务">
        {(error || tasks.error) && <p role="alert" className="text-sm text-[var(--studio-danger)]">{error || tasks.error}</p>}
        {!tasks.jobs.length && <p className="py-6 text-center text-sm text-[var(--studio-muted)]">还没有生成记录</p>}
        {tasks.jobs.map(job => <article key={job.id} className="border-b border-[var(--studio-line)] pb-4" data-generation-id={job.id}>
            <div className="flex items-center gap-3">
                {(job.result || job.rawResult) && <img src={thumbnailUrl((job.result || job.rawResult)!.dataUrl)} alt={job.name} className="h-16 w-16 rounded object-contain" />}
                <div className="min-w-0 flex-1"><strong className="block truncate" title={job.name}>{job.name}</strong><span className="text-xs text-[var(--studio-muted)]">{job.model} · {job.resolution === "fit" && job.status === "running" ? "本地对齐中" : labels[job.status]}{job.canvasProjectId ? " · 画布" : ""}</span></div>
                {["queued", "running"].includes(job.status) && <Button size="small" loading={pending === job.id} title={job.status === "running" && !job.resolution ? "仅停止本机等待，服务端可能仍在处理或计费" : undefined} onClick={() => void act(job.id, () => tasks.cancel(job))}>{job.status === "queued" ? "取消排队" : job.resolution ? "停止对齐" : "停止等待"}</Button>}
                {job.status === "completed" && !onPreview && <Button size="small" disabled={assets.some(a => a.generationJobId === job.id)} onClick={() => void act(job.id, () => onCollect(job))}>存入素材库</Button>}
                {["failed", "cancelled", "interrupted"].includes(job.status) && !job.rawResult && <Popconfirm title="重新发送生成请求？" description="请先核对服务端记录，此操作可能再次计费。" okText="重新生成" cancelText="返回" getPopupContainer={el => el.closest("dialog") || el.parentElement!} onConfirm={() => act(job.id, () => tasks.retry(job))}><Button size="small" loading={pending === job.id}>重新生成</Button></Popconfirm>}
            </div>
            {job.status === "completed" && onPreview && <div className="mt-2 flex items-center gap-2"><Button size="small" type="text" onClick={() => onPreview(job)}>查看结果</Button><Button size="small" disabled={assets.some(a => a.generationJobId === job.id)} onClick={() => void act(job.id, () => onCollect(job))}>存入素材库</Button></div>}
            {job.error && <p className="mt-2 text-xs text-[var(--studio-danger)]">{job.error}</p>}
            {job.rawResult && !["queued", "running"].includes(job.status) && <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs text-[var(--studio-muted)]">原始返回 {job.rawResult.width} × {job.rawResult.height}</span>
                <Button size="small" type="text" onClick={() => setRawPreview(rawPreview === job.id ? "" : job.id)}>{rawPreview === job.id ? "收起原始图" : "查看原始图"}</Button>
                <Button size="small" disabled={assets.some(a => a.generationJobId === `raw:${job.id}`)} onClick={() => void act(job.id, () => { useStudio.getState().edit(p => collectRawGeneration(p, job)); })}>保存原始图</Button>
                {job.status !== "completed" && generationReviewSize(job) && <Popconfirm title={`缩小对齐到 ${job.size}？`} description="使用已保留的返回图在本机处理，不重新生图。请检查对齐后的内容；原图和原始返回图都会保留。" okText="缩小并对齐" cancelText="返回" getPopupContainer={el => el.closest("dialog") || el.parentElement!} onConfirm={() => act(job.id, async () => { tasks.upsert(await studioRequest<GenerationJob>("generation-resolve-size", { id: job.id, projectId: job.projectId })); })}><Button size="small" loading={pending === job.id}>缩小对齐</Button></Popconfirm>}
                {rawPreview === job.id && <div className="flex h-80 w-full min-w-0"><ToolImagePreview src={job.rawResult.dataUrl} alt="模型原始返回图" /></div>}
            </div>}
            <details className="mt-2 text-xs text-[var(--studio-muted)]"><summary>请求快照</summary><p>{job.baseUrl} · {job.size} · {job.references.length} 张参考图{job.selectionMask ? " · 含画面选区" : ""}</p><pre className="whitespace-pre-wrap">{job.prompt}</pre>{job.rawResult && ["review", "failed", "cancelled", "interrupted"].includes(job.status) && <Popconfirm title="重新发送生成请求？" description="已有原始返回图。重新生成会另发请求，可能再次计费。" okText="重新生成" cancelText="返回" getPopupContainer={el => el.closest("dialog") || el.parentElement!} onConfirm={() => act(job.id, () => tasks.retry(job))}><Button size="small" loading={pending === job.id}>重新请求模型</Button></Popconfirm>}</details>
        </article>)}
    </div>;
}
