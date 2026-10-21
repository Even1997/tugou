"use client";
import { Button, Tabs } from "antd";
import type { Job } from "./model";
import type { ToolJob } from "./tool-schema";
import type { ToolTasks } from "./use-tool-tasks";
import { ToolTaskList } from "./tool-task-list";
import { GenerationTaskList, type GenerationTasks } from "./generation-task-list";
import type { GenerationJob } from "./generation-schema";

export type CanvasTask = { id: string; projectId: string; name: string; status: string; error?: string };
export function TaskOverview({ tasks, generations, cloud, onCollect, canvas, onPreview, onCanvas }: { tasks: ToolTasks; generations: Job[]; cloud: GenerationTasks; onCollect: (job: GenerationJob) => void; canvas: CanvasTask[]; onPreview: (job: ToolJob) => void; onCanvas: (projectId: string) => void }) {
    return <div className="studio-ui" aria-label="统一任务记录"><Tabs items={[
        { key: "local", label: `本地处理 · ${tasks.jobs.length}`, children: <ToolTaskList tasks={tasks} onPreview={onPreview} /> },
        { key: "generation", label: `云端生成 · ${generations.length + cloud.jobs.length}`, children: <div className="job-list">
            <GenerationTaskList tasks={cloud} onCollect={onCollect} />
            {[...generations].reverse().map(job => <article key={job.id}>
                <div className="flex items-center justify-between gap-3"><strong>{job.name}</strong><span>{{ running: "生成中", completed: "已完成", failed: "失败", interrupted: "已中断" }[job.status]}</span></div>
                <p>{job.model} · {new Date(job.startedAt).toLocaleString("zh-CN")}</p>
                {job.error && <p className="warning-note">{job.error}</p>}
                <details><summary>提示词快照</summary><pre>{job.prompt}</pre></details>
            </article>)}
        </div> },
        { key: "canvas", label: `画布节点 · ${canvas.length}`, children: <div className="flex flex-col gap-4">
            {!canvas.length && <p className="py-6 text-center text-sm text-[var(--studio-muted)]">还没有画布生成记录</p>}
            {canvas.map(job => <div key={`${job.projectId}:${job.id}`} className="flex flex-wrap items-center gap-3 border-b border-[var(--studio-line)] pb-3 text-sm"><span className="flex-1">{job.name}</span><span>{({ loading: "生成中", stopping: "停止中", stopped: "已停止", success: "已完成", error: "失败" } as Record<string, string>)[job.status] || job.status}</span><Button size="small" onClick={() => onCanvas(job.projectId)}>前往画布</Button>{job.error && <p className="w-full text-xs text-[var(--studio-danger)]">{job.error}</p>}</div>)}
        </div> },
    ]} /></div>;
}
