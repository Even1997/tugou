import type { CanvasModuleReference, CanvasNodeData } from "../(user)/canvas/types";
import type { PromptModule, StudioProject } from "./model";

type ModuleProject = Pick<StudioProject, "id" | "modules">;
export function moduleReference(projectId: string, module: PromptModule, format: CanvasModuleReference["format"] = "plain"): CanvasModuleReference {
    return { projectId, moduleId: module.id, name: module.name, kind: module.kind, text: module.text, format };
}
export function moduleNodeText(ref: CanvasModuleReference) {
    return ref.format === "labeled" ? `【${ref.name}】\n${ref.text}` : ref.text;
}
export function moduleSyncState(node: CanvasNodeData, project: ModuleProject) {
    const ref = node.metadata?.moduleRef;
    if (!ref || node.type !== "text") return "unlinked";
    if (ref.projectId !== project.id) return "foreign";
    const module = project.modules.find((m) => m.id === ref.moduleId);
    if (!module) return "missing";
    if (!module.text.trim()) return "empty";
    const changed = node.title !== ref.name || (node.metadata?.content || "") !== moduleNodeText(ref);
    const outdated = module.name !== ref.name || module.kind !== ref.kind || module.text !== ref.text;
    return outdated ? changed ? "conflict" : "outdated" : changed ? "modified" : "current";
}
export function updateModuleNode(node: CanvasNodeData, project: ModuleProject, overwrite = false): CanvasNodeData {
    const state = moduleSyncState(node, project);
    if (state !== "outdated" && !(overwrite && (state === "conflict" || state === "modified"))) return node;
    const ref = node.metadata!.moduleRef!;
    const module = project.modules.find((m) => m.id === ref.moduleId)!;
    const next = moduleReference(project.id, module, ref.format);
    return { ...node, title: module.name, metadata: { ...node.metadata, content: moduleNodeText(next), moduleRef: next } };
}
export function updateOutdatedModules(nodes: CanvasNodeData[], project: ModuleProject) {
    const updated = nodes.map((node) => updateModuleNode(node, project));
    return updated.some((node, index) => node !== nodes[index]) ? updated : nodes;
}
export const moduleStateLabels = { current: "已同步", outdated: "有新版", conflict: "有新版 · 本地已修改", modified: "本地已修改", missing: "来源已删除", foreign: "来自其他工程", empty: "来源内容为空", unlinked: "未关联模块" };
