import type { Quad } from "./perspective";
import { uniqueReferences, referenceRoleBlock } from "./reference-roles.js";
import { validImageSize, MAX_IMAGE_DATA_URL } from "./image-limits.js";
import { validImageSource } from "./resource-url.js";
import { adjustmentDefinitions, effectDefinitions, validAdjustment, validEffects } from "./tone-schema.js";
export type Adjustment = { kind: keyof typeof adjustmentDefinitions; values: Record<string, number>; colors?: string[]; curves?: number[][][] };
export type LayerEffect = { kind: keyof typeof effectDefinitions; enabled: boolean; color: string; opacity: number; values: Record<string, number> };

export type PromptModule = { id: string; name: string; kind: string; text: string; global?: boolean };
export type Reference = { assetId: string; role: string };
export type Recipe = { id: string; name: string; moduleIds: string[]; references: Reference[]; output: string; size: string };
export type Asset = {
    id: string;
    name: string;
    dataUrl: string;
    width: number;
    height: number;
    hasAlpha: boolean;
    recipeId?: string;
    prompt?: string;
    model?: string;
    createdAt: string;
    fingerprint?: string;
    sourceNodeId?: string;
    toolJobId?: string;
    generationJobId?: string;
    toolOutputIndex?: number;
    sourceAssetId?: string;
    secondarySourceAssetId?: string;
    tool?: string;
    toolOptions?: Record<string, string | number>;
};
export const blendModes = [
    ["source-over", "正常"],
    ["darken", "变暗"],
    ["multiply", "正片叠底"],
    ["color-burn", "颜色加深"],
    ["linear-burn", "线性加深"],
    ["lighten", "变亮"],
    ["screen", "滤色"],
    ["color-dodge", "颜色减淡"],
    ["linear-dodge", "线性减淡"],
    ["overlay", "叠加"],
    ["soft-light", "柔光"],
    ["hard-light", "强光"],
    ["vivid-light", "亮光"],
    ["linear-light", "线性光"],
    ["pin-light", "点光"],
    ["hard-mix", "实色混合"],
    ["difference", "差值"],
    ["exclusion", "排除"],
    ["subtract", "减去"],
    ["divide", "划分"],
    ["hue", "色相"],
    ["saturation", "饱和度"],
    ["color", "颜色"],
    ["luminosity", "明度"],
] as const;
export type BlendMode = (typeof blendModes)[number][0];
export type MaskPath = { points: number[]; operation: "add" | "subtract" | "intersect" };
export type RasterBitmap = { dataUrl: string; width: number; height: number };
export type DocumentSelection = { paths?: MaskPath[]; bitmap?: RasterBitmap; feather?: number; grow?: number; inverted?: boolean };
export type LayerMask = { x: number; y: number; width: number; height: number; paths?: MaskPath[]; bitmap?: RasterBitmap; inverted?: boolean; feather?: number; disabled?: boolean;
    anchor?: { matrix: number[]; width: number; height: number; warp?: Quad };
    offset?: { x: number; y: number; rotation: number; scale: number };
};
export type Layer = {
    id: string;
    name: string;
    kind: "image" | "text" | "group" | "shape" | "adjustment";
    adjustment?: Adjustment;
    effects?: LayerEffect[];
    assetId?: string;
    bitmap?: RasterBitmap;
    parentId?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
    opacity: number;
    visible: boolean;
    locked: boolean;
    flipX: boolean;
    flipY: boolean;
    blend: BlendMode;
    scaleX?: number;
    scaleY?: number;
    skewX?: number;
    text?: string;
    fontSize?: number;
    color?: string;
    fontFamily?: string;
    align?: "left" | "center" | "right" | "justify";
    lineHeight?: number;
    letterSpacing?: number;
    fontStyle?: "normal" | "bold" | "italic" | "bold italic";
    shape?: "rect" | "ellipse" | "line";
    radius?: number;
    stroke?: string;
    strokeWidth?: number;
    gradient?: { endColor: string; angle: number };
    clipping?: boolean;
    warp?: Quad;
    mask?: LayerMask;
    maskSourceId?: string;
};
export type Job = { id: string; recipeId: string; name: string; prompt: string; fingerprint: string; model: string; status: "running" | "completed" | "failed" | "interrupted"; startedAt: string; error?: string; assetId?: string };
export type StudioProject = {
    format: "canvas-studio";
    version: 1 | 2 | 3 | 4 | 5;
    id: string;
    name: string;
    updatedAt: string;
    width: number;
    height: number;
    background: string;
    modules: PromptModule[];
    recipes: Recipe[];
    assets: Asset[];
    layers: Layer[];
    selection?: DocumentSelection;
    jobs: Job[];
    canvasProjectIds?: string[];
    splitPlans?: { sourceId: string; targets: string }[];
    layout?: { snap: boolean; grid: boolean; rulers: boolean; gridSize: number; guides: { axis: "x" | "y"; position: number }[] };
};
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const commonStyle =
    "温柔清新的二维清线婚礼插画。用圆润、舒展的形状和纤细暖灰褐线条表达物体，轮廓清楚，内部线条克制。以干净的浅色色面为主，仅在主要转折处添加少量柔和阴影，大部分区域保持平整明亮。奶油白、雾霭蓝、柔和叶绿为主，少量淡粉点缀。\n整体细致但轻盈，具有亲切的卡通插画感；细节服务于造型，不追求真实材质与立体塑造。避免密集碎线、复杂渐变、强烈高光、写实纹理和厚重描边。各类素材保持一致的线条、配色与简化程度。";
