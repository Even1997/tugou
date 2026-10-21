"use client";
import type { Layer } from "./model";
import { identityQuad, validateQuad } from "./perspective";

export function WarpControls({ layer, locked, patch, notify }: { layer: Layer; locked: boolean; patch: (values: Partial<Layer>) => void; notify: (text: string) => void }) {
    if (layer.kind === "group" || layer.kind === "adjustment") return null;
    return (
        <details open={!!layer.warp}>
            <summary>四角变形</summary>
            <label className="inline">
                <input aria-label="启用四角变形" type="checkbox" checked={!!layer.warp} disabled={locked} onChange={(e) => patch({ warp: e.target.checked ? [...identityQuad] : undefined })} />
                拖动四角调整透视
            </label>
            {layer.warp && (
                <>
                    <div className="field-grid">
                        {layer.warp.map((value, i) => (
                            <label key={i}>
                                {["左上", "右上", "右下", "左下"][Math.floor(i / 2)]} {i % 2 ? "Y" : "X"} %
                                <input
                                    aria-label={`变形角${i}`}
                                    type="number"
                                    min="-200"
                                    max="300"
                                    step="1"
                                    value={Math.round(value * 100)}
                                    disabled={locked}
                                    onChange={(e) => {
                                        const quad = [...layer.warp!];
                                        quad[i] = Number(e.target.value) / 100;
                                        try {
                                            validateQuad(quad);
                                            patch({ warp: quad });
                                        } catch (error) {
                                            notify((error as Error).message);
                                        }
                                    }}
                                />
                            </label>
                        ))}
                    </div>
                    <button disabled={locked} onClick={() => patch({ warp: [...identityQuad] })}>
                        重置四角
                    </button>
                </>
            )}
        </details>
    );
}
