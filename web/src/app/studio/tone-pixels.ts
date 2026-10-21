import type { Adjustment } from "./model";
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const linear = (v: number) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
const srgb = (v: number) => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;
function random(x: number, y: number, seed: number) {
    let n = Math.imul(x ^ seed, 374761393) ^ Math.imul(y, 668265263);
    n = Math.imul(n ^ n >>> 13, 1274126177);
    return ((n ^ n >>> 16) >>> 0) / 4294967296;
}
/** Shape-preserving cubic curves: no overshoot between adjacent control points. */
export function curveLut(points: number[][]) {
    const slopes = points.slice(1).map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]));
    const tangent = points.map((_, i) => !i ? slopes[0] : i === points.length - 1 ? slopes.at(-1)! : slopes[i - 1] * slopes[i] <= 0 ? 0 : 2 / (1 / slopes[i - 1] + 1 / slopes[i]));
    return Float32Array.from({ length: 256 }, (_, i) => {
        const x = i / 255; let j = 0;
        while (j < points.length - 2 && x > points[j + 1][0]) j++;
        const [a, b] = [points[j], points[j + 1]], h = b[0] - a[0], t = (x - a[0]) / h;
        return clamp((2 * t ** 3 - 3 * t ** 2 + 1) * a[1] + (t ** 3 - 2 * t ** 2 + t) * h * tangent[j] + (-2 * t ** 3 + 3 * t ** 2) * b[1] + (t ** 3 - t ** 2) * h * tangent[j + 1]);
    });
}
export function adjustPixels(data: Uint8ClampedArray, width: number, adjustment: Adjustment, originX = 0, originY = 0, scale = 1) {
    const { kind, values: v } = adjustment, curves = adjustment.curves?.map(curveLut);
    const colors = adjustment.colors?.map(color => [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16) / 255));
    // These transforms are channel-independent. Calculate 256 entries once,
    // rather than evaluating powers and allocating arrays for every pixel.
    if (["levels", "curves", "exposure", "balance", "invert"].includes(kind)) {
        const tables = [0, 1, 2].map(k => Uint8ClampedArray.from({ length: 256 }, (_, byte) => {
            const n = byte / 255;
            if (kind === "levels") return v.low + (v.high - v.low) * clamp((byte - v.black) / (v.white - v.black)) ** (1 / v.gamma);
            if (kind === "curves" && curves) return curves[0][Math.round(curves[k + 1][byte] * 255)] * 255;
            if (kind === "exposure") return clamp(srgb(clamp(linear(n) * 2 ** v.exposure + v.offset) ** (1 / v.gamma))) * 255;
            if (kind === "balance") return clamp(n + [v.red, v.green, v.blue][k] / 100 * (1 - Math.abs(2 * n - 1))) * 255;
            return 255 - byte;
        }));
        for (let i = 0; i < data.length; i += 4) if (data[i + 3]) {
            data[i] = tables[0][data[i]]; data[i + 1] = tables[1][data[i + 1]]; data[i + 2] = tables[2][data[i + 2]];
        }
        return;
    }
    for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        let r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        if (kind === "hsv") {
            const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
            let h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h = (h + v.hue / 60 + 6) % 6;
            let l = (max + min) / 2, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
            s = clamp(s * (1 + v.saturation / 100));
            l = v.lightness < 0 ? l * (1 + v.lightness / 100) : l + (1 - l) * v.lightness / 100;
            const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(h % 2 - 1)), m = l - c / 2;
            [r, g, b] = (h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]).map(n => n + m);
        } else if (kind === "gradient" && colors) {
            const l = .2126 * r + .7152 * g + .0722 * b;
            [r, g, b] = colors[0].map((n, k) => n + (colors[1][k] - n) * l);
        } else if (kind === "bw") r = g = b = clamp((r * v.red + g * v.green + b * v.blue) / 100);
        else if (kind === "grain" || kind === "noise") {
            const p = i / 4, size = kind === "grain" ? v.size : 1, x = Math.floor((originX + p % width + .5) / scale / size), y = Math.floor((originY + Math.floor(p / width) + .5) / scale / size);
            [r, g, b] = [r, g, b].map((n, k) => {
                const seed = v.seed + (kind === "noise" && !v.mono ? k * 1337 : 0);
                const noise = v.gaussian ? Math.sqrt(-2 * Math.log(Math.max(1e-8, random(x, y, seed)))) * Math.cos(2 * Math.PI * random(x, y, seed + 101)) / 6 : random(x, y, seed) - .5;
                return clamp(n + noise * v.amount / 100 * (kind === "grain" ? 4 * n * (1 - n) : 1));
            });
        }
        data[i] = clamp(r) * 255; data[i + 1] = clamp(g) * 255; data[i + 2] = clamp(b) * 255;
    }
}
/** Exact squared Euclidean distance transform, O(width * height). */
export function edgeDistance(alpha: Uint8ClampedArray, width: number, height: number, toOpaque: boolean) {
    const out = new Float32Array(width * height), f = new Float64Array(Math.max(width, height)), d = f.slice(), z = new Float64Array(f.length + 1), sites = new Int32Array(f.length);
    const line = (n: number) => {
        let k = 0; sites[0] = 0; z[0] = -Infinity; z[1] = Infinity;
        for (let q = 1; q < n; q++) {
            let s = ((f[q] + q * q) - (f[sites[k]] + sites[k] ** 2)) / (2 * (q - sites[k]));
            while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[sites[k]] + sites[k] ** 2)) / (2 * (q - sites[k])); }
            sites[++k] = q; z[k] = s; z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - sites[k]) ** 2 + f[sites[k]]; }
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) f[x] = (alpha[(y * width + x) * 4 + 3] >= 128) === toOpaque ? 0 : 1e12;
        line(width); for (let x = 0; x < width; x++) out[y * width + x] = d[x];
    }
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) f[y] = out[y * width + x];
        line(height); for (let y = 0; y < height; y++) out[y * width + x] = Math.sqrt(d[y]);
    }
    return out;
}
