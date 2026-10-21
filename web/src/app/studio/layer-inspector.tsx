"use client";
import { useStudio } from "./store";
import { blendModes, type Layer } from "./model";
import { alignLayers, isLayerLocked, ungroupLayer } from "./layer-operations";
import { MaskControls } from "./mask-controls";
import { WarpControls } from "./warp-controls";
import { MAX_IMAGE_EDGE, validImageSize } from "./image-limits.js";
import { FlipHorizontal, AlignCenter } from "lucide-react";
import { useEffect, useState } from "react";

function CanvasDimension({ dimension, notify }: { dimension: "width" | "height"; notify: (message: string) => void }) {
    const p = useStudio((s) => s.project),
        edit = useStudio((s) => s.edit);
    const [value, setValue] = useState(String(p[dimension]));
    useEffect(() => setValue(String(p[dimension])), [p.id, p[dimension]]);
    const commit = () => {
        const number = Number(value);
        if (number >= 64 && validImageSize(number, p[dimension === "width" ? "height" : "width"])) {
            if (number !== p[dimension]) edit((p) => ({ ...p, selection: undefined, [dimension]: number }));
        } else {
            notify("边长需为 64–30,000 的整数，总像素不超过 1 亿");
            setValue(String(p[dimension]));
        }
    };
    return (
        <label>
            {dimension === "width" ? "宽度" : "高度"}
            <input
                aria-label={dimension === "width" ? "画布宽度" : "画布高度"}
                type="number"
                min={64}
                max={MAX_IMAGE_EDGE}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                }}
            />
        </label>
    );
}

