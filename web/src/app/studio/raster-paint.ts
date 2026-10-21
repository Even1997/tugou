import type { Layer, RasterBitmap, StudioProject } from "./model";
import Konva from "konva";
import { worldTransform } from "./layer-operations";
import { inverseHomography, projectPoint } from "./perspective";
import { validImageSize, MAX_IMAGE_DATA_URL } from "./image-limits.js";
import { selectionSampler, layerPixelToWorld } from "./selection-raster";

export type Brush = { size: number; hardness: number; opacity: number; color: string; erase: boolean };
export type RasterPreview = { layerId: string; target: "image" | "mask"; canvas: HTMLCanvasElement };
export type Point = { x: number; y: number };
const surface = (width: number, height: number) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
};
export async function decodeBitmap(bitmap: RasterBitmap) {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("图片无法读取"));
        image.src = bitmap.dataUrl;
    });
    if (image.width !== bitmap.width || image.height !== bitmap.height) throw new Error("图片实际尺寸与记录不符，请重新导入");
    return image;
}
export async function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<string> {
    const blob = "convertToBlob" in canvas ? await canvas.convertToBlob({ type: "image/png" }) : await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("图片编码失败，原工程未改变");
    if (Math.ceil(blob.size / 3) * 4 + 22 > MAX_IMAGE_DATA_URL) throw new Error("编码后的图片超过 150 MB，当前笔画未保存");
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("图片编码读取失败"));
        reader.readAsDataURL(blob);
    });
}
export function paintPoint(layer: Layer, project: StudioProject, point: Point, width: number, height: number, target: "image" | "mask" = "image"): Point {
    const mask = target === "mask" ? layer.mask : undefined, anchor = mask?.anchor, offset = mask?.offset;
    const matrix = anchor ? new Konva.Transform(anchor.matrix) : worldTransform(layer, project.layers);
    const shift = offset && new Konva.Transform().translate(offset.x, offset.y).rotate(offset.rotation * Math.PI / 180).scale(offset.scale, offset.scale);
    if (anchor && shift) matrix.multiply(shift);
    const local = matrix.invert().point(point), w = anchor?.width || layer.width, h = anchor?.height || layer.height, warp = anchor ? anchor.warp : layer.warp;
    const uv = warp ? projectPoint(inverseHomography(warp), local.x / w, local.y / h) : { x: local.x / w, y: local.y / h };
    const raw = !anchor && shift ? shift.invert().point({ x: uv.x * w, y: uv.y * h }) : { x: uv.x * w, y: uv.y * h };
    return { x: raw.x / w * width, y: raw.y / h * height };
}
export async function preparePaint(project: StudioProject, layer: Layer, target: "image" | "mask", brush: Brush) {
    const bitmap = target === "mask" ? layer.mask?.bitmap : layer.bitmap || project.assets.find((a) => a.id === layer.assetId);
    const resolution = bitmap || (layer.kind === "image" ? layer.bitmap || project.assets.find((a) => a.id === layer.assetId) : undefined);
    const width = resolution?.width || Math.max(1, Math.round(layer.width)),
        height = resolution?.height || Math.max(1, Math.round(layer.height));
    if (!validImageSize(width, height)) throw new Error("当前图层超过 1 亿像素或 30000 像素边长");
    const canvas = surface(width, height),
        c = canvas.getContext("2d")!;
    const tileSize = 256;
    const tiles = new Map<string, { x: number; y: number; base: HTMLCanvasElement; stroke: HTMLCanvasElement; dirty: boolean; clip?: Uint8Array }>();
    const clipped = project.selection && surface(tileSize, tileSize);
    const dispose = () => {
        canvas.width = canvas.height = 0;
        for (const tile of tiles.values()) tile.base.width = tile.base.height = tile.stroke.width = tile.stroke.height = 0;
        if (clipped) clipped.width = clipped.height = 0;
        tiles.clear();
    };
    try {
        const sample = project.selection && await selectionSampler(project.selection, project.width, project.height),
            world = sample && layerPixelToWorld(layer, project, width, height, target);
        if (bitmap) c.drawImage(await decodeBitmap(bitmap), 0, 0);
        else if (target === "mask") {
            const b = c;
            const mask = layer.mask;
            if (mask?.paths) {
                for (const path of mask.paths) {
                    b.globalCompositeOperation = path.operation === "subtract" ? "destination-out" : path.operation === "intersect" ? "destination-in" : "source-over";
                    b.beginPath();
                    b.moveTo(path.points[0] * width, path.points[1] * height);
                    for (let i = 2; i < path.points.length; i += 2) b.lineTo(path.points[i] * width, path.points[i + 1] * height);
                    b.closePath();
                    b.fill();
                }
            } else b.fillRect((mask?.x || 0) * width, (mask?.y || 0) * height, (mask?.width ?? 1) * width, (mask?.height ?? 1) * height);
        }
        let previous: Point | undefined;
        const radius = brush.size / 2;
        const dab = (point: Point) => {
            if (point.x < -radius || point.y < -radius || point.x > width + radius || point.y > height + radius) return;
            for (let y = Math.max(0, Math.floor((point.y - radius - 1) / tileSize) * tileSize); y < Math.min(height, point.y + radius + 1); y += tileSize) {
                for (let x = Math.max(0, Math.floor((point.x - radius - 1) / tileSize) * tileSize); x < Math.min(width, point.x + radius + 1); x += tileSize) {
                    const key = `${x},${y}`;
                    let tile = tiles.get(key);
                    if (!tile) {
                        if ((tiles.size + 1) * tileSize * tileSize * (sample ? 9 : 8) > 192 * 1024 * 1024) throw new Error("单笔覆盖区域过大，请分几笔绘制；当前笔画未保存");
                        const w = Math.min(tileSize, width - x),
                            h = Math.min(tileSize, height - y);
                        tile = { x, y, base: surface(w, h), stroke: surface(w, h), dirty: true };
                        tile.base.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, w, h);
                        if (sample && world) {
                            tile.clip = new Uint8Array(w * h);
                            for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) {
                                const p = world(x + col + .5, y + row + .5);
                                tile.clip[row * w + col] = sample(p.x, p.y);
                            }
                        }
                        tiles.set(key, tile);
                    }
                    const s = tile.stroke.getContext("2d")!,
                        px = point.x - x,
                        py = point.y - y;
                    if (brush.hardness < 1) {
                        const gradient = s.createRadialGradient(px, py, radius * brush.hardness, px, py, radius);
                        gradient.addColorStop(0, brush.color);
                        gradient.addColorStop(1, `${brush.color}00`);
                        s.fillStyle = gradient;
                    } else s.fillStyle = brush.color;
                    s.beginPath();
                    s.arc(px, py, radius, 0, Math.PI * 2);
                    s.fill();
                    tile.dirty = true;
                }
            }
        };
        const add = (point: Point) => {
            if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
            if (previous) {
                const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
                // Bound work when the inverse perspective maps outside the visible plane.
                const count = Math.min(4096, Math.max(1, Math.ceil(distance / Math.max(1, brush.size * 0.15))));
                for (let i = 1; i <= count; i++) dab({ x: previous.x + ((point.x - previous.x) * i) / count, y: previous.y + ((point.y - previous.y) * i) / count });
            } else dab(point);
            previous = point;
        };
        const update = () => {
            for (const tile of tiles.values()) {
                if (!tile.dirty) continue;
                c.save();
                c.beginPath();
                c.rect(tile.x, tile.y, tile.base.width, tile.base.height);
                c.clip();
                c.globalCompositeOperation = "copy";
                c.globalAlpha = 1;
                c.drawImage(tile.base, tile.x, tile.y);
                c.globalCompositeOperation = (target === "mask" && layer.mask?.inverted ? !brush.erase : brush.erase) ? "destination-out" : "source-over";
                c.globalAlpha = brush.opacity;
                if (tile.clip && clipped) {
                    const pixels = tile.stroke.getContext("2d")!.getImageData(0, 0, tile.stroke.width, tile.stroke.height);
                    for (let i = 0; i < tile.clip.length; i++) pixels.data[i * 4 + 3] = Math.round(pixels.data[i * 4 + 3] * tile.clip[i] / 255);
                    const ctx = clipped.getContext("2d")!;
                    ctx.clearRect(0, 0, tileSize, tileSize); ctx.putImageData(pixels, 0, 0);
                    c.drawImage(clipped, tile.x, tile.y);
                } else c.drawImage(tile.stroke, tile.x, tile.y);
                c.restore();
                tile.dirty = false;
            }
        };
        update();
        return {
            canvas,
            add,
            update,
            bitmap: async (): Promise<RasterBitmap> => ({ dataUrl: await encodeCanvas(canvas), width, height }),
            stats: () => ({ workingBytes: width * height * 4 + (clipped ? tileSize * tileSize * 4 : 0) + [...tiles.values()].reduce((sum, t) => sum + t.base.width * t.base.height * 8 + (t.clip?.length || 0), 0), touchedTiles: tiles.size }),
            dispose,
        };
    } catch (error) {
        dispose();
        throw error;
    }
}
