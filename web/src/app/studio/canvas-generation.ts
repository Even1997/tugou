import { studioRequest } from "./client-api";
import { useStudio } from "./store";
import type { GenerationJob, GenerationInput } from "./generation-schema";
import type { CanvasImageTask, CanvasImageTaskOptions } from "@/services/api/image";
import { useCanvasStore } from "../(user)/canvas/stores/use-canvas-store";

export async function canvasGeneration(prompt: string, references: string[], params: Pick<GenerationInput, "size" | "quality" | "responseFormatB64Json">, options: CanvasImageTaskOptions): Promise<CanvasImageTask> {
    const project = useStudio.getState().project;
    if (!options.sourceId || !project.canvasProjectIds?.includes(options.sourceId)) throw new Error("请从图构工作台打开所属无限画布后生成");
    const id = options.clientTaskId || crypto.randomUUID(), projectId = project.id;
    const name = useCanvasStore.getState().projects.find(p => p.id === options.sourceId)?.nodes.find(n => n.id === options.nodeId)?.title || "画布生成";
    const cancel = () => { void studioRequest("generation-cancel", { id, projectId }).catch(() => {}); };
    options.signal?.throwIfAborted();
    options.signal?.addEventListener("abort", cancel);
    try {
        let job = await studioRequest<GenerationJob>("generation-submit", { id, projectId, canvasProjectId: options.sourceId, sourceNodeId: options.nodeId, name, prompt, references, ...params });
        if (options.signal?.aborted) { cancel(); options.signal.throwIfAborted(); }
        while (["queued", "running"].includes(job.status)) {
            await new Promise(resolve => setTimeout(resolve, 1000)); options.signal?.throwIfAborted();
            job = await studioRequest<GenerationJob>("generation-get", { id, projectId });
        }
        options.signal?.throwIfAborted();
        if (job.status !== "completed" || !job.result) throw new Error(job.error || "生成未完成，请查看任务记录");
        return { id, source: "canvas", source_id: options.sourceId, node_id: options.nodeId, model: job.model, prompt, status: "completed", progress: 100, image_url: job.result.dataUrl, width: job.result.width, height: job.result.height };
    } finally { options.signal?.removeEventListener("abort", cancel); }
}
