import type { Layer, RasterBitmap, StudioProject } from "./model";
import { decodeBitmap, encodeCanvas, type Brush, type Point } from "./raster-paint";
import { selectionSampler, layerPixelToWorld } from "./selection-raster";
import { bilinear, falloff, healingCorrection, premultiply, writePixel } from "./retouch-pixels";
import { validImageSize } from "./image-limits.js";

export type RetouchTool = "clone" | "heal" | "blur" | "smudge" | "liquify";
export const isRetouchTool = (tool: string): tool is RetouchTool => ["clone", "heal", "blur", "smudge", "liquify"].includes(tool);
export type RetouchBrush = Brush & { tool: RetouchTool; source?: Point; blurRadius: number };
export async function prepareRetouch(project: StudioProject, layer: Layer, brush: RetouchBrush) {
    const bitmap = layer.bitmap || project.assets.find((a) => a.id === layer.assetId);
    if (!bitmap || !validImageSize(bitmap.width, bitmap.height)) throw new Error("请先选择有图片的图层");
    const { width, height } = bitmap,
        image = await decodeBitmap(bitmap);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext("2d", { willReadFrequently: true })!;
    c.drawImage(image, 0, 0);
    const scratch = document.createElement("canvas"),
        ctx = scratch.getContext("2d", { willReadFrequently: true })!;
    const radius = Math.max(0.5, brush.size / 2),
        r = Math.ceil(radius),
        side = r * 2 + 1;
    const coverage = new Map<string, Uint8Array>();
    let carried: Float32Array | undefined, previous: Point | undefined, offset: Point | undefined;
    let changed = false,
        peakPatchBytes = 0;
    const dispose = () => {
        canvas.width = canvas.height = scratch.width = scratch.height = 0;
        coverage.clear();
        carried = undefined;
        image.src = "";
    };
    try {
        const selection = project.selection && (await selectionSampler(project.selection, project.width, project.height));
        const world = selection && layerPixelToWorld(layer, project, width, height);
        // Read only the local patch; source image remains immutable for the whole stroke.
        const read = (source: CanvasImageSource, x: number, y: number, w: number, h: number, blur = 0) => {
            const margin = Math.ceil(blur * 3);
            if (scratch.width !== w + margin * 2 || scratch.height !== h + margin * 2) {
                scratch.width = w + margin * 2;
                scratch.height = h + margin * 2;
            } else {
                ctx.clearRect(0, 0, scratch.width, scratch.height);
            }
            ctx.filter = blur ? `blur(${blur}px)` : "none";
            const left = Math.max(0, x - margin),
                top = Math.max(0, y - margin),
                right = Math.min(width, x + w + margin),
                bottom = Math.min(height, y + h + margin);
            if (right > left && bottom > top) ctx.drawImage(source, left, top, right - left, bottom - top, left - x + margin, top - y + margin, right - left, bottom - top);
            peakPatchBytes = Math.max(peakPatchBytes, scratch.width * scratch.height * 4 + w * h * 48);
            return ctx.getImageData(margin, margin, w, h);
        };
        const autoOffset = (point: Point) => {
            const x = Math.round(point.x) - r,
                y = Math.round(point.y) - r,
                target = read(image, x, y, side, side).data;
            let best = Infinity,
                found: Point | undefined;
            // Compare rings, not the blemish itself; reject overlapping/transparent donors.
            for (const distance of [side, side * 2, side * 3])
                for (let angle = 0; angle < 12; angle++) {
                    const dx = Math.round(Math.cos((angle * Math.PI) / 6) * distance),
                        dy = Math.round(Math.sin((angle * Math.PI) / 6) * distance);
                    if (x + dx < 0 || y + dy < 0 || x + dx + side > width || y + dy + side > height || Math.hypot(dx, dy) < side) continue;
                    const candidate = read(image, x + dx, y + dy, side, side).data;
                    let score = 0,
                        count = 0,
                        valid = true;
                    for (let a = 0; a < 48; a++) {
                        const sx = r + Math.round(Math.cos((a * Math.PI) / 24) * radius * 0.9),
                            sy = r + Math.round(Math.sin((a * Math.PI) / 24) * radius * 0.9),
                            i = (sy * side + sx) * 4;
                        if (candidate[i + 3] < 250) {
                            valid = false;
                            break;
                        }
                        for (let k = 0; k < 3; k++) score += (candidate[i + k] - target[i + k]) ** 2;
                        count++;
                    }
                    if (valid && count && score / count < best) {
                        best = score / count;
                        found = { x: dx, y: dy };
                    }
                }
            if (!found) throw new Error("周围没有足够的修复来源，请减小笔刷，或按 Alt 点击指定来源");
            return found;
        };
        const dab = (p: Point, from?: Point) => {
            const cx = Math.round(p.x),
                cy = Math.round(p.y),
                x = cx - r,
                y = cy - r;
            if (x >= width || y >= height || x + side <= 0 || y + side <= 0) return;
            const staticTool = brush.tool === "clone" || brush.tool === "heal" || brush.tool === "blur";
            const base = read(staticTool ? image : canvas, x, y, side, side);
            const under = premultiply(base.data);
            let candidate: Float32Array;
            if (brush.tool === "smudge") candidate = carried!;
            else if (brush.tool === "liquify") {
                if (!from) return;
                const dx = (p.x - from.x) * brush.opacity,
                    dy = (p.y - from.y) * brush.opacity,
                    margin = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))) + 2;
                const w = side + margin * 2,
                    raw = premultiply(read(canvas, x - margin, y - margin, w, w).data),
                    value = new Float32Array(4);
                candidate = new Float32Array(under.length);
                for (let row = 0; row < side; row++)
                    for (let col = 0; col < side; col++) {
                        const weight = falloff(Math.hypot(col - r, row - r), radius, Math.min(0.98, brush.hardness));
                        bilinear(raw, w, w, col + margin - dx * weight, row + margin - dy * weight, value);
                        candidate.set(value, (row * side + col) * 4);
                    }
            } else {
                const raw = brush.tool === "blur" ? read(image, x, y, side, side, brush.blurRadius) : read(image, x + offset!.x, y + offset!.y, side, side);
                if (brush.tool === "heal") {
                    const correction = healingCorrection(raw.data, base.data, side),
                        value = new Float32Array(4);
                    for (let row = 0; row < side; row++)
                        for (let col = 0; col < side; col++) {
                            const i = (row * side + col) * 4;
                            bilinear(correction.values, correction.side, correction.side, (col / (side - 1)) * (correction.side - 1), (row / (side - 1)) * (correction.side - 1), value);
                            if (raw.data[i + 3] === 0) {
                                raw.data.set(base.data.subarray(i, i + 4), i);
                                continue;
                            }
                            for (let k = 0; k < 3; k++) raw.data[i + k] += value[k];
                            raw.data[i + 3] = base.data[i + 3];
                        }
                }
                candidate = premultiply(raw.data);
            }
            const result = c.getImageData(x, y, side, side),
                mixed = new Float32Array(4);
            for (let row = 0; row < side; row++)
                for (let col = 0; col < side; col++) {
                    const px = x + col,
                        py = y + row,
                        i = (row * side + col) * 4;
                    if (px < 0 || py < 0 || px >= width || py >= height) continue;
                    let amount = falloff(Math.hypot(col - r, row - r), radius, brush.hardness);
                    if (!amount) continue;
                    let clip = 1;
                    if (selection && world) {
                        const w = world(px + 0.5, py + 0.5);
                        clip = selection(w.x, w.y) / 255;
                    }
                    amount *= clip;
                    if (brush.tool !== "liquify") amount *= brush.opacity;
                    if (!amount) continue;
                    if (offset && (px + offset.x < 0 || py + offset.y < 0 || px + offset.x >= width || py + offset.y >= height)) continue;
                    if (staticTool) {
                        const key = `${px >> 8},${py >> 8}`;
                        let tile = coverage.get(key);
                        if (!tile) {
                            tile = new Uint8Array(256 * 256);
                            coverage.set(key, tile);
                        }
                        const index = (py & 255) * 256 + (px & 255),
                            a = Math.round(amount * 255);
                        if (a <= tile[index]) continue;
                        tile[index] = a;
                    }
                    // Liquify's falloff is already in its displacement field.
                    const blend = brush.tool === "liquify" ? clip : amount;
                    for (let k = 0; k < 4; k++) mixed[k] = under[i + k] + (candidate[i + k] - under[i + k]) * blend;
                    writePixel(result.data, i, mixed, 0);
                    if (carried) for (let k = 0; k < 4; k++) carried[i + k] = mixed[k];
                    if (!changed) for (let k = 0; k < 4; k++) if (result.data[i + k] !== base.data[i + k]) changed = true;
                }
            c.putImageData(result, x, y);
        };
        const add = (p: Point) => {
            if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
            if (!previous) {
                if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return;
                if (brush.tool === "clone" && !brush.source) throw new Error("按 Alt 点击图片设置仿制来源");
                if (brush.tool === "clone" || brush.tool === "heal") offset = brush.source ? { x: Math.round(brush.source.x - p.x), y: Math.round(brush.source.y - p.y) } : autoOffset(p);
                if (brush.tool === "smudge") carried = premultiply(read(canvas, Math.round(p.x) - r, Math.round(p.y) - r, side, side).data);
                else dab(p);
            } else {
                const distance = Math.hypot(p.x - previous.x, p.y - previous.y);
                if (distance < 0.01) return;
                const spacing = Math.max(1, brush.size * (brush.tool === "smudge" ? 0.005 : brush.tool === "liquify" ? 0.025 : 0.15));
                const steps = Math.ceil(distance / spacing);
                if (steps > 4096) throw new Error("笔触跨度过大，请在图层范围内分段操作");
                let from = previous;
                for (let i = 1; i <= steps; i++) {
                    const next = { x: previous.x + ((p.x - previous.x) * i) / steps, y: previous.y + ((p.y - previous.y) * i) / steps };
                    dab(next, from);
                    from = next;
                }
            }
            previous = p;
        };
        return {
            canvas,
            add,
            update: () => {},
            bitmap: async (): Promise<RasterBitmap> => ({ dataUrl: await encodeCanvas(canvas), width, height }),
            stats: () => ({ workingBytes: width * height * 4 + peakPatchBytes + coverage.size * 65536 + (carried?.byteLength || 0), touchedTiles: coverage.size }),
            changed: () => changed,
            dispose,
        };
    } catch (error) {
        dispose();
        throw error;
    }
}
