// Shared by project validation and the toolbar. All sizes are document pixels.
const field = (label, min, max, value, step = 1) => ({ label, min, max, value, step });
export const adjustmentDefinitions = {
    hsv: { label: "色相 / 饱和度", fields: { hue: field("色相", -180, 180, 0), saturation: field("饱和度", -100, 100, 0), lightness: field("明度", -100, 100, 0) } },
    levels: { label: "色阶", fields: { black: field("输入黑场", 0, 254, 0), white: field("输入白场", 1, 255, 255), gamma: field("中间调", .1, 10, 1, .01), low: field("输出黑场", 0, 255, 0), high: field("输出白场", 0, 255, 255) } },
    curves: { label: "曲线", fields: {} },
    exposure: { label: "曝光", fields: { exposure: field("曝光", -10, 10, 0, .1), offset: field("偏移", -.5, .5, 0, .01), gamma: field("伽马", .1, 10, 1, .01) } },
    gradient: { label: "渐变映射", fields: {} },
    bw: { label: "黑白", fields: { red: field("红", -100, 200, 30), green: field("绿", -100, 200, 59), blue: field("蓝", -100, 200, 11) } },
    balance: { label: "色彩平衡", fields: { red: field("青 — 红", -100, 100, 0), green: field("洋红 — 绿", -100, 100, 0), blue: field("黄 — 蓝", -100, 100, 0) } },
    invert: { label: "反相", fields: {} },
    grain: { label: "颗粒", fields: { amount: field("数量", 0, 100, 15), size: field("尺寸", 1, 20, 2), seed: field("图案", 0, 9999, 1) } },
    noise: { label: "添加杂色", fields: { amount: field("数量", 0, 100, 10), mono: field("单色", 0, 1, 1), gaussian: field("高斯分布", 0, 1, 0), seed: field("图案", 0, 9999, 1) } },
    blur: { label: "高斯模糊", fields: { radius: field("半径", 0, 250, 10, .5) } },
    motion: { label: "动感模糊", fields: { distance: field("距离", 0, 2000, 20), angle: field("角度", -180, 180, 0) } },
};
export const effectDefinitions = {
    stroke: { label: "描边", color: "#334638", fields: { size: field("宽度", 0, 500, 4), inside: field("内侧", 0, 1, 0) } },
    shadow: { label: "投影", color: "#000000", fields: { distance: field("距离", 0, 5000, 20), angle: field("角度", -180, 180, 90), blur: field("模糊", 0, 500, 20) } },
    overlay: { label: "颜色叠加", color: "#8aab80", fields: {} },
    innerShadow: { label: "内阴影", color: "#000000", fields: { distance: field("距离", 0, 5000, 10), angle: field("角度", -180, 180, 90), blur: field("模糊", 0, 500, 10) } },
    outerGlow: { label: "外发光", color: "#fff4c2", fields: { size: field("大小", 0, 500, 20) } },
    innerGlow: { label: "内发光", color: "#fff4c2", fields: { size: field("大小", 0, 500, 10) } },
};
export const defaultValues = fields => Object.fromEntries(Object.entries(fields).map(([key, f]) => [key, f.value]));
export const defaultAdjustment = kind => ({
    kind, values: defaultValues(adjustmentDefinitions[kind].fields),
    ...(kind === "gradient" ? { colors: ["#182837", "#fff4da"] } : {}),
    ...(kind === "curves" ? { curves: Array.from({ length: 4 }, () => [[0, 0], [1, 1]]) } : {}),
});
export const defaultEffect = kind => ({ kind, enabled: true, color: effectDefinitions[kind].color, opacity: kind === "shadow" || kind === "innerShadow" ? .5 : .8, values: defaultValues(effectDefinitions[kind].fields) });
const finite = (n, min, max) => typeof n === "number" && Number.isFinite(n) && n >= min && n <= max;
const color = v => typeof v === "string" && /^#[\da-f]{6}$/i.test(v);
function validValues(values, fields) {
    return values && typeof values === "object" && !Array.isArray(values) && Object.keys(values).length === Object.keys(fields).length &&
        Object.entries(fields).every(([key, f]) => finite(values[key], f.min, f.max) && (f.step < 1 || Number.isInteger(values[key])));
}
export function validAdjustment(a) {
    if (!a || !Object.hasOwn(adjustmentDefinitions, a.kind) || !validValues(a.values, adjustmentDefinitions[a.kind].fields)) return false;
    if (a.kind === "levels" && (a.values.black >= a.values.white || a.values.low > a.values.high)) return false;
    if (a.kind === "gradient" && (!Array.isArray(a.colors) || a.colors.length !== 2 || !a.colors.every(color))) return false;
    if (a.kind === "curves" && (!Array.isArray(a.curves) || a.curves.length !== 4 || !a.curves.every(points =>
        Array.isArray(points) && points.length >= 2 && points.length <= 16 && points[0]?.[0] === 0 && points.at(-1)?.[0] === 1 &&
        points.every((p, i) => Array.isArray(p) && p.length === 2 && finite(p[0], 0, 1) && finite(p[1], 0, 1) && (!i || p[0] - points[i - 1][0] >= .001))))) return false;
    return true;
}
export function validEffects(effects) {
    return Array.isArray(effects) && effects.length <= 6 && new Set(effects.map(e => e?.kind)).size === effects.length &&
        effects.every(e => e && Object.hasOwn(effectDefinitions, e.kind) && typeof e.enabled === "boolean" && color(e.color) && finite(e.opacity, 0, 1) && validValues(e.values, effectDefinitions[e.kind].fields));
}
