import { setImmediate as yieldToLoop } from "node:timers/promises";

/** @typedef {{ dimension: number, size: number, min: number[], max: number[], values: Float32Array }} Cube */
/** @param {string} text @returns {Cube} */
export function parseCube(text) {
    if (typeof text !== "string" || text.length > 12_000_000) throw new Error("LUT 文件超过 12 MB 或内容无效");
    let dimension = 3, size = 0, min = [0, 0, 0], max = [1, 1, 1];
    const values = [], headers = new Set();
    for (const original of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
        if (/^\s*TITLE\s+"[^"]*"\s*(?:#.*)?$/.test(original)) continue;
        const line = original.replace(/#.*$/, "").trim();
        if (!line || /^TITLE\s+".*"$/.test(line)) continue;
        const parts = line.split(/\s+/), key = parts[0];
        if (["LUT_1D_SIZE", "LUT_3D_SIZE", "DOMAIN_MIN", "DOMAIN_MAX"].includes(key)) {
            if (headers.has(key) || values.length) throw new Error("LUT 头部重复或位于数据之后");
            headers.add(key);
            if (key.endsWith("SIZE")) {
                if (size) throw new Error("暂不支持在同一文件组合 1D 与 3D LUT");
                dimension = key === "LUT_1D_SIZE" ? 1 : 3; size = Number(parts[1]);
                if (parts.length !== 2 || !Number.isInteger(size) || size < 2 || size > (dimension === 3 ? 65 : 65536)) throw new Error("3D LUT 支持 2–65 点，1D LUT 支持 2–65536 点");
            } else {
                const numbers = parts.slice(1).map(Number);
                if (numbers.length !== 3 || numbers.some(v => !Number.isFinite(v))) throw new Error("LUT DOMAIN 无效");
                if (key === "DOMAIN_MIN") min = numbers; else max = numbers;
            }
        } else {
            const numbers = parts.map(Number);
            if (!size || numbers.length !== 3 || numbers.some(v => !Number.isFinite(Math.fround(v)))) throw new Error(`LUT 数据行无效：${line.slice(0, 50)}`);
            values.push(...numbers);
            if (values.length > size ** dimension * 3) throw new Error("LUT 数据点过多");
        }
    }
    if (!size || values.length !== size ** dimension * 3 || min.some((v, i) => v >= max[i] || !Number.isFinite(max[i] - v))) throw new Error("LUT 点数或 DOMAIN 范围不正确");
    return { dimension, size, min, max, values: new Float32Array(values) };
}

/** RGB samples are stored red-fastest; input outside DOMAIN is clamped. Alpha is untouched.
 * @param {Buffer} data @param {Cube} cube @param {number} strength @param {AbortSignal} signal
 */
export async function applyCubeRgba(data, cube, strength, signal) {
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) throw new Error("LUT 强度应为 0–1");
    if (strength === 0) return;
    const { size, values } = cube;
    const positions = [0, 1, 2].map(c => Array.from({ length: 256 }, (_, v) => Math.max(0, Math.min(1, (v / 255 - cube.min[c]) / (cube.max[c] - cube.min[c]))) * (size - 1)));
    for (let p = 0; p < data.length; p += 4) {
        if (p % 65536 === 0) { await yieldToLoop(); signal.throwIfAborted(); }
        const r = positions[0][data[p]], g = positions[1][data[p + 1]], b = positions[2][data[p + 2]];
        const x = Math.min(size - 2, Math.floor(r)), y = Math.min(size - 2, Math.floor(g)), z = Math.min(size - 2, Math.floor(b));
        const fx = r - x, fy = g - y, fz = b - z, base = (x + size * y + size * size * z) * 3;
        for (let c = 0; c < 3; c++) {
            let value;
            if (cube.dimension === 1) {
                const v = positions[c][data[p + c]], lo = Math.min(size - 2, Math.floor(v)), f = v - lo;
                value = values[lo * 3 + c] * (1 - f) + values[(lo + 1) * 3 + c] * f;
            } else {
                const at = base + c, row = size * 3, plane = size * size * 3;
                const lower = (values[at] * (1 - fx) + values[at + 3] * fx) * (1 - fy) + (values[at + row] * (1 - fx) + values[at + row + 3] * fx) * fy;
                const upper = (values[at + plane] * (1 - fx) + values[at + plane + 3] * fx) * (1 - fy) + (values[at + plane + row] * (1 - fx) + values[at + plane + row + 3] * fx) * fy;
                value = lower * (1 - fz) + upper * fz;
            }
            data[p + c] = Math.round(Math.max(0, Math.min(255, data[p + c] * (1 - strength) + value * 255 * strength)));
        }
    }
}
