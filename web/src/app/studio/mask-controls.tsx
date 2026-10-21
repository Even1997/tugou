"use client";
import type { Layer } from "./model";

export function MaskControls({ layer, locked, patch }: { layer: Layer; locked: boolean; patch: (values: Partial<Layer>) => void }) {
    const mask = layer.mask;
    return (
        <details open={!!mask}>
            <summary>图层蒙版</summary>
            <div className="inline">
                <span>{mask?.bitmap ? "像素蒙版" : mask?.paths ? `${mask.paths.length} 个选区` : mask ? "矩形蒙版" : "保留原图，控制可见范围"}</span>
                <div className="spacer" />
                <button disabled={locked} onClick={() => patch({ mask: mask ? undefined : { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } })}>
                    {mask ? "移除蒙版" : "添加蒙版"}
                </button>
            </div>
            {mask && (
                <>
                    <div className="inline">
                        <label className="inline">
                            <input aria-label="反相蒙版" type="checkbox" checked={!!mask.inverted} disabled={locked} onChange={(e) => patch({ mask: { ...mask, inverted: e.target.checked } })} />
                            反相
                        </label>
                        <label className="inline">
                            <input aria-label="启用蒙版" type="checkbox" checked={!mask.disabled} disabled={locked} onChange={(e) => patch({ mask: { ...mask, disabled: !e.target.checked } })} />
                            启用
                        </label>
                    </div>
                    <label>
                        羽化 · {mask.feather || 0} px
                        <input aria-label="蒙版羽化" type="range" min="0" max="200" value={mask.feather || 0} disabled={locked} onChange={(e) => patch({ mask: { ...mask, feather: +e.target.value } })} />
                    </label>
                    {!mask.paths && !mask.bitmap && (
                        <div className="field-grid">
                            {(["x", "y", "width", "height"] as const).map((key, i) => (
                                <label key={key}>
                                    {["左侧 %", "顶部 %", "可见宽 %", "可见高 %"][i]}
                                    <input
                                        aria-label={`蒙版${key}`}
                                        type="number"
                                        min="0"
                                        max="100"
                                        disabled={locked}
                                        value={Math.round(mask[key] * 100)}
                                        onChange={(e) => patch({ mask: { ...mask, [key]: Math.max(0, Math.min(1, +e.target.value / 100)) } })}
                                    />
                                </label>
                            ))}
                        </div>
                    )}
                </>
            )}
        </details>
    );
}
