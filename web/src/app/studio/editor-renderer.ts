import Konva from "konva";
import { SceneContext } from "konva/lib/Context";
import type { SceneCanvas } from "konva/lib/Canvas";
import type { BlendMode, Layer, StudioProject } from "./model";
import { quadBounds, warpPixels } from "./perspective";
import { worldTransform, layerBounds, transformValues } from "./layer-operations";
import { paintPoint, type RasterPreview } from "./raster-paint";
import { adjustedCanvas, applyEffects, adjustmentMargin, effectMargin, samplingMargin } from "./tone-render";

const decoded = new Map<string, { image: HTMLImageElement; bytes: number; dataUrl: string }>();
const IMAGE_BUDGET = 128 * 1024 * 1024;
async function assetImage(id: string, dataUrl: string) {
    const cached = decoded.get(id);
    if (cached?.dataUrl === dataUrl) {
        decoded.delete(id);
        decoded.set(id, cached);
        return cached.image;
    }
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("图片无法读取"));
        image.src = dataUrl;
    });
    decoded.set(id, { image, bytes: image.width * image.height * 4, dataUrl });
    let bytes = [...decoded.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    for (const [key, entry] of decoded) {
        // Keep the most recent oversized image so strip export decodes it only once.
        if (bytes <= IMAGE_BUDGET || decoded.size === 1) break;
        decoded.delete(key);
        bytes -= entry.bytes;
    }
    return image;
}
const customModes = new Set(["linear-burn", "linear-dodge", "vivid-light", "linear-light", "pin-light", "hard-mix", "subtract", "divide"]);
const clamp = (v: number) => Math.max(0, Math.min(1, v));
function channel(mode: string, b: number, s: number): number {
    // Color burn/dodge boundary order follows W3C Compositing and Blending §10.1.
    const burn = (c: number) => (b === 1 ? 1 : c === 0 ? 0 : 1 - Math.min(1, (1 - b) / c));
    const dodge = (c: number) => (b === 0 ? 0 : c === 1 ? 1 : Math.min(1, b / (1 - c)));
    const vivid = () => (s < 0.5 ? burn(s * 2) : dodge(2 * s - 1));
    switch (mode) {
        case "linear-burn":
            return clamp(b + s - 1);
        case "linear-dodge":
            return clamp(b + s);
        case "vivid-light":
            return vivid();
        case "linear-light":
            return clamp(b + 2 * s - 1);
        case "pin-light":
            return s < 0.5 ? Math.min(b, 2 * s) : Math.max(b, 2 * s - 1);
        case "hard-mix":
            return vivid() < 0.5 ? 0 : 1;
        case "subtract":
            return Math.max(0, b - s);
        case "divide":
            return s === 0 ? 1 : Math.min(1, b / s);
        default:
            return s;
    }
}
export function blendPixels(bottom: Uint8ClampedArray, top: Uint8ClampedArray, mode: string, opacity: number) {
    for (let i = 0; i < bottom.length; i += 4) {
        const ab = bottom[i + 3] / 255,
            as = (top[i + 3] / 255) * opacity,
            ao = as + ab * (1 - as);
        if (!as) continue;
        for (let c = 0; c < 3; c++) {
            const b = bottom[i + c] / 255,
                s = top[i + c] / 255;
            bottom[i + c] = (255 * ((1 - as) * ab * b + (1 - ab) * as * s + ab * as * channel(mode, b, s))) / ao;
        }
        bottom[i + 3] = ao * 255;
    }
}
type Surface = { canvas: HTMLCanvasElement; x: number; y: number };
/** Same compositor for the on-screen preview, raster merge, and full-resolution export. */
export async function renderProject(project: StudioProject, options: { scale?: number; transparent?: boolean; only?: string[]; raster?: RasterPreview; region?: { x: number; y: number; width: number; height: number } } = {}) {
    const scale = options.scale ?? 1;
    const region = options.region || { x: 0, y: 0, width: project.width, height: project.height };
    const requested = { x: Math.floor(region.x * scale), y: Math.floor(region.y * scale), width: Math.ceil(region.width * scale), height: Math.ceil(region.height * scale) };
    const halo = project.layers.some(l => l.adjustment || l.effects?.some(e => e.enabled)) ? Math.ceil(samplingMargin(project) * scale) : 0;
    const viewport = { x: requested.x - halo, y: requested.y - halo, width: requested.width + halo * 2, height: requested.height + halo * 2 };
    let allocated = 0;
    const surfaces = new Set<HTMLCanvasElement>();
    const make = (width: number, height: number, x = 0, y = 0): Surface => {
        width = Math.max(1, Math.ceil(width));
        height = Math.max(1, Math.ceil(height));
        if (width > 32767 || height > 32767) throw new Error("含特效边缘的临时合成区域过大，请缩小特效范围");
        if (allocated + width * height * 4 > 384 * 1024 * 1024) throw new Error("合成所需内存超出预算，请减少嵌套组或缩小画布");
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        allocated += width * height * 4;
        surfaces.add(canvas);
        return { canvas, x, y };
    };
    const free = (surface: Surface) => {
        if (!surfaces.delete(surface.canvas)) return;
        allocated -= surface.canvas.width * surface.canvas.height * 4;
        surface.canvas.width = surface.canvas.height = 0;
    };
    // Freeze the in-progress stroke before asynchronous image decoding.
    const activeLayer = options.raster && project.layers.find((l) => l.id === options.raster!.layerId);
    const anchor = options.raster?.target === "mask" && activeLayer?.mask?.anchor;
    const activeMatrix = activeLayer && (anchor ? anchor.matrix : worldTransform(activeLayer, project.layers).getMatrix());
    const rasterWidth = anchor ? anchor.width : activeLayer?.width || 1, rasterHeight = anchor ? anchor.height : activeLayer?.height || 1;
    const input = options.raster?.canvas;
    const rasterScale =
        activeMatrix && input && activeLayer ? Math.min(1, scale * (options.raster?.target === "mask" ? activeLayer.mask?.offset?.scale || 1 : 1) * Math.max((Math.hypot(activeMatrix[0], activeMatrix[1]) * rasterWidth) / input.width, (Math.hypot(activeMatrix[2], activeMatrix[3]) * rasterHeight) / input.height)) : scale;
    const corners =
        activeLayer && input
            ? [
                  [region.x, region.y],
                  [region.x + region.width, region.y],
                  [region.x, region.y + region.height],
                  [region.x + region.width, region.y + region.height],
              ].map(([x, y]) => paintPoint(activeLayer, project, { x, y }, input.width, input.height, options.raster?.target))
            : [];
    const padding = Math.ceil((activeLayer?.mask?.feather || 0) * 3 + 8);
    const rx = input ? Math.max(0, Math.min(input.width - 1, Math.floor(Math.min(...corners.map((p) => p.x)) - padding))) : 0;
    const ry = input ? Math.max(0, Math.min(input.height - 1, Math.floor(Math.min(...corners.map((p) => p.y)) - padding))) : 0;
    const rw = input ? Math.max(1, Math.min(input.width, Math.ceil(Math.max(...corners.map((p) => p.x)) + padding)) - rx) : 1;
    const rh = input ? Math.max(1, Math.min(input.height, Math.ceil(Math.max(...corners.map((p) => p.y)) + padding)) - ry) : 1;
    const raster = input && activeLayer && make(rw * rasterScale, rh * rasterScale);
    const rasterRect =
        input && activeLayer
            ? { x: (rx / input.width) * rasterWidth, y: (ry / input.height) * rasterHeight, width: (rw / input.width) * rasterWidth, height: (rh / input.height) * rasterHeight }
            : { x: 0, y: 0, width: 1, height: 1 };
    if (raster && input) raster.canvas.getContext("2d")!.drawImage(input, rx, ry, rw, rh, 0, 0, raster.canvas.width, raster.canvas.height);
    const bounds = (layer: Layer): { x: number; y: number; width: number; height: number } => {
        if (layer.kind !== "group") {
            const b = layerBounds(layer, project.layers),
                matrix = worldTransform(layer, project.layers).getMatrix();
            const padding = (layer.strokeWidth || 0) * Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3])) + effectMargin(layer.effects) + 2;
            return { x: b.x - padding, y: b.y - padding, width: b.width + padding * 2, height: b.height + padding * 2 };
        }
        const children = project.layers.filter((l) => l.parentId === layer.id && l.visible && l.kind !== "adjustment").map(bounds);
        if (!children.length) return { x: 0, y: 0, width: 1, height: 1 };
        const x = Math.min(...children.map((b) => b.x)),
            y = Math.min(...children.map((b) => b.y));
        const padding = effectMargin(layer.effects) + project.layers.filter(l => l.parentId === layer.id && l.visible).reduce((s, l) => s + adjustmentMargin(l.adjustment), 0);
        return { x: x - padding, y: y - padding, width: Math.max(...children.map((b) => b.x + b.width)) - x + padding * 2, height: Math.max(...children.map((b) => b.y + b.height)) - y + padding * 2 };
    };
    const composite = (target: Surface, source: Surface, mode: BlendMode | "destination-in" = "source-over", opacity = 1) => {
        const ctx = target.canvas.getContext("2d", { willReadFrequently: customModes.has(mode) })!;
        const x = source.x - target.x,
            y = source.y - target.y;
        if (customModes.has(mode)) {
            const left = Math.max(0, x),
                top = Math.max(0, y),
                width = Math.min(target.canvas.width, x + source.canvas.width) - left,
                height = Math.min(target.canvas.height, y + source.canvas.height) - top;
            if (width <= 0 || height <= 0) return;
            if (allocated + width * height * 8 > 384 * 1024 * 1024) throw new Error("混合模式所需内存超出预算，请缩小画布");
            const bottom = ctx.getImageData(left, top, width, height);
            const pixels = source.canvas.getContext("2d")!.getImageData(left - x, top - y, width, height);
            blendPixels(bottom.data, pixels.data, mode, opacity);
            ctx.putImageData(bottom, left, top);
        } else {
            ctx.save();
            ctx.resetTransform();
            ctx.globalAlpha = opacity;
            ctx.globalCompositeOperation = mode as GlobalCompositeOperation;
            ctx.drawImage(source.canvas, x, y);
            ctx.restore();
        }
    };
    const stack = async (target: Surface, layers: Layer[]) => {
        let base: Surface | undefined, baseLayer: Layer | undefined;
        const finish = () => {
            if (base && baseLayer) {
                composite(target, base, baseLayer.blend, baseLayer.opacity);
                free(base);
            }
            base = undefined;
        };
        try {
            for (const layer of layers) {
                if (layer.kind === "adjustment") {
                    if (!layer.clipping) finish();
                    if (layer.visible && (!layer.clipping || base)) await adjust(layer.clipping ? base! : target, layer);
                    continue;
                }
                if (!layer.clipping) {
                    finish();
                    baseLayer = layer;
                }
                if (!layer.visible) continue;
                const source = await render(layer);
                if (layer.clipping) {
                    if (!base) {
                        free(source);
                        continue;
                    }
                    // Clip stacks preserve the base alpha, including antialiased edges.
                    const ctx = base.canvas.getContext("2d")!,
                        width = base.canvas.width,
                        height = base.canvas.height;
                    if (allocated + width * height * 9 > 384 * 1024 * 1024) throw new Error("剪贴合成所需内存超出预算，请缩小画布");
                    const pixels = ctx.getImageData(0, 0, width, height),
                        alpha = new Uint8Array(width * height);
                    for (let i = 3; i < pixels.data.length; i += 4) {
                        alpha[(i - 3) / 4] = pixels.data[i];
                        pixels.data[i] = 255;
                    }
                    ctx.putImageData(pixels, 0, 0);
                    composite(base, source, layer.blend, layer.opacity);
                    const result = ctx.getImageData(0, 0, width, height);
                    for (let i = 3; i < result.data.length; i += 4) result.data[i] = alpha[(i - 3) / 4];
                    ctx.putImageData(result, 0, 0);
                    free(source);
                } else base = source;
            }
            finish();
        } finally {
            if (base) free(base);
        }
    };
    const drawContent = async (layer: Layer, surface: Surface, ctx: CanvasRenderingContext2D) => {
        if (layer.kind === "image") {
            const asset = layer.bitmap || project.assets.find((a) => a.id === layer.assetId);
            if (raster && options.raster?.layerId === layer.id && options.raster.target === "image") ctx.drawImage(raster.canvas, rasterRect.x, rasterRect.y, rasterRect.width, rasterRect.height);
            else if (asset) ctx.drawImage(await assetImage(layer.bitmap ? `paint:${layer.id}` : layer.assetId!, asset.dataUrl), 0, 0, layer.width, layer.height);
        } else if (layer.kind === "text") {
            const text = new Konva.Text({
                text: layer.text || "",
                width: layer.width,
                height: layer.height,
                fontSize: layer.fontSize || 40,
                fontFamily: layer.fontFamily || "Microsoft YaHei",
                fill: layer.color || "#334638",
                lineHeight: layer.lineHeight ?? 1.3,
                align: layer.align || "center",
                letterSpacing: layer.letterSpacing ?? 0,
                fontStyle: layer.fontStyle || "normal",
            });
            // Draw text with the same layout engine at the output resolution, including transformed groups.
            const context = new SceneContext({ _canvas: surface.canvas, getPixelRatio: () => 1 } as SceneCanvas);
            ctx.save();
            text.getSceneFunc().call(text, context, text);
            ctx.restore();
            text.destroy();
        } else {
            ctx.fillStyle = layer.color || "#8aab80";
            if (layer.gradient) {
                const angle = (layer.gradient.angle * Math.PI) / 180,
                    dx = (Math.cos(angle) * layer.width) / 2,
                    dy = (Math.sin(angle) * layer.height) / 2;
                const gradient = ctx.createLinearGradient(layer.width / 2 - dx, layer.height / 2 - dy, layer.width / 2 + dx, layer.height / 2 + dy);
                gradient.addColorStop(0, layer.color || "#8aab80");
                gradient.addColorStop(1, layer.gradient.endColor);
                ctx.fillStyle = gradient;
            }
            ctx.beginPath();
            if (layer.shape === "ellipse") ctx.ellipse(layer.width / 2, layer.height / 2, layer.width / 2, layer.height / 2, 0, 0, Math.PI * 2);
            else if (layer.shape === "line") {
                ctx.moveTo(0, 0);
                ctx.lineTo(layer.width, layer.height);
            } else ctx.roundRect(0, 0, layer.width, layer.height, Math.min(layer.radius || 0, layer.width / 2, layer.height / 2));
            if (layer.shape !== "line") ctx.fill();
            if (layer.strokeWidth || layer.shape === "line") {
                ctx.strokeStyle = layer.stroke || layer.color || "#8aab80";
                ctx.lineWidth = layer.strokeWidth || 2;
                ctx.stroke();
            }
        }
    };
    const applyMask = async (surface: Surface, layer: Layer, matrix: number[], renderScale: number) => {
        const ctx = surface.canvas.getContext("2d")!,
            { x, y } = surface;
        const liveMask = raster && options.raster?.layerId === layer.id && options.raster.target === "mask";
        if (liveMask || (layer.mask && !layer.mask.disabled)) {
            const mask = layer.mask || { x: 0, y: 0, width: 1, height: 1 };
            if (mask.anchor) {
                const transform = new Konva.Transform(mask.anchor.matrix);
                if (mask.offset) transform.translate(mask.offset.x, mask.offset.y).rotate(mask.offset.rotation * Math.PI / 180).scale(mask.offset.scale, mask.offset.scale);
                const source = await render({ ...layer, ...transformValues(transform), parentId: undefined, kind: "shape", shape: "rect", color: "#ffffff", gradient: undefined, strokeWidth: 0, radius: 0,
                    width: mask.anchor.width, height: mask.anchor.height, warp: mask.anchor.warp, maskSourceId: undefined,
                    adjustment: undefined, effects: undefined, mask: { ...mask, anchor: undefined, offset: undefined, inverted: false, feather: 0 } });
                ctx.save();
                ctx.resetTransform();
                ctx.globalCompositeOperation = mask.inverted ? "destination-out" : "destination-in";
                ctx.filter = mask.feather ? `blur(${mask.feather * renderScale}px)` : "none";
                ctx.drawImage(source.canvas, source.x - surface.x, source.y - surface.y);
                ctx.restore();
                free(source); return;
            }
            const matte = make(surface.canvas.width, surface.canvas.height);
            const m = matte.canvas.getContext("2d")!;
            m.setTransform(matrix[0] * renderScale, matrix[1] * renderScale, matrix[2] * renderScale, matrix[3] * renderScale, matrix[4] * renderScale - x, matrix[5] * renderScale - y);
            if (mask.offset) { m.translate(mask.offset.x, mask.offset.y); m.rotate(mask.offset.rotation * Math.PI / 180); m.scale(mask.offset.scale, mask.offset.scale); }
            if (liveMask) m.drawImage(raster.canvas, rasterRect.x, rasterRect.y, rasterRect.width, rasterRect.height);
            else if (mask.bitmap) {
                m.drawImage(await assetImage(`mask:${layer.id}`, mask.bitmap.dataUrl), 0, 0, layer.width, layer.height);
            } else if (mask.paths) {
                for (const path of mask.paths) {
                    m.globalCompositeOperation = path.operation === "subtract" ? "destination-out" : path.operation === "intersect" ? "destination-in" : "source-over";
                    m.beginPath();
                    m.moveTo(path.points[0] * layer.width, path.points[1] * layer.height);
                    for (let i = 2; i < path.points.length; i += 2) m.lineTo(path.points[i] * layer.width, path.points[i + 1] * layer.height);
                    m.closePath();
                    m.fill();
                }
            } else m.fillRect(mask.x * layer.width, mask.y * layer.height, mask.width * layer.width, mask.height * layer.height);
            if (mask.inverted) {
                m.resetTransform();
                m.globalCompositeOperation = "source-out";
                m.fillRect(0, 0, matte.canvas.width, matte.canvas.height);
            }
            ctx.resetTransform();
            ctx.globalCompositeOperation = "destination-in";
            ctx.filter = mask.feather ? `blur(${mask.feather * renderScale}px)` : "none";
            ctx.drawImage(matte.canvas, 0, 0);
            ctx.filter = "none";
            ctx.globalCompositeOperation = "source-over";
            free(matte);
        }
    };
    const render = async (layer: Layer): Promise<Surface> => {
        const b = bounds(layer),
            x = Math.max(viewport.x, Math.floor(b.x * scale)),
            y = Math.max(viewport.y, Math.floor(b.y * scale));
        const right = Math.min(viewport.x + viewport.width, Math.ceil((b.x + b.width) * scale)),
            bottom = Math.min(viewport.y + viewport.height, Math.ceil((b.y + b.height) * scale));
        const surface = make(Math.max(1, right - x), Math.max(1, bottom - y), x, y),
            ctx = surface.canvas.getContext("2d")!;
        if (right <= x || bottom <= y) return surface;
        if (layer.kind === "group")
            await stack(
                surface,
                project.layers.filter((l) => l.parentId === layer.id),
            );
        else {
            const matrix = worldTransform(layer, project.layers).getMatrix();
            ctx.setTransform(matrix[0] * scale, matrix[1] * scale, matrix[2] * scale, matrix[3] * scale, matrix[4] * scale - x, matrix[5] * scale - y);
            if (layer.warp) {
                const resolution = scale * Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
                const width = Math.max(1, Math.ceil(layer.width * resolution)),
                    height = Math.max(1, Math.ceil(layer.height * resolution));
                if (width > 16000 || height > 16000) throw new Error("四角变形图层过大，请先缩小图层");
                const raw = make(width, height),
                    context = raw.canvas.getContext("2d")!;
                context.scale(width / layer.width, height / layer.height);
                await drawContent(layer, raw, context);
                if (!layer.mask?.anchor) await applyMask(raw, layer, [1, 0, 0, 1, 0, 0], resolution);
                const box = quadBounds(layer.warp, width, height),
                    warped = make(box.width, box.height);
                if (allocated + (width * height + box.width * box.height) * 4 > 384 * 1024 * 1024) throw new Error("四角变形所需内存超出预算，请缩小画布或图层");
                const source = context.getImageData(0, 0, width, height),
                    output = warped.canvas.getContext("2d")!.createImageData(box.width, box.height);
                warpPixels(source.data, width, height, layer.warp, output.data);
                warped.canvas.getContext("2d")!.putImageData(output, 0, 0);
                ctx.drawImage(warped.canvas, (box.x / width) * layer.width, (box.y / height) * layer.height, (box.width / width) * layer.width, (box.height / height) * layer.height);
                free(raw);
                free(warped);
            } else await drawContent(layer, surface, ctx);
        }
        if (!layer.warp || layer.mask?.anchor) await applyMask(surface, layer, worldTransform(layer, project.layers).getMatrix(), scale);
        if (layer.maskSourceId) {
            const sourceLayer = project.layers.find(l => l.id === layer.maskSourceId)!;
            const source = await render(sourceLayer);
            composite(surface, source, "destination-in", sourceLayer.opacity);
            free(source);
        }
        if (layer.effects?.some(e => e.enabled)) {
            if (allocated + surface.canvas.width * surface.canvas.height * 48 > 384 * 1024 * 1024) throw new Error("图层特效计算超出临时内存预算，请缩小特效或分块导出");
            applyEffects(surface.canvas, layer, scale);
        }
        return surface;
    };
    const adjust = async (target: Surface, layer: Layer) => {
        const w = target.canvas.width, h = target.canvas.height;
        if (allocated + w * h * 48 > 384 * 1024 * 1024) throw new Error("调整图层超出临时内存预算，请缩小预览或分块导出");
        const filtered = adjustedCanvas(target.canvas, layer.adjustment!, target.x, target.y, scale);
        const matte = make(w, h, target.x, target.y), opaque = layer.blend !== "source-over" ? make(w, h, target.x, target.y) : undefined;
        try {
            if ((!layer.mask || layer.mask.disabled) && !(options.raster?.layerId === layer.id && options.raster.target === "mask")) {
                const ctx = matte.canvas.getContext("2d")!; ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h);
            } else {
                const mask = await render({ ...layer, kind: "shape", shape: "rect", color: "#ffffff", gradient: undefined, strokeWidth: 0, radius: 0, adjustment: undefined, effects: undefined });
                composite(matte, mask); free(mask);
            }
            const ctx = target.canvas.getContext("2d")!, original = ctx.getImageData(0, 0, w, h), changed = filtered.getContext("2d")!.getImageData(0, 0, w, h), coverage = matte.canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
            let mixed = changed.data;
            if (opaque) {
                const a = new ImageData(original.data.slice(), w, h), b = new ImageData(changed.data.slice(), w, h);
                for (let i = 3; i < a.data.length; i += 4) a.data[i] = b.data[i] = 255;
                opaque.canvas.getContext("2d")!.putImageData(a, 0, 0); filtered.getContext("2d")!.putImageData(b, 0, 0);
                composite(opaque, { canvas: filtered, x: target.x, y: target.y }, layer.blend);
                mixed = opaque.canvas.getContext("2d")!.getImageData(0, 0, w, h).data;
            }
            for (let i = 0; i < original.data.length; i += 4) {
                const amount = coverage[i + 3] / 255 * layer.opacity;
                if (!amount) continue;
                const a = original.data[i + 3] / 255, b = layer.clipping ? a : changed.data[i + 3] / 255, alpha = a * (1 - amount) + b * amount;
                for (let k = 0; k < 3; k++) original.data[i + k] = alpha ? (original.data[i + k] * a * (1 - amount) + mixed[i + k] * b * amount) / alpha : 0;
                original.data[i + 3] = alpha * 255;
            }
            ctx.putImageData(original, 0, 0);
        } finally { filtered.width = filtered.height = 0; free(matte); if (opaque) free(opaque); }
    };
    try {
        const output = make(viewport.width, viewport.height, viewport.x, viewport.y);
        if (!options.transparent && project.background !== "transparent") {
            const ctx = output.canvas.getContext("2d")!;
            ctx.fillStyle = project.background;
            ctx.fillRect(0, 0, output.canvas.width, output.canvas.height);
        }
        const selected = options.only && new Set(options.only);
        await stack(
            output,
            project.layers.filter((l) => (selected ? selected.has(l.id) : !l.parentId)),
        );
        if (halo) {
            const cropped = make(requested.width, requested.height);
            cropped.canvas.getContext("2d")!.drawImage(output.canvas, -halo, -halo);
            free(output); surfaces.delete(cropped.canvas); return cropped.canvas;
        }
        surfaces.delete(output.canvas); return output.canvas;
    } finally {
        for (const canvas of surfaces) canvas.width = canvas.height = 0;
    }
}
