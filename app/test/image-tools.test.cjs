const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  parseCube,
  applyLut,
  alphaEdges,
  lighting,
  defaults,
  validateSettings,
  dimensions,
  erode,
} = require("../core/image-tools.cjs");
test("Cube 1D/3D interpolation, domains and protected alpha", () => {
  const one = parseCube(
    'TITLE "fixture # one"\nLUT_1D_SIZE 2\nDOMAIN_MAX 1 2 1\n0 0 1\n1 1 0',
  );
  const p = Uint8ClampedArray.from([128, 128, 128, 37, 80, 90, 100, 0]);
  applyLut(p, one, 100);
  assert.deepEqual([...p], [128, 64, 127, 37, 80, 90, 100, 0]);
  const values = [];
  for (let b = 0; b < 2; b++)
    for (let g = 0; g < 2; g++)
      for (let r = 0; r < 2; r++) values.push(`${b} ${r} ${g}`);
  const three = parseCube("LUT_3D_SIZE 2\n" + values.join("\n")),
    q = Uint8ClampedArray.from([60, 120, 180, 128]);
  applyLut(q, three, 100);
  assert.deepEqual([...q], [180, 60, 120, 128]);
  const identity = parseCube("LUT_1D_SIZE 2\n0 0 0\n1 1 1"),
    a = Uint8ClampedArray.from({ length: 1024 }, (_, i) => i % 256),
    before = a.slice();
  applyLut(a, identity, 100);
  assert.deepEqual(a, before);
  applyLut(a, three, 0);
  assert.deepEqual(a, before);
  for (const text of [
    "LUT_3D_SIZE 66",
    "LUT_1D_SIZE 2\n0 0 0",
    "LUT_1D_SIZE 2\nDOMAIN_MIN 1 0 0\n0 0 0\n1 1 1",
    "LUT_1D_SIZE 2\n0 0 0\nNaN 1 1",
    "LUT_1D_SIZE 2\nLUT_3D_SIZE 2",
    "LUT_1D_SIZE 2\n0 0 0\n1 1 1\n1 1 1",
    "LUT_1D_INPUT_RANGE 0 1",
  ])
    assert.throws(() => parseCube(text));
});
test("Grayscale erosion matches brute force and does not threshold soft coverage", () => {
  const w = 13,
    h = 11,
    a = Uint8Array.from({ length: w * h }, (_, i) => (i * 41) % 256);
  for (const r of [0, 1, 3, 16]) {
    const actual = erode(a, w, h, r);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let expected = 255;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            expected = Math.min(
              expected,
              x + dx < 0 || x + dx >= w || y + dy < 0 || y + dy >= h
                ? 0
                : a[(y + dy) * w + x + dx],
            );
        assert.equal(actual[y * w + x], expected);
      }
  }
});
test("Alpha tools preserve originals at zero, never increase coverage, and decontaminate only soft pixels", () => {
  const p = Uint8ClampedArray.from([
      200, 210, 220, 255, 191, 127, 127, 128, 0, 0, 0, 0,
    ]),
    before = p.slice();
  alphaEdges(p, 3, 1, defaults.alpha);
  assert.deepEqual(p, before);
  alphaEdges(p, 3, 1, { ...defaults.alpha, matte: "white" });
  assert.deepEqual([...p.slice(0, 4)], [200, 210, 220, 255]);
  assert.equal(p[7], 128);
  assert.equal(p[4], 128);
  assert.equal(p[5], 0);
  const alpha = Uint8ClampedArray.from({ length: 11 * 11 * 4 }, (_, i) =>
      i % 4 === 3 ? i % 231 : 120,
    ),
    original = alpha.slice();
  alphaEdges(alpha, 11, 11, { shrink: 1, feather: 2, matte: "none" });
  for (let x = 0; x < 11; x++)
    assert.equal(
      alpha[x * 4 + 3],
      0,
      "inward feather must not restore eroded border",
    );
  for (let i = 0; i < alpha.length; i++)
    if (i % 4 === 3) assert.ok(alpha[i] <= original[i]);
    else assert.equal(alpha[i], original[i]);
});
test("Local lighting uses full-image coordinates, protects alpha and outside radius", () => {
  const w = 100,
    h = 30,
    p = Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) =>
      i % 4 === 3 ? 127 : 90,
    ),
    s = { ...defaults.light, radius: 20, exposure: 1 };
  const result = p.slice();
  lighting(result, w, h, s);
  for (let i = 3; i < result.length; i += 4) assert.equal(result[i], 127);
  assert.equal(result[0], 90);
  assert.ok(result[(15 * w + 50) * 4] > 90);
  const tile = new Uint8ClampedArray(20 * 10 * 4);
  for (let y = 0; y < 10; y++)
    tile.set(
      p.slice(((y + 10) * w + 40) * 4, ((y + 10) * w + 60) * 4),
      y * 20 * 4,
    );
  lighting(tile, 20, 10, s, 40, 10, w, h);
  for (let y = 0; y < 10; y++)
    assert.deepEqual(
      tile.slice(y * 80, (y + 1) * 80),
      result.slice(((y + 10) * w + 40) * 4, ((y + 10) * w + 60) * 4),
    );
  lighting(p, w, h, { ...s, exposure: 0 });
  assert.equal(p[0], 90);
});
test("Local tools reject invalid dimensions and parameters before processing", () => {
  dimensions(10000, 10000);
  assert.throws(() => dimensions(10001, 10000));
  for (const operation of Object.keys(defaults))
    validateSettings({ operation, ...defaults[operation] });
  for (const s of [
    { operation: "alpha", ...defaults.alpha, shrink: -1 },
    { operation: "light", ...defaults.light, exposure: Infinity },
    { operation: "pattern", ...defaults.pattern, motifScale: 0 },
    { operation: "pattern", ...defaults.pattern, width: 10000, height: 10001 },
    { operation: "lut", strength: NaN },
  ])
    assert.throws(() => validateSettings(s));
});
