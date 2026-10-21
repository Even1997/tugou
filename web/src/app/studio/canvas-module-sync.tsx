"use client";
import { Button, Modal, Tag, Tooltip } from "antd";
import { Check, RefreshCw } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "../(user)/canvas/types";
import { moduleNodeText, moduleReference, moduleStateLabels, moduleSyncState, updateModuleNode, updateOutdatedModules } from "./module-sync";
import { useStudio } from "./store";

export function ModuleNodeBadge({ node, onReview }: { node: CanvasNodeData; onReview: () => void }) {
    const project = useStudio((s) => s.project);
    const state = moduleSyncState(node, project);
    const theme = canvasThemes[useThemeStore((s) => s.theme)];
    return (
        <Tooltip title={moduleStateLabels[state]}>
            <button
                type="button"
                aria-label={`${node.title}：${moduleStateLabels[state]}`}
                onClick={onReview}
                className="shrink-0 rounded px-1.5 py-0.5 text-[10px]"
                style={{ color: state === "current" ? theme.node.muted : theme.accent, fontWeight: state === "outdated" || state === "conflict" ? 600 : 400 }}
            >
                {state === "current" ? <Check size={13} /> : state === "unlinked" ? "关联模块" : moduleStateLabels[state]}
            </button>
        </Tooltip>
    );
}

export function CanvasModuleSync({
    nodes,
    onChange,
    reviewNodeId,
    onReview,
    busy,
}: {
    nodes: CanvasNodeData[];
    onChange: (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => void;
    reviewNodeId: string | null;
    onReview: (id: string | null) => void;
    busy: boolean;
}) {
    const project = useStudio((s) => s.project);
    const theme = canvasThemes[useThemeStore((s) => s.theme)];
    const texts = nodes.filter((n) => n.type === "text");
    const outdated = texts.filter((n) => moduleSyncState(n, project) === "outdated").length;
    const conflicts = texts.filter((n) => moduleSyncState(n, project) === "conflict").length;
    const visible = reviewNodeId === "all" ? texts : texts.filter((n) => n.id === reviewNodeId);
    const buttonStyle = { color: theme.node.text, background: theme.toolbar.panel, borderColor: theme.toolbar.border };
    const change = (update: (nodes: CanvasNodeData[]) => CanvasNodeData[]) => {
        if (!busy) onChange(update);
    };
    if (!texts.length) return null;
    return (
        <>
            <button type="button" className="absolute left-4 top-14 z-[60] flex items-center gap-2 rounded px-2 py-1 text-xs" style={buttonStyle} onClick={() => onReview("all")}>
                <RefreshCw size={13} />
                模块更新{outdated + conflicts ? ` · ${outdated + conflicts} 个有新版` : ""}
            </button>
            <Modal title="模块更新" open={reviewNodeId !== null} onCancel={() => onReview(null)} footer={null} width={760} destroyOnHidden>
                <div className="studio-ui flex flex-col gap-5 pt-3" style={{ color: theme.node.text }}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="text-sm" style={{ color: theme.node.muted }}>
                            {busy ? "生成期间暂停更新" : conflicts ? `${conflicts} 个本地修改需单独确认` : "更新可撤销，位置与连线保留"}
                        </span>
                        <Button type="primary" disabled={busy || !outdated} icon={<RefreshCw size={14} />} onClick={() => change((current) => updateOutdatedModules(current, useStudio.getState().project))}>
                            更新全部旧版（{outdated}）
                        </Button>
                    </div>
                    <div className="max-h-[55vh] space-y-3 overflow-y-auto">
                        {visible.map((node) => {
                            const state = moduleSyncState(node, project);
                            const ref = node.metadata?.moduleRef;
                            const source = ref?.projectId === project.id ? project.modules.find((m) => m.id === ref.moduleId) : undefined;
                            const canUpdate = state === "outdated" || state === "conflict" || state === "modified";
                            return (
                                <section key={node.id} aria-label={`模块引用 ${node.title}`} className="rounded-lg border p-3" style={{ borderColor: theme.toolbar.border }}>
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                                        <strong>{node.title}</strong>
                                        <Tag color={state === "conflict" ? "gold" : state === "outdated" ? "blue" : undefined}>{moduleStateLabels[state]}</Tag>
                                    </div>
                                    {ref && ref.name !== node.title && <p className="mt-1 text-xs opacity-60">来源：{ref.name}</p>}
                                    {canUpdate && (
                                        <Button size="small" disabled={busy} className="mt-3" onClick={() => change((current) => current.map((n) => (n.id === node.id ? updateModuleNode(n, useStudio.getState().project, state !== "outdated") : n)))}>
                                            {state === "outdated" ? "更新" : "覆盖本地修改并更新"}
                                        </Button>
                                    )}
                                    {(state === "unlinked" || state === "missing" || state === "foreign") && (
                                        <label className="mt-2 flex items-center gap-2 text-xs">
                                            关联模块
                                            <select
                                                aria-label={`为 ${node.title} 关联模块`}
                                                disabled={busy}
                                                value=""
                                                className="min-w-0 rounded border p-1"
                                                style={buttonStyle}
                                                onChange={(event) => {
                                                    const moduleId = event.target.value;
                                                    change((current) => {
                                                        const p = useStudio.getState().project;
                                                        const m = p.modules.find((m) => m.id === moduleId);
                                                        return !m
                                                            ? current
                                                            : current.map((n) =>
                                                                  n.id === node.id ? { ...n, metadata: { ...n.metadata, moduleRef: moduleReference(p.id, m, n.metadata?.content === `【${m.name}】\n${m.text}` ? "labeled" : "plain") } } : n,
                                                              );
                                                    });
                                                }}
                                            >
                                                <option value="">选择工作台模块…</option>
                                                {project.modules.map((m) => (
                                                    <option key={m.id} value={m.id}>
                                                        {m.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                    )}
                                    {state === "unlinked" && <p className="mt-2 text-xs opacity-60">关联后可跟随更新，当前内容保留。</p>}
                                    {source && state !== "current" && (
                                        <details className="mt-2 text-xs" open={state === "conflict" || state === "modified"}>
                                            <summary className="cursor-pointer">对比画布与工作台</summary>
                                            <div className="mt-2 grid gap-3 sm:grid-cols-2">
                                                <div>
                                                    <b>画布当前：{node.title}</b>
                                                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{node.metadata?.content || "（空）"}</pre>
                                                </div>
                                                <div>
                                                    <b>工作台最新：{source.name}</b>
                                                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words font-sans">{moduleNodeText(moduleReference(project.id, source, ref!.format)) || "（空）"}</pre>
                                                </div>
                                            </div>
                                        </details>
                                    )}
                                </section>
                            );
                        })}
                    </div>
                    {reviewNodeId !== "all" && (
                        <button type="button" className="text-xs underline" onClick={() => onReview("all")}>
                            查看当前画布全部模块节点
                        </button>
                    )}
                </div>
            </Modal>
        </>
    );
}
