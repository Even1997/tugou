// Multi-scale PatchMatch adapted from Compositor/Rendering/PatchPixels.c (MIT).
// All donors are opaque, original pixels outside the hole. See THIRD-PARTY-NOTICES.md.
const R = 3,
    CH = 6;
export const MAX_FILL_PIXELS = 4_000_000;
type Level = { w: number; h: number; color: Float32Array; hole: Uint8Array; known: Uint8Array; source: Uint8Array; target: Uint8Array; targets: number[]; sources: number[]; counts: Uint16Array; match: Int32Array; distance: Float32Array };
function allocate(w: number, h: number): Level {
    const n = w * h;
    return {
        w,
        h,
        color: new Float32Array(n * CH),
        hole: new Uint8Array(n),
        known: new Uint8Array(n),
        source: new Uint8Array(n),
        target: new Uint8Array(n),
        targets: [],
        sources: [],
        counts: new Uint16Array(n),
        match: new Int32Array(n),
        distance: new Float32Array(n),
    };
}
function integral(data: ArrayLike<number>, w: number, h: number) {
    const out = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) {
        let row = 0;
        for (let x = 0; x < w; x++) {
            row += data[y * w + x];
            out[(y + 1) * (w + 1) + x + 1] = out[y * (w + 1) + x + 1] + row;
        }
    }
    return out;
}
function sum(sat: Float64Array, w: number, x0: number, y0: number, x1: number, y1: number) {
    const stride = w + 1;
    return sat[y1 * stride + x1] - sat[y0 * stride + x1] - sat[y1 * stride + x0] + sat[y0 * stride + x0];
}
function classify(l: Level) {
    const { w, h } = l,
        known = integral(l.known, w, h),
        hole = integral(l.hole, w, h);
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const p = y * w + x,
                x0 = Math.max(0, x - R),
                y0 = Math.max(0, y - R),
                x1 = Math.min(w, x + R + 1),
                y1 = Math.min(h, y + R + 1);
            const holes = sum(hole, w, x0, y0, x1, y1),
                sure = sum(known, w, x0, y0, x1, y1);
            if (holes) {
                l.target[p] = 1;
                l.targets.push(p);
            }
            l.counts[p] = holes + sure * 8;
            if (x >= R && y >= R && x + R < w && y + R < h && sure === (R * 2 + 1) ** 2) {
                l.source[p] = 1;
                l.sources.push(p);
            }
        }
}
function texture(l: Level) {
    const { w, h, color: a } = l,
        known = integral(l.known, w, h),
        edge = new Float32Array(w * h);
    const luma = (p: number) => (a[p * CH] + a[p * CH + 1] + a[p * CH + 2]) / 3;
    for (let direction = 0; direction < 2; direction++) {
        edge.fill(0);
        for (let y = 1; y < h - 1; y++)
            for (let x = 1; x < w - 1; x++) {
                const p = y * w + x,
                    d = direction ? w : 1;
                if (l.known[p] && l.known[p - d] && l.known[p + d]) edge[p] = Math.abs(luma(p + d) - luma(p - d)) / 2;
            }
        const sat = integral(edge, w, h);
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                if (!l.known[p]) continue;
                const x0 = Math.max(0, x - 2),
                    y0 = Math.max(0, y - 2),
                    x1 = Math.min(w, x + 3),
                    y1 = Math.min(h, y + 3);
                a[p * CH + 4 + direction] = (sum(sat, w, x0, y0, x1, y1) / sum(known, w, x0, y0, x1, y1)) * 6;
            }
    }
}
function distance(l: Level, p: number, q: number, best = Infinity) {
    const { w, h, color: a } = l,
        px = p % w,
        py = Math.floor(p / w),
        qx = q % w,
        qy = Math.floor(q / w);
    let total = 0;
    const limit = best * l.counts[p];
    for (let dy = -R; dy <= R; dy++) {
        if (py + dy < 0 || py + dy >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
            const x = px + dx,
                t = (py + dy) * w + x;
            if (x < 0 || x >= w || !(l.hole[t] || l.known[t])) continue;
            const s = ((qy + dy) * w + qx + dx) * CH;
            for (let k = 0; k < CH; k++) total += (a[t * CH + k] - a[s + k]) ** 2 * (l.known[t] ? 8 : 1);
        }
        if (total > limit) return Infinity;
    }
    return total / l.counts[p];
}
function measure(l: Level) {
    for (const p of l.targets) l.distance[p] = distance(l, p, l.match[p]);
}
function pass(l: Level, forward: boolean, random: () => number) {
    const { w, h } = l,
        step = forward ? 1 : -1;
    for (let i = 0; i < l.targets.length; i++) {
        const p = l.targets[forward ? i : l.targets.length - 1 - i],
            x = p % w,
            y = Math.floor(p / w);
        let best = l.match[p],
            score = l.distance[p];
        const consider = (q: number) => {
            if (q < 0 || q >= w * h || !l.source[q] || q === best) return;
            const d = distance(l, p, q, score);
            if (d < score) {
                score = d;
                best = q;
            }
        };
        const nx = x - step,
            ny = y - step;
        if (nx >= 0 && nx < w && l.target[p - step]) {
            const m = l.match[p - step];
            if ((m % w) + step >= 0 && (m % w) + step < w) consider(m + step);
        }
        if (ny >= 0 && ny < h && l.target[p - step * w]) consider(l.match[p - step * w] + step * w);
        for (let r = Math.max(w, h); r >= 1; r = Math.floor(r / 2)) {
            const cx = (best % w) + (random() % (r * 2 + 1)) - r,
                cy = Math.floor(best / w) + (random() % (r * 2 + 1)) - r;
            if (cx >= 0 && cy >= 0 && cx < w && cy < h) consider(cy * w + cx);
        }
        l.match[p] = best;
        l.distance[p] = score;
    }
}
function spread(l: Level, sharpness: number) {
    let total = 0;
    for (const p of l.targets) total += l.distance[p];
    return ((2 * total) / Math.max(1, l.targets.length) + 1) / sharpness;
}
function predict(l: Level, p: number, variance: number, out: Float32Array) {
    out.fill(0);
    let total = 0,
        best = Infinity,
        fallback = -1;
    const x = p % l.w,
        y = Math.floor(p / l.w);
    for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
            const px = x - dx,
                py = y - dy;
            if (px < 0 || py < 0 || px >= l.w || py >= l.h) continue;
            const t = py * l.w + px,
                q = l.match[t];
            if (!l.target[t] || !l.source[q]) continue;
            const s = (q + dy * l.w + dx) * CH,
                weight = Math.exp(-l.distance[t] / variance);
            if (l.distance[t] < best) {
                best = l.distance[t];
                fallback = s;
            }
            for (let k = 0; k < CH; k++) out[k] += l.color[s + k] * weight;
            total += weight;
        }
    if (total > 1e-20) for (let k = 0; k < CH; k++) out[k] /= total;
    else if (fallback >= 0) out.set(l.color.subarray(fallback, fallback + CH));
    return total > 1e-20 || fallback >= 0;
}
function vote(l: Level, sharpness = 1) {
    const variance = spread(l, sharpness),
        value = new Float32Array(CH);
    for (const p of l.targets) if (l.hole[p] && predict(l, p, variance, value)) l.color.set(value, p * CH);
}
function downsample(f: Level) {
    const c = allocate(Math.ceil(f.w / 2), Math.ceil(f.h / 2));
    for (let y = 0; y < c.h; y++)
        for (let x = 0; x < c.w; x++) {
            const p = y * c.w + x,
                all = new Float32Array(CH),
                sure = new Float32Array(CH);
            let present = 0,
                known = 0;
            for (let dy = 0; dy < 2; dy++)
                for (let dx = 0; dx < 2; dx++) {
                    if (x * 2 + dx >= f.w || y * 2 + dy >= f.h) continue;
                    const q = (y * 2 + dy) * f.w + x * 2 + dx;
                    present++;
                    known += f.known[q];
                    c.hole[p] |= f.hole[q];
                    for (let k = 0; k < CH; k++) {
                        all[k] += f.color[q * CH + k];
                        if (f.known[q]) sure[k] += f.color[q * CH + k];
                    }
                }
            c.known[p] = !c.hole[p] && known === present ? 1 : 0;
            for (let k = 0; k < CH; k++) c.color[p * CH + k] = known ? sure[k] / known : all[k] / present;
        }
    classify(c);
    return c;
}
function initialize(l: Level) {
    const done = l.known.slice(),
        mean = new Float32Array(CH);
    let known = 0;
    for (let p = 0; p < done.length; p++)
        if (done[p]) {
            known++;
            for (let k = 0; k < CH; k++) mean[k] += l.color[p * CH + k];
        }
    for (;;) {
        const next: number[] = [];
        for (const p of l.targets) {
            if (!l.hole[p] || done[p]) continue;
            const x = p % l.w,
                y = Math.floor(p / l.w),
                value = new Float32Array(CH);
            let count = 0;
            for (let dy = -1; dy <= 1; dy++)
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx,
                        ny = y + dy,
                        q = ny * l.w + nx;
                    if (nx < 0 || ny < 0 || nx >= l.w || ny >= l.h || !done[q]) continue;
                    count++;
                    for (let k = 0; k < CH; k++) value[k] += l.color[q * CH + k];
                }
            if (count) {
                for (let k = 0; k < CH; k++) l.color[p * CH + k] = value[k] / count;
                next.push(p);
            }
        }
        if (!next.length) break;
        for (const p of next) done[p] = 1;
    }
    for (const p of l.targets) if (l.hole[p] && !done[p]) for (let k = 0; k < CH; k++) l.color[p * CH + k] = mean[k] / Math.max(1, known);
}
// Prefer a coherent source patch when at least 75% of its surrounding context
// is available and every available context pixel matches.
// This preserves periodic texture phase instead of seeding each pixel separately.
function seedExactPatch(l: Level) {
    let x0 = l.w,
        y0 = l.h,
        x1 = 0,
        y1 = 0;
    for (const p of l.targets)
        if (l.hole[p]) {
            x0 = Math.min(x0, p % l.w);
            y0 = Math.min(y0, Math.floor(p / l.w));
            x1 = Math.max(x1, (p % l.w) + 1);
            y1 = Math.max(y1, Math.floor(p / l.w) + 1);
        }
    const hx0 = x0,
        hy0 = y0,
        hx1 = x1,
        hy1 = y1;
    x0 = Math.max(0, x0 - R);
    y0 = Math.max(0, y0 - R);
    x1 = Math.min(l.w, x1 + R);
    y1 = Math.min(l.h, y1 + R);
    const width = x1 - x0,
        height = y1 - y0,
        sat = integral(l.known, l.w, l.h),
        context: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (l.known[y * l.w + x]) context.push(y * l.w + x);
    if (context.length < 16) return false;
    for (let sy = 0; sy + height <= l.h; sy++)
        for (let sx = 0; sx + width <= l.w; sx++) {
            if (sum(sat, l.w, sx + hx0 - x0, sy + hy0 - y0, sx + hx1 - x0, sy + hy1 - y0) !== (hx1 - hx0) * (hy1 - hy0)) continue;
            const offset = (sy - y0) * l.w + sx - x0;
            let matches = true,
                compared = 0;
            for (const p of context) {
                if (!l.known[p + offset]) continue;
                compared++;
                for (let k = 0; k < 4; k++)
                    if (Math.abs(l.color[p * CH + k] - l.color[(p + offset) * CH + k]) > 0.5) {
                        matches = false;
                        break;
                    }
                if (!matches) break;
            }
            if (!matches || compared < context.length * 0.75) continue;
            for (const p of l.targets) if (l.hole[p]) l.color.set(l.color.subarray((p + offset) * CH, (p + offset) * CH + CH), p * CH);
            return true;
        }
    return false;
}
function membrane(a: Float32Array, role: Uint8Array, w: number, h: number) {
    let iterations = 200;
    if (w > 16 && h > 16) {
        const cw = Math.ceil(w / 2),
            ch = Math.ceil(h / 2),
            ca = new Float32Array(cw * ch * 3),
            cr = new Uint8Array(cw * ch);
        for (let y = 0; y < ch; y++)
            for (let x = 0; x < cw; x++) {
                const q = y * cw + x;
                let count = 0;
                for (let dy = 0; dy < 2; dy++)
                    for (let dx = 0; dx < 2; dx++) {
                        if (x * 2 + dx >= w || y * 2 + dy >= h) continue;
                        const p = (y * 2 + dy) * w + x * 2 + dx;
                        if (role[p] === 2 && !cr[q]) cr[q] = 2;
                        if (role[p] === 1) {
                            cr[q] = 1;
                            count++;
                            for (let k = 0; k < 3; k++) ca[q * 3 + k] += a[p * 3 + k];
                        }
                    }
                if (count) for (let k = 0; k < 3; k++) ca[q * 3 + k] /= count;
            }
        membrane(ca, cr, cw, ch);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (role[y * w + x] === 2) for (let k = 0; k < 3; k++) a[(y * w + x) * 3 + k] = ca[(Math.floor(y / 2) * cw + Math.floor(x / 2)) * 3 + k];
        iterations = 40;
    }
    for (let pass = 0; pass < iterations; pass++) {
        let change = 0;
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                if (role[p] !== 2) continue;
                const neighbors = [x ? p - 1 : -1, x + 1 < w ? p + 1 : -1, y ? p - w : -1, y + 1 < h ? p + w : -1].filter((q) => q >= 0 && role[q]);
                if (!neighbors.length) continue;
                for (let k = 0; k < 3; k++) {
                    let sum = 0;
                    for (const q of neighbors) sum += a[q * 3 + k];
                    const d = (sum / neighbors.length - a[p * 3 + k]) * 1.6;
                    a[p * 3 + k] += d;
                    change = Math.max(change, Math.abs(d));
                }
            }
        if (change < 0.02) break;
    }
}
function adaptColor(l: Level) {
    const role = new Uint8Array(l.w * l.h),
        correction = new Float32Array(role.length * 3),
        value = new Float32Array(CH),
        variance = spread(l, 1);
    for (const p of l.targets) {
        if (l.hole[p]) {
            role[p] = 2;
            continue;
        }
        if (!l.known[p]) continue;
        const x = p % l.w,
            y = Math.floor(p / l.w);
        if (((x && l.hole[p - 1]) || (x + 1 < l.w && l.hole[p + 1]) || (y && l.hole[p - l.w]) || (y + 1 < l.h && l.hole[p + l.w])) && predict(l, p, variance, value)) {
            role[p] = 1;
            for (let k = 0; k < 3; k++) correction[p * 3 + k] = l.color[p * CH + k] - value[k];
        }
    }
    membrane(correction, role, l.w, l.h);
    for (const p of l.targets) if (l.hole[p]) for (let k = 0; k < 3; k++) l.color[p * CH + k] += correction[p * 3 + k];
}
export function contentFillPixels(rgba: Uint8ClampedArray, coverage: Uint8Array, width: number, height: number, progress: (value: number) => void = () => {}) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_FILL_PIXELS || rgba.length !== width * height * 4 || coverage.length !== width * height)
        throw new Error("填充范围超过局部处理内存预算，请缩小选区或分区填充");
    if (!coverage.some(Boolean)) throw new Error("选区没有覆盖当前图片");
    const fine = allocate(width, height),
        levels = [fine];
    let minX = width,
        minY = height,
        maxX = 0,
        maxY = 0;
    for (let p = 0; p < coverage.length; p++) {
        fine.hole[p] = coverage[p] ? 1 : 0;
        fine.known[p] = !coverage[p] && rgba[p * 4 + 3] === 255 ? 1 : 0;
        for (let k = 0; k < 4; k++) fine.color[p * CH + k] = rgba[p * 4 + k];
        if (coverage[p]) {
            minX = Math.min(minX, p % width);
            maxX = Math.max(maxX, p % width);
            minY = Math.min(minY, Math.floor(p / width));
            maxY = Math.max(maxY, Math.floor(p / width));
        }
    }
    classify(fine);
    if (!fine.sources.length) throw new Error("选区周围没有足够的完整纹理，请缩小选区或换一处来源充足的区域");
    texture(fine);
    progress(0.05);
    if (seedExactPatch(fine)) {
        const result = rgba.slice();
        for (let p = 0; p < coverage.length; p++) if (coverage[p]) for (let k = 0; k < 4; k++) result[p * 4 + k] = fine.color[p * CH + k];
        progress(1);
        return result;
    }
    for (let span = Math.max(maxX - minX, maxY - minY); span > 4 && levels.length < 12; span /= 2) {
        const f = levels[levels.length - 1];
        if (Math.min(f.w, f.h) < 32) break;
        const c = downsample(f);
        if (!c.sources.length) break;
        levels.push(c);
    }
    let state = 0x751ba341;
    const random = () => {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        return state >>> 0;
    };
    const total = 12 + (levels.length - 1) * 6;
    let completed = 0;
    for (let index = levels.length - 1; index >= 0; index--) {
        const l = levels[index],
            coarse = levels[index + 1];
        if (!coarse) initialize(l);
        for (const p of l.targets) {
            let candidate = -1;
            if (coarse) {
                const x = p % l.w,
                    y = Math.floor(p / l.w),
                    q = Math.floor(y / 2) * coarse.w + Math.floor(x / 2),
                    m = coarse.match[q];
                if (l.hole[p]) l.color.set(coarse.color.subarray(q * CH, q * CH + CH), p * CH);
                const mx = (m % coarse.w) * 2 + (x % 2),
                    my = Math.floor(m / coarse.w) * 2 + (y % 2);
                if (mx < l.w && my < l.h && l.source[my * l.w + mx]) candidate = my * l.w + mx;
            }
            l.match[p] = candidate >= 0 ? candidate : l.sources[random() % l.sources.length];
        }
        measure(l);
        for (let i = 0; i < (coarse ? 6 : 12); i++) {
            pass(l, i % 2 === 0, random);
            vote(l);
            measure(l);
            progress(0.05 + (0.85 * ++completed) / total);
        }
    }
    vote(fine, 8);
    progress(0.92);
    adaptColor(fine);
    // Return reconstructed pixels; the caller blends with original RGBA using
    // the exact feathered selection, so zero-coverage pixels remain byte-identical.
    const result = rgba.slice();
    for (let p = 0; p < coverage.length; p++) if (coverage[p]) for (let k = 0; k < 4; k++) result[p * 4 + k] = fine.color[p * CH + k];
    progress(1);
    return result;
}
