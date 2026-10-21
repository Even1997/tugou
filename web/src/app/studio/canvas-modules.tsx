"use client";
import { useState } from "react";
import { FileText, Palette, Plus, Search } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { InsertAssetPayload } from "../(user)/canvas/types";
import { useStudio } from "./store";
import { moduleReference } from "./module-sync";

export function CanvasModules({ onInsert, onDragStart, onDragEnd }: { onInsert: (payload: Extract<InsertAssetPayload, { kind: "text" }>) => void; onDragStart?: (payload: InsertAssetPayload) => void; onDragEnd?: () => void }) {
    const modules = useStudio((s) => s.project.modules);
    const projectId = useStudio((s) => s.project.id);
    const theme = canvasThemes[useThemeStore((s) => s.theme)];
    const [search, setSearch] = useState("");
    const filtered = modules.filter((m) => [m.name, m.kind === "style" ? "公共画风" : m.kind, m.text].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
    return (
        <section className="flex h-full min-h-0 flex-col gap-3 p-3" aria-label="当前工程提示词模块" style={{ color: theme.node.text }}>
            <p className="text-xs leading-5 opacity-70" title={onDragStart ? "工作台修改后，节点会提示更新。" : "直接追加为文本；需要同步时，请从侧栏插入模块节点。"}>
                {onDragStart ? "拖入模块，连线使用" : "点击追加到提示词"}
            </p>
            <label className="flex items-center gap-2 rounded border px-2 py-1.5" style={{ borderColor: theme.toolbar.border }}>
                <Search size={14} />
                <input aria-label="搜索提示词模块" placeholder="搜索名称、类别或内容" className="min-w-0 flex-1 bg-transparent text-xs outline-none" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                {filtered.map((module) => {
                    const payload = { kind: "text" as const, title: module.name, content: module.text, moduleRef: moduleReference(projectId, module) };
                    const Icon = module.kind === "style" ? Palette : FileText;
                    return (
                        <button
                            key={module.id}
                            type="button"
                            aria-label={`使用模块 ${module.name}`}
                            disabled={!module.text.trim()}
                            title={module.text.trim() ? module.text : "请先在提示词工作台填写内容"}
                            className="block w-full shrink-0 rounded-lg border p-3 text-left transition hover:opacity-80 disabled:opacity-40"
                            style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}
                            draggable={!!onDragStart && !!module.text.trim()}
                            onClick={() => onInsert(payload)}
                            onDragStart={(event) => {
                                event.dataTransfer.setData("application/x-infinite-canvas-asset", JSON.stringify(payload));
                                event.dataTransfer.effectAllowed = "copy";
                                onDragStart?.(payload);
                            }}
                            onDragEnd={onDragEnd}
                        >
                            <span className="flex items-center gap-2 text-xs font-medium">
                                <Icon size={14} />
                                <span className="min-w-0 flex-1 truncate">{module.name}</span>
                                <Plus size={13} />
                            </span>
                            <span className="mt-2 line-clamp-2 whitespace-pre-wrap break-words text-xs leading-5 opacity-70">{module.text || "尚未填写内容"}</span>
                        </button>
                    );
                })}
                {!filtered.length && <p className="py-6 text-center text-xs opacity-60">{modules.length ? "没有匹配的模块" : "请在提示词工作台添加模块"}</p>}
            </div>
        </section>
    );
}
