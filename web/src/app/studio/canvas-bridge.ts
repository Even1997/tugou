import { useCanvasStore } from "../(user)/canvas/stores/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../(user)/canvas/types";
import { useStudio } from "./store";
import { uid, recipeModules, type Recipe, type Asset } from "./model";
import { readAsset } from "./client-api";
import { resolveImageUrl } from "@/services/image-storage";
import { localForageStorage } from "@/lib/localforage-storage";
import { moduleReference } from "./module-sync";
import { uniqueReferences } from "./reference-roles.js";

export async function sendToCanvas(recipe: Recipe) {
    if (!useCanvasStore.persist.hasHydrated()) await useCanvasStore.persist.rehydrate();
    const p = useStudio.getState().project;
    const target = uid();
    const connections: CanvasConnection[] = [];
    const references = uniqueReferences(recipe.references);
    if (references.some(r => !p.assets.some(a => a.id === r.assetId))) throw new Error("参考素材已删除，请重新选择");
    const prompt = `【构图与输出】\n${recipe.output}`;
    const nodes: CanvasNodeData[] = [{ id: target, type: CanvasNodeType.Image, title: recipe.name, position: { x: 950, y: 180 }, width: 400, height: 600, metadata: { prompt, size: recipe.size, generationMode: "image", status: "idle" } }];
    const modules = recipeModules(p, recipe);
    modules.forEach((m, i) => {
        const id = uid();
        nodes.push({ id, type: CanvasNodeType.Text, title: m.name, position: { x: 40 + (i % 2) * 410, y: 40 + Math.floor(i / 2) * 330 }, width: 360, height: 280, metadata: { content: `【${m.name}】\n${m.text}`, moduleRef: moduleReference(p.id, m, "labeled") } });
        connections.push({ id: uid(), fromNodeId: id, toNodeId: target });
    });
    references.forEach((r, i) => {
        const asset = p.assets.find((a) => a.id === r.assetId);
        if (!asset) return;
        const id = uid();
        nodes.push({
            id,
            type: CanvasNodeType.Image,
            title: `图${i + 1} · ${r.role}`,
            position: { x: 40 + i * 300, y: 760 },
            width: 260,
            height: (260 * asset.height) / asset.width,
            metadata: { content: asset.dataUrl, naturalWidth: asset.width, naturalHeight: asset.height, status: "success" },
        });
        connections.push({ id: uid(), fromNodeId: id, toNodeId: target, referenceRole: r.role });
    });
    const id = useCanvasStore.getState().importProject({ title: `${p.name} · ${recipe.name}`, nodes, connections });
    // Flush the new project before opening it in the integrated workspace.
    await localForageStorage.setItem("infinite-canvas:canvas_store", JSON.stringify({ state: { projects: useCanvasStore.getState().projects }, version: 0 }));
    useStudio.getState().edit((p) => ({ ...p, canvasProjectIds: [...(p.canvasProjectIds || []), id] }));
    return id;
}
export async function importCanvasImages(nodeId?: string) {
    if (!useCanvasStore.persist.hasHydrated()) await useCanvasStore.persist.rehydrate();
    const { projects } = useCanvasStore.getState();
    const p = useStudio.getState().project;
    const candidates = projects
        .filter((x) => p.canvasProjectIds?.includes(x.id))
        .flatMap((x) => x.nodes)
        .filter((n) => (n.type === CanvasNodeType.Image || n.type === CanvasNodeType.Panorama) && (n.metadata?.content || n.metadata?.storageKey) && (nodeId ? n.id === nodeId : !n.title.startsWith("图")));
    const assets: Asset[] = [];
    for (const node of candidates) {
        const name = `${node.title} · 画布 ${node.id.slice(0, 6)}`;
        const url = await resolveImageUrl(node.metadata?.storageKey, node.metadata?.content || "");
        if (!url) continue;
        const response = await fetch(url);
        if (!response.ok) throw new Error("无法读取画布素材");
        const asset = await readAsset(await response.blob(), name);
        const previous = p.assets.filter((a) => a.sourceNodeId === node.id);
        if (p.assets.some((a) => a.dataUrl === asset.dataUrl) || assets.some((a) => a.dataUrl === asset.dataUrl)) continue;
        assets.push({ ...asset, name: `${name} · V${previous.length + 1}`, sourceNodeId: node.id });
    }
    if (useStudio.getState().project.id !== p.id) throw new Error("工程已切换，请重新选择要保存的图片");
    if (useStudio.getState().project.assets.length + assets.length > 500) throw new Error("单个工程最多容纳 500 份素材，请拆分后导入");
    if (assets.length) useStudio.getState().edit((p) => ({ ...p, assets: [...p.assets, ...assets] }));
    return assets.length;
}
