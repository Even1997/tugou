const test = require("node:test"),
  assert = require("node:assert/strict");
const { mapSelection } = require("../core/selection-map.cjs");
const layer = { id: "l", kind: "image", width: 4, height: 3, x: 2, y: 1 };
const alpha = Uint8Array.from(
  { length: 80 },
  (_, i) => (i % 10) * 10 + Math.floor(i / 10) * 20,
);
const run = (l, extra = {}) =>
  mapSelection({
    alpha,
    width: 10,
    height: 8,
    targetWidth: 4,
    targetHeight: 3,
    layers: [l],
    layerId: "l",
    ...extra,
  });
test("selection maps source centres through translation, flips, rotation, scaling and groups", () => {
  assert.deepEqual(
    [...run(layer)],
    [40, 50, 60, 70, 60, 70, 80, 90, 80, 90, 100, 110],
  );
  assert.deepEqual(
    [...run({ ...layer, flipX: true })],
    [70, 60, 50, 40, 90, 80, 70, 60, 110, 100, 90, 80],
  );
  assert.deepEqual(
    [...run({ ...layer, x: 6, y: 1, rotation: 90 })],
    [70, 90, 110, 130, 60, 80, 100, 120, 50, 70, 90, 110],
  );
  assert.deepEqual(
    [...run({ ...layer, scaleX: 2, scaleY: 2 })],
    [55, 75, 95, 115, 95, 115, 135, 155, 135, 155, 175, 195],
  );
  const child = { ...layer, parentId: "g" };
  assert.deepEqual(
    run(child, { layers: [{ id: "g", x: 1, y: 2 }, child] }),
    run({ ...layer, x: 3, y: 3 }),
  );
});
test("perspective and skew coverage preserve antialiasing and protect out-of-document pixels", () => {
  const perspective = run({ ...layer, warp: [0, 0, 1, 0, 0.75, 1, 0.25, 1] });
  // This trapezoid has the analytic map ((u+.5v)/(1+v), 2v/(1+v)).
  for (let y = 0; y < 3; y++)
    for (let x = 0; x < 4; x++) {
      const u = (x + 0.5) / 4,
        v = (y + 0.5) / 3;
      assert.equal(
        perspective[y * 4 + x],
        Math.round(
          (2 + (4 * (u + 0.5 * v)) / (1 + v) - 0.5) * 10 +
            (1 + (6 * v) / (1 + v) - 0.5) * 20,
        ),
      );
    }
  const skew = run({ ...layer, skewX: 45 });
  assert.equal(skew[0], 45);
  assert.equal(skew[8], 105);
  const edge = run(
    { ...layer, x: -2, y: 0 },
    { alpha: new Uint8Array(80).fill(255) },
  );
  assert.deepEqual([...edge.slice(0, 4)], [0, 0, 255, 255]);
  assert.throws(() => run({ ...layer, scaleX: 0 }), /不可逆/);
  assert.throws(() => run(layer, { alpha: new Uint8Array(2) }), /尺寸/);
});
