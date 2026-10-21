"use client";
import { useRef, useState } from "react";
import { Plus, Download, Layers, Replace, ImagePlus, Search } from "lucide-react";
import { useStudio } from "./store";
import { createLayer, type Asset } from "./model";
import { studioRequest, readAsset } from "./client-api";
import { Button, Input } from "antd";
import { PanelHeader } from "./ui";
import { thumbnailUrl } from "./resource-url.js";

export function AssetLibrary({ compact = false, notify, onCompose }: { compact?: boolean; notify: (message: string) => void; onCompose: () => void }) {
    const p = useStudio((s) => s.project);
    const selected = useStudio((s) => s.selected);
    const select = useStudio((s) => s.select);
    const edit = useStudio((s) => s.edit);
    const input = useRef<HTMLInputElement>(null);
    const [search, setSearch] = useState("");
    const [activeId, setActive] = useState<string>();
    const [importing, setImporting] = useState(false);
    const active = p.assets.find((a) => a.id === activeId);
    const selectedLayer = p.layers.find((l) => l.id === selected[0] && l.kind === "image");
    const add = (a: Asset) => {
        const scale = Math.min((p.width * 0.65) / a.width, (p.height * 0.7) / a.height, 1);
        const l = { ...createLayer("image", a.name), assetId: a.id, width: a.width * scale, height: a.height * scale, x: (p.width - a.width * scale) / 2, y: (p.height - a.height * scale) / 2 };
        edit((p) => ({ ...p, layers: [...p.layers, l] }));
        select([l.id]);
        onCompose();
        notify("素材已作为新图层加入画面");
    };
    const replace = (a: Asset) => {
        if (!selectedLayer || selectedLayer.locked) return;
        const height = (selectedLayer.width * a.height) / a.width;
        edit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === selectedLayer.id ? { ...l, assetId: a.id, height, y: l.y + (l.height - height) / 2 } : l)) }));
        notify("已保留位置、宽度、旋转与蒙版，按新素材比例替换；可撤销");
    };
    return (
        <section className={`asset-library ${compact ? "compact" : ""}`}>
            <div className="studio-ui">
                <PanelHeader title="素材库" count={p.assets.length} actions={<Button type="text" size="small" loading={importing} icon={<ImagePlus size={15} />} onClick={() => input.current?.click()}>{compact ? "导入" : "导入图片"}</Button>} />
                <input
                    type="file"
                    multiple
                    ref={input}
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={async (e) => {
                        const files = Array.from(e.target.files || []);
                        setImporting(true);
                        try {
                            if (p.assets.length + files.length > 500) throw new Error("单个工程最多容纳 500 份素材");
                            const assets: Asset[] = [];
                            for (const f of files) assets.push(await readAsset(f, f.name.replace(/\.[^.]+$/, "")));
                            if (useStudio.getState().project.id !== p.id) throw new Error("工程已切换，请在当前工程重新导入");
                            edit((p) => ({ ...p, assets: [...p.assets, ...assets] }));
                            notify(`已导入 ${assets.length} 张图片`);
                        } catch (e) {
                            notify(e instanceof Error ? e.message : "导入失败");
                        } finally {
                            setImporting(false);
                            if (input.current) input.current.value = "";
                        }
                    }}
                />
            </div>
            {!compact && (
                <div className="studio-ui flex items-center justify-between gap-4 px-9 py-5">
                    <h2 className="text-xl font-semibold">全部素材</h2>
                    <Input className="max-w-64" aria-label="搜索素材" prefix={<Search size={16} />} allowClear placeholder="搜索素材" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
            )}
            <div className="asset-grid">
                {p.assets
                    .filter((a) => a.name.includes(search))
                    .map((a) => (
                        <article key={a.id} className={`asset-card ${active?.id === a.id ? "selected" : ""}`}>
                            <button
                                className="asset-preview checker"
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData("application/x-studio-asset", a.id);
                                    e.dataTransfer.effectAllowed = "copy";
                                }}
                                onClick={() => setActive(a.id)}
                                onDoubleClick={() => add(a)}
                            >
                                <img alt={a.name} src={thumbnailUrl(a.dataUrl)} loading="lazy" decoding="async" />
                                {a.hasAlpha && <span className="alpha-label">透明</span>}
                            </button>
                            <div className="asset-caption">
                                <strong>{a.name}</strong>
                                <small>
                                    {a.width} × {a.height}
                                    {a.recipeId ? ` · V${p.assets.filter((x) => x.recipeId === a.recipeId).findIndex((x) => x.id === a.id) + 1}` : " · 导入"}
                                </small>
                            </div>
                            <div className="asset-buttons">
                                <button title={`添加 ${a.name} 到图层`} onClick={() => add(a)}>
                                    <Plus size={14} />
                                    加入画面
                                </button>
                                <button
                                    title="下载原始素材"
                                    onClick={async () => {
                                        try {
                                            const saved = await studioRequest<{ path: string }>("export", { dataUrl: a.dataUrl, name: a.name });
                                            notify(`素材已保存：${saved.path}`);
                                        } catch (e) {
                                            notify((e as Error).message);
                                        }
                                    }}
                                >
                                    <Download size={14} />
                                </button>
                            </div>
                        </article>
                    ))}
                {!p.assets.length && (
                    <div className="studio-ui col-span-full flex min-w-0 flex-col items-center gap-4 px-3 py-12 text-center text-[var(--studio-muted)]">
                        <ImagePlus size={28} />
                        <div className="flex flex-col gap-2">
                            <h3 className="text-sm font-medium text-[var(--studio-text)]">还没有素材</h3>
                            <p className="max-w-64 text-sm leading-7">导入图片，或从配方生成。</p>
                        </div>
                        <Button icon={<Plus size={15} />} onClick={() => input.current?.click()}>导入图片</Button>
                    </div>
                )}
            </div>
            {active && (
                <div className="asset-detail">
                    <div className="inline">
                        <Layers size={15} />
                        <strong>{active.name}</strong>
                    </div>
                    <p>
                        {active.model || "本地导入"} · {new Date(active.createdAt).toLocaleString("zh-CN")}
                    </p>
                    {selectedLayer && (
                        <button className="secondary full" disabled={selectedLayer.locked} onClick={() => replace(active)}>
                            <Replace size={14} />
                            替换「{selectedLayer.name}」
                        </button>
                    )}
                    {active.prompt && (
                        <details>
                            <summary>查看生成时的提示词</summary>
                            <pre>{active.prompt}</pre>
                        </details>
                    )}
                </div>
            )}
        </section>
    );
}
