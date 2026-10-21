import type { DocumentSelection } from "./model";
import { selectionSampler } from "./selection-raster";

/** The overlay is a display aid; all edits sample the original-resolution selection. */
export async function selectionPreview(selection: DocumentSelection, width: number, height: number) {
    const scale = Math.min(1, 800 / Math.max(width, height));
    const output = Object.assign(document.createElement("canvas"), { width: Math.ceil(width * scale), height: Math.ceil(height * scale) });
    const sample = await selectionSampler(
        {
            ...selection,
            paths: selection.paths?.map((path) => ({ ...path, points: path.points.map((n) => n * scale) })),
            feather: (selection.feather || 0) * scale,
            grow: Math.round((selection.grow || 0) * scale),
        },
        output.width,
        output.height,
    );
    const ctx = output.getContext("2d")!,
        pixels = ctx.createImageData(output.width, output.height);
    for (let y = 0; y < output.height; y++)
        for (let x = 0; x < output.width; x++) {
            const i = (y * output.width + x) * 4;
            pixels.data[i] = 118;
            pixels.data[i + 1] = 187;
            pixels.data[i + 2] = 223;
            pixels.data[i + 3] = sample(x, y);
        }
    ctx.putImageData(pixels, 0, 0);
    return output;
}
