import test from "node:test";
import assert from "node:assert/strict";
import { contentFillPixels, MAX_FILL_PIXELS } from "../src/app/studio/content-fill-pixels.ts";
import { smoothPoint } from "../src/app/studio/brush-path.ts";

test("拖绳平滑过滤抖动，跟随大移动，关闭后直通；不同缩放屏幕长度一致", () => {
    assert.equal(smoothPoint({ x: 10, y: 10 }, { x: 13, y: 14 }, 8), undefined);
    assert.deepEqual(smoothPoint({ x: 0, y: 0 }, { x: 20, y: 0 }, 8), { x: 12, y: 0 });
    assert.deepEqual(smoothPoint({ x: 0, y: 0 }, { x: 3, y: 7 }, 0), { x: 3, y: 7 });
    const p = smoothPoint({ x: 0, y: 0 }, { x: 80, y: 0 }, 8 / 0.25);
    assert.equal(p.x * 0.25, 12);
});
const fixture = (size, pixel, box = [24, 24, 16, 16]) => {
    const original = new Uint8ClampedArray(size * size * 4),
        coverage = new Uint8Array(size * size);
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const p = y * size + x;
            original.set([...pixel(x, y), 255], p * 4);
            if (x >= box[0] && x < box[0] + box[2] && y >= box[1] && y < box[1] + box[3]) coverage[p] = 255;
        }
    const damaged = original.slice();
    for (let p = 0; p < coverage.length; p++) if (coverage[p]) damaged.set([255, 0, 255, 255], p * 4);
    return { original, coverage, damaged, size };
};
function restore(f, limit) {
    const progress = [],
        out = contentFillPixels(f.damaged, f.coverage, f.size, f.size, (v) => progress.push(v));
    let sum = 0,
        count = 0;
    for (let p = 0; p < f.coverage.length; p++)
        if (f.coverage[p]) {
            for (let c = 0; c < 3; c++) {
                sum += Math.abs(out[p * 4 + c] - f.original[p * 4 + c]);
                count++;
            }
            assert.equal(out[p * 4 + 3], 255);
        } else assert.deepEqual(out.subarray(p * 4, p * 4 + 4), f.original.subarray(p * 4, p * 4 + 4));
    assert.ok(progress.every((v, i) => !i || v >= progress[i - 1]));
    assert.equal(progress.at(-1), 1);
    const mae = sum / count;
    assert.ok(mae <= limit, `selected-pixel MAE ${mae} > ${limit}`);
    return { out, mae };
}
test("内容感知填充恢复均匀背景，选区外字节不变，结果可重复", () => {
    const f = fixture(64, () => [68, 122, 177]);
    const { out } = restore(f, 0);
    assert.deepEqual(out, contentFillPixels(f.damaged, f.coverage, 64, 64));
});
test("内容感知填充保留重复纹理而非均值涂平", () => {
    restore(
        fixture(64, (x, y) => {
            const v = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 ? 210 : 50;
            return [v, v, v];
        }),
        18,
    );
});
test("内容感知填充延续穿过选区的横向边缘", () => {
    restore(
        fixture(64, (_, y) => (y < 32 ? [230, 210, 190] : [30, 50, 70])),
        15,
    );
});
test("多尺度填充与边界色调适配恢复渐变", () => {
    restore(
        fixture(128, (x, y) => [50 + x, 70 + Math.round(y * 0.7), 100 + Math.round(x * 0.4)], [42, 42, 44, 44]),
        12,
    );
});
test("非重复起伏纹理填充保留明暗变化，避免均值涂平", () => {
    const f = fixture(
        128,
        (x, y) => {
            const v = Math.round(110 + 22 * Math.sin(x / 4.3) + 18 * Math.cos(y / 8.7) + 5 * Math.sin(x * y * 0.13));
            return [v, v + 15, v + 25];
        },
        [48, 48, 32, 32],
    );
    const { out } = restore(f, 35);
    const values = [];
    for (let p = 0; p < f.coverage.length; p++) if (f.coverage[p]) values.push(out[p * 4]);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    assert.ok(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length > 100, "retain texture variance");
});
test("没有来源、空选区、错误尺寸与内存超限明确拒绝", () => {
    const f = fixture(64, () => [1, 2, 3]);
    assert.throws(() => contentFillPixels(f.damaged, new Uint8Array(4096).fill(255), 64, 64), /没有足够/);
    assert.throws(() => contentFillPixels(f.damaged, new Uint8Array(4096), 64, 64), /没有覆盖/);
    assert.throws(() => contentFillPixels(f.damaged, f.coverage, MAX_FILL_PIXELS, 2), /内存预算/);
    assert.throws(() => contentFillPixels(f.damaged, f.coverage, 63, 64), /内存预算/);
});
test("透明区域不能成为来源，但可以填充选中的透明空洞", () => {
    const f = fixture(64, () => [70, 130, 180]);
    for (let p = 0; p < f.coverage.length; p++) if (f.coverage[p]) f.damaged.set([0, 0, 0, 0], p * 4);
    restore(f, 0);
    f.damaged.fill(0);
    assert.throws(() => contentFillPixels(f.damaged, f.coverage, 64, 64), /没有足够/);
});
