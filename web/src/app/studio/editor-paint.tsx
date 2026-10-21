"use client";
import { useEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Dropdown, InputNumber } from "antd";
import { MoreHorizontal, Stamp } from "lucide-react";
import { useStudio } from "./store";
import { createLayer, type Layer, type StudioProject } from "./model";
import { isLayerLocked } from "./layer-operations";
import { preparePaint, paintPoint, encodeCanvas, type Point, type RasterPreview } from "./raster-paint";
import { validImageSize } from "./image-limits.js";
import { isRetouchTool, prepareRetouch } from "./raster-retouch";
import { layerPixelToWorld } from "./selection-raster";
import { smoothPoint } from "./brush-path";

type Session = {
    project: StudioProject;
    layer: Layer;
    target: "image" | "mask";
    points: Point[];
    done: boolean;
    spacing?: number;
    previous?: Point;
    start: Point;
    pointer: Point;
    anchor: Point;
    smoothing: number;
    line: boolean;
    paint?: Awaited<ReturnType<typeof preparePaint>> | Awaited<ReturnType<typeof prepareRetouch>>;
};
export function useEditorPaint(point: () => Point, notify: (text: string) => void, zoom: number, fill: () => Promise<void>) {
    const project = useStudio((s) => s.project),
        selected = useStudio((s) => s.selected);
    const [tool, setTool] = useState(""),
        [size, setSize] = useState(32),
        [hardness, setHardness] = useState(1),
        [opacity, setOpacity] = useState(1),
        [color, setColor] = useState("#334638");
    const [source, setSource] = useState<Point>(),
        [picking, setPicking] = useState(false),
        [aligned, setAligned] = useState(true),
        [blurRadius, setBlurRadius] = useState(4),
        [hover, setHover] = useState<Point>();
    const alignedOffset = useRef<Point | undefined>(undefined);
    const [smoothing, setSmoothing] = useState(0),
        [straight, setStraight] = useState(false),
        [linePreview, setLinePreview] = useState<number[]>();
    const lastStroke = useRef<{ project: StudioProject; layerId: string; target: string; point: Point } | undefined>(undefined);
    const [live, setLive] = useState<RasterPreview>();
    const [encoding, setEncoding] = useState(false);
    const session = useRef<Session | undefined>(undefined),
        frame = useRef(0);
    const cancel = () => {
        cancelAnimationFrame(frame.current);
        const old = session.current;
        session.current = undefined;
        setLive(undefined);
        setLinePreview(undefined);
        // A render using this canvas may still be awaiting image decoding.
        if (old?.paint) setTimeout(old.paint.dispose, 1000);
    };
    useEffect(() => {
        cancel();
        setTool("");
        setSource(undefined);
        setPicking(false);
        setHover(undefined);
        alignedOffset.current = undefined;
        lastStroke.current = undefined;
    }, [project.id, selected.join()]);
    useEffect(() => {
        if (session.current && session.current.project !== project) cancel();
        if (lastStroke.current && lastStroke.current.project !== project) lastStroke.current = undefined;
    }, [project]);
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                cancel();
                setTool("");
            }
        };
        window.addEventListener("keydown", escape);
        return () => {
            window.removeEventListener("keydown", escape);
            cancelAnimationFrame(frame.current);
            session.current?.paint?.dispose();
        };
    }, []);
    const commit = async () => {
        const current = session.current;
        if (!current?.paint || !current.done) return;
        if ("changed" in current.paint && !current.paint.changed()) {
            cancel();
            return;
        }
        if (useStudio.getState().project !== current.project) {
            cancel();
            return;
        }
        try {
            setEncoding(true);
            const bitmap = await current.paint.bitmap();
            if (session.current !== current || useStudio.getState().project !== current.project) return;
            useStudio.getState().edit((p) => ({
                ...p,
                layers: p.layers.map((l) => (l.id !== current.layer.id ? l : current.target === "image" ? { ...l, bitmap } : { ...l, mask: { x: 0, y: 0, width: 1, height: 1, ...l.mask, paths: undefined, bitmap, disabled: false } })),
            }));
            lastStroke.current = current.spacing ? undefined : { project: useStudio.getState().project, layerId: current.layer.id, target: current.target, point: current.pointer };
        } catch (error) {
            notify((error as Error).message);
        } finally {
            setEncoding(false);
            if (session.current === current) cancel();
        }
    };
    const flush = () => {
        const current = session.current;
        if (!current?.paint) return;
        try {
            const started = performance.now();
            while (current.points.length) {
                const p = paintPoint(current.layer, current.project, current.points[0], current.paint.canvas.width, current.paint.canvas.height, current.target);
                if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
                    current.points.shift();
                    continue;
                }
                const distance = current.previous ? Math.hypot(p.x - current.previous.x, p.y - current.previous.y) : 0;
                if (current.spacing && distance > Math.max(current.paint.canvas.width, current.paint.canvas.height) * 4) throw new Error("笔触超出图层范围，请分段操作");
                if (current.spacing && distance > current.spacing && current.previous) {
                    const ratio = current.spacing / distance;
                    current.previous = { x: current.previous.x + (p.x - current.previous.x) * ratio, y: current.previous.y + (p.y - current.previous.y) * ratio };
                } else {
                    current.points.shift();
                    current.previous = p;
                }
                current.paint.add(current.previous);
                if (performance.now() - started > 12) break;
            }
            current.paint.update();
            setLive({ layerId: current.layer.id, target: current.target, canvas: current.paint.canvas });
            if (current.points.length) frame.current = requestAnimationFrame(flush);
            else if (current.done) void commit();
        } catch (error) {
            cancel();
            notify((error as Error).message);
        }
    };
    const end = () => {
        if (!session.current || session.current.done) return;
        const current = session.current;
        if (current.line) current.points.push(current.start, current.pointer);
        else if (current.smoothing) current.points.push(current.pointer);
        session.current.done = true;
        cancelAnimationFrame(frame.current);
        flush();
    };
    useEffect(() => {
        window.addEventListener("mouseup", end);
        window.addEventListener("blur", cancel);
        return () => {
            window.removeEventListener("mouseup", end);
            window.removeEventListener("blur", cancel);
        };
    });
    const activate = async (key: string) => {
        if (encoding) return;
        cancel();
        setPicking(false);
        alignedOffset.current = undefined;
        if (key === "new") {
            if (project.layers.length >= 500) {
                notify("图层已达 500 个上限");
                return;
            }
            if (!validImageSize(project.width, project.height)) {
                notify("画布超过 1 亿像素或 30000 像素边长");
                return;
            }
            const canvas = document.createElement("canvas");
            canvas.width = project.width;
            canvas.height = project.height;
            try {
                setEncoding(true);
                const layer = { ...createLayer("image", "绘画层"), width: project.width, height: project.height, bitmap: { dataUrl: await encodeCanvas(canvas), width: canvas.width, height: canvas.height } };
                if (useStudio.getState().project !== project) return;
                useStudio.getState().edit((p) => ({ ...p, layers: [...p.layers, layer] }));
                useStudio.getState().select([layer.id]);
                setTimeout(() => setTool("brush"), 0);
            } catch (error) {
                notify((error as Error).message);
            } finally {
                canvas.width = canvas.height = 0;
                setEncoding(false);
            }
        } else setTool(key);
    };
    const items = [
        { key: "brush", label: "画笔" },
        { key: "erase", label: "橡皮" },
        { key: "mask-hide", label: "蒙版 · 隐藏" },
        { key: "mask-show", label: "蒙版 · 恢复" },
        { key: "new", label: "新建绘画层" },
    ];
    const retouchItems = [
        { key: "clone", label: "仿制图章" },
        { key: "heal", label: "修复" },
        { key: "blur", label: "模糊" },
        { key: "smudge", label: "涂抹" },
        { key: "liquify", label: "液化" },
    ];
    const retouch = isRetouchTool(tool),
        sampling = tool === "clone" || tool === "heal";
    const activeLayer = selected.length === 1 ? project.layers.find((l) => l.id === selected[0]) : undefined;
    const resolution = activeLayer && (activeLayer.bitmap || project.assets.find((a) => a.id === activeLayer.assetId));
    const toWorld = activeLayer && resolution && layerPixelToWorld(activeLayer, project, resolution.width, resolution.height);
    const localHover = activeLayer && resolution && hover && paintPoint(activeLayer, project, hover, resolution.width, resolution.height);
    const marker = source && toWorld && toWorld(alignedOffset.current && localHover ? localHover.x + alignedOffset.current.x : source.x, alignedOffset.current && localHover ? localHover.y + alignedOffset.current.y : source.y);
    const outline =
        retouch && localHover && toWorld
            ? Array.from({ length: 49 }, (_, i) => {
                  const angle = (i / 48) * Math.PI * 2,
                      p = toWorld(localHover.x + (Math.cos(angle) * size) / 2, localHover.y + (Math.sin(angle) * size) / 2);
                  return [p.x, p.y];
              }).flat()
            : undefined;
    const handlers = {
        onMouseDown: async (event: Konva.KonvaEventObject<MouseEvent>) => {
            if (!tool || event.evt.button !== 0 || session.current || encoding) return;
            event.cancelBubble = true;
            const layer = selected.length === 1 && project.layers.find((l) => l.id === selected[0]);
            const target = tool.startsWith("mask") ? "mask" : "image";
            if (!layer || isLayerLocked(layer, project.layers)) {
                notify("请先选择一个未锁定的图层");
                return;
            }
            if (target === "image" && layer.kind !== "image") {
                notify("请新建绘画层，或先将选中图层合并为图片");
                return;
            }
            let samplePoint: Point | undefined;
            if (sampling && resolution) {
                const local = paintPoint(layer, project, point(), resolution.width, resolution.height);
                if (event.evt.altKey || picking) {
                    if (local.x < 0 || local.y < 0 || local.x >= resolution.width || local.y >= resolution.height) {
                        notify("请在图片范围内取样");
                        return;
                    }
                    setSource(local);
                    alignedOffset.current = undefined;
                    setPicking(false);
                    return;
                }
                if (tool === "clone" && !source) {
                    setPicking(true);
                    notify("点击图片设置来源，再拖动进行仿制");
                    return;
                }
                if (source) {
                    if (aligned && !alignedOffset.current) alignedOffset.current = { x: source.x - local.x, y: source.y - local.y };
                    samplePoint = aligned && alignedOffset.current ? { x: local.x + alignedOffset.current.x, y: local.y + alignedOffset.current.y } : source;
                }
            }
            const pointer = point(),
                last = lastStroke.current;
            const linked = !retouch && event.evt.shiftKey && last?.project === project && last.layerId === layer.id && last.target === target;
            const line = !retouch && (straight || !!linked),
                start = linked ? last.point : pointer;
            const current: Session = {
                project,
                layer,
                target,
                points: line ? [] : [pointer],
                done: false,
                start,
                pointer,
                anchor: start,
                smoothing: !retouch && !line ? smoothing / Math.max(0.002, zoom) : 0,
                line,
                spacing: retouch ? Math.max(1, size * (tool === "smudge" ? 0.005 : tool === "liquify" ? 0.025 : 0.15)) : undefined,
            };
            session.current = current;
            if (line) setLinePreview([start.x, start.y, pointer.x, pointer.y]);
            try {
                const brush = { size, hardness, opacity, color: target === "mask" ? "#ffffff" : color, erase: tool === "erase" || tool === "mask-hide" };
                const paint = isRetouchTool(tool) ? await prepareRetouch(project, layer, { ...brush, tool, source: samplePoint, blurRadius }) : await preparePaint(project, layer, target, brush);
                if (session.current !== current) {
                    paint.dispose();
                    return;
                }
                current.paint = paint;
                flush();
            } catch (error) {
                if (session.current === current) {
                    cancel();
                    notify((error as Error).message);
                }
            }
        },
        onMouseMove: () => {
            if (retouch) setHover(point());
            if (!session.current || session.current.done) return;
            const current = session.current;
            current.pointer = point();
            if (current.line) {
                setLinePreview([current.start.x, current.start.y, current.pointer.x, current.pointer.y]);
                return;
            }
            const filtered = smoothPoint(current.anchor, current.pointer, current.smoothing);
            if (!filtered) return;
            current.anchor = filtered;
            current.points.push(filtered);
            cancelAnimationFrame(frame.current);
            frame.current = requestAnimationFrame(flush);
        },
        onMouseUp: () => {
            if (session.current) session.current.pointer = point();
            end();
        },
        onMouseLeave: () => setHover(undefined),
    };
    return {
        active: !!tool,
        tool,
        activate,
        encoding,
        live,
        handlers,
        outline,
        linePreview,
        marker: sampling ? marker : undefined,
        cancel: () => {
            cancel();
            setTool("");
        },
        trigger: (
            <Dropdown trigger={["click"]} menu={{ items, onClick: ({ key }) => activate(key) }}>
                <button aria-label="绘画工具" title="绘画层与蒙版工具">
                    <MoreHorizontal size={16} />
                </button>
            </Dropdown>
        ),
        retouchTrigger: (
            <Dropdown trigger={["click"]} menu={{ items: [...retouchItems, { key: "content-fill", label: "内容感知填充" }], selectedKeys: [tool], onClick: ({ key }) => (key === "content-fill" ? void fill() : activate(key)) }}>
                <button aria-label="修图工具" title="仿制、修复、模糊、涂抹、液化与内容感知填充" className={retouch ? "active" : ""}>
                    <Stamp size={16} />
                    <span className="retouch-label">修图</span>
                </button>
            </Dropdown>
        ),
        toolbar: tool && (
            <div className="editor-controls" aria-label="绘画选项" style={{ flexWrap: "nowrap", paddingTop: 0, paddingBottom: 0, whiteSpace: "nowrap" }}>
                <div style={{ flexShrink: 0 }}>
                    <select aria-label="画笔模式" value={tool} onChange={(e) => activate(e.target.value)}>
                        {[...items, ...retouchItems]
                            .filter((i) => i.key !== "new")
                            .map((i) => (
                                <option key={i.key} value={i.key}>
                                    {i.label}
                                </option>
                            ))}
                    </select>
                    {tool === "brush" && <input type="color" aria-label="画笔颜色" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 32 }} />}
                    <InputNumber aria-label="画笔直径" title="图层像素直径" min={1} max={1000} value={size} onChange={(v) => setSize(v || 1)} suffix="px" style={{ width: 90 }} />
                    <span>硬度</span>
                    <InputNumber aria-label="画笔硬度" min={0} max={100} value={Math.round(hardness * 100)} onChange={(v) => setHardness((v ?? 100) / 100)} suffix="%" style={{ width: 80 }} />
                    <span>{retouch ? "强度" : "不透明度"}</span>
                    <InputNumber aria-label="画笔不透明度" min={1} max={100} value={Math.round(opacity * 100)} onChange={(v) => setOpacity((v ?? 100) / 100)} suffix="%" style={{ width: 80 }} />
                    {!retouch && (
                        <>
                            <span>平滑</span>
                            <InputNumber aria-label="笔触平滑" title="屏幕像素防抖距离；0 为关闭，松手后补到终点" min={0} max={100} value={smoothing} onChange={(v) => setSmoothing(v || 0)} suffix="px" style={{ width: 76 }} />
                            <button
                                aria-label="直线绘制"
                                aria-pressed={straight}
                                className={straight ? "active" : ""}
                                title="拖动绘制直线；也可 Shift 点击连接上一笔终点"
                                onClick={() => {
                                    cancel();
                                    setStraight(!straight);
                                }}
                            >
                                直线
                            </button>
                        </>
                    )}
                    {tool === "blur" && (
                        <>
                            <span>半径</span>
                            <InputNumber aria-label="模糊半径" min={0.5} max={50} step={0.5} value={blurRadius} onChange={(v) => setBlurRadius(v || 0.5)} suffix="px" style={{ width: 80 }} />
                        </>
                    )}
                    {sampling && (
                        <>
                            <button aria-label="设置取样来源" title="也可按住 Alt 点击图片取样；只取当前图层" className={picking ? "active" : ""} onClick={() => setPicking(!picking)}>
                                {picking ? "点击图片取样" : source ? "重新取样" : tool === "heal" ? "指定来源" : "设置来源"}
                            </button>
                            {source && (
                                <button
                                    aria-label="对齐取样"
                                    aria-pressed={aligned}
                                    className={aligned ? "active" : ""}
                                    title="开启后跨笔画保持来源偏移，关闭后每笔从取样点开始"
                                    onClick={() => {
                                        setAligned(!aligned);
                                        alignedOffset.current = undefined;
                                    }}
                                >
                                    对齐
                                </button>
                            )}
                            {tool === "heal" && (
                                <button
                                    aria-label="自动修复取样"
                                    className={!source ? "active" : ""}
                                    onClick={() => {
                                        setSource(undefined);
                                        alignedOffset.current = undefined;
                                        setPicking(false);
                                    }}
                                >
                                    自动
                                </button>
                            )}
                        </>
                    )}
                </div>
                <button
                    onClick={() => {
                        cancel();
                        setTool("");
                    }}
                >
                    {encoding ? "正在保存笔触…" : retouch ? "完成修图" : "完成绘画"}
                </button>
            </div>
        ),
    };
}
