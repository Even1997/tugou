"use client";
import { useRef, useState } from "react";
import { App } from "antd";
import { ImagePlus, Plus, Search } from "lucide-react";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { InsertAssetPayload } from "../(user)/canvas/types";
import { useStudio } from "./store";
import { readAsset } from "./client-api";
import { thumbnailUrl } from "./resource-url.js";
import type { Asset } from "./model";

export function CanvasAssets({ onInsert, onDragStart, onDragEnd }: {
    onInsert: (payload: InsertAssetPayload) => void;
    onDragStart?: (payload: InsertAssetPayload) => void;
    onDragEnd?: () => void;
}) {
    const project = useStudio((s) => s.project);
    const theme = canvasThemes[useThemeStore((s) => s.theme)];
    const { message } = App.useApp();
    const input = useRef<HTMLInputElement>(null);
    const [search, setSearch] = useState("");
    const [importing, setImporting] = useState(false);
    return <section className="flex h-full min-h-0 flex-col gap-3 p-3" aria-label="当前工程素材库" style={{ color: theme.node.text }}>
        <div className="flex items-center justify-between gap-2 text-xs">
            <span>当前工程 · {project.assets.length} 份素材</span>
            <button type="button" disabled={importing} className="flex items-center gap-1 rounded px-2 py-1 hover:opacity-70 disabled:opacity-40" onClick={() => input.current?.click()}><ImagePlus size={14} />{importing ? "导入中…" : "导入图片"}</button>
            <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={async (event) => {
                const files = Array.from(event.target.files || []);
                if (!files.length) return;
                setImporting(true);
                try {
                    if (project.assets.length + files.length > 500) throw new Error("单个工程最多容纳 500 份素材");
                    const assets: Asset[] = [];
                    for (const file of files) assets.push(await readAsset(file, file.name.replace(/\.[^.]+$/, "")));
                    if (useStudio.getState().project.id !== project.id) throw new Error("工程已切换，请在当前工程重新导入");
                    useStudio.getState().edit((p) => ({ ...p, assets: [...p.assets, ...assets] }));
                    message.success(`已导入 ${assets.length} 张图片，素材库已同步`);
                } catch (error) { message.error((error as Error).message); }
                finally { setImporting(false); if (input.current) input.current.value = ""; }
            }} />
        </div>
        <label className="flex items-center gap-2 rounded border px-2 py-1.5" style={{ borderColor: theme.toolbar.border }}>
            <Search size={14} /><input aria-label="搜索当前工程素材" placeholder="搜索素材" className="min-w-0 flex-1 bg-transparent text-xs outline-none" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
                {project.assets.filter((asset) => asset.name.toLowerCase().includes(search.trim().toLowerCase())).map((asset) => {
                    const payload: InsertAssetPayload = { kind: "image", dataUrl: asset.dataUrl, title: asset.name, width: asset.width, height: asset.height, source: "asset" };
                    return <button key={asset.id} type="button" aria-label={`插入 ${asset.name}`} title={`${asset.name} · 点击或拖入画布`} className="group overflow-hidden rounded-lg border text-left transition hover:opacity-80" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }} draggable onClick={() => onInsert(payload)} onDragStart={(event) => {
                        event.dataTransfer.setData("application/x-infinite-canvas-asset", JSON.stringify(payload));
                        event.dataTransfer.effectAllowed = "copy";
                        onDragStart?.(payload);
                    }} onDragEnd={onDragEnd}>
                        <img src={thumbnailUrl(asset.dataUrl)} alt={asset.name} loading="lazy" decoding="async" className="checker aspect-square w-full object-contain" />
                        <div className="p-2"><div className="truncate text-xs font-medium">{asset.name}</div><div className="mt-1 flex items-center justify-between text-[10px] opacity-60"><span>{asset.width} × {asset.height}</span><Plus size={13} /></div></div>
                    </button>;
                })}
            </div>
            {!project.assets.length && <p className="py-8 text-center text-xs opacity-60">导入图片，或在画布图片上点击“存素材”。</p>}
        </div>
    </section>;
}
