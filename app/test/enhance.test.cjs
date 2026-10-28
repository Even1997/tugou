const test = require("node:test"),
  assert = require("node:assert/strict");
const { enhancePixels, validateSettings } = require("../core/image-tools.cjs");
const { reference } = require("./enhance-reference.cjs");
test("enhancement validates strength and tile dimensions including 100MP boundary", () => {
  for (const strength of [0, 0.5, 50, 100])
    assert.doesNotThrow(() =>
      validateSettings({ operation: "enhance", strength }),
    );
  for (const strength of [-1, 101, Infinity, NaN, undefined])
    assert.throws(() => validateSettings({ operation: "enhance", strength }));
  assert.doesNotThrow(() =>
    validateSettings({ operation: "tile", width: 10000, height: 10000 }),
  );
  for (const [width, height] of [
    [0, 1],
    [1.5, 3],
    [30001, 1],
    [10001, 10000],
  ])
    assert.throws(() => validateSettings({ operation: "tile", width, height }));
});
test("separable enhancement agrees with brute-force 2D reference at fractional strengths", () => {
  for (const [w, h] of [
    [1, 1],
    [1, 7],
    [7, 1],
    [19, 13],
  ])
    for (const strength of [0, 0.5, 15, 50, 100]) {
      const input = Uint8ClampedArray.from(
          { length: w * h * 4 },
          (_, i) => (i * 37 + 19) % 256,
        ),
        expected = reference(input, w, h, strength),
        actual = enhancePixels(input.slice(), w, h, strength);
      for (let i = 0; i < input.length; i++)
        assert.ok(Math.abs(actual[i] - expected[i]) <= (i % 4 === 3 ? 0 : 1));
      if (!strength) assert.deepEqual(actual, input);
    }
});
test("transparent RGB cannot bleed into visible contours and neutral flat fields stay unchanged", () => {
  const p = Uint8ClampedArray.from([
      255, 0, 0, 0, 100, 100, 100, 128, 0, 0, 255, 0,
    ]),
    q = p.slice();
  q.set([0, 255, 0, 0], 0);
  q.set([255, 255, 0, 0], 8);
  assert.deepEqual(
    [...enhancePixels(p, 3, 1, 100).slice(4, 8)],
    [100, 100, 100, 128],
  );
  assert.deepEqual(enhancePixels(q, 3, 1, 100).slice(4, 8), p.slice(4, 8));
  const flat = new Uint8ClampedArray(9 * 7 * 4);
  for (let i = 0; i < flat.length; i += 4)
    flat.set([120, 120, 120, i % 8 ? 128 : 255], i);
  assert.deepEqual(enhancePixels(flat.slice(), 9, 7, 100), flat);
});
test("one-pixel halo makes tiled enhancement equal full image", () => {
  const w = 19,
    h = 13,
    p = Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => (i * 53) % 256),
    full = enhancePixels(p.slice(), w, h, 80),
    out = p.slice();
  for (let y = 0; y < h; y += 5)
    for (let x = 0; x < w; x += 7) {
      const tw = Math.min(7, w - x),
        th = Math.min(5, h - y),
        tile = new Uint8ClampedArray((tw + 2) * (th + 2) * 4);
      for (let yy = -1; yy <= th; yy++)
        for (let xx = -1; xx <= tw; xx++)
          if (x + xx >= 0 && y + yy >= 0 && x + xx < w && y + yy < h)
            for (let c = 0; c < 4; c++)
              tile[((yy + 1) * (tw + 2) + xx + 1) * 4 + c] =
                p[((y + yy) * w + x + xx) * 4 + c];
      enhancePixels(tile, tw + 2, th + 2, 80);
      for (let yy = 0; yy < th; yy++)
        out.set(
          tile.slice(
            ((yy + 1) * (tw + 2) + 1) * 4,
            ((yy + 1) * (tw + 2) + tw + 1) * 4,
          ),
          ((y + yy) * w + x) * 4,
        );
    }
  assert.deepEqual(out, full);
});

test("reused enhancement buffers do not leak across tile dimensions or images", () => {
  const buffers = {};
  for (const [width, height] of [
    [19, 13],
    [7, 5],
    [23, 17],
    [1, 1],
    [19, 13],
  ]) {
    const input = Uint8ClampedArray.from(
      { length: width * height * 4 },
      (_, i) => (i * 29 + 7) % 256,
    );
    assert.deepEqual(
      enhancePixels(input.slice(), width, height, 70, buffers),
      enhancePixels(input.slice(), width, height, 70),
    );
  }
});
