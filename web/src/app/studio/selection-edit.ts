import { createLayer, type DocumentSelection, type StudioProject, type Layer } from "./model";
import { decodeBitmap, encodeCanvas } from "./raster-paint";
import { selectionOnLayer, selectionSampler, layerPixelToWorld, yieldSelection } from "./selection-raster";
import { validImageSize } from "./image-limits.js";

export async function combineSelection(project: StudioProject, next: DocumentSelection, mode: string): Promise<DocumentSelection> {
    const previous = project.selection;
    if (!previous || mode === "replace") return next;
    if (previous.paths && next.paths && !previous.feather && !previous.grow && !previous.inverted && !next.feather && !next.grow && !next.inverted) {
        if (previous.paths.length + next.paths.length > 100) throw new Error("选区路径超过 100 段，请先应用为蒙版");
        return { paths: [...previous.paths, ...next.paths.map((path) => ({ ...path, operation: mode as "add" | "subtract" | "intersect" }))] };
    }
    const layer = { ...createLayer("shape", "选区"), width: project.width, height: project.height };
    const a = await selectionOnLayer(project, layer, project.width, project.height);
    let b: HTMLCanvasElement | undefined;
    try {
        b = await selectionOnLayer({ ...project, selection: next }, layer, project.width, project.height);
        const ctx = a.getContext("2d")!;
        ctx.globalCompositeOperation = mode === "subtract" ? "destination-out" : mode === "intersect" ? "destination-in" : "source-over";
        ctx.drawImage(b, 0, 0);
        return { bitmap: { dataUrl: await encodeCanvas(a), width: project.width, height: project.height } };
    } finally {
        a.width = a.height = 0;
        if (b) b.width = b.height = 0;
    }
}

export async function editSelectedPixels(project: StudioProject, layer: Layer, color?: string) {
    const source = layer.bitmap || project.assets.find((a) => a.id === layer.assetId);
    if (layer.kind !== "image" || !source || !project.selection) throw new Error("请选择图片图层并创建选区");
    const output = Object.assign(document.createElement("canvas"), { width: source.width, height: source.height });
    try {
        const ctx = output.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(await decodeBitmap(source), 0, 0);
        const sample = await selectionSampler(project.selection, project.width, project.height),
            world = layerPixelToWorld(layer, project, source.width, source.height);
        const rgb = color && [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
        for (let top = 0; top < output.height; top += 64) {
            const rows = Math.min(64, output.height - top),
                pixels = ctx.getImageData(0, top, output.width, rows);
            for (let row = 0; row < rows; row++)
                for (let x = 0; x < output.width; x++) {
                    const p = world(x + 0.5, top + row + 0.5),
                        amount = sample(p.x, p.y) / 255,
                        i = (row * output.width + x) * 4;
                    if (!amount) continue;
                    const old = pixels.data[i + 3] / 255,
                        alpha = rgb ? amount + old * (1 - amount) : old * (1 - amount);
                    if (rgb) for (let c = 0; c < 3; c++) pixels.data[i + c] = Math.round((rgb[c] * amount + pixels.data[i + c] * old * (1 - amount)) / alpha);
                    pixels.data[i + 3] = Math.round(alpha * 255);
                }
            ctx.putImageData(pixels, 0, top);
            await yieldSelection();
        }
        return { dataUrl: await encodeCanvas(output), width: output.width, height: output.height };
    } finally {
        output.width = output.height = 0;
    }
}

export async function selectionMask(project: StudioProject, layer: Layer) {
    const bitmap = layer.bitmap || project.assets.find((a) => a.id === layer.assetId);
    const width = bitmap?.width || Math.ceil(layer.width),
        height = bitmap?.height || Math.ceil(layer.height);
    if (!validImageSize(width, height)) throw new Error("蒙版尺寸超过 30000 边长或 1 亿像素");
    const surface = await selectionOnLayer(project, layer, width, height);
    try {
        return { dataUrl: await encodeCanvas(surface), width, height };
    } finally {
        surface.width = surface.height = 0;
    }
}
