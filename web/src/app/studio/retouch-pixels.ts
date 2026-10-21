// Smudge/push semantics adapted from Compositor's SmudgeLiquify.swift (MIT).
// Work in premultiplied RGBA so transparent edges do not acquire dark fringes.
export function premultiply(data: Uint8ClampedArray) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] / 255;
        for (let k = 0; k < 3; k++) out[i + k] = data[i + k] * a;
        out[i + 3] = data[i + 3];
    }
    return out;
}
export function writePixel(out: Uint8ClampedArray, i: number, values: ArrayLike<number>, j: number) {
    const a = Math.max(0, Math.min(255, values[j + 3]));
    for (let k = 0; k < 3; k++) out[i + k] = a > 0.001 ? (values[j + k] * 255) / a : 0;
    out[i + 3] = a;
}
export function falloff(distance: number, radius: number, hardness: number) {
    const u = distance / radius;
    if (u >= 1) return 0;
    if (u <= hardness) return 1;
    const t = (1 - u) / (1 - hardness);
    return t * t * (3 - 2 * t);
}
export function bilinear(data: Float32Array, width: number, height: number, x: number, y: number, out: Float32Array) {
    x = Math.max(0, Math.min(width - 1, x));
    y = Math.max(0, Math.min(height - 1, y));
    const ix = Math.floor(x),
        iy = Math.floor(y),
        fx = x - ix,
        fy = y - iy;
    const a = (iy * width + ix) * 4,
        b = (iy * width + Math.min(width - 1, ix + 1)) * 4;
    const c = (Math.min(height - 1, iy + 1) * width + ix) * 4,
        d = (Math.min(height - 1, iy + 1) * width + Math.min(width - 1, ix + 1)) * 4;
    for (let k = 0; k < 4; k++) out[k] = (data[a + k] * (1 - fx) + data[b + k] * fx) * (1 - fy) + (data[c + k] * (1 - fx) + data[d + k] * fx) * fy;
}
// Harmonic boundary correction: keep source texture while matching the target's
// surrounding tone. Solve only the smooth correction on a small grid, not the image.
export function healingCorrection(source: Uint8ClampedArray, target: Uint8ClampedArray, side: number) {
    const n = Math.min(33, side),
        values = new Float32Array(n * n * 4),
        hole = new Uint8Array(n * n);
    const mean = [0, 0, 0];
    let count = 0;
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
            const r = Math.hypot(x - (n - 1) / 2, y - (n - 1) / 2),
                inside = r < (n - 1) / 2 - 1;
            const p = (y * n + x) * 4;
            if (inside) {
                hole[y * n + x] = 1;
                continue;
            }
            const sx = Math.round((x / (n - 1)) * (side - 1)),
                sy = Math.round((y / (n - 1)) * (side - 1)),
                s = (sy * side + sx) * 4;
            if (source[s + 3] && target[s + 3]) {
                for (let k = 0; k < 3; k++) {
                    values[p + k] = target[s + k] - source[s + k];
                    mean[k] += values[p + k];
                }
                count++;
            }
        }
    for (let p = 0; p < hole.length; p++) if (hole[p]) for (let k = 0; k < 3; k++) values[p * 4 + k] = mean[k] / Math.max(1, count);
    for (let pass = 0; pass < 80; pass++) {
        let change = 0;
        for (let y = 1; y < n - 1; y++)
            for (let x = 1; x < n - 1; x++) {
                const p = (y * n + x) * 4;
                if (!hole[y * n + x]) continue;
                for (let k = 0; k < 3; k++) {
                    const d = ((values[p - 4 + k] + values[p + 4 + k] + values[p - n * 4 + k] + values[p + n * 4 + k]) / 4 - values[p + k]) * 1.6;
                    values[p + k] += d;
                    change = Math.max(change, Math.abs(d));
                }
            }
        if (change < 0.02) break;
    }
    return { values, side: n };
}
