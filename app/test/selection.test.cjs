const test = require("node:test"),
  assert = require("node:assert/strict");
const {
    selectColor,
    combineAlpha,
    growAlpha,
  } = require("../core/selection.cjs"),
  L = require("../core/layers.cjs");
test("wand selects connected colors while range includes disconnected and transparent RGB is ignored", () => {
  const rgba = Uint8Array.from([
    255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255,
  ]);
  assert.deepEqual([...selectColor(rgba, 3, 1, 0, 0, 0, true)], [255, 0, 0]);
  assert.deepEqual([...selectColor(rgba, 3, 1, 0, 0, 0, false)], [255, 0, 255]);
  assert.deepEqual(
    [
      ...selectColor(
        Uint8Array.from([0, 0, 0, 0, 255, 255, 255, 0]),
        2,
        1,
        0,
        0,
        0,
        false,
      ),
    ],
    [255, 255],
  );
  assert.throws(() => selectColor(rgba, 3, 1, 5, 0, 0, true), /无效/);
});
test("selection alpha operations preserve soft edges", () => {
  assert.deepEqual(
    [
      ...combineAlpha(
        Uint8Array.from([255, 128, 0]),
        Uint8Array.from([128, 128, 255]),
        "subtract",
      ),
    ],
    [127, 64, 0],
  );
  assert.deepEqual(
    [
      ...combineAlpha(
        Uint8Array.from([255, 128, 0]),
        Uint8Array.from([128, 128, 255]),
        "intersect",
      ),
    ],
    [128, 64, 0],
  );
});
test("Euclidean growth and shrink equal a brute force disk oracle including canvas boundary", () => {
  const w = 17,
    h = 13,
    a = Uint8Array.from({ length: w * h }, (_, i) =>
      (i * 37) % 13 < 5 ? 255 : 0,
    );
  for (const r of [-3, -1, 1, 3]) {
    const expected = a.map((_, i) => {
      const x = i % w,
        y = Math.floor(i / w);
      for (let dy = -Math.abs(r); dy <= Math.abs(r); dy++)
        for (let dx = -Math.abs(r); dx <= Math.abs(r); dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const xx = x + dx,
            yy = y + dy,
            v = xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : a[yy * w + xx];
          if (r > 0 && v) return 255;
          if (r < 0 && !v) return 0;
        }
      return r > 0 ? 0 : 255;
    });
    assert.deepEqual(growAlpha(a, w, h, r), expected);
  }
});
test("hierarchy relocation preserves world corners and opaque data across transformed groups", () => {
  const g = L.createLayer("group", {
      id: "g",
      rotation: 34,
      scaleX: 1.5,
      scaleY: 0.8,
      x: 130,
      y: 70,
    }),
    p = L.createLayer("image", {
      id: "p",
      x: 40,
      y: 50,
      rotation: -12,
      warp: [0.1, 0, 1, 0.1, 0.9, 1, 0, 1],
      unknown: { keep: true },
    });
  const before = L.corners([p, g], p),
    next = L.relocateLayers([p, g], ["p"], "g");
  L.corners(
    next,
    next.find((l) => l.id === "p"),
  ).forEach((p, i) =>
    assert.ok(Math.hypot(p.x - before[i].x, p.y - before[i].y) < 1e-7),
  );
  assert.deepEqual(next.find((l) => l.id === "p").unknown, p.unknown);
  const restored = L.relocateLayers(next, ["p"], undefined);
  L.corners(
    restored,
    restored.find((l) => l.id === "p"),
  ).forEach((p, i) =>
    assert.ok(Math.hypot(p.x - before[i].x, p.y - before[i].y) < 1e-7),
  );
  assert.throws(() => L.relocateLayers(next, ["g"], "p"), /自身|子层/);
  assert.throws(
    () => L.relocateLayers([p, { ...g, opacity: 0.5 }], ["p"], "g"),
    /改变/,
  );
  assert.throws(
    () => L.relocateLayers([{ ...p, locked: true }, g], ["p"], "g"),
    /锁定/,
  );
});
