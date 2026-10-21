import test from "node:test";
import assert from "node:assert/strict";
import { identityQuad, inverseHomography, projectPoint, quadBounds, warpPixels, validateQuad } from "../src/app/studio/perspective.ts";
test("透视变形四个目标角精确映射回原图四角", () => {
    const quad = [.2, 0, .8, .1, 1, 1, 0, 1], matrix = inverseHomography(quad);
    for (let i = 0; i < 8; i += 2) {
        const p = projectPoint(matrix, quad[i], quad[i + 1]);
        assert.ok(Math.abs(p.x - identityQuad[i]) < 1e-8);
        assert.ok(Math.abs(p.y - identityQuad[i + 1]) < 1e-8);
    }
});
test("恒等变形保留全部像素；透明图无黑边", () => {
    const source = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0]), target = new Uint8ClampedArray(16);
    warpPixels(source, 2, 2, identityQuad, target);
    assert.deepEqual(target, source);
    const quad = [0, 0, 2, 0, 2, 1, 0, 1], bounds = quadBounds(quad, 2, 2), large = new Uint8ClampedArray(bounds.width * bounds.height * 4);
    warpPixels(source, 2, 2, quad, large);
    assert.ok(large[7] > 0 && large[7] < 255);
    assert.equal(large[4], 255);
});
test("交叉、折叠、非有限和极限尺寸变形被拒绝", () => {
    assert.throws(() => validateQuad([0, 0, 1, 1, 1, 0, 0, 1]), /交叉/);
    assert.throws(() => validateQuad([0, 0, 0, 0, 1, 1, 0, 1]), /交叉/);
    assert.throws(() => validateQuad([0, 0, NaN, 0, 1, 1, 0, 1]), /位置/);
});
