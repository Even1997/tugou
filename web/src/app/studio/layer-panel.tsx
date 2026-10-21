"use client";
import { useStudio } from "./store";
import { IconButton, PanelHeader } from "./ui";
import { createLayer, layerEntries, removeLayers, uid, now, type Layer } from "./model";
import { groupLayers, duplicateLayers, reparentLayer, isLayerLocked, rootSelection } from "./layer-operations";
import { renderProject } from "./editor-renderer";
import { alphaBounds } from "./image-bounds";
import { Dropdown } from "antd";
import { useState } from "react";
import { Eye, EyeOff, Lock, Unlock, Type, ImageIcon, FolderPlus, Folder, Trash2, ChevronUp, ChevronDown, Copy, Shapes, MoreHorizontal, SlidersHorizontal } from "lucide-react";

export function LayerPanel({ notify }: { notify: (text: string) => void }) {
    const p = useStudio((s) => s.project);
    const selected = useStudio((s) => s.selected);
    const select = useStudio((s) => s.select);
    const edit = useStudio((s) => s.edit);
    const [collapsed, setCollapsed] = useState<string[]>([]);
    const [merging, setMerging] = useState(false);
    const run = (operation: () => void) => {
        try {
            operation();
        } catch (e) {
            notify((e as Error).message);
        }
    };
    const patch = (id: string, values: Partial<Layer>) => edit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === id ? { ...l, ...values } : l)) }));
    const group = () => {
        run(() => {
            const g = createLayer("group", "新分组");
            edit((p) => groupLayers(p, selected, g));
            select([g.id]);
        });
    };
    const merge = async () => {
        setMerging(true);
        let canvas: HTMLCanvasElement | undefined;
        try {
            const roots = rootSelection(p.layers, selected),
                siblings = p.layers.filter((l) => !l.parentId),
                indexes = roots.map((l) => siblings.indexOf(l)).sort((a, b) => a - b);
            if (!roots.length || roots.some((l) => l.parentId || isLayerLocked(l, p.layers) || l.clipping || l.blend !== "source-over") || indexes.at(-1)! - indexes[0] !== indexes.length - 1)
                throw new Error("请选择画布根层中连续、未锁定、正常混合的图层或组");
            if (roots.some(l => l.kind === "adjustment" && !l.clipping) && indexes[0] !== 0) throw new Error("合并调整图层时，请同时选择其下方全部内容图层");
            if (p.background !== "transparent" && roots.some(l => l.kind === "adjustment")) throw new Error("调整图层也影响画布底色，请先将底色设为透明或改用背景图层，再合并");
            const remaining = new Set(removeLayers(p.layers, roots.map(l => l.id)).map(l => l.id));
            if (p.layers.some(l => remaining.has(l.id) && l.maskSourceId && !remaining.has(l.maskSourceId))) throw new Error("选中图层正被其他图层引用为蒙版，请先解除引用再合并");
            canvas = await renderProject(p, { transparent: true, only: roots.map((l) => l.id) });
            const box = alphaBounds(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
            if (!box) throw new Error("选中图层没有可见内容");
            const trimmed = document.createElement("canvas");
            trimmed.width = box.width;
            trimmed.height = box.height;
            trimmed.getContext("2d")!.drawImage(canvas, -box.x, -box.y);
            canvas.width = canvas.height = 0;
            canvas = trimmed;
            const asset = { id: uid(), name: "合并图层", dataUrl: canvas.toDataURL(), width: box.width, height: box.height, hasAlpha: true, createdAt: now() };
            const layer = { ...createLayer("image", "合并图层"), assetId: asset.id, ...box };
            if (useStudio.getState().project !== p) throw new Error("合成期间工程已变化，请重新合并");
            edit((current) => {
                const layers = removeLayers(
                    current.layers,
                    roots.map((l) => l.id),
                );
                const next = siblings[indexes.at(-1)! + 1],
                    index = next ? layers.findIndex((l) => l.id === next.id) : layers.length;
                layers.splice(index, 0, layer);
                return { ...current, layers, assets: [...current.assets, asset] };
            });
            select([layer.id]);
        } catch (e) {
            notify((e as Error).message);
        } finally {
            if (canvas) canvas.width = canvas.height = 0;
            setMerging(false);
        }
    };
    const move = (direction: number) =>
        edit((p) => {
            const layers = [...p.layers];
            const i = layers.findIndex((l) => l.id === selected[0]);
            if (i < 0 || isLayerLocked(layers[i], layers)) return p;
            const same = layers.map((l, index) => ({ l, index })).filter((x) => x.l.parentId === layers[i]?.parentId);
            const pos = same.findIndex((x) => x.index === i);
            const j = same[pos + direction]?.index;
            if (i < 0 || j === undefined) return p;
            [layers[i], layers[j]] = [layers[j], layers[i]];
            return { ...p, layers };
        });
    return (
        <section className="layer-panel">
            <div className="studio-ui">
                <PanelHeader
                    title="图层"
                    count={p.layers.length}
                    actions={
                        <>
                            <IconButton label="将选中图层分组" disabled={!selected.length} onClick={group}>
                                <FolderPlus size={16} />
                            </IconButton>
                        </>
                    }
                />
            </div>
            <div
                className="layer-list"
                onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/x-studio-layer")) e.preventDefault();
                }}
                onDrop={(e) => {
                    if (e.target !== e.currentTarget) return;
                    e.preventDefault();
                    const id = e.dataTransfer.getData("application/x-studio-layer");
                    if (id) run(() => edit((p) => reparentLayer(p, id)));
                }}
            >
                {layerEntries(p.layers)
                    .filter(({ layer }) => {
                        let parent = layer.parentId;
                        while (parent) {
                            if (collapsed.includes(parent)) return false;
                            parent = p.layers.find((l) => l.id === parent)?.parentId;
                        }
                        return true;
                    })
                    .map(({ layer: l, depth }) => (
                        <div
                            key={l.id}
                            className={`layer-row ${selected.includes(l.id) ? "selected" : ""}`}
                            style={{ paddingLeft: 10 + depth * 14 }}
                            draggable={!isLayerLocked(l, p.layers)}
                            onDragStart={(e) => e.dataTransfer.setData("application/x-studio-layer", l.id)}
                            onDragOver={(e) => {
                                if (e.dataTransfer.types.includes("application/x-studio-layer")) e.preventDefault();
                            }}
                            onDrop={(e) => {
                                const id = e.dataTransfer.getData("application/x-studio-layer");
                                if (!id || id === l.id) return;
                                e.preventDefault();
                                e.stopPropagation();
                                run(() => edit((p) => reparentLayer(p, id, l.kind === "group" ? l.id : l.parentId, l.kind === "group" ? undefined : l.id)));
                            }}
                        >
                            {l.kind === "group" && (
                                <button title={collapsed.includes(l.id) ? "展开组" : "折叠组"} onClick={() => setCollapsed((c) => (c.includes(l.id) ? c.filter((id) => id !== l.id) : [...c, l.id]))}>
                                    {collapsed.includes(l.id) ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                </button>
                            )}
                            <button className="layer-name" onClick={(e) => select(e.shiftKey ? (selected.includes(l.id) ? selected.filter((id) => id !== l.id) : [...selected, l.id]) : [l.id])}>
                                {l.kind === "group" ? <Folder size={15} /> : l.kind === "text" ? <Type size={15} /> : l.kind === "shape" ? <Shapes size={15} /> : l.kind === "adjustment" ? <SlidersHorizontal size={15} /> : <ImageIcon size={15} />}
                                <span>
                                    {l.clipping ? "↳ " : ""}
                                    {l.name}
                                </span>
                            </button>
                            <button title={l.visible ? "隐藏图层" : "显示图层"} onClick={() => patch(l.id, { visible: !l.visible })}>
                                {l.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                            </button>
                            <button title={l.locked ? "解锁图层" : "锁定图层"} onClick={() => patch(l.id, { locked: !l.locked })}>
                                {l.locked ? <Lock size={13} /> : <Unlock size={13} />}
                            </button>
                        </div>
                    ))}
            </div>
            <div className="layer-actions">
                <button title="上移图层" disabled={selected.length !== 1} onClick={() => move(1)}>
                    <ChevronUp size={16} />
                </button>
                <button title="下移图层" disabled={selected.length !== 1} onClick={() => move(-1)}>
                    <ChevronDown size={16} />
                </button>
                <button
                    title="复制选中图层"
                    disabled={!selected.length}
                    onClick={() => {
                        run(() => {
                            const copy = duplicateLayers(p, selected);
                            edit(() => copy.project);
                            select(copy.selected);
                        });
                    }}
                >
                    <Copy size={15} />
                </button>
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "merge", label: merging ? "正在合并…" : "合并为图片", disabled: !selected.length || merging },
                            { key: "out", label: "移至画布根层", disabled: selected.length !== 1 },
                        ],
                        onClick: ({ key }) => (key === "merge" ? void merge() : run(() => edit((p) => reparentLayer(p, selected[0])))),
                    }}
                >
                    <button title="更多图层操作">
                        <MoreHorizontal size={16} />
                    </button>
                </Dropdown>
                <div className="spacer" />
                <button
                    title="删除选中图层"
                    disabled={!selected.length}
                    onClick={() => {
                        edit((p) => ({
                            ...p,
                            layers: removeLayers(
                                p.layers,
                                selected.filter((id) => {
                                    const l = p.layers.find((l) => l.id === id);
                                    return l && !isLayerLocked(l, p.layers);
                                }),
                            ),
                        }));
                        select([]);
                    }}
                >
                    <Trash2 size={15} />
                </button>
            </div>
        </section>
    );
}
