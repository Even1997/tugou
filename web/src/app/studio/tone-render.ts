import type { Adjustment, Layer, LayerEffect, StudioProject } from "./model";
import { adjustPixels, edgeDistance } from "./tone-pixels";
export const adjustmentMargin = (a?: Adjustment) => a?.kind === "blur" ? a.values.radius * 3 + 2 : a?.kind === "motion" ? a.values.distance / 2 + 2 : 0;
export function effectMargin(effects: LayerEffect[] = []) {
    return Math.ceil(Math.max(0, ...effects.filter(e => e.enabled).map(e => e.kind === "shadow" || e.kind === "innerShadow" ? e.values.distance + e.values.blur * 3 + 2 : e.kind === "stroke" ? e.values.size + 2 : e.kind === "outerGlow" || e.kind === "innerGlow" ? e.values.size * 3 + 2 : 0)));
}
export function samplingMargin(project: StudioProject) {
    // Independent siblings need the largest footprint, not their sum. Filters
    // along the same compositing path still accumulate to avoid strip seams.
    const cached = new Map<string, number>();
    const scope = (parentId?: string): number => {
        let margin = 0;
        for (const layer of project.layers.filter(l => l.parentId === parentId && l.visible)) {
            if (layer.kind === "adjustment") margin += adjustmentMargin(layer.adjustment) + (layer.mask?.feather || 0) * 3;
            else margin = Math.max(margin, footprint(layer));
        }
        return margin;
    };
    const footprint = (layer: Layer): number => {
        if (cached.has(layer.id)) return cached.get(layer.id)!;
        const source = layer.maskSourceId && project.layers.find(l => l.id === layer.maskSourceId);
        const margin = (layer.kind === "group" ? scope(layer.id) : 0) + effectMargin(layer.effects) + (layer.mask?.feather || 0) * 3 + (source ? footprint(source) : 0);
        cached.set(layer.id, margin); return margin;
    };
    return Math.ceil(8 + scope());
}
const canvas = (w: number, h: number) => Object.assign(document.createElement("canvas"), { width: w, height: h });
export function adjustedCanvas(source: HTMLCanvasElement, adjustment: Adjustment, x: number, y: number, scale: number) {
    const output = canvas(source.width, source.height), ctx = output.getContext("2d")!;
    if (adjustment.kind === "blur") {
        ctx.filter = `blur(${adjustment.values.radius * scale}px)`; ctx.drawImage(source, 0, 0); ctx.filter = "none";
    } else if (adjustment.kind === "motion") {
        const distance = adjustment.values.distance * scale, angle = adjustment.values.angle * Math.PI / 180;
        const samples = 2 ** Math.ceil(Math.log2(Math.max(1, Math.ceil(distance) + 1))), step = distance / Math.max(1, samples - 1);
        const temp = canvas(source.width, source.height), t = temp.getContext("2d")!;
        ctx.drawImage(source, 0, 0);
        // Doubling gives a centered uniform line convolution in logarithmic passes.
        for (let n = 1; n < samples; n *= 2) {
            const dx = Math.cos(angle) * n * step / 2, dy = Math.sin(angle) * n * step / 2;
            t.clearRect(0, 0, temp.width, temp.height); t.globalCompositeOperation = "source-over"; t.globalAlpha = .5; t.drawImage(output, -dx, -dy); t.globalCompositeOperation = "lighter"; t.drawImage(output, dx, dy);
            ctx.clearRect(0, 0, output.width, output.height); ctx.drawImage(temp, 0, 0);
        }
        temp.width = temp.height = 0;
    } else {
        ctx.drawImage(source, 0, 0);
        const pixels = ctx.getImageData(0, 0, source.width, source.height);
        adjustPixels(pixels.data, source.width, adjustment, x, y, scale); ctx.putImageData(pixels, 0, 0);
    }
    return output;
}
/** Effects sample the masked silhouette before effects, never each other. */
export function applyEffects(source: HTMLCanvasElement, layer: Layer, scale: number) {
    const effects = layer.effects?.filter(e => e.enabled);
    if (!effects?.length) return;
    const w = source.width, h = source.height, original = canvas(w, h), mask = canvas(w, h), temp = canvas(w, h), result = source.getContext("2d")!;
    original.getContext("2d")!.drawImage(source, 0, 0);
    const content = original.getContext("2d")!.getImageData(0, 0, w, h), rgba = content.data, m = mask.getContext("2d")!, t = temp.getContext("2d")!;
    const colorOf = (e: LayerEffect) => [1, 3, 5].map(i => parseInt(e.color.slice(i, i + 2), 16));
    const tint = (i: number, color: number[], amount: number) => { for (let k = 0; k < 3; k++) rgba[i + k] = rgba[i + k] * (1 - amount) + color[k] * amount; };
    const shade = (e: LayerEffect, inner: boolean) => {
        m.clearRect(0, 0, w, h); m.globalCompositeOperation = "source-over"; m.drawImage(original, 0, 0); m.globalCompositeOperation = "source-in"; m.fillStyle = e.color; m.fillRect(0, 0, w, h); m.globalCompositeOperation = "source-over";
        const angle = (e.values.angle || 0) * Math.PI / 180, distance = (e.values.distance || 0) * scale, dx = -Math.cos(angle) * distance, dy = Math.sin(angle) * distance;
        t.clearRect(0, 0, w, h); t.globalCompositeOperation = "source-over"; t.filter = `blur(${(e.values.blur ?? e.values.size ?? 0) * scale}px)`; t.drawImage(mask, dx, dy); t.filter = "none";
        if (inner) {
            const blurred = t.getImageData(0, 0, w, h).data, color = colorOf(e);
            for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) tint(i, color, e.opacity * (1 - blurred[i + 3] / 255));
        } else { result.save(); result.globalAlpha = e.opacity; result.drawImage(temp, 0, 0); result.restore(); }
    };
    try {
        result.resetTransform(); result.clearRect(0, 0, w, h);
        for (const e of effects) if (e.kind === "shadow" || e.kind === "outerGlow") shade(e, false);
        const overlay = effects.find(e => e.kind === "overlay");
        if (overlay) {
            const color = colorOf(overlay);
            for (let i = 0; i < rgba.length; i += 4) if (rgba[i + 3]) tint(i, color, overlay.opacity);
        }
        for (const e of effects) if (e.kind === "innerShadow" || e.kind === "innerGlow") shade(e, true);
        const stroke = effects.find(e => e.kind === "stroke");
        if (stroke && stroke.values.size) {
            const distance = edgeDistance(rgba, w, h, !stroke.values.inside), pixels = m.createImageData(w, h), color = [1, 3, 5].map(i => parseInt(stroke.color.slice(i, i + 2), 16));
            for (let p = 0; p < w * h; p++) {
                const coverage = Math.max(0, Math.min(1, stroke.values.size * scale + .5 - distance[p]));
                if (stroke.values.inside) tint(p * 4, color, stroke.opacity * coverage);
                else { pixels.data.set(color, p * 4); pixels.data[p * 4 + 3] = 255 * coverage; }
            }
            if (!stroke.values.inside) { m.putImageData(pixels, 0, 0); result.save(); result.globalAlpha = stroke.opacity; result.drawImage(mask, 0, 0); result.restore(); }
        }
        m.putImageData(content, 0, 0); result.drawImage(mask, 0, 0);
    } finally { original.width = original.height = mask.width = mask.height = temp.width = temp.height = 0; }
}
