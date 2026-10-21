"use client";
import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Image as CanvasImage, Line } from "react-konva";
import { useStudio } from "./store";
import { isLayerLocked, worldTransform } from "./layer-operations";
import type { DocumentSelection } from "./model";
import { Dropdown, InputNumber } from "antd";
import { ScanLine, MoreHorizontal } from "lucide-react";
import { inverseHomography, projectPoint } from "./perspective";
import { sampleColorSelection } from "./selection-color";
import { combineSelection, editSelectedPixels, selectionMask } from "./selection-edit";
import { encodeCanvas } from "./raster-paint";
import { selectionPreview } from "./selection-preview";

const tools = [
    { key: "rect", label: "矩形选区" },
    { key: "ellipse", label: "椭圆选区" },
    { key: "lasso", label: "自由套索" },
    { key: "polygon", label: "多边形选区" },
    { key: "wand", label: "魔棒" },
    { key: "color", label: "色彩范围" },
];
export function useEditorSelection(point: () => { x: number; y: number }, notify: (text: string) => void, contentFill: () => Promise<void>) {
    const project = useStudio((s) => s.project),
        selected = useStudio((s) => s.selected);
    const [tool, setTool] = useState(""),
        [operation, setOperation] = useState("replace"),
        [drawing, setDrawing] = useState<number[]>([]);
    const [tolerance, setTolerance] = useState(32),
        [allLayers, setAllLayers] = useState(false),
        [color, setColor] = useState("#334638");
    const [busy, setBusy] = useState(false),
        pending = useRef(0),
        [preview, setPreview] = useState<HTMLCanvasElement>();
    const selection = project.selection;
    const layer = selected.length === 1 && project.layers.find((l) => l.id === selected[0]);
    const editable = !!layer && !isLayerLocked(layer, project.layers);
    const cancel = () => {
        pending.current++;
        setBusy(false);
        setTool("");
        setDrawing([]);
    };
    useEffect(() => {
        cancel();
    }, [project.id]);
    useEffect(() => {
        let active = true;
        if (!selection || (selection.paths && !selection.feather && !selection.grow && !selection.inverted)) {
            setPreview(undefined);
            return;
        }
        selectionPreview(selection, project.width, project.height)
            .then((value) => {
                if (active) setPreview(value);
            })
            .catch((error) => {
                if (active) notify(error.message);
            });
        return () => {
            active = false;
        };
    }, [selection, project.width, project.height, notify]);
    const run = async (job: () => Promise<void>) => {
        if (busy) return;
        const id = ++pending.current;
        setBusy(true);
        try {
            await job();
        } catch (error) {
            if (pending.current === id) notify((error as Error).message);
        } finally {
            if (pending.current === id) setBusy(false);
        }
    };
    const commit = async (next: DocumentSelection) => {
        const id = pending.current,
            value = await combineSelection(project, next, operation);
        if (id === pending.current && useStudio.getState().project === project) useStudio.getState().edit((p) => ({ ...p, selection: value }));
    };
    const polygon = (points: number[]) => {
        if (tool === "lasso" || tool === "polygon") return points;
        const [x, y, x2, y2] = points,
            width = x2 - x,
            height = y2 - y;
        return tool === "ellipse"
            ? Array.from({ length: 64 }, (_, i) => {
                  const a = (i * Math.PI) / 32;
                  return [x + width / 2 + (Math.cos(a) * width) / 2, y + height / 2 + (Math.sin(a) * height) / 2];
              }).flat()
            : [x, y, x2, y, x2, y2, x, y2];
    };
    const finish = () => {
        if (drawing.length < (tool === "lasso" || tool === "polygon" ? 6 : 4)) {
            setDrawing([]);
            return;
        }
        const points = polygon(drawing);
        let area = 0;
        for (let i = 0; i < points.length; i += 2) {
            const j = (i + 2) % points.length;
            area += points[i] * points[j + 1] - points[j] * points[i + 1];
        }
        setDrawing([]);
        if (Math.abs(area) >= 1) void run(() => commit({ paths: [{ points, operation: "add" }] }));
    };
    const apply = () =>
        run(async () => {
            if (!editable || !layer || !selection) return;
            const id = pending.current;
            let mask;
            if (selection.paths && !selection.feather && !selection.grow && !selection.inverted) {
                const inverse = worldTransform(layer, project.layers).invert(),
                    perspective = layer.warp && inverseHomography(layer.warp);
                const paths = selection.paths.map((path) => ({
                    ...path,
                    points: path.points.map((_, index) => {
                        const i = index - (index % 2),
                            p = inverse.point({ x: path.points[i], y: path.points[i + 1] });
                        const uv = perspective ? projectPoint(perspective, p.x / layer.width, p.y / layer.height) : { x: p.x / layer.width, y: p.y / layer.height };
                        return index % 2 ? uv.y : uv.x;
                    }),
                }));
                if (paths.some((path) => path.points.some((n) => !Number.isFinite(n) || Math.abs(n) > 1000))) throw new Error("选区距离图层过远，请调整选区");
                mask = { x: 0, y: 0, width: 1, height: 1, paths };
            } else mask = { x: 0, y: 0, width: 1, height: 1, bitmap: await selectionMask(project, layer) };
            if (id !== pending.current || useStudio.getState().project !== project) return;
            useStudio.getState().edit((p) => ({ ...p, selection: undefined, layers: p.layers.map((l) => (l.id === layer.id ? { ...l, mask } : l)) }));
            setTool("");
            notify("已将选区应用为图层蒙版");
        });
    const pixels = (fill: boolean) =>
        run(async () => {
            if (!editable || !layer) return;
            const id = pending.current,
                bitmap = await editSelectedPixels(project, layer, fill ? color : undefined);
            if (id === pending.current && useStudio.getState().project === project) useStudio.getState().edit((p) => ({ ...p, layers: p.layers.map((l) => (l.id === layer.id ? { ...l, bitmap } : l)) }));
        });
    const change = (value: Partial<DocumentSelection>, key?: string) => {
        if (!selection || busy) return;
        useStudio.getState().edit((p) => ({ ...p, selection: { ...p.selection!, ...value } }), key);
    };
    const deselect = () => {
        cancel();
        if (useStudio.getState().project.selection) useStudio.getState().edit((p) => ({ ...p, selection: undefined }));
    };
    useEffect(() => {
        const keyboard = (e: KeyboardEvent) => {
            if ((e.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true],[data-editor-input]") || document.querySelector(".ant-modal-wrap:not([style*='display: none']),dialog[open]")) return;
            if (e.key === "Escape") {
                cancel();
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d" && selection) {
                e.preventDefault();
                e.stopImmediatePropagation();
                deselect();
            } else if ((e.key === "Delete" || e.key === "Backspace") && selection) {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (editable && layer && layer.kind === "image") void pixels(false);
                else notify("请先选择图片图层以清除选区像素");
            } else if (e.key === "Enter" && tool === "polygon") {
                e.preventDefault();
                finish();
            }
        };
        window.addEventListener("keydown", keyboard, true);
        return () => window.removeEventListener("keydown", keyboard, true);
    });
    const activate = (key: string) => {
        if (!busy) {
            setTool(key);
            setDrawing([]);
        }
    };
    const handlers = {
        onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
            if (!tool || e.evt.button !== 0 || busy) return;
            e.cancelBubble = true;
            const p = point();
            if (tool === "wand" || tool === "color") {
                if (!allLayers && !layer) {
                    notify("请先选择一个图层，或改为所有可见图层取样");
                    return;
                }
                void run(async () => {
                    const id = pending.current,
                        result = await sampleColorSelection(project, p.x, p.y, tolerance, tool === "wand", allLayers ? undefined : layer ? layer.id : undefined, () => id !== pending.current || useStudio.getState().project !== project);
                    try {
                        const dataUrl = await encodeCanvas(result);
                        if (id === pending.current) await commit({ bitmap: { dataUrl, width: project.width, height: project.height } });
                    } finally {
                        result.width = result.height = 0;
                    }
                });
            } else setDrawing((old) => (tool === "polygon" ? [...old, p.x, p.y].slice(0, 20000) : [p.x, p.y, p.x, p.y]));
        },
        onMouseMove: () => {
            if (!tool || tool === "polygon" || !drawing.length || busy) return;
            const p = point();
            setDrawing((old) => (tool === "lasso" ? (Math.hypot(p.x - old.at(-2)!, p.y - old.at(-1)!) > 2 ? [...old, p.x, p.y].slice(0, 20000) : old) : [old[0], old[1], p.x, p.y]));
        },
        onMouseUp: () => {
            if (tool && tool !== "polygon" && drawing.length) finish();
        },
        onDblClick: () => {
            if (tool === "polygon") finish();
        },
    };
    const trigger = (
        <Dropdown trigger={["click"]} menu={{ items: tools, onClick: ({ key }) => activate(key) }}>
            <button aria-label="创建选区" title="选区" className={tool ? "active" : ""}>
                <ScanLine size={16} />
            </button>
        </Dropdown>
    );
    const toolbar = tool && (
        <div className="editor-controls" aria-label="选区工具">
            <div>
                <select aria-label="选区类型" value={tool} disabled={busy} onChange={(e) => activate(e.target.value)}>
                    {tools.map((t) => (
                        <option key={t.key} value={t.key}>
                            {t.label}
                        </option>
                    ))}
                </select>
                <select aria-label="选区组合" value={operation} disabled={busy} onChange={(e) => setOperation(e.target.value)}>
                    <option value="replace">新建</option>
                    <option value="add">添加</option>
                    <option value="subtract">减去</option>
                    <option value="intersect">交集</option>
                </select>
                {["wand", "color"].includes(tool) ? (
                    <>
                        <span>容差</span>
                        <InputNumber aria-label="选区容差" min={0} max={255} value={tolerance} disabled={busy} onChange={(v) => setTolerance(v ?? 0)} style={{ width: 70 }} />
                        <select aria-label="选区取样来源" value={allLayers ? "all" : "layer"} disabled={busy} onChange={(e) => setAllLayers(e.target.value === "all")}>
                            <option value="layer">当前图层</option>
                            <option value="all">所有可见图层</option>
                        </select>
                    </>
                ) : (
                    <>
                        <span>羽化</span>
                        <InputNumber aria-label="选区羽化" min={0} max={100} value={selection?.feather || 0} disabled={!selection || busy} onChange={(v) => change({ feather: v || 0 }, "selection-feather")} suffix="px" style={{ width: 82 }} />
                        <span>扩缩</span>
                        <InputNumber aria-label="选区扩缩" min={-100} max={100} precision={0} value={selection?.grow || 0} disabled={!selection || busy} onChange={(v) => change({ grow: v || 0 }, "selection-grow")} suffix="px" style={{ width: 82 }} />
                    </>
                )}
            </div>
            <div>
                {tool === "polygon" && (
                    <button disabled={drawing.length < 6 || busy} onClick={finish}>
                        闭合选区
                    </button>
                )}
                <button disabled={!selection || !editable || busy} onClick={() => void apply()}>
                    {busy ? "处理中…" : "应用为蒙版"}
                </button>
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "invert", label: "反选", disabled: !selection || busy },
                            { key: "refine", label: "羽化与扩缩", disabled: !selection || busy },
                            { key: "fill", label: "填充选区", disabled: !selection || !editable || !layer || layer.kind !== "image" || busy },
                            { key: "content-fill", label: "内容感知填充", disabled: !selection || !editable || !layer || layer.kind !== "image" || busy },
                            { key: "clear", label: "清除选区像素", disabled: !selection || !editable || !layer || layer.kind !== "image" || busy },
                            { key: "all", label: "全选", disabled: busy },
                            { key: "none", label: "取消选区 · Ctrl+D", disabled: !selection || busy },
                        ],
                        onClick: ({ key }) => {
                            if (key === "invert") change({ inverted: !selection?.inverted });
                            else if (key === "refine") setTool("rect");
                            else if (key === "fill" || key === "clear") void pixels(key === "fill");
                            else if (key === "content-fill") void contentFill();
                            else if (key === "all") useStudio.getState().edit((p) => ({ ...p, selection: { paths: [{ points: [0, 0, p.width, 0, p.width, p.height, 0, p.height], operation: "add" }] } }));
                            else deselect();
                        },
                    }}
                >
                    <button aria-label="选区操作">
                        <MoreHorizontal size={16} />
                    </button>
                </Dropdown>
                <input aria-label="选区填充颜色" title="选区填充颜色" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 28 }} />
                <button onClick={cancel}>完成</button>
            </div>
        </div>
    );
    const paths = selection?.paths && !preview ? selection.paths : [];
    const overlay = (
        <>
            {selection && preview && <CanvasImage image={preview} x={0} y={0} width={project.width} height={project.height} opacity={0.3} listening={false} />}
            {[...paths, ...(drawing.length >= 4 ? [{ points: polygon(drawing), operation: "add" as const }] : [])].map((path, i) => (
                <Line
                    key={i}
                    points={path.points}
                    closed
                    stroke={path.operation === "subtract" ? "#e3a18c" : "#76bbdf"}
                    strokeWidth={1}
                    strokeScaleEnabled={false}
                    dash={[5, 4]}
                    fill={path.operation === "subtract" ? "#e3a18c18" : "#76bbdf18"}
                    listening={false}
                />
            ))}
        </>
    );
    return { active: !!tool, trigger, toolbar, overlay, handlers, cancel };
}
