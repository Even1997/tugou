const test = require("node:test"),
  assert = require("node:assert/strict");
const L = require("../core/layers.cjs");
const close = (a, b) =>
  a.forEach((n, i) => assert.ok(Math.abs(n - b[i]) < 1e-7, `${n} != ${b[i]}`));
const shape = (id, patch = {}) =>
  L.createLayer("shape", { id, name: id, shape: "rect", ...patch });
test("group and ungroup preserve world transforms, unknown fields and child geometry", () => {
  const layers = [
    shape("a", {
      x: 80,
      y: 40,
      rotation: 24,
      scaleX: 1.2,
      skewX: 7,
      unknown: { kept: true },
    }),
    shape("b", { x: 600, y: 300, flipX: true }),
  ];
  const before = layers.map((l) => L.worldMatrix(layers, l));
  const grouped = L.groupLayers(layers, ["a", "b"]);
  for (let i = 0; i < 2; i++)
    close(
      L.worldMatrix(
        grouped.layers,
        grouped.layers.find((l) => l.id === layers[i].id),
      ),
      before[i],
    );
  const result = L.ungroupLayers(grouped.layers, grouped.ids[0]);
  for (let i = 0; i < 2; i++)
    close(
      L.worldMatrix(
        result.layers,
        result.layers.find((l) => l.id === layers[i].id),
      ),
      before[i],
    );
  assert.deepEqual(result.layers[0].unknown, { kept: true });
});
test("moving selected parent and child moves only the root; locked ancestry prevents mutation", () => {
  const group = L.createLayer("group", { id: "g", x: 10, y: 20, rotation: 30 }),
    child = shape("c", { parentId: "g", x: 40, y: 30 });
  let result = L.moveLayers([group, child], ["g", "c"], 100, 20);
  assert.equal(result[0].x, 110);
  assert.equal(result[1].x, 40);
  group.locked = true;
  assert.deepEqual(L.moveLayers([group, child], ["c"], 100, 20), [
    group,
    child,
  ]);
  assert.deepEqual(L.deleteLayers([group, child], ["c"]), [group, child]);
});
test("duplicate remaps nested parents and internal mask references; delete clears external source links", () => {
  const group = L.createLayer("group", { id: "g" }),
    child = shape("c", { parentId: "g" }),
    masked = shape("m", { maskSourceId: "c" });
  const copy = L.duplicateLayers([group, child, masked], ["g", "m"]);
  const newGroup = copy.layers.find((l) => l.id === copy.ids[0]),
    newChild = copy.layers.find((l) => l.parentId === newGroup.id),
    newMasked = copy.layers.at(-1);
  assert.equal(newMasked.maskSourceId, newChild.id);
  assert.equal(copy.layers.length, 6);
  const deleted = L.deleteLayers([group, child, masked], ["g"]);
  assert.equal(deleted.length, 1);
  assert.equal(deleted[0].maskSourceId, undefined);
});
test("alignment and equal gaps work in document space under transformed groups", () => {
  const g = L.createLayer("group", { id: "g", rotation: 30, scaleX: 2 }),
    a = shape("a", { parentId: "g", x: 0, y: 0, width: 100, height: 40 }),
    b = shape("b", { parentId: "g", x: 300, y: 30, width: 80, height: 40 }),
    c = shape("c", { parentId: "g", x: 500, y: 10, width: 70, height: 40 });
  const layers = [g, a, b, c],
    aligned = L.alignLayers(
      { layers, width: 1000, height: 1000 },
      ["a", "b", "c"],
      "y",
      "start",
    );
  const boxes = ["a", "b", "c"].map((id) => L.bounds(aligned, [id]));
  close(
    boxes.map((b) => b.y),
    [boxes[0].y, boxes[0].y, boxes[0].y],
  );
  const spaced = L.distributeLayers(layers, ["a", "b", "c"], "x"),
    bs = ["a", "b", "c"].map((id) => L.bounds(spaced, [id]));
  close([bs[1].x - bs[0].x - bs[0].width], [bs[2].x - bs[1].x - bs[1].width]);
});
test("homography maps all corners and inverse hit testing survives rotation and skew", () => {
  const q = [0.1, 0.2, 0.9, 0, 1.1, 1, 0.05, 0.8],
    h = L.homography(q);
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ].forEach(([x, y], i) => {
    const p = L.project(h, x, y);
    close([p.x, p.y], q.slice(i * 2, i * 2 + 2));
  });
  const l = shape("a", {
    warp: q,
    rotation: 20,
    skewX: 12,
    width: 400,
    height: 300,
  });
  const w = L.project(h, 0.3, 0.7),
    p = L.point(L.worldMatrix([l], l), w.x * l.width, w.y * l.height),
    back = L.localPoint([l], l, p.x, p.y);
  close([back.x, back.y], [120, 210]);
});
test("validation rejects cycles, folded quads and invalid parents without altering data", () => {
  const a = L.createLayer("group", { id: "a", parentId: "b" }),
    b = L.createLayer("group", { id: "b", parentId: "a" });
  assert.throws(() => L.validateLayers([a, b]), /循环/);
  assert.throws(
    () => L.validateLayers([shape("c", { warp: [0, 0, 1, 1, 1, 0, 0, 1] })]),
    /交叉|折叠/,
  );
  assert.throws(
    () => L.validateLayers([shape("c", { parentId: "missing" })]),
    /分组引用/,
  );
});
test("reordering is scoped to siblings and cannot change locked layer properties", () => {
  const layers = [shape("a"), shape("b"), shape("c")];
  assert.deepEqual(
    L.reorder(layers, ["a"], "up").map((l) => l.id),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    L.reorder(layers, ["a", "b"], "top").map((l) => l.id),
    ["c", "a", "b"],
  );
  assert.throws(
    () =>
      L.ungroupLayers([L.createLayer("group", { id: "g", opacity: 0.5 })], "g"),
    /改变外观/,
  );
});
test("crop preserves layer world geometry, anchored masks, guides and unknown data", () => {
  const doc = {
    width: 1000,
    height: 800,
    custom: { retained: true },
    assets: [{ id: "asset" }],
    layers: [
      L.createLayer("group", { id: "g", x: 150, y: 80 }),
      shape("c", {
        parentId: "g",
        x: 20,
        y: 30,
        mask: {
          anchor: { matrix: [1, 0, 0, 1, 160, 100], width: 20, height: 20 },
        },
      }),
    ],
    layout: {
      snap: true,
      guides: [
        { axis: "x", position: 500 },
        { axis: "y", position: 300 },
      ],
    },
    selection: {
      paths: [
        { operation: "add", points: [100, 50, 700, 50, 700, 450, 100, 450] },
      ],
    },
  };
  const before = structuredClone(doc),
    result = L.cropToSelection(doc);
  assert.deepEqual(doc, before);
  assert.equal(result.width, 600);
  assert.equal(result.height, 400);
  close(L.worldMatrix(result.layers, result.layers[1]), [1, 0, 0, 1, 70, 60]);
  close(result.layers[1].mask.anchor.matrix, [1, 0, 0, 1, 60, 50]);
  assert.deepEqual(result.layout.guides, [
    { axis: "x", position: 400 },
    { axis: "y", position: 250 },
  ]);
  assert.deepEqual(result.assets, doc.assets);
  assert.deepEqual(result.custom, doc.custom);
  assert.throws(
    () =>
      L.cropToSelection({
        ...doc,
        selection: { ...doc.selection, inverted: true },
      }),
    /普通/,
  );
});
test("snapping respects disabled mode, grid spacing and nearby guide edges", () => {
  const layers = [shape("a", { x: 13, y: 27, width: 100, height: 80 })];
  assert.deepEqual(L.snapDelta(layers, ["a"], 20, 30, { snap: false }), {
    dx: 20,
    dy: 30,
  });
  assert.deepEqual(
    L.snapDelta(layers, ["a"], 20, 30, { snap: true, gridSize: 20 }),
    { dx: 27, dy: 33 },
  );
  assert.deepEqual(
    L.snapDelta(layers, ["a"], 20, 30, {
      snap: true,
      gridSize: 20,
      guides: [{ axis: "x", position: 142 }],
    }),
    { dx: 29, dy: 33 },
  );
  assert.throws(() => L.validateLayers([shape("a", { scaleX: 0 })]), /缩放/);
});
