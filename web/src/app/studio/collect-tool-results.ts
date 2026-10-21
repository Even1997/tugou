import type { Asset, StudioProject } from "./model";
import type { ToolJob } from "./tool-schema";

export function collectToolResults(project: StudioProject, job: ToolJob, results: { asset: Asset; index: number }[], sourceLayerId?: string, hideSource = false) {
    if (project.id !== job.projectId) throw new Error("工程已切换，请返回来源工程收集结果");
    const source = sourceLayerId ? project.layers.find(l => l.id === sourceLayerId && l.assetId === job.sourceId) : undefined;
    if (sourceLayerId && (!source || source.bitmap)) throw new Error("来源图层已变化，请重新选择未绘画的来源图层");
    const assets = [...project.assets], additions = [];
    const { lut: _lut, ...metadata } = job.options;
    for (const { asset, index } of results) {
        let saved = assets.find(a => a.toolJobId === job.id && (a.toolOutputIndex || 0) === index);
        if (!saved) {
            saved = { ...asset, toolJobId: job.id, toolOutputIndex: index, sourceAssetId: job.sourceId, secondarySourceAssetId: job.secondarySourceId, tool: job.tool, toolOptions: metadata,
                model: job.tool === "upscale" ? `Real-ESRGAN · ${job.options.model}` : job.tool === "cutout" ? "IS-Net · 本地" : "本地像素处理" };
            assets.push(saved);
        }
        if (source) additions.push({ ...source, id: crypto.randomUUID(), name: saved.name, assetId: saved.id, locked: false, visible: true });
    }
    if (assets.length > 500 || project.layers.length + additions.length > 500) throw new Error("单个工程最多 500 份素材和 500 个图层，请减少选择或新建工程");
    const layers = [...project.layers];
    if (source) {
        const at = layers.findIndex(l => l.id === source.id);
        if (hideSource) layers[at] = { ...source, visible: false };
        layers.splice(at + 1, 0, ...additions);
    }
    return { project: assets.length === project.assets.length && !additions.length ? project : { ...project, assets, layers: source ? layers : project.layers }, selected: additions.map(l => l.id) };
}
