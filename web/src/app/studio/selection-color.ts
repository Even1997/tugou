import type { StudioProject } from "./model";
import { renderProject } from "./editor-renderer";
import { connectedCoverage } from "./selection-pixels";
import { yieldSelection } from "./selection-raster";
const canvas = (width: number, height: number) => Object.assign(document.createElement("canvas"), { width, height });
export async function sampleColorSelection(project: StudioProject, x: number, y: number, tolerance: number, contiguous: boolean, layerId?: string, cancelled = () => false) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= project.width || y >= project.height) throw new Error("请在画布内取样");
    const options = { transparent: !!layerId, ...(layerId && { only: [layerId] }) };
    const seed = await renderProject(project, { ...options, region: { x, y, width: 1, height: 1 } });
    const color = seed.getContext("2d")!.getImageData(0, 0, 1, 1).data;
    seed.width = seed.height = 0;
    const width = project.width,
        height = project.height;
    let coverage = new Uint8Array(width * height);
    for (let top = 0; top < height; top += 64) {
        if (cancelled()) throw new Error("已取消选区");
        const rows = Math.min(64, height - top),
            stripe = await renderProject(project, { ...options, region: { x: 0, y: top, width, height: rows } });
        try {
            const rgba = stripe.getContext("2d")!.getImageData(0, 0, width, rows).data;
            for (let i = 0; i < width * rows; i++) {
                const at = i * 4,
                    a = rgba[at + 3],
                    distance = Math.max(Math.abs(a - color[3]), Math.abs((a ? rgba[at] : 0) - (color[3] ? color[0] : 0)), Math.abs((a ? rgba[at + 1] : 0) - (color[3] ? color[1] : 0)), Math.abs((a ? rgba[at + 2] : 0) - (color[3] ? color[2] : 0)));
                coverage[top * width + i] = distance <= tolerance ? 255 : 0;
            }
        } finally {
            stripe.width = stripe.height = 0;
        }
        await yieldSelection();
    }
    if (contiguous) coverage = connectedCoverage(coverage, width, height, y * width + x);
    const result = canvas(width, height),
        ctx = result.getContext("2d")!;
    for (let top = 0; top < height; top += 64) {
        const rows = Math.min(64, height - top),
            pixels = ctx.createImageData(width, rows);
        for (let i = 0; i < width * rows; i++) {
            pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
            pixels.data[i * 4 + 3] = coverage[top * width + i];
        }
        ctx.putImageData(pixels, 0, top);
    }
    return result;
}
