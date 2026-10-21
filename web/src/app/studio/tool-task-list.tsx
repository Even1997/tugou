"use client";
import { useState } from "react";
import { Button, Progress } from "antd";
import { imageTools, type ToolJob } from "./tool-schema";
import type { ToolTasks } from "./use-tool-tasks";

const labels = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", cancelled: "已取消", interrupted: "已中断" };
export function ToolTaskList({ tasks, onPreview, loading = false }: { tasks: ToolTasks; onPreview: (job: ToolJob) => void; loading?: boolean }) {
    const [error, setError] = useState("");
    const act = async (action: () => Promise<void>) => { setError(""); try { await action(); } catch (e) { setError((e as Error).message); } };
    return <div className="flex flex-col gap-3" aria-label="工具任务">
        {(error || tasks.error) && <p role="alert" className="text-xs text-[var(--studio-danger)]">{error || tasks.error}</p>}
        {tasks.jobs.map(job => <div key={job.id} className="flex flex-wrap items-center gap-3 border-t border-[var(--studio-line)] pt-3 text-sm">
            <span className="min-w-0 flex-1 truncate" title={job.name}>{job.tool === "split" ? `${job.options.splitMode === "grid" ? "网格" : "透明岛"} · ${job.name}` : `${job.name} · ${imageTools[job.tool]}`}</span><span className="text-xs text-[var(--studio-muted)]">{labels[job.status]}{job.outputs ? ` · ${job.outputs.length} 层` : ""}</span>
            {["queued", "running"].includes(job.status) ? <><Progress className="w-24" percent={Math.round(job.progress)} size="small" showInfo={false} /><Button size="small" type="text" onClick={() => void act(() => tasks.cancel(job))}>取消</Button></> : job.status === "completed" && <Button size="small" loading={loading} onClick={() => onPreview(job)}>查看结果</Button>}
            {job.error && <p className="w-full text-xs text-[var(--studio-danger)]">{job.error}</p>}
            {["failed", "cancelled", "interrupted"].includes(job.status) && <Button size="small" onClick={() => void act(() => tasks.retry(job))}>重新处理</Button>}
        </div>)}
        {!tasks.jobs.length && <p className="py-3 text-center text-sm text-[var(--studio-muted)]">还没有本地处理记录</p>}
    </div>;
}
