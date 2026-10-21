"use client";
import { InputNumber, Dropdown } from "antd";
import { MoreHorizontal } from "lucide-react";
import Konva from "konva";
import { useStudio } from "./store";
import { validateProject, type Layer, type LayerMask } from "./model";
import { isLayerLocked, worldTransform } from "./layer-operations";
import { homography, projectPoint, type Quad } from "./perspective";

export function MaskToolbar({ close, notify }: { close: () => void; notify: (message: string) => void }) {
    const p = useStudio((s) => s.project),
        ids = useStudio((s) => s.selected);
    const layer = ids.length === 1 ? p.layers.find((l) => l.id === ids[0]) : undefined;
    const disabled = !layer || isLayerLocked(layer, p.layers),
        mask = layer?.mask;
    const offset = mask?.offset || { x: 0, y: 0, rotation: 0, scale: 1 };
    const patch = (values: Partial<Layer>, key?: string) => {
        if (!layer || disabled) return;
        try {
            const next = { ...p, layers: p.layers.map((l) => (l.id === layer.id ? { ...l, ...values } : l)) };
            validateProject(next);
            useStudio.getState().edit(() => next, key && `${layer.id}:mask:${key}`);
        } catch (error) {
            notify((error as Error).message);
        }
    };
    const update = (values: Partial<LayerMask>, key?: string) => mask && patch({ mask: { ...mask, ...values } }, key);
    const detach = () => {
        if (!layer || !mask) return;
        const transform = worldTransform(layer, p.layers),
            shift = new Konva.Transform()
                .translate(offset.x, offset.y)
                .rotate((offset.rotation * Math.PI) / 180)
                .scale(offset.scale, offset.scale);
        let warp = layer.warp;
        if (warp) {
            const matrix = homography(warp);
            warp = [0, 0, 1, 0, 1, 1, 0, 1].map((_, i, points) => {
                const at = i - (i % 2),
                    a = shift.point({ x: points[at] * layer.width, y: points[at + 1] * layer.height });
                const b = projectPoint(matrix, a.x / layer.width, a.y / layer.height);
                return i % 2 ? b.y : b.x;
            }) as Quad;
        } else transform.multiply(shift);
        update({ anchor: { matrix: transform.getMatrix(), width: layer.width, height: layer.height, ...(warp && { warp }) }, offset: undefined });
    };
    return (
        <div className="editor-controls" aria-label="蒙版工具">
            <div>
                {!mask ? (
                    <button disabled={disabled} onClick={() => patch({ mask: { x: 0, y: 0, width: 1, height: 1 } })}>
                        添加蒙版
                    </button>
                ) : (
                    <>
                        <span>{mask.anchor ? "独立蒙版" : "随图层移动"}</span>
                        {(["x", "y", "rotation", "scale"] as const).map((key, i) => (
                            <label key={key} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 6, margin: 0, whiteSpace: "nowrap" }}>
                                {["X", "Y", "角度", "缩放"][i]}
                                <InputNumber
                                    aria-label={`蒙版变换${key}`}
                                    value={key === "scale" ? Math.round(offset[key] * 100) : offset[key]}
                                    min={key === "scale" ? 1 : key === "rotation" ? -36000 : -100000}
                                    max={key === "scale" ? 10000 : key === "rotation" ? 36000 : 100000}
                                    disabled={disabled}
                                    onChange={(v) => update({ offset: { ...offset, [key]: key === "scale" ? (v || 100) / 100 : v || 0 } }, key)}
                                    style={{ width: 78 }}
                                />
                            </label>
                        ))}
                    </>
                )}
            </div>
            <div>
                <select
                    aria-label="实时蒙版来源"
                    title="使用来源图层自身的透明度；隐藏来源仍可作为蒙版"
                    value={layer?.maskSourceId || ""}
                    disabled={disabled || layer?.kind === "group" || layer?.kind === "adjustment"}
                    onChange={(e) => patch({ maskSourceId: e.target.value || undefined })}
                    style={{ maxWidth: 150 }}
                >
                    <option value="">不引用其他图层</option>
                    {p.layers
                        .filter((l) => l.id !== layer?.id && l.kind !== "group" && l.kind !== "adjustment")
                        .map((l) => (
                            <option key={l.id} value={l.id}>
                                {l.name}
                            </option>
                        ))}
                </select>
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        items: [
                            { key: "detach", label: "取消链接 · 独立定位", disabled: !mask || !!mask.anchor || disabled },
                            { key: "reset", label: "恢复随动并重置位置", disabled: !mask || disabled },
                            { key: "invert", label: "反相蒙版", disabled: !mask || disabled },
                            { key: "toggle", label: mask?.disabled ? "启用蒙版" : "停用蒙版", disabled: !mask || disabled },
                            { key: "remove", label: "移除蒙版", disabled: !mask || disabled },
                        ],
                        onClick: ({ key }) => {
                            if (key === "detach") detach();
                            else if (key === "reset") update({ anchor: undefined, offset: undefined });
                            else if (key === "invert") update({ inverted: !mask?.inverted });
                            else if (key === "toggle") update({ disabled: !mask?.disabled });
                            else patch({ mask: undefined });
                        },
                    }}
                >
                    <button aria-label="蒙版操作">
                        <MoreHorizontal size={16} />
                    </button>
                </Dropdown>
                <button onClick={close}>完成</button>
            </div>
        </div>
    );
}
