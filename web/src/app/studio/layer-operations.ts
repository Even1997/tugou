import Konva from "konva";
import type { Layer, StudioProject } from "./model";

function checkHierarchy(layers: Layer[]) {
    if (layers.length > 500) throw new Error("工程最多支持 500 个图层");
    for (const layer of layers) {
        let parent = layer.parentId,
            depth = 0;
        while (parent) {
            if (++depth > 32) throw new Error("图层组最多嵌套 32 层");
            parent = layers.find((l) => l.id === parent)?.parentId;
        }
    }
}
export function localTransform(layer: Layer) {
    return new Konva.Transform()
        .translate(layer.x, layer.y)
        .rotate((layer.rotation * Math.PI) / 180)
        .skew(layer.skewX ?? 0, 0)
        .scale(layer.scaleX ?? 1, layer.scaleY ?? 1)
        .translate(layer.flipX ? layer.width : 0, layer.flipY ? layer.height : 0)
        .scale(layer.flipX ? -1 : 1, layer.flipY ? -1 : 1);
}
export function worldTransform(layer: Layer, layers: Layer[]): Konva.Transform {
    const parent = layers.find((l) => l.id === layer.parentId);
    return parent ? worldTransform(parent, layers).multiply(localTransform(layer)) : localTransform(layer);
}
export function transformValues(transform: Konva.Transform): Partial<Layer> {
    const { x, y, rotation, scaleX, scaleY, skewX } = transform.decompose();
    return { x, y, rotation, scaleX, scaleY, skewX, flipX: false, flipY: false };
}
export function isLayerLocked(layer: Layer, layers: Layer[]): boolean {
    const parent = layers.find((l) => l.id === layer.parentId);
    return layer.locked || (!!parent && isLayerLocked(parent, layers));
}
export function normalizeGroupFrames(layers: Layer[]) {
    let result = layers;
    const depth = (l: Layer): number => (l.parentId ? 1 + depth(layers.find((n) => n.id === l.parentId)!) : 0);
    for (const group of layers.filter((l) => l.kind === "group").sort((a, b) => depth(b) - depth(a))) {
        const children = result.filter((l) => l.parentId === group.id && l.kind !== "adjustment");
        if (!children.length) continue;
        const boxes = children.map((l) => layerBounds({ ...l, parentId: undefined }, []));
        const x = Math.min(...boxes.map((b) => b.x)),
            y = Math.min(...boxes.map((b) => b.y));
        const width = Math.max(1, ...boxes.map((b) => b.x + b.width - x)),
            height = Math.max(1, ...boxes.map((b) => b.y + b.height - y));
        if (Math.abs(x) < 1e-8 && Math.abs(y) < 1e-8 && Math.abs(group.width - width) < 1e-8 && Math.abs(group.height - height) < 1e-8) continue;
        const updated = { ...group, ...transformValues(localTransform(group).translate(x, y)), width, height };
        // Rectangular masks retain their absolute placement when the frame changes.
        if (group.mask?.paths || group.mask?.bitmap || group.mask?.anchor) continue;
        if (group.mask) updated.mask = { ...group.mask, x: (group.mask.x * group.width - x) / width, y: (group.mask.y * group.height - y) / height, width: (group.mask.width * group.width) / width, height: (group.mask.height * group.height) / height };
        // Existing normalized masks may extend outside a reframed group; keep that frame fixed.
        if (updated.mask && [updated.mask.x, updated.mask.y, updated.mask.width, updated.mask.height].some((v) => v < 0 || v > 1)) continue;
        result = result.map((l) => (l.id === group.id ? updated : l.parentId === group.id ? { ...l, x: l.x - x, y: l.y - y } : l));
    }
    return result;
}
export function rootSelection(layers: Layer[], selected: string[]) {
    const ids = new Set(selected);
    return layers.filter((l) => {
        if (!ids.has(l.id)) return false;
        let parent = l.parentId;
        while (parent) {
            if (ids.has(parent)) return false;
            parent = layers.find((n) => n.id === parent)?.parentId;
        }
        return true;
    });
}
export function layerBounds(layer: Layer, layers: Layer[]) {
    const matrix = worldTransform(layer, layers);
    const corners = layer.warp
        ? [0, 2, 4, 6].map((i) => [layer.warp![i] * layer.width, layer.warp![i + 1] * layer.height])
        : [
              [0, 0],
              [layer.width, 0],
              [layer.width, layer.height],
              [0, layer.height],
          ];
    const points = corners.map(([x, y]) => matrix.point({ x, y }));
    return {
        x: Math.min(...points.map((p) => p.x)),
        y: Math.min(...points.map((p) => p.y)),
        width: Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x)),
        height: Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y)),
    };
}
export function moveLayers(project: StudioProject, ids: string[], dx: number, dy: number) {
    const selected = new Set(
        rootSelection(project.layers, ids)
            .filter((l) => !isLayerLocked(l, project.layers))
            .map((l) => l.id),
    );
    return {
        ...project,
        layers: project.layers.map((l) => {
            if (!selected.has(l.id)) return l;
            const parent = project.layers.find((n) => n.id === l.parentId);
            const inverse = parent ? worldTransform(parent, project.layers).invert() : new Konva.Transform();
            const zero = inverse.point({ x: 0, y: 0 }),
                delta = inverse.point({ x: dx, y: dy });
            return { ...l, x: l.x + delta.x - zero.x, y: l.y + delta.y - zero.y };
        }),
    };
}
export function snapTranslation(project: StudioProject, ids: string[], dx: number, dy: number, zoom: number) {
    const moving = rootSelection(project.layers, ids).filter((l) => !isLayerLocked(l, project.layers)),
        selected = new Set(ids);
    const excluded = new Set(ids);
    for (const layer of project.layers) {
        let parent = layer.parentId;
        while (parent) {
            if (selected.has(parent)) excluded.add(layer.id);
            parent = project.layers.find((l) => l.id === parent)?.parentId;
        }
    }
    for (const layer of moving) {
        let parent = layer.parentId;
        while (parent) {
            excluded.add(parent);
            parent = project.layers.find((l) => l.id === parent)?.parentId;
        }
    }
    const boxes = moving.map((l) => layerBounds(l, project.layers));
    if (!boxes.length) return { dx, dy };
    const others = project.layers
        .filter((l) => {
            if (!l.visible || excluded.has(l.id)) return false;
            let parent = l.parentId;
            while (parent) {
                const ancestor = project.layers.find((n) => n.id === parent);
                if (!ancestor?.visible) return false;
                parent = ancestor.parentId;
            }
            return true;
        })
        .map((l) => layerBounds(l, project.layers));
    const delta = (axis: "x" | "y", amount: number) => {
        const dimension = axis === "x" ? "width" : "height",
            size = axis === "x" ? project.width : project.height;
        const min = Math.min(...boxes.map((b) => b[axis])),
            max = Math.max(...boxes.map((b) => b[axis] + b[dimension]));
        const edges = [min + amount, (min + max) / 2 + amount, max + amount];
        const targets = [0, size / 2, size, ...(project.layout?.guides || []).filter((g) => g.axis === axis).map((g) => g.position), ...others.flatMap((b) => [b[axis], b[axis] + b[dimension] / 2, b[axis] + b[dimension]])];
        if (project.layout?.grid) edges.forEach((value) => targets.push(Math.round(value / project.layout!.gridSize) * project.layout!.gridSize));
        let correction = 0,
            distance = 6 / zoom;
        for (const edge of edges)
            for (const target of targets)
                if (Math.abs(target - edge) < distance) {
                    correction = target - edge;
                    distance = Math.abs(correction);
                }
        return amount + correction;
    };
    return { dx: delta("x", dx), dy: delta("y", dy) };
}
export function groupLayers(project: StudioProject, ids: string[], group: Layer) {
    const selected = rootSelection(project.layers, ids);
    if (!selected.length || selected.some((l) => isLayerLocked(l, project.layers) || l.parentId !== selected[0].parentId || l.clipping)) throw new Error("请选择同一层级的未锁定、非剪贴图层");
    const boxes = selected.map((l) => layerBounds({ ...l, parentId: undefined }, []));
    const x = Math.min(...boxes.map((b) => b.x)),
        y = Math.min(...boxes.map((b) => b.y));
    const created = { ...group, parentId: selected[0].parentId, x, y, width: Math.max(1, ...boxes.map((b) => b.x + b.width - x)), height: Math.max(1, ...boxes.map((b) => b.y + b.height - y)) };
    const chosen = new Set(selected.map((l) => l.id));
    const layers = project.layers.map((l) => (chosen.has(l.id) ? { ...l, x: l.x - x, y: l.y - y, parentId: group.id } : l));
    layers.splice(Math.max(...selected.map((l) => project.layers.indexOf(l))) + 1, 0, created);
    checkHierarchy(layers);
    return { ...project, layers };
}
export function ungroupLayer(project: StudioProject, id: string) {
    const group = project.layers.find((l) => l.id === id);
    if (!group || group.kind !== "group" || isLayerLocked(group, project.layers)) return project;
    if (group.opacity !== 1 || group.blend !== "source-over" || group.clipping || group.mask || group.effects?.length || project.layers.some((l) => l.parentId === id && (l.blend !== "source-over" || l.kind === "adjustment"))) throw new Error("组包含调整图层、特效、蒙版或独立合成参数，请保留分组，或合并为图片");
    const children = project.layers.filter((l) => l.parentId === id).map((l) => ({ ...l, ...transformValues(localTransform(group).multiply(localTransform(l))), parentId: group.parentId, visible: group.visible && l.visible }));
    return { ...project, layers: project.layers.flatMap((l) => (l.id === id ? children : l.parentId === id ? [] : [l])) };
}
export function duplicateLayers(project: StudioProject, ids: string[]) {
    const roots = rootSelection(project.layers, ids);
    const copying = new Set(roots.map((l) => l.id));
    for (let size = -1; size !== copying.size;) {
        size = copying.size;
        project.layers.forEach((l) => {
            if (l.parentId && copying.has(l.parentId)) copying.add(l.id);
        });
    }
    const replacements = new Map([...copying].map((id) => [id, crypto.randomUUID()]));
    const shiftedAnchor = (layer: Layer) => {
        const anchor = layer.mask?.anchor;
        if (!anchor) return {};
        let root = layer;
        while (!roots.includes(root)) root = project.layers.find(l => l.id === root.parentId)!;
        const parent = project.layers.find(l => l.id === root.parentId), matrix = parent ? worldTransform(parent, project.layers).getMatrix() : [1,0,0,1,0,0];
        const moved = [...anchor.matrix]; moved[4] += (matrix[0] + matrix[2]) * 20; moved[5] += (matrix[1] + matrix[3]) * 20;
        return { mask: { ...layer.mask!, anchor: { ...anchor, matrix: moved } } };
    };
    const copies = project.layers
        .filter((l) => copying.has(l.id))
        .map((l) => ({
            ...l,
            id: replacements.get(l.id)!,
            parentId: replacements.get(l.parentId || "") || l.parentId,
            ...(l.maskSourceId && { maskSourceId: replacements.get(l.maskSourceId) || l.maskSourceId }),
            ...shiftedAnchor(l),
            ...(roots.includes(l) ? { x: l.x + 20, y: l.y + 20, name: `${l.name} 副本` } : {}),
        }));
    const layers = [...project.layers];
    layers.splice(Math.max(-1, ...roots.map((l) => layers.indexOf(l))) + 1, 0, ...copies);
    checkHierarchy(layers);
    return { project: { ...project, layers }, selected: roots.map((l) => replacements.get(l.id)!) };
}
export function reparentLayer(project: StudioProject, id: string, parentId?: string, beforeId?: string) {
    const layer = project.layers.find((l) => l.id === id);
    const parent = project.layers.find((l) => l.id === parentId);
    if (!layer || isLayerLocked(layer, project.layers) || (parentId && (!parent || parent.kind !== "group" || isLayerLocked(parent, project.layers)))) throw new Error("目标图层已锁定或不能接收子图层");
    let ancestor = parent;
    while (ancestor) {
        if (ancestor.id === id) throw new Error("不能把组放入自己或自己的子组");
        ancestor = project.layers.find((l) => l.id === ancestor!.parentId);
    }
    const matrix = parent ? worldTransform(parent, project.layers).invert() : new Konva.Transform();
    const moved = { ...layer, ...transformValues(matrix.multiply(worldTransform(layer, project.layers))), parentId };
    const layers = project.layers.filter((l) => l.id !== id);
    const index = beforeId ? layers.findIndex((l) => l.id === beforeId && l.parentId === parentId) : -1;
    layers.splice(index < 0 ? layers.length : index, 0, moved);
    checkHierarchy(layers);
    return { ...project, layers };
}
export function alignLayers(project: StudioProject, ids: string[], alignment: "left" | "center" | "right" | "top" | "middle" | "bottom" | "horizontal" | "vertical") {
    const selected = rootSelection(project.layers, ids).filter((l) => !isLayerLocked(l, project.layers));
    if (!selected.length) return project;
    const boxes = selected.map((l) => ({ layer: l, ...layerBounds(l, project.layers) }));
    const bounds =
        selected.length === 1
            ? { x: 0, y: 0, width: project.width, height: project.height }
            : {
                  x: Math.min(...boxes.map((b) => b.x)),
                  y: Math.min(...boxes.map((b) => b.y)),
                  width: Math.max(...boxes.map((b) => b.x + b.width)) - Math.min(...boxes.map((b) => b.x)),
                  height: Math.max(...boxes.map((b) => b.y + b.height)) - Math.min(...boxes.map((b) => b.y)),
              };
    let result = project;
    if (alignment === "horizontal" || alignment === "vertical") {
        if (boxes.length < 3) return project;
        const axis = alignment === "horizontal" ? "x" : "y",
            dimension = axis === "x" ? "width" : "height";
        boxes.sort((a, b) => a[axis] - b[axis]);
        const gap = (bounds[dimension] - boxes.reduce((sum, b) => sum + b[dimension], 0)) / (boxes.length - 1);
        let position = bounds[axis];
        for (const b of boxes) {
            result = moveLayers(result, [b.layer.id], axis === "x" ? position - b.x : 0, axis === "y" ? position - b.y : 0);
            position += b[dimension] + gap;
        }
    } else
        for (const b of boxes) {
            const dx = alignment === "left" ? bounds.x - b.x : alignment === "center" ? bounds.x + (bounds.width - b.width) / 2 - b.x : alignment === "right" ? bounds.x + bounds.width - b.x - b.width : 0;
            const dy = alignment === "top" ? bounds.y - b.y : alignment === "middle" ? bounds.y + (bounds.height - b.height) / 2 - b.y : alignment === "bottom" ? bounds.y + bounds.height - b.y - b.height : 0;
            result = moveLayers(result, [b.layer.id], dx, dy);
        }
    return result;
}
