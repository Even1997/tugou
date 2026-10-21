import type { StudioProject } from "./model";
import type { GenerationJob } from "./generation-schema";

export function collectRawGeneration(project: StudioProject, job: GenerationJob): StudioProject {
    if (!job.rawResult) throw new Error("原始返回图尚未保存");
    return collectGeneration(project, { ...job, id: `raw:${job.id}`, recipeId: undefined, status: "completed", result: job.rawResult });
}

export function collectGeneration(project: StudioProject, job: GenerationJob): StudioProject {
    if (project.id !== job.projectId) throw new Error("工程已切换，请返回来源工程收集结果");
    if (job.status !== "completed" || !job.result) throw new Error("任务尚无可用图片");
    if (project.assets.some(a => a.generationJobId === job.id)) return project;
    if (project.assets.some(a => a.id === job.result!.id)) throw new Error("素材标识冲突，请另存工程后收集");
    if (project.assets.length >= 500) throw new Error("单个工程最多500份素材，请先整理素材库");
    const jobs = job.recipeId && !project.jobs.some(j => j.id === job.id) ? [...project.jobs, {
        id: job.id, recipeId: job.recipeId, name: job.name, prompt: job.prompt, fingerprint: job.fingerprint || "", model: job.model,
        status: "completed" as const, startedAt: job.createdAt, assetId: job.result.id,
    }] : project.jobs;
    return { ...project, assets: [...project.assets, job.result], jobs };
}

export function alignGeneration(project: StudioProject, job: GenerationJob, sourceLayerId: string): StudioProject {
    if (job.operation?.kind !== "segment") throw new Error("仅类别拆分结果可按来源对齐");
    const source = project.layers.find(l => l.id === sourceLayerId && l.kind === "image" && l.assetId === job.operation!.sourceId);
    if (!source || source.bitmap) throw new Error("来源图层已变化，请选择未绘画的原图层");
    const next = collectGeneration(project, job), asset = next.assets.find(a => a.generationJobId === job.id)!;
    if (next.layers.some(l => l.assetId === asset.id)) return next;
    if (next.layers.length >= 500) throw new Error("单个工程最多500个图层");
    if (asset.width !== job.operation.sourceWidth || asset.height !== job.operation.sourceHeight) throw new Error("拆分结果尺寸与来源不一致");
    const layers = [...next.layers];
    layers.splice(layers.findIndex(l => l.id === source.id) + 1, 0, { ...source, id: crypto.randomUUID(), name: asset.name, assetId: asset.id, locked: false, visible: true });
    return { ...next, layers };
}
