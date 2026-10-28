const test = require("node:test"),
  assert = require("node:assert/strict");
const { outputGeometry } = require("../core/image-tools.cjs");
const {
  validateComposition,
  applyRegion,
} = require("../core/image-composition.cjs");
test("geometry resolves exact dimensions and existing scale/padding without cropping sources", () => {
  assert.deepEqual(
    outputGeometry(
      { operation: "resize", sizeMode: "size", width: 31, height: 19 },
      65,
      49,
    ),
    { width: 31, height: 19, left: 0, top: 0 },
  );
  assert.deepEqual(outputGeometry({ operation: "resize", scale: 2 }, 65, 49), {
    width: 130,
    height: 98,
    left: 0,
    top: 0,
  });
  assert.deepEqual(
    outputGeometry({ operation: "extend", padding: 7 }, 65, 49),
    { width: 79, height: 63, left: 7, top: 7 },
  );
  assert.deepEqual(
    outputGeometry(
      {
        operation: "extend",
        sizeMode: "size",
        width: 80,
        height: 60,
        left: 15,
        top: 11,
      },
      65,
      49,
    ),
    { width: 80, height: 60, left: 15, top: 11 },
  );
  for (const s of [
    { operation: "resize", sizeMode: "size", width: 10001, height: 10000 },
    { operation: "resize", scale: NaN },
    { operation: "resize", sizeMode: "other", scale: 2 },
    {
      operation: "extend",
      sizeMode: "size",
      width: 65,
      height: 49,
      left: 1,
      top: 0,
    },
    {
      operation: "extend",
      sizeMode: "size",
      width: 80,
      height: 60,
      left: 0.1,
      top: 0,
    },
    { operation: "extend", padding: -1 },
    { operation: "extend", padding: 5001 },
  ])
    assert.throws(() => outputGeometry(s, 65, 49));
});
test("region validation distinguishes crop, full-frame extraction, and required replacement", () => {
  const box = { left: 3, top: 2, width: 7, height: 8, feather: 2 };
  for (const operation of ["crop", "extract", "patch"]) {
    assert.doesNotThrow(() =>
      validateComposition({ operation, ...box }, 10, 10, {
        width: 4,
        height: 6,
      }),
    );
    for (const bad of [{ width: 8 }, { left: -1 }, { top: 2.5 }, { height: 9 }])
      assert.throws(() =>
        validateComposition({ operation, ...box, ...bad }, 10, 10, {
          width: 4,
          height: 6,
        }),
      );
  }
  assert.throws(() =>
    validateComposition({ operation: "patch", ...box }, 10, 10),
  );
  assert.throws(() =>
    validateComposition({ operation: "extract", ...box, feather: -1 }, 10, 10),
  );
});
test("rectangle extraction preserves selected colors and applies analytic inward alpha ramp", () => {
  const s = {
      operation: "extract",
      left: 2,
      top: 1,
      width: 4,
      height: 4,
      feather: 2,
    },
    p = new Uint8ClampedArray(8 * 7 * 4);
  for (let i = 0; i < p.length; i += 4) p.set([120, 80, 40, 200], i);
  applyRegion(p, null, 8, 7, s, 0, 0);
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 8; x++) {
      const at = (y * 8 + x) * 4,
        inside = x >= 2 && x < 6 && y >= 1 && y < 5;
      if (!inside) assert.deepEqual([...p.slice(at, at + 4)], [0, 0, 0, 0]);
      else {
        assert.deepEqual([...p.slice(at, at + 3)], [120, 80, 40]);
        assert.equal(
          p[at + 3],
          x === 2 || x === 5 || y === 1 || y === 4 ? 50 : 150,
        );
      }
    }
});
test("patch source-over matches independent scalar oracle and tiled processing", () => {
  const width = 19,
    height = 13,
    s = {
      operation: "patch",
      left: 3,
      top: 2,
      width: 13,
      height: 9,
      feather: 3,
    };
  const p = Uint8ClampedArray.from(
      { length: width * height * 4 },
      (_, i) => (i * 59 + 3) % 256,
    ),
    q = Uint8ClampedArray.from(p, (_, i) => (i * 17 + 11) % 256),
    before = p.slice();
  applyRegion(p, q, width, height, s, 0, 0);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (x < 3 || x >= 16 || y < 2 || y >= 11)
        assert.deepEqual(p.slice(i, i + 4), before.slice(i, i + 4));
      else {
        const a =
          (q[i + 3] *
            Math.min(
              1,
              (x - 2.5) / 3,
              (15.5 - x) / 3,
              (y - 1.5) / 3,
              (10.5 - y) / 3,
            )) /
          255;
        const b = before[i + 3] / 255,
          alpha = 1 - (1 - a) * (1 - b);
        assert.equal(p[i + 3], Math.round(alpha * 255));
        for (let c = 0; c < 3; c++)
          assert.equal(
            p[i + c],
            Math.round((q[i + c] * a + before[i + c] * b * (1 - a)) / alpha),
          );
      }
    }
  const tiled = before.slice();
  for (let y = 0; y < height; y += 5)
    for (let x = 0; x < width; x += 7) {
      const w = Math.min(7, width - x),
        h = Math.min(5, height - y),
        a = new Uint8ClampedArray(w * h * 4),
        b = a.slice();
      for (let yy = 0; yy < h; yy++)
        for (let xx = 0; xx < w; xx++)
          for (let c = 0; c < 4; c++) {
            a[(yy * w + xx) * 4 + c] =
              before[((y + yy) * width + x + xx) * 4 + c];
            b[(yy * w + xx) * 4 + c] = q[((y + yy) * width + x + xx) * 4 + c];
          }
      applyRegion(a, b, w, h, s, x, y);
      for (let yy = 0; yy < h; yy++)
        tiled.set(
          a.slice(yy * w * 4, (yy + 1) * w * 4),
          ((y + yy) * width + x) * 4,
        );
    }
  assert.deepEqual(p, tiled);
});