export function Inspector({ notify }: { notify: (text: string) => void }) {
    const p = useStudio((s) => s.project);
    const selected = useStudio((s) => s.selected);
    const edit = useStudio((s) => s.edit);
    const l = selected.length === 1 ? p.layers.find((l) => l.id === selected[0]) : undefined;
    const locked = !!l && isLayerLocked(l, p.layers);
    const patch = (values: Partial<Layer>) => l && !locked && edit((p) => ({ ...p, layers: p.layers.map((n) => (n.id === l.id ? { ...n, ...values } : n)) }), `${l.id}:${Object.keys(values).join()}`);
    const alignment = selected.length > 0 && (
        <div className="field-grid">
            {(["left", "center", "right", "top", "middle", "bottom", "horizontal", "vertical"] as const).map((key, i) => (
                <button key={key} disabled={i > 5 && selected.length < 3} onClick={() => edit((p) => alignLayers(p, selected, key))}>
                    {["左对齐", "水平居中", "右对齐", "顶对齐", "垂直居中", "底对齐", "水平等距", "垂直等距"][i]}
                </button>
            ))}
        </div>
    );
    if (selected.length > 1)
        return (
            <section className="inspector">
                <div className="panel-heading">
                    <strong>对齐与分布</strong>
                    <span>{selected.length} 个图层</span>
                </div>
                {alignment}
            </section>
        );
    if (!l)
        return (
            <section className="inspector">
                <div className="panel-heading">
                    <strong>画布设置</strong>
                </div>
                <label>
                    工程名称
                    <input value={p.name} onChange={(e) => edit((p) => ({ ...p, name: e.target.value }))} />
                </label>
                <div className="field-grid">
                    {(["width", "height"] as const).map((dimension) => (
                        <CanvasDimension key={dimension} dimension={dimension} notify={notify} />
                    ))}
                </div>
                <label>
                    画布底色
                    <div className="inline">
                        <input aria-label="画布底色" type="color" value={p.background === "transparent" ? "#ffffff" : p.background} onChange={(e) => edit((p) => ({ ...p, background: e.target.value }))} />
                        <button onClick={() => edit((p) => ({ ...p, background: p.background === "transparent" ? "#fffdf8" : "transparent" }))}>{p.background === "transparent" ? "当前透明底" : "设为透明"}</button>
                    </div>
                </label>
            </section>
        );
    const numeric = (key: "x" | "y" | "width" | "height" | "rotation", label: string) => (
        <label key={key}>
            {label}
            <input
                aria-label={label}
                type="number"
                value={Math.round(l[key] * (l.kind === "group" && key === "width" ? Math.abs(l.scaleX ?? 1) : l.kind === "group" && key === "height" ? Math.abs(l.scaleY ?? 1) : 1))}
                disabled={locked}
                onChange={(e) => {
                    const value = Number(e.target.value);
                    if (Number.isFinite(value) && Math.abs(value) <= 100000 && (!(key === "width" || key === "height") || value > 0)) {
                        if (l.kind === "group" && (key === "width" || key === "height")) patch({ [key === "width" ? "scaleX" : "scaleY"]: value / l[key] });
                        else patch({ [key]: value });
                    }
                }}
            />
        </label>
    );
    return (
        <section className="inspector">
            <div className="panel-heading">
                <strong>图层属性</strong>
                <span className="count">{l.kind === "text" ? "文字" : l.kind === "group" ? "分组" : l.kind === "shape" ? "形状" : l.kind === "adjustment" ? "调整" : "图片"}</span>
            </div>
            <label>
                名称
                <input aria-label="图层名称" value={l.name} disabled={locked} onChange={(e) => patch({ name: e.target.value })} />
            </label>
            {l.bitmap && l.assetId && (
                <button disabled={locked} onClick={() => patch({ bitmap: undefined })}>
                    还原素材原图
                </button>
            )}
            {l.kind !== "adjustment" && <div className="field-grid">
                {numeric("x", "X 位置")}
                {numeric("y", "Y 位置")}
                {
                    <>
                        {numeric("width", "宽度")}
                        {numeric("height", "高度")}
                        {numeric("rotation", "旋转角度")}
                    </>
                }
            </div>}
            <label>
                不透明度 <span>{Math.round(l.opacity * 100)}%</span>
                <input aria-label="不透明度" type="range" min={0} max={100} value={Math.round(l.opacity * 100)} disabled={l.locked} onChange={(e) => patch({ opacity: +e.target.value / 100 })} />
            </label>
            <label>
                混合模式
                <select aria-label="混合模式" value={l.blend} disabled={locked} onChange={(e) => patch({ blend: e.target.value as Layer["blend"] })}>
                    {blendModes.map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </select>
            </label>
            <label className="inline">
                <input type="checkbox" checked={!!l.clipping} disabled={locked} onChange={(e) => patch({ clipping: e.target.checked })} />
                剪贴到下方图层
            </label>
            {l.kind !== "adjustment" && <details>
                <summary>对齐与自由变换</summary>
                {alignment}
                <div className="field-grid">
                    {(["scaleX", "scaleY", "skewX"] as const).map((key, i) => (
                        <label key={key}>
                            {["水平缩放", "垂直缩放", "水平倾斜"][i]}
                            <input
                                aria-label={["水平缩放", "垂直缩放", "水平倾斜"][i]}
                                type="number"
                                step=".1"
                                disabled={locked}
                                value={l[key] ?? (i === 2 ? 0 : 1)}
                                onChange={(e) => {
                                    const value = Number(e.target.value);
                                    if (Number.isFinite(value) && Math.abs(value) <= 100 && (i === 2 || Math.abs(value) >= 0.001)) patch({ [key]: value });
                                }}
                            />
                        </label>
                    ))}
                </div>
                <button disabled={locked} onClick={() => patch({ flipY: !l.flipY })}>
                    垂直翻转
                </button>
            </details>}
            {l.kind !== "group" && l.kind !== "adjustment" && (
                <div className="inline">
                    <button disabled={l.locked} onClick={() => patch({ flipX: !l.flipX })}>
                        <FlipHorizontal size={14} />
                        水平翻转
                    </button>
                    <button disabled={locked} onClick={() => edit((p) => alignLayers(p, [l.id], "center"))}>
                        <AlignCenter size={14} />
                        水平居中
                    </button>
                </div>
            )}
            {l.kind === "text" && (
                <>
                    <label>
                        文字内容
                        <textarea aria-label="文字内容" rows={3} value={l.text} disabled={l.locked} onChange={(e) => patch({ text: e.target.value })} />
                    </label>
                    <div className="field-grid">
                        <label>
                            字号
                            <input aria-label="字号" type="number" min={1} max={1000} value={l.fontSize} onChange={(e) => +e.target.value > 0 && +e.target.value <= 1000 && patch({ fontSize: +e.target.value })} />
                        </label>
                        <label>
                            文字颜色
                            <input aria-label="文字颜色" type="color" value={l.color || "#45604b"} onChange={(e) => patch({ color: e.target.value })} />
                        </label>
                    </div>
                    <label>
                        字体
                        <select value={l.fontFamily || "Microsoft YaHei"} onChange={(e) => patch({ fontFamily: e.target.value })}>
                            <option>Microsoft YaHei</option>
                            <option>SimSun</option>
                            <option>Georgia</option>
                            <option>Arial</option>
                        </select>
                    </label>
                    <label>
                        段落对齐
                        <select aria-label="段落对齐" value={l.align || "center"} onChange={(e) => patch({ align: e.target.value as Layer["align"] })}>
                            {["left", "center", "right", "justify"].map((key, i) => (
                                <option key={key} value={key}>
                                    {["左对齐", "居中", "右对齐", "两端对齐"][i]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className="field-grid">
                        <label>
                            行距
                            <input
                                aria-label="行距"
                                type="number"
                                step=".1"
                                min=".5"
                                max="5"
                                value={l.lineHeight ?? 1.3}
                                onChange={(e) => {
                                    const n = +e.target.value;
                                    if (n >= 0.5 && n <= 5) patch({ lineHeight: n });
                                }}
                            />
                        </label>
                        <label>
                            字距
                            <input
                                aria-label="字距"
                                type="number"
                                min="-50"
                                max="200"
                                value={l.letterSpacing ?? 0}
                                onChange={(e) => {
                                    const n = +e.target.value;
                                    if (n >= -50 && n <= 200) patch({ letterSpacing: n });
                                }}
                            />
                        </label>
                    </div>
                    <label>
                        字形
                        <select aria-label="字形" value={l.fontStyle || "normal"} onChange={(e) => patch({ fontStyle: e.target.value as Layer["fontStyle"] })}>
                            {["normal", "bold", "italic", "bold italic"].map((key, i) => (
                                <option key={key} value={key}>
                                    {["常规", "粗体", "斜体", "粗斜体"][i]}
                                </option>
                            ))}
                        </select>
                    </label>
                </>
            )}
            {l.kind === "shape" && (
                <>
                    <div className="field-grid">
                        <label>
                            填充颜色
                            <input aria-label="填充颜色" type="color" value={l.color || "#8aab80"} onChange={(e) => patch({ color: e.target.value })} />
                        </label>
                        <label>
                            描边颜色
                            <input aria-label="描边颜色" type="color" value={l.stroke || "#334638"} onChange={(e) => patch({ stroke: e.target.value })} />
                        </label>
                        <label>
                            描边宽度
                            <input aria-label="描边宽度" type="number" min="0" max="500" value={l.strokeWidth || 0} onChange={(e) => patch({ strokeWidth: Math.max(0, Math.min(500, +e.target.value)) })} />
                        </label>
                        {l.shape === "rect" && (
                            <label>
                                圆角
                                <input aria-label="圆角" type="number" min="0" max="10000" value={l.radius || 0} onChange={(e) => patch({ radius: Math.max(0, Math.min(10000, +e.target.value)) })} />
                            </label>
                        )}
                    </div>
                    <label className="inline">
                        <input type="checkbox" checked={!!l.gradient} onChange={(e) => patch({ gradient: e.target.checked ? { endColor: "#fffdf8", angle: 90 } : undefined })} />
                        渐变填充
                    </label>
                    {l.gradient && (
                        <div className="field-grid">
                            <label>
                                结束颜色
                                <input aria-label="渐变结束颜色" type="color" value={l.gradient.endColor} onChange={(e) => patch({ gradient: { ...l.gradient!, endColor: e.target.value } })} />
                            </label>
                            <label>
                                渐变角度
                                <input aria-label="渐变角度" type="number" min="-360" max="360" value={l.gradient.angle} onChange={(e) => patch({ gradient: { ...l.gradient!, angle: Math.max(-360, Math.min(360, +e.target.value)) } })} />
                            </label>
                        </div>
                    )}
                </>
            )}
            <MaskControls layer={l} locked={locked} patch={patch} />
            <WarpControls layer={l} locked={locked} patch={patch} notify={notify} />
            {l.kind === "group" && (
                <button
                    disabled={locked}
                    onClick={() => {
                        try {
                            edit((p) => ungroupLayer(p, l.id));
                            useStudio.getState().select([]);
                        } catch (e) {
                            notify((e as Error).message);
                        }
                    }}
                >
                    解除分组
                </button>
            )}
        </section>
    );
}