export function blankProject(): StudioProject {
    return {
        format: "canvas-studio",
        version: 4,
        id: uid(),
        name: "未命名创作",
        updatedAt: now(),
        width: 1024,
        height: 1536,
        background: "#fffdf8",
        modules: [{ id: uid(), name: "公共画风", kind: "style", text: "", global: true }],
        recipes: [],
        assets: [],
        layers: [],
        jobs: [],
    };
}
export function createLayer(kind: Layer["kind"], name: string): Layer {
    return { id: uid(), kind, name, x: 0, y: 0, width: 400, height: 400, rotation: 0, opacity: 1, visible: true, locked: false, flipX: false, flipY: false, blend: "source-over" };
}
// Projects saved before the scope switch treated style modules as global.
export const isGlobalModule = (module: PromptModule) => module.global ?? module.kind === "style";
export function recipeModules(project: StudioProject, recipe: Recipe): PromptModule[] {
    const selected = recipe.moduleIds.map((id) => project.modules.find((m) => m.id === id)).filter((m): m is PromptModule => !!m && !isGlobalModule(m));
    return [...new Map([...selected, ...project.modules.filter(isGlobalModule)].filter((m) => m.text.trim()).map((m) => [m.id, m])).values()].sort((a, b) => Number(a.kind === "style") - Number(b.kind === "style"));
}
export function buildPrompt(project: StudioProject, recipe: Recipe): string {
    const modules = recipeModules(project, recipe);
    const refs = referenceRoleBlock(uniqueReferences(recipe.references).map(r => r.role));
    return [refs, ...modules.map((m) => `【${m.name}${m.kind === "style" ? " · 统一约束以上全部内容" : ""}】\n${m.text.trim()}`), `【构图与输出】\n${recipe.output.trim()}`].filter(Boolean).join("\n\n");
}
export function recipeFingerprint(project: StudioProject, recipe: Recipe): string {
    // IDs refer to immutable asset versions, so swapping a reference also invalidates the recipe.
    return JSON.stringify([buildPrompt(project, recipe), recipe.size, uniqueReferences(recipe.references).map((r) => r.assetId)]);
}
export function recipeIsStale(project: StudioProject, recipe: Recipe): boolean {
    const latest = project.assets.filter((a) => a.recipeId === recipe.id).at(-1);
    return !!latest?.fingerprint && latest.fingerprint !== recipeFingerprint(project, recipe);
}
export function layerEntries(layers: Layer[], parentId?: string, depth = 0): { layer: Layer; depth: number }[] {
    return layers
        .filter((l) => l.parentId === parentId)
        .reverse()
        .flatMap((layer) => [{ layer, depth }, ...layerEntries(layers, layer.id, depth + 1)]);
}
export function removeLayers(layers: Layer[], ids: string[]): Layer[] {
    const removed = new Set(ids);
    let size = 0;
    while (size !== removed.size) {
        size = removed.size;
        layers.forEach((l) => {
            if (l.parentId && removed.has(l.parentId)) removed.add(l.id);
        });
    }
    return layers.filter((l) => !removed.has(l.id)).map(l => l.maskSourceId && removed.has(l.maskSourceId) ? { ...l, maskSourceId: undefined } : l);
}
export function validateProject(value: unknown): asserts value is StudioProject {
    if (!value || typeof value !== "object") throw new Error("工程文件不是有效对象");
    const p = value as StudioProject;
    const finite = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
    const list = (v: unknown, max: number) => Array.isArray(v) && v.length <= max;
    if (
        p.format !== "canvas-studio" ||
        ![1, 2, 3, 4, 5].includes(p.version) ||
        !/^[\w-]{1,80}$/.test(p.id) ||
        typeof p.name !== "string" ||
        !validImageSize(p.width, p.height) ||
        !/^#[\da-fA-F]{6}$|^transparent$/.test(p.background)
    )
        throw new Error("工程格式、版本或画布尺寸无效（最大 30000 边长 / 1 亿像素）");
    if (!list(p.modules, 300) || !list(p.recipes, 300) || !list(p.assets, 500) || !list(p.layers, 500) || !list(p.jobs, 1000)) throw new Error("工程内容超出限制");
    if (p.selection) {
        const s = p.selection, b = s.bitmap;
        if (p.version < 4 || !!b === !!s.paths ||
            (b && (!validImageSource(b.dataUrl, true) || b.dataUrl.length > MAX_IMAGE_DATA_URL || b.width !== p.width || b.height !== p.height)) ||
            (s.paths && (!list(s.paths, 100) || s.paths.some(path => !["add", "subtract", "intersect"].includes(path.operation) || !list(path.points, 20000) || path.points.length < 6 || path.points.length % 2 || path.points.some(n => !finite(n, -100000, 100000))))) ||
            (s.feather !== undefined && !finite(s.feather, 0, 100)) || (s.grow !== undefined && (!finite(s.grow, -100, 100) || !Number.isInteger(s.grow))) ||
            (s.inverted !== undefined && typeof s.inverted !== "boolean")) throw new Error("文档选区参数无效");
    }
    if (p.canvasProjectIds && (!list(p.canvasProjectIds, 1000) || p.canvasProjectIds.some((id) => typeof id !== "string" || !/^[\w-]{1,80}$/.test(id)))) throw new Error("画布关联无效");
    if (p.splitPlans && (!list(p.splitPlans, 500) || new Set(p.splitPlans.map(s => s.sourceId)).size !== p.splitPlans.length || p.splitPlans.some(s => !/^[\w-]{1,80}$/.test(s.sourceId) || typeof s.targets !== "string" || s.targets.length > 3600))) throw new Error("拆分方案无效");
    for (const items of [p.modules, p.recipes, p.assets, p.layers, p.jobs]) if (new Set(items.map((i) => i.id)).size !== items.length || items.some((i) => !/^[\w-]{1,80}$/.test(i.id))) throw new Error("工程存在重复或无效 ID");
    for (const m of p.modules) if (![m.name, m.kind, m.text].every((s) => typeof s === "string") || m.text.length > 100000 || (m.global !== undefined && typeof m.global !== "boolean")) throw new Error("提示词模块无效");
    for (const a of p.assets)
        if (typeof a.name !== "string" || !validImageSource(a.dataUrl) || a.dataUrl.length > MAX_IMAGE_DATA_URL || !validImageSize(a.width, a.height))
            throw new Error("素材必须是有效的 PNG / JPEG / WebP 图片");
    for (const r of p.recipes)
        if (
            typeof r.name !== "string" ||
            typeof r.output !== "string" ||
            !/^\d{2,5}x\d{2,5}$/.test(r.size) ||
            !list(r.moduleIds, 300) ||
            r.moduleIds.some((id) => !p.modules.some((m) => m.id === id)) ||
            !list(r.references, 12) ||
            r.references.some((ref) => !p.assets.some((a) => a.id === ref.assetId) || typeof ref.role !== "string")
        )
            throw new Error("素材配方引用无效");
    for (const l of p.layers) {
        if (
            !["image", "text", "group", "shape", "adjustment"].includes(l.kind) ||
            typeof l.name !== "string" ||
            !finite(l.x, -100000, 100000) ||
            !finite(l.y, -100000, 100000) ||
            !finite(l.width, 1, 100000) ||
            !finite(l.height, 1, 100000) ||
            !finite(l.rotation, -36000, 36000) ||
            !finite(l.opacity, 0, 1) ||
            !blendModes.some(([mode]) => mode === l.blend) ||
            ![l.visible, l.locked, l.flipX, l.flipY].every((v) => typeof v === "boolean")
        )
            throw new Error("图层参数无效");
        if (l.kind === "adjustment" ? p.version < 5 || !validAdjustment(l.adjustment) || !!l.warp || !!l.maskSourceId || !!l.effects?.length : l.adjustment !== undefined) throw new Error("调整图层参数无效或工程版本过旧");
        if (l.effects !== undefined && (p.version < 5 || !validEffects(l.effects))) throw new Error("图层特效参数无效或工程版本过旧");
        if (l.kind === "image" && !l.bitmap && !p.assets.some((a) => a.id === l.assetId)) throw new Error("图层引用的素材缺失");
        if (l.bitmap && l.kind !== "image") throw new Error("只有图片图层可以包含绘画副本");
        for (const bitmap of [l.bitmap, l.mask?.bitmap]) {
            if (
                bitmap &&
                (p.version < 4 ||
                    !validImageSource(bitmap.dataUrl, true) ||
                    bitmap.dataUrl.length > MAX_IMAGE_DATA_URL ||
                    !validImageSize(bitmap.width, bitmap.height))
            )
                throw new Error("像素副本需要 V4 工程的有效 PNG，最大 1 亿像素");
        }
        if (l.mask?.bitmap && l.mask.paths) throw new Error("像素蒙版与路径蒙版不能同时存在");
        if (l.kind === "text" && (typeof l.text !== "string" || l.text.length > 100000 || !finite(l.fontSize || 0, 1, 1000) || (l.fontFamily !== undefined && (typeof l.fontFamily !== "string" || l.fontFamily.length > 200))))
            throw new Error("文字图层无效");
        if (l.kind === "shape" && !["rect", "ellipse", "line"].includes(l.shape || "")) throw new Error("形状图层无效");
        for (const key of ["scaleX", "scaleY"] as const) if (l[key] !== undefined && (!finite(l[key]!, -1000, 1000) || Math.abs(l[key]!) < 0.001)) throw new Error("图层缩放无效");
        if (l.skewX !== undefined && !finite(l.skewX, -100, 100)) throw new Error("图层倾斜无效");
        if (l.align !== undefined && !["left", "center", "right", "justify"].includes(l.align)) throw new Error("文字对齐无效");
        if (l.fontStyle !== undefined && !["normal", "bold", "italic", "bold italic"].includes(l.fontStyle)) throw new Error("文字样式无效");
        if (l.lineHeight !== undefined && !finite(l.lineHeight, 0.5, 5)) throw new Error("行距无效");
        if (l.letterSpacing !== undefined && !finite(l.letterSpacing, -50, 200)) throw new Error("字距无效");
        if (l.radius !== undefined && !finite(l.radius, 0, 10000)) throw new Error("圆角无效");
        if (l.strokeWidth !== undefined && !finite(l.strokeWidth, 0, 500)) throw new Error("描边无效");
        for (const color of [l.color, l.stroke, l.gradient?.endColor]) if (color !== undefined && !/^#[a-f\d]{6}$/i.test(color)) throw new Error("图层颜色无效");
        if (l.gradient && !finite(l.gradient.angle, -360, 360)) throw new Error("渐变角度无效");
        if (l.clipping !== undefined && typeof l.clipping !== "boolean") throw new Error("剪贴图层无效");
        if (l.warp) {
            if (p.version < 3 || l.kind === "group" || (l.kind !== "image" && p.version < 4) || !list(l.warp, 8) || l.warp.length !== 8 || l.warp.some((n) => !finite(n, -2, 3)))
                throw new Error("四角变形需要有效四边形；文字和形状需要 V4 工程，组请先合并");
            const cross = [0, 2, 4, 6].map((a) => {
                const b = (a + 2) % 8,
                    c = (a + 4) % 8,
                    q = l.warp!;
                return (q[b] - q[a]) * (q[c + 1] - q[b + 1]) - (q[b + 1] - q[a + 1]) * (q[c] - q[b]);
            });
            if (cross.some((n) => Math.abs(n) < 0.00001) || !cross.every((n) => Math.sign(n) === Math.sign(cross[0]))) throw new Error("四角不能交叉或折叠");
        }
        if (l.mask && ![l.mask.x, l.mask.y, l.mask.width, l.mask.height].every((v) => finite(v, 0, 1))) throw new Error("蒙版参数无效");
        if (
            l.mask?.paths &&
            (!list(l.mask.paths, 100) ||
                l.mask.paths.some((path) => !["add", "subtract", "intersect"].includes(path.operation) || !list(path.points, 20000) || path.points.length < 6 || path.points.length % 2 || path.points.some((v) => !finite(v, -1000, 1000))))
        )
            throw new Error("选区路径无效");
        if (l.mask?.feather !== undefined && !finite(l.mask.feather, 0, 200)) throw new Error("蒙版羽化无效");
        if ([l.mask?.inverted, l.mask?.disabled].some((v) => v !== undefined && typeof v !== "boolean")) throw new Error("蒙版开关无效");
        const anchor = l.mask?.anchor, offset = l.mask?.offset;
        if (offset && (!finite(offset.x, -100000, 100000) || !finite(offset.y, -100000, 100000) || !finite(offset.rotation, -36000, 36000) || !finite(offset.scale, .01, 100))) throw new Error("蒙版变换无效");
        if (anchor) {
            if (!list(anchor.matrix, 6) || anchor.matrix.length !== 6 || anchor.matrix.some(n => !finite(n, -100000, 100000)) || Math.abs(anchor.matrix[0] * anchor.matrix[3] - anchor.matrix[1] * anchor.matrix[2]) < 1e-8 ||
                !finite(anchor.width, 1, 100000) || !finite(anchor.height, 1, 100000)) throw new Error("蒙版独立坐标无效");
            if (anchor.warp) {
                const q = anchor.warp;
                if (!list(q, 8) || q.length !== 8 || q.some(n => !finite(n, -2, 3))) throw new Error("蒙版透视坐标无效");
                const cross = [0, 2, 4, 6].map(a => { const b = (a + 2) % 8, c = (b + 2) % 8; return (q[b] - q[a]) * (q[c + 1] - q[b + 1]) - (q[b + 1] - q[a + 1]) * (q[c] - q[b]); });
                if (cross.some(n => Math.abs(n) < .00001) || !cross.every(n => Math.sign(n) === Math.sign(cross[0]))) throw new Error("蒙版透视不能折叠");
            }
        }
        if (l.maskSourceId) {
            const visited = new Set([l.id]); let id: string | undefined = l.maskSourceId;
            if (l.kind === "group") throw new Error("组请使用组蒙版，实时引用仅用于普通图层");
            while (id) {
                const source = p.layers.find(n => n.id === id);
                if (!source || source.kind === "group" || source.kind === "adjustment" || visited.has(id) || visited.size >= 32) throw new Error("蒙版引用缺失、循环或超过 32 层");
                visited.add(id); id = source.maskSourceId;
            }
        }
        const seen = new Set([l.id]);
        let parent = l.parentId;
        while (parent) {
            const node = p.layers.find((n) => n.id === parent);
            if (!node || node.kind !== "group" || seen.has(parent) || seen.size > 32) throw new Error("图层分组存在循环或无效父级");
            seen.add(parent);
            parent = node.parentId;
        }
    }
    if (
        p.layout &&
        (![p.layout.snap, p.layout.grid, p.layout.rulers].every((v) => typeof v === "boolean") ||
            !finite(p.layout.gridSize, 4, 1000) ||
            !list(p.layout.guides, 100) ||
            p.layout.guides.some((g) => !["x", "y"].includes(g.axis) || !finite(g.position, -100000, 100000)))
    )
        throw new Error("参考线设置无效");
}
export function recoverProject(project: StudioProject): StudioProject {
    validateProject(project);
    return {
        ...project,
        version: project.version === 5 ? 5 : 4,
        layers: project.layers.map((layer) => {
            // V1 clipped outside the flipped image; V2 masks share the layer transform.
            if (project.version !== 1 || !layer.mask || (!layer.flipX && !layer.flipY)) return layer;
            const mask = layer.mask,
                width = Math.min(mask.width, 1 - mask.x),
                height = Math.min(mask.height, 1 - mask.y);
            return { ...layer, mask: { ...mask, width, height, x: layer.flipX ? 1 - mask.x - width : mask.x, y: layer.flipY ? 1 - mask.y - height : mask.y } };
        }),
        modules: project.modules.map((m) => ({ ...m, global: isGlobalModule(m) })),
        jobs: project.jobs.map((j) => (j.status === "running" ? { ...j, status: "interrupted", error: "应用关闭时任务尚未完成。请先检查模型服务的请求记录，避免重复计费。" } : j)),
    };
}
