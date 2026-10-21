import type { DocumentSelection, Layer, StudioProject } from "./model";

import { worldTransform } from "./layer-operations";
import { homography, projectPoint } from "./perspective";
import { growCoverage } from "./selection-pixels";
import Konva from "konva";

const canvas = (width: number, height: number) => Object.assign(document.createElement("canvas"), { width, height });
const image = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const value = new Image();
        value.onload = () => resolve(value);
        value.onerror = () => reject(new Error("选区图片无法读取"));
        value.src = src;
    });
export const yieldSelection = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** A bounded cache in document coordinates; painting never allocates another full-document mask. */
export async function selectionSampler(selection: DocumentSelection, width: number, height: number) {
    const bitmap = selection.bitmap && (await image(selection.bitmap.dataUrl));
    const cache = new Map<string, Uint8ClampedArray>(),
        size = 128;
    return (x: number, y: number): number => {
        x = Math.floor(x);
        y = Math.floor(y);
        if (x < 0 || y < 0 || x >= width || y >= height) return 0;
        const tx = Math.floor(x / size) * size,
            ty = Math.floor(y / size) * size,
            key = `${tx}:${ty}`;
        let data = cache.get(key);
        if (!data) {
            const margin = Math.ceil(Math.abs(selection.grow || 0) + (selection.feather || 0) * 3 + 2),
                edge = size + margin * 2;
            const surface = canvas(edge, edge),
                ctx = surface.getContext("2d", { willReadFrequently: true })!;
            ctx.translate(margin - tx, margin - ty);
            ctx.beginPath();
            ctx.rect(0, 0, width, height);
            ctx.clip();
            ctx.fillStyle = "#ffffff";
            if (bitmap) ctx.drawImage(bitmap, 0, 0, width, height);
            else
                for (const path of selection.paths || []) {
                    ctx.globalCompositeOperation = path.operation === "subtract" ? "destination-out" : path.operation === "intersect" ? "destination-in" : "source-over";
                    ctx.beginPath();
                    ctx.moveTo(path.points[0], path.points[1]);
                    for (let i = 2; i < path.points.length; i += 2) ctx.lineTo(path.points[i], path.points[i + 1]);
                    ctx.closePath();
                    ctx.fill();
                }
            ctx.resetTransform();
            ctx.globalCompositeOperation = "source-over";
            if (selection.grow) {
                const pixels = ctx.getImageData(0, 0, edge, edge),
                    alpha = new Uint8Array(edge * edge);
                for (let i = 0; i < alpha.length; i++) alpha[i] = pixels.data[i * 4 + 3];
                const grown = growCoverage(alpha, edge, edge, selection.grow);
                for (let i = 0; i < alpha.length; i++) {
                    pixels.data[i * 4] = pixels.data[i * 4 + 1] = pixels.data[i * 4 + 2] = 255;
                    pixels.data[i * 4 + 3] = grown[i];
                }
                ctx.putImageData(pixels, 0, 0);
            }
            const cropped = canvas(size, size),
                out = cropped.getContext("2d", { willReadFrequently: true })!;
            if (selection.feather) out.filter = `blur(${selection.feather}px)`;
            out.drawImage(surface, -margin, -margin);
            data = out.getImageData(0, 0, size, size).data;
            if (selection.inverted) for (let i = 3; i < data.length; i += 4) data[i] = 255 - data[i];
            if (cache.size >= 64) cache.delete(cache.keys().next().value!);
            cache.set(key, data);
            surface.width = surface.height = cropped.width = cropped.height = 0;
        }
        return data[((y - ty) * size + x - tx) * 4 + 3];
    };
}

export function layerPixelToWorld(layer: Layer, project: StudioProject, width: number, height: number, target: "image" | "mask" = "image") {
    const mask = target === "mask" ? layer.mask : undefined,
        anchor = mask?.anchor,
        offset = mask?.offset;
    const matrix = anchor ? new Konva.Transform(anchor.matrix) : worldTransform(layer, project.layers),
        quad = anchor ? anchor.warp : layer.warp,
        warp = quad && homography(quad);
    const w = anchor?.width || layer.width,
        h = anchor?.height || layer.height;
    const shift =
        offset &&
        new Konva.Transform()
            .translate(offset.x, offset.y)
            .rotate((offset.rotation * Math.PI) / 180)
            .scale(offset.scale, offset.scale);
    if (anchor && shift) matrix.multiply(shift);
    return (x: number, y: number) => {
        const raw = !anchor && shift ? shift.point({ x: (x / width) * w, y: (y / height) * h }) : { x: (x / width) * w, y: (y / height) * h };
        const p = warp ? projectPoint(warp, raw.x / w, raw.y / h) : { x: raw.x / w, y: raw.y / h };
        return matrix.point({ x: p.x * w, y: p.y * h });
    };
}

export async function selectionOnLayer(project: StudioProject, layer: Layer, width: number, height: number, signal?: AbortSignal) {
    const surface = canvas(width, height),
        ctx = surface.getContext("2d")!;
    try {
        const sample = await selectionSampler(project.selection!, project.width, project.height),
            world = layerPixelToWorld(layer, project, width, height);
        for (let y = 0; y < height; y += 64) {
            signal?.throwIfAborted();
            const rows = Math.min(64, height - y),
                pixels = ctx.createImageData(width, rows);
            for (let row = 0; row < rows; row++)
                for (let x = 0; x < width; x++) {
                    const p = world(x + 0.5, y + row + 0.5),
                        i = (row * width + x) * 4;
                    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 255;
                    pixels.data[i + 3] = sample(p.x, p.y);
                }
            ctx.putImageData(pixels, 0, y);
            await yieldSelection();
        }
        return surface;
    } catch (error) {
        surface.width = surface.height = 0;
        throw error;
    }
}
