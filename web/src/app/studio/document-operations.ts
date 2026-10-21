import Konva from "konva";
import type { StudioProject } from "./model";
import { localTransform, transformValues } from "./layer-operations";
import { validImageSize } from "./image-limits.js";

export function resizeDocument(project: StudioProject, width: number, height: number, scaleContent: boolean) {
    if (width < 64 || height < 64 || !validImageSize(width, height)) throw new Error("尺寸需为 64–30000 的整数，总像素不超过 1 亿");
    const sx = width / project.width,
        sy = height / project.height;
    const matrix = scaleContent ? new Konva.Transform().scale(sx, sy) : new Konva.Transform().translate((width - project.width) / 2, (height - project.height) / 2);
    return {
        ...project,
        selection: undefined,
        width,
        height,
        layers: project.layers.map((l) => ({
            ...l,
            ...(!l.parentId && transformValues(matrix.copy().multiply(localTransform(l)))),
            ...(l.mask?.anchor && { mask: { ...l.mask, anchor: { ...l.mask.anchor, matrix: matrix.copy().multiply(new Konva.Transform(l.mask.anchor.matrix)).getMatrix() } } }),
        })),
        layout: project.layout && {
            ...project.layout,
            guides: project.layout.guides.map((g) => ({ ...g, position: scaleContent ? g.position * (g.axis === "x" ? sx : sy) : g.position + (g.axis === "x" ? width - project.width : height - project.height) / 2 })),
        },
    };
}
export function cropDocument(project: StudioProject, rect: { x: number; y: number; width: number; height: number }) {
    if (![rect.x, rect.y].every(Number.isFinite) || Math.abs(rect.x) > 100000 || Math.abs(rect.y) > 100000) throw new Error("裁剪位置无效");
    resizeDocument(project, rect.width, rect.height, false);
    return {
        ...project,
        selection: undefined,
        width: rect.width,
        height: rect.height,
        layers: project.layers.map((l) => ({
            ...l,
            ...(!l.parentId && { x: l.x - rect.x, y: l.y - rect.y }),
            ...(l.mask?.anchor && { mask: { ...l.mask, anchor: { ...l.mask.anchor, matrix: new Konva.Transform().translate(-rect.x, -rect.y).multiply(new Konva.Transform(l.mask.anchor.matrix)).getMatrix() } } }),
        })),
        layout: project.layout && { ...project.layout, guides: project.layout.guides.map((g) => ({ ...g, position: g.position - (g.axis === "x" ? rect.x : rect.y) })) },
    };
}
