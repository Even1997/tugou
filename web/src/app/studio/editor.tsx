"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CreationTools, ObjectTools } from "./editor-tools";
import { DocumentSize } from "./document-size";
import { exportImageStrips } from "./image-export";
import Konva from "konva";
import { Stage, Layer as CanvasLayer, Group, Image as CanvasImage, Rect, Text, Line, Circle, Transformer } from "react-konva";
import { Dropdown } from "antd";
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Hand, Download, Grid2X2, PanelLeftClose, Eraser, Paintbrush } from "lucide-react";
import { useStudio } from "./store";
import { createLayer, removeLayers, type Layer, type StudioProject } from "./model";
import { renderProject } from "./editor-renderer";
import { worldTransform, transformValues, rootSelection, isLayerLocked, moveLayers, duplicateLayers, groupLayers, snapTranslation } from "./layer-operations";
import { useEditorSelection } from "./editor-selection";
import { quadBounds, validateQuad } from "./perspective";
import { useEditorPaint } from "./editor-paint";
import { MaskToolbar } from "./mask-toolbar";
import { useEditorFill } from "./editor-fill";
import { useEditorTone } from "./editor-tone";

export const defaultLayout = { snap: true, grid: false, rulers: false, gridSize: 40, guides: [] };
export default function Editor({ notify, toolbarHost, libraryVisible, toggleLibrary }: { notify: (text: string) => void; toolbarHost: HTMLDivElement | null; libraryVisible: boolean; toggleLibrary: () => void }) {
    const project = useStudio((s) => s.project),
        selected = useStudio((s) => s.selected),
        select = useStudio((s) => s.select),
        edit = useStudio((s) => s.edit);
    const host = useRef<HTMLDivElement>(null),
        stage = useRef<Konva.Stage>(null),
        tr = useRef<Konva.Transformer>(null);
    const [area, setArea] = useState({ width: 800, height: 700 }),
        [zoom, setZoom] = useState(0.35),
        [origin, setOrigin] = useState({ x: 150, y: 30 });
    const [panning, setPanning] = useState(false),
        [maskEditing, setMaskEditing] = useState(false),
        [format, setFormat] = useState("png"),
        [exporting, setExporting] = useState(false),
        [cancellingExport, setCancellingExport] = useState(false),
        [exportProgress, setExportProgress] = useState(0);
    const exportController = useRef<AbortController | null>(null);
    useEffect(() => () => { exportController.current?.abort(); }, [project.id]);
    const [draft, setDraft] = useState<StudioProject>(),
        [preview, setPreview] = useState<{ canvas: HTMLCanvasElement; x: number; y: number; width: number; height: number }>();
    const current = draft || project,
        layout = project.layout || defaultLayout;
    const transaction = useRef<{ project: StudioProject; ids: string[]; start: { x: number; y: number }; id: string; result?: StudioProject } | undefined>(undefined);
    const warpEdit = useRef<StudioProject | undefined>(undefined);
    const fill = useEditorFill(notify);
    const tone = useEditorTone(notify, () => setMaskEditing(true));
    const selection = useEditorSelection(
        () => {
            const point = stage.current?.getPointerPosition() || origin;
            return { x: (point.x - origin.x) / zoom, y: (point.y - origin.y) / zoom };
        },
        notify,
        fill.run,
    );
    const paint = useEditorPaint(
        () => {
            const point = stage.current?.getPointerPosition() || origin;
            return { x: (point.x - origin.x) / zoom, y: (point.y - origin.y) / zoom };
        },
        notify,
        zoom,
        fill.run,
    );
    const drawing = selection.active || paint.active;
    useEffect(() => {
        if (tone.intent) { paint.cancel(); selection.cancel(); fill.cancel(); setMaskEditing(false); }
    }, [tone.intent]);
    useEffect(() => {
        if (fill.busy) {
            paint.cancel();
            selection.cancel();
            setMaskEditing(false);
        }
    }, [fill.busy]);
    useEffect(() => {
        setMaskEditing(false);
    }, [drawing, project.id, selected.join()]);
    useEffect(() => {
        if (paint.active) {
            if (fill.busy) fill.cancel();
            selection.cancel();
            setPanning(false);
        }
    }, [paint.active]);
    useEffect(() => {
        if (selection.active) {
            if (fill.busy) fill.cancel();
            paint.cancel();
            setPanning(false);
        }
    }, [selection.active]);
    useEffect(() => {
        let active = true;
        const timer = setTimeout(
            () => {
                const scale = Math.min(2, zoom * Math.min(devicePixelRatio, 2));
                const bleed = Math.ceil(Math.max(0, ...current.layers.map((l) => l.mask?.feather || 0)) * 3 + 8);
                const x = Math.max(0, Math.min(current.width - 1, Math.floor(-origin.x / zoom - bleed)));
                const y = Math.max(0, Math.min(current.height - 1, Math.floor(-origin.y / zoom - bleed)));
                const width = Math.max(1, Math.min(current.width, Math.ceil((area.width - origin.x) / zoom + bleed)) - x);
                const height = Math.max(1, Math.min(current.height, Math.ceil((area.height - origin.y) / zoom + bleed)) - y);
                renderProject(current, { scale, region: { x, y, width, height }, raster: paint.live })
                    .then((canvas) => {
                        if (!active) {
                            canvas.width = canvas.height = 0;
                            return;
                        }
                        // Konva may still draw the previous canvas during a concurrent React commit.
                        // Let it release that reference before the browser collects the old bitmap.
                        setPreview({ canvas, x: Math.floor(x * scale) / scale, y: Math.floor(y * scale) / scale, width: canvas.width / scale, height: canvas.height / scale });
                    })
                    .catch((e) => {
                        if (active) notify(e instanceof Error ? e.message : "画面合成失败");
                    });
            },
            draft ? 16 : 0,
        );
        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [current, notify, draft, paint.live, zoom, origin.x, origin.y, area.width, area.height]);
    useEffect(() => {
        if (!host.current) return;
        const observer = new ResizeObserver(([entry]) => setArea({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(host.current);
        return () => observer.disconnect();
    }, []);
    const fit = () => {
        const k = Math.max(0.002, Math.min((area.width - 100) / project.width, (area.height - 80) / project.height, 1));
        setZoom(k);
        setOrigin({ x: (area.width - project.width * k) / 2, y: (area.height - project.height * k) / 2 });
    };
    useEffect(fit, [area.width, area.height, project.id, project.width, project.height]);
    useEffect(() => {
        tr.current?.nodes(
            rootSelection(project.layers, selected)
                .map((l) => stage.current?.findOne(`#${l.id}`))
                .filter((n): n is Konva.Node => !!n && n.isVisible() && n.isListening()),
        );
        tr.current?.getLayer()?.batchDraw();
    }, [selected, project.layers, panning, drawing]);
    useEffect(() => {
        const keys = (e: KeyboardEvent) => {
            if (drawing || document.querySelector("dialog[open],.ant-modal-wrap:not([style*='display: none'])") || (e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true],[data-editor-input]")) return;
            const state = useStudio.getState(),
                ids = rootSelection(state.project.layers, state.selected)
                    .filter((l) => !isLayerLocked(l, state.project.layers))
                    .map((l) => l.id);
            if (!ids.length) return;
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                state.edit((p) => moveLayers(p, ids, e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0), `nudge:${ids.join()}`);
            } else if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                state.edit((p) => ({ ...p, layers: removeLayers(p.layers, ids) }));
                state.select([]);
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
                e.preventDefault();
                try {
                    const copy = duplicateLayers(state.project, ids);
                    state.edit(() => copy.project);
                    state.select(copy.selected);
                } catch (e) {
                    notify((e as Error).message);
                }
            } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "g") {
                e.preventDefault();
                try {
                    const group = createLayer("group", "新分组");
                    state.edit((p) => groupLayers(p, ids, group));
                    state.select([group.id]);
                } catch (error) {
                    notify((error as Error).message);
                }
            }
        };
        window.addEventListener("keydown", keys);
        return () => window.removeEventListener("keydown", keys);
    }, [notify, drawing]);
    const dragging = (node: Konva.Node, free = false) => {
        const t = transaction.current;
        if (!t) return;
        let dx = node.x() - t.start.x,
            dy = node.y() - t.start.y;
        if (layout.snap && !free) ({ dx, dy } = snapTranslation(t.project, t.ids, dx, dy, zoom));
        t.result = moveLayers(t.project, t.ids, dx, dy);
        setDraft(t.result);
    };
    const transforming = () => {
        const ids = new Set(rootSelection(project.layers, selected).map((l) => l.id));
        const result = {
            ...project,
            layers: project.layers.map((l) => {
                const node = ids.has(l.id) && stage.current?.findOne(`#${l.id}`);
                if (!node) return l;
                const parent = project.layers.find((p) => p.id === l.parentId);
                const inverse = parent ? worldTransform(parent, project.layers).invert() : new Konva.Transform();
                return { ...l, ...transformValues(inverse.multiply(node.getTransform().copy())) };
            }),
        };
        setDraft(result);
        return result;
    };
    const exportImage = async () => {
        if (exportController.current) return;
        const controller = new AbortController();
        exportController.current = controller;
        setExporting(true);
        setCancellingExport(false);
        setExportProgress(0);
        try {
            const saved = await exportImageStrips(project, format, setExportProgress, controller.signal);
            notify(`已导出 ${project.width} × ${project.height}：${saved.path}`);
        } catch (e) {
            notify(controller.signal.aborted ? "已取消导出" : e instanceof Error ? e.message : "导出失败");
        } finally {
            exportController.current = null;
            setExporting(false);
            setCancellingExport(false);
        }
    };
    const visible = (l: Layer): boolean => l.visible && (!l.parentId || visible(current.layers.find((n) => n.id === l.parentId)!));
    const hitLayers = current.layers.filter((l) => l.kind !== "adjustment" && visible(l) && (!l.parentId || selected.includes(l.id)));
    const warpLayer = selected.length === 1 ? current.layers.find((l) => l.id === selected[0] && l.warp) : undefined;
    const warpPoints = warpLayer?.warp ? [0, 2, 4, 6].map((i) => worldTransform(warpLayer, current.layers).point({ x: warpLayer.warp![i] * warpLayer.width, y: warpLayer.warp![i + 1] * warpLayer.height })) : [];
    const guideLines = [...layout.guides],
        gridStep = Math.max(layout.gridSize, Math.ceil(20 / zoom / layout.gridSize) * layout.gridSize);
    if (layout.grid) {
        for (let x = gridStep; x < project.width; x += gridStep) guideLines.push({ axis: "x", position: x });
        for (let y = gridStep; y < project.height; y += gridStep) guideLines.push({ axis: "y", position: y });
    }
    return (
        <div className="editor-space">
            {toolbarHost &&
                createPortal(
                    <>
                        <div className="editor-controls" aria-label="编辑工具栏">
                            <div>
                                <button aria-label={libraryVisible ? "收起素材库" : "展开素材库"} title="素材库" onClick={toggleLibrary}>
                                    <PanelLeftClose size={17} />
                                </button>
                                <span className="divider" />
                                <button
                                    className={!panning && !drawing ? "active" : ""}
                                    aria-label="选择与移动图层"
                                    onClick={() => {
                                        setPanning(false);
                                        selection.cancel();
                                        paint.cancel();
                                    }}
                                >
                                    <MousePointer2 size={16} />
                                </button>
                                <button
                                    className={panning ? "active" : ""}
                                    aria-label="平移画布"
                                    onClick={() => {
                                        setPanning(true);
                                        selection.cancel();
                                        paint.cancel();
                                    }}
                                >
                                    <Hand size={16} />
                                </button>
                                {selection.trigger}
                                <button aria-label="画笔" title="画笔" className={paint.tool === "brush" ? "active" : ""} onClick={() => paint.activate("brush")}>
                                    <Paintbrush size={17} />
                                    <span className="tool-label">画笔</span>
                                </button>
                                <button aria-label="橡皮" title="橡皮" className={paint.tool === "erase" ? "active" : ""} onClick={() => paint.activate("erase")}>
                                    <Eraser size={17} />
                                </button>
                                {paint.trigger}
                                {paint.retouchTrigger}
                                <span className="divider" />
                                <CreationTools notify={notify} />
                                {tone.trigger}
                                <DocumentSize notify={notify} compact />
                                <Dropdown
                                    menu={{
                                        items: [
                                            ...(["snap", "grid", "rulers"] as const).map((key, i) => ({ key, label: `${layout[key] ? "✓ " : ""}${["吸附", "网格", "标尺"][i]}` })),
                                            { type: "divider" },
                                            { key: "x", label: "添加垂直参考线" },
                                            { key: "y", label: "添加水平参考线" },
                                            { key: "clear", label: "清除参考线", disabled: !layout.guides.length },
                                        ],
                                        onClick: ({ key }) =>
                                            edit((p) => ({
                                                ...p,
                                                layout:
                                                    key === "snap" || key === "grid" || key === "rulers"
                                                        ? { ...(p.layout || defaultLayout), [key]: !(p.layout || defaultLayout)[key] }
                                                        : { ...(p.layout || defaultLayout), guides: key === "clear" ? [] : [...(p.layout?.guides || []), { axis: key as "x" | "y", position: (key === "x" ? p.width : p.height) / 2 }].slice(-100) },
                                            })),
                                    }}
                                    trigger={["click"]}
                                >
                                    <button aria-label="排版辅助" title="吸附、网格与参考线">
                                        <Grid2X2 size={16} />
                                    </button>
                                </Dropdown>
                            </div>
                            <div>
                                <select aria-label="导出格式" disabled={exporting} value={format} onChange={(e) => setFormat(e.target.value)}>
                                    <option value="png">PNG · 保留透明</option>
                                    <option value="jpg">JPEG · 白色底</option>
                                </select>
                                <button disabled={exporting} onClick={exportImage}>
                                    <Download size={15} />
                                    {exporting ? `导出 ${exportProgress}%` : "导出画面"}
                                </button>
                                {exporting && <button aria-label="取消导出" disabled={cancellingExport} onClick={() => { setCancellingExport(true); exportController.current?.abort(); }}>
                                    {cancellingExport ? "正在取消…" : "取消"}
                                </button>}
                            </div>
                        </div>
                        <div className="editor-context">
                            {fill.toolbar || selection.toolbar || paint.toolbar || (maskEditing ? <MaskToolbar notify={notify} close={() => setMaskEditing(false)} /> : tone.toolbar || <ObjectTools notify={notify} editMask={() => setMaskEditing(true)} />)}
                        </div>
                    </>,
                    toolbarHost,
                )}
            <div
                className="editor-stage checker"
                ref={host}
                onPointerDownCapture={() => {
                    if (fill.busy) fill.cancel();
                }}
                onDragOver={(e) => {
                    if (e.dataTransfer.types.includes("application/x-studio-asset")) e.preventDefault();
                }}
                onDrop={(e) => {
                    const asset = project.assets.find((a) => a.id === e.dataTransfer.getData("application/x-studio-asset"));
                    if (!asset || !host.current) return;
                    if (project.layers.length >= 500) {
                        notify("工程最多支持 500 个图层");
                        return;
                    }
                    e.preventDefault();
                    const bounds = host.current.getBoundingClientRect(),
                        k = Math.min((project.width * 0.65) / asset.width, (project.height * 0.7) / asset.height, 1);
                    const layer = {
                        ...createLayer("image", asset.name),
                        assetId: asset.id,
                        width: asset.width * k,
                        height: asset.height * k,
                        x: (e.clientX - bounds.left - origin.x) / zoom - (asset.width * k) / 2,
                        y: (e.clientY - bounds.top - origin.y) / zoom - (asset.height * k) / 2,
                    };
                    edit((p) => ({ ...p, layers: [...p.layers, layer] }));
                    select([layer.id]);
                }}
            >
                <Stage
                    ref={stage}
                    width={area.width}
                    height={area.height}
                    {...(paint.active ? paint.handlers : selection.handlers)}
                    onMouseDown={(e) => {
                        if (paint.active) void paint.handlers.onMouseDown(e);
                        else if (selection.active) selection.handlers.onMouseDown(e);
                        else if (e.target === e.target.getStage()) select([]);
                    }}
                    onWheel={(e) => {
                        e.evt.preventDefault();
                        if (e.evt.ctrlKey || e.evt.metaKey) {
                            const k = Math.max(0.002, Math.min(16, zoom * (e.evt.deltaY < 0 ? 1.08 : 1 / 1.08))),
                                point = stage.current?.getPointerPosition() || { x: area.width / 2, y: area.height / 2 };
                            setOrigin({ x: point.x - ((point.x - origin.x) * k) / zoom, y: point.y - ((point.y - origin.y) * k) / zoom });
                            setZoom(k);
                        } else setOrigin({ x: origin.x - e.evt.deltaX, y: origin.y - e.evt.deltaY });
                    }}
                >
                    <CanvasLayer>
                        <Group
                            x={origin.x}
                            y={origin.y}
                            scaleX={zoom}
                            scaleY={zoom}
                            draggable={panning && !drawing}
                            onDragEnd={(e) => {
                                if (e.target === e.currentTarget) setOrigin({ x: e.target.x(), y: e.target.y() });
                            }}
                        >
                            <Rect
                                width={project.width}
                                height={project.height}
                                fill="rgba(0,0,0,0)"
                                stroke="rgba(128,128,128,.3)"
                                strokeWidth={1 / zoom}
                                onClick={() => {
                                    if (!drawing) select([]);
                                }}
                            />
                            {preview && <CanvasImage image={preview.canvas} x={preview.x} y={preview.y} width={preview.width} height={preview.height} listening={false} />}
                            {hitLayers.map((layer) => {
                                const { x, y, rotation, scaleX, scaleY, skewX } = transformValues(worldTransform(layer, current.layers));
                                const box = layer.warp ? quadBounds(layer.warp, layer.width, layer.height) : { x: 0, y: 0, width: layer.width, height: layer.height };
                                return (
                                    <Group
                                        key={layer.id}
                                        id={layer.id}
                                        x={x}
                                        y={y}
                                        rotation={rotation}
                                        scaleX={scaleX}
                                        scaleY={scaleY}
                                        skewX={skewX}
                                        width={layer.width}
                                        height={layer.height}
                                        draggable={!panning && !drawing && !isLayerLocked(layer, current.layers)}
                                        listening={!panning && !drawing && !isLayerLocked(layer, current.layers)}
                                        onClick={(e) => {
                                            e.cancelBubble = true;
                                            select(e.evt.shiftKey ? (selected.includes(layer.id) ? selected.filter((id) => id !== layer.id) : [...selected, layer.id]) : [layer.id]);
                                        }}
                                        onDragStart={(e) => {
                                            e.cancelBubble = true;
                                            const ids = selected.includes(layer.id) ? rootSelection(project.layers, selected).map((l) => l.id) : [layer.id];
                                            if (!selected.includes(layer.id)) select(ids);
                                            // Konva has already moved on dragstart; use the persisted matrix for the origin.
                                            transaction.current = { project, ids, start: { x: x!, y: y! }, id: layer.id };
                                        }}
                                        onDragMove={(e) => {
                                            e.cancelBubble = true;
                                            dragging(e.target, e.evt.altKey);
                                        }}
                                        onDragEnd={(e) => {
                                            e.cancelBubble = true;
                                            dragging(e.target, e.evt.altKey);
                                            const result = transaction.current?.result;
                                            transaction.current = undefined;
                                            if (result) edit(() => result);
                                            setDraft(undefined);
                                        }}
                                    >
                                        <Rect {...box} fill="rgba(0,0,0,0)" />
                                    </Group>
                                );
                            })}
                            {guideLines.map((g, i) => (
                                <Line
                                    key={i}
                                    points={g.axis === "x" ? [g.position, 0, g.position, project.height] : [0, g.position, project.width, g.position]}
                                    stroke={i < layout.guides.length ? "#67b7cd" : "rgba(128,128,128,.18)"}
                                    strokeWidth={1 / zoom}
                                    listening={i < layout.guides.length && !panning && !drawing}
                                    hitStrokeWidth={8 / zoom}
                                    draggable={i < layout.guides.length && !panning && !drawing}
                                    onDragEnd={(e) => {
                                        const offset = g.axis === "x" ? e.target.x() : e.target.y();
                                        e.target.position({ x: 0, y: 0 });
                                        edit((p) => ({ ...p, layout: { ...(p.layout || defaultLayout), guides: layout.guides.map((item, index) => (index === i ? { ...item, position: item.position + offset } : item)) } }));
                                    }}
                                />
                            ))}
                            {selection.overlay}
                            {paint.linePreview && (
                                <>
                                    <Line points={paint.linePreview} stroke="#111111" strokeWidth={3 / zoom} listening={false} />
                                    <Line points={paint.linePreview} stroke="#ffffff" strokeWidth={1 / zoom} dash={[6 / zoom, 4 / zoom]} listening={false} />
                                </>
                            )}
                            {paint.outline && (
                                <>
                                    <Line points={paint.outline} stroke="#111111" strokeWidth={3 / zoom} listening={false} />
                                    <Line points={paint.outline} stroke="#ffffff" strokeWidth={1 / zoom} listening={false} />
                                </>
                            )}
                            {paint.marker && (
                                <Group x={paint.marker.x} y={paint.marker.y} listening={false}>
                                    <Circle radius={6 / zoom} stroke="#111111" strokeWidth={3 / zoom} />
                                    <Circle radius={6 / zoom} stroke="#ffffff" strokeWidth={1 / zoom} />
                                    <Line points={[-9 / zoom, 0, 9 / zoom, 0, 0, 0, 0, -9 / zoom, 0, 9 / zoom]} stroke="#ffffff" strokeWidth={1 / zoom} />
                                </Group>
                            )}
                            {warpLayer && !drawing && !panning && !isLayerLocked(warpLayer, current.layers) && (
                                <>
                                    <Line points={warpPoints.flatMap((point) => [point.x, point.y])} closed stroke="#8aab80" strokeWidth={1 / zoom} listening={false} />
                                    {warpPoints.map((point, index) => (
                                        <Circle
                                            key={index}
                                            x={point.x}
                                            y={point.y}
                                            radius={5 / zoom}
                                            fill="#ffffff"
                                            stroke="#8aab80"
                                            strokeWidth={1 / zoom}
                                            draggable
                                            onDragStart={(e) => {
                                                e.cancelBubble = true;
                                                warpEdit.current = undefined;
                                            }}
                                            onDragMove={(e) => {
                                                e.cancelBubble = true;
                                                const local = worldTransform(warpLayer, current.layers).invert().point(e.target.position()),
                                                    quad = [...warpLayer.warp!];
                                                quad[index * 2] = local.x / warpLayer.width;
                                                quad[index * 2 + 1] = local.y / warpLayer.height;
                                                try {
                                                    validateQuad(quad);
                                                    const result = { ...project, layers: project.layers.map((l) => (l.id === warpLayer.id ? { ...l, warp: quad } : l)) };
                                                    warpEdit.current = result;
                                                    setDraft(result);
                                                } catch {
                                                    e.target.position(point);
                                                }
                                            }}
                                            onDragEnd={(e) => {
                                                e.cancelBubble = true;
                                                const result = warpEdit.current;
                                                warpEdit.current = undefined;
                                                if (result) edit(() => result);
                                                setDraft(undefined);
                                            }}
                                        />
                                    ))}
                                </>
                            )}
                            <Transformer
                                ref={tr}
                                visible={!drawing && !warpLayer}
                                keepRatio={false}
                                flipEnabled={false}
                                rotateEnabled
                                borderStroke="#8aab80"
                                anchorStroke="#8aab80"
                                anchorFill="#ffffff"
                                anchorSize={8}
                                onTransform={transforming}
                                onTransformEnd={() => {
                                    const result = transforming();
                                    edit(() => result);
                                    setDraft(undefined);
                                }}
                                boundBoxFunc={(old, next) => (Math.abs(next.width) < 3 || Math.abs(next.height) < 3 ? old : next)}
                            />
                        </Group>
                        {layout.rulers && (
                            <Group listening={false}>
                                <Rect width={area.width} height={20} fill="#222630" />
                                <Rect width={20} height={area.height} fill="#222630" />
                                {Array.from({ length: Math.ceil(project.width / gridStep) + 1 }, (_, i) => (
                                    <Text key={`x${i}`} x={origin.x + i * gridStep * zoom} y={4} text={`${i * gridStep}`} fill="#b7bfcc" fontSize={10} />
                                ))}
                                {Array.from({ length: Math.ceil(project.height / gridStep) + 1 }, (_, i) => (
                                    <Text key={`y${i}`} x={4} y={origin.y + i * gridStep * zoom} text={`${i * gridStep}`} fill="#b7bfcc" fontSize={10} rotation={90} />
                                ))}
                            </Group>
                        )}
                    </CanvasLayer>
                </Stage>
            </div>
            <div className="editor-footer">
                <span title="Shift 多选 / 等比缩放 · 方向键微调 · Ctrl+D 复制 · Ctrl+G 分组">{selected.length ? `已选 ${selected.length} 个图层` : "拖入素材开始排版"}</span>
                <div>
                    <button title="缩小" onClick={() => setZoom((z) => Math.max(0.002, z / 1.15))}>
                        <ZoomOut size={15} />
                    </button>
                    <button
                        title="原始像素 · 100%"
                        onClick={() => {
                            setZoom(1);
                            setOrigin({ x: (area.width - project.width) / 2, y: (area.height - project.height) / 2 });
                        }}
                    >
                        {Math.round(zoom * 1000) / 10}%
                    </button>
                    <button title="放大" onClick={() => setZoom((z) => Math.min(16, z * 1.15))}>
                        <ZoomIn size={15} />
                    </button>
                    <button title="适合窗口" onClick={fit}>
                        <Maximize size={15} />
                    </button>
                </div>
            </div>
        </div>
    );
}
