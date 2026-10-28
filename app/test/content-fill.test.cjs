const test = require("node:test"),
  assert = require("node:assert/strict");
const { contentFill } = require("../core/content-fill.cjs");
function fixture(w = 128, h = 96, wave = false) {
  const rgba = new Uint8ClampedArray(w * h * 4),
    mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = (((x >> 3) + (y >> 3)) % 2) * 180 + 30;
      rgba.set(
        wave
          ? [
              50 + x * 0.8 + y * 0.2 + 25 * Math.sin(x * 0.17 + y * y * 0.003),
              80 + y * 0.8 + 15 * Math.cos(x * 0.09 + y * 0.12),
              180 - x * 0.6,
              255,
            ]
          : [v, v * 0.8, v * 0.6, 255],
        (y * w + x) * 4,
      );
    }
  const original = rgba.slice();
  for (let y = 32; y < 56; y++)
    for (let x = 48; x < 72; x++) {
      const i = y * w + x;
      mask[i] = 255;
      rgba.set([255, 0, 255, 255], i * 4);
    }
  return { rgba, mask, width: w, height: h, original };
}
test("coherent fill restores repeated texture exactly and does not mutate inputs", () => {
  const f = fixture(),
    before = f.rgba.slice(),
    m = f.mask.slice(),
    progress = [];
  const r = contentFill(f, (p) => progress.push(p));
  assert.equal(r.method, "coherent");
  assert.deepEqual(r.rgba, f.original);
  assert.deepEqual(f.rgba, before);
  assert.deepEqual(f.mask, m);
  assert.equal(progress.at(-1), 1);
  assert.ok(
    progress.every((p, i) => p >= 0 && p <= 1 && (!i || p >= progress[i - 1])),
  );
});
test("nonrepeating texture uses patch matching, reduces error and preserves every unselected pixel", () => {
  const f = fixture(128, 96, true),
    r = contentFill(f);
  let error = 0,
    n = 0;
  assert.equal(r.method, "patchmatch");
  for (let i = 0; i < f.mask.length; i++)
    for (let k = 0; k < 4; k++)
      if (f.mask[i] && k < 3) {
        error += Math.abs(r.rgba[i * 4 + k] - f.original[i * 4 + k]);
        n++;
      } else if (!f.mask[i]) assert.equal(r.rgba[i * 4 + k], f.rgba[i * 4 + k]);
  assert.ok(error / n < 8, `MAE ${error / n}`);
  assert.deepEqual(contentFill(f).rgba, r.rgba);
});
test("feather blends once and transparent holes receive opaque texture", () => {
  const f = fixture();
  for (let i = 0; i < f.mask.length; i++) if (f.mask[i]) f.mask[i] = 128;
  const r = contentFill(f);
  for (let i = 0; i < f.mask.length; i++)
    if (f.mask[i])
      for (let k = 0; k < 3; k++)
        assert.ok(
          Math.abs(
            r.rgba[i * 4 + k] -
              (f.rgba[i * 4 + k] * 127 + f.original[i * 4 + k] * 128) / 255,
          ) < 1,
        );
  for (let i = 0; i < f.mask.length; i++)
    if (f.mask[i]) {
      f.mask[i] = 255;
      f.rgba.fill(0, i * 4, i * 4 + 4);
    }
  assert.deepEqual(contentFill(f).rgba, f.original);
});
test("empty, full, oversized and insufficient donor selections fail explicitly", () => {
  const f = fixture();
  f.mask.fill(0);
  assert.throws(() => contentFill(f), /未覆盖/);
  f.mask.fill(255);
  assert.throws(() => contentFill(f), /全部选中/);
  assert.throws(() => contentFill({ ...f, width: 4000001 }), /400万/);
  f.mask.fill(0);
  f.mask[40 * 128 + 60] = 255;
  f.rgba.fill(0);
  assert.throws(() => contentFill(f), /不透明纹理/);
});
