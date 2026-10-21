import type { Layer, StudioProject } from "./model";
import { decodeBitmap, encodeCanvas, paintPoint } from "./raster-paint";
import { layerPixelToWorld, selectionSampler, yieldSelection } from "./selection-raster";
import { MAX_FILL_PIXELS } from "./content-fill-pixels";
import { validImageSize } from "./image-limits.js";

export async function contentAwareFill(project: StudioProject, layer: Layer, signal: AbortSignal, progress: (value: number) => void) {
    const source = layer.bitmap || project.assets.find((a) => a.id === layer.assetId),
        selection = project.selection;
    if (layer.kind !== "image" || !source || !selection) throw new Error("请选择图片图层并创建选区");
    if (!validImageSize(source.width, source.height)) throw new Error("当前图层超过 1 亿像素或 30000 像素边长");
    const check = () => signal.throwIfAborted();
    const { width, height } = source,
        sample = await selectionSampler(selection, project.width, project.height),
        world = layerPixelToWorld(layer, project, width, height);
    check();
    let left = 0,
        top = 0,
        right = width,
        bottom = height;
    // An affine image permits a tight scan of the path bounds. Warped, bitmap,
    // or inverted selections use the same exact sampler over the entire image.
    if (selection.paths?.length && !selection.inverted && !layer.warp) {
        let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
        for (const path of selection.paths)
            for (let i = 0; i < path.points.length; i += 2) {
                minX = Math.min(minX, path.points[i]);
                maxX = Math.max(maxX, path.points[i]);
                minY = Math.min(minY, path.points[i + 1]);
                maxY = Math.max(maxY, path.points[i + 1]);
            }
        const pad = (selection.feather || 0) * 3 + Math.abs(selection.grow || 0) + 3;
        const x0 = minX - pad,
            y0 = minY - pad,
            x1 = maxX + pad,
            y1 = maxY + pad;
        const local = [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
        ].map(([x, y]) => paintPoint(layer, project, { x, y }, width, height));
        left = Math.max(0, Math.floor(Math.min(...local.map((p) => p.x))));
        top = Math.max(0, Math.floor(Math.min(...local.map((p) => p.y))));
        right = Math.min(width, Math.ceil(Math.max(...local.map((p) => p.x))));
        bottom = Math.min(height, Math.ceil(Math.max(...local.map((p) => p.y))));
    }
    let x0 = width,
        y0 = height,
        x1 = 0,
        y1 = 0;
    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            const p = world(x + 0.5, y + 0.5);
            if (sample(p.x, p.y)) {
                x0 = Math.min(x0, x);
                y0 = Math.min(y0, y);
                x1 = Math.max(x1, x + 1);
                y1 = Math.max(y1, y + 1);
            }
        }
        if ((y - top) % 32 === 0) {
            progress((0.08 * (y - top)) / Math.max(1, bottom - top));
            await yieldSelection();
            check();
        }
        if (x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) > MAX_FILL_PIXELS) throw new Error("选区超过局部填充预算，请缩小选区或分区填充");
    }
    if (x1 <= x0 || y1 <= y0) throw new Error("选区没有覆盖当前图片");
    const padding = Math.min(512, Math.max(64, x1 - x0, y1 - y0));
    x0 = Math.max(0, x0 - padding);
    y0 = Math.max(0, y0 - padding);
    x1 = Math.min(width, x1 + padding);
    y1 = Math.min(height, y1 + padding);
    const w = x1 - x0,
        h = y1 - y0;
    if (w * h > MAX_FILL_PIXELS) throw new Error("填充及周边取样超过 400 万像素预算，请缩小选区或分区填充");
    const coverage = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = world(x + x0 + 0.5, y + y0 + 0.5);
            coverage[y * w + x] = sample(p.x, p.y);
        }
        if (y % 32 === 0) {
            await yieldSelection();
            check();
        }
    }
    const image = await decodeBitmap(source);
    check();
    const crop = Object.assign(document.createElement("canvas"), { width: w, height: h });
    const output = document.createElement("canvas");
    try {
        const ctx = crop.getContext("2d", { willReadFrequently: true })!;
        ctx.drawImage(image, x0, y0, w, h, 0, 0, w, h);
        const original = ctx.getImageData(0, 0, w, h);
        progress(0.1);
        const pixels = await new Promise<Uint8ClampedArray>((resolve, reject) => {
            const worker = new Worker(new URL("./content-fill.worker.ts", import.meta.url));
            const close = () => {
                worker.terminate();
                signal.removeEventListener("abort", abort);
            };
            const abort = () => {
                close();
                reject(signal.reason);
            };
            worker.onmessage = ({ data }) => {
                if (data.error) {
                    close();
                    reject(new Error(data.error));
                } else if (data.pixels) {
                    close();
                    resolve(data.pixels);
                } else progress(0.1 + data.progress * 0.8);
            };
            worker.onerror = () => {
                close();
                reject(new Error("填充线程运行失败，原图未改变"));
            };
            signal.addEventListener("abort", abort, { once: true });
            const rgba = original.data.slice(),
                mask = coverage.slice();
            worker.postMessage({ rgba, coverage: mask, width: w, height: h }, [rgba.buffer, mask.buffer]);
        });
        check();
        for (let p = 0; p < coverage.length; p++) {
            if (!coverage[p]) continue;
            const i = p * 4,
                amount = coverage[p] / 255,
                old = original.data[i + 3] / 255,
                next = pixels[i + 3] / 255,
                alpha = next * amount + old * (1 - amount);
            for (let k = 0; k < 3; k++) original.data[i + k] = alpha ? (pixels[i + k] * next * amount + original.data[i + k] * old * (1 - amount)) / alpha : 0;
            original.data[i + 3] = alpha * 255;
        }
        output.width = width;
        output.height = height;
        const out = output.getContext("2d")!;
        out.drawImage(image, 0, 0);
        out.putImageData(original, x0, y0);
        progress(0.95);
        await yieldSelection();
        check();
        const dataUrl = await encodeCanvas(output);
        check();
        return { dataUrl, width, height };
    } finally {
        crop.width = crop.height = output.width = output.height = 0;
    }
}
