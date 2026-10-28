const test = require("node:test"),
  assert = require("node:assert/strict");
const { filterMaterials, replaceLayerAsset } = require("../core/materials.cjs");
const { createLayer, corners } = require("../core/layers.cjs");
test("material filtering and sorting are stable views that never reorder stored assets", () => {
  const assets = [
      { id: "a", name: "图10", width: 20, height: 10 },
      { id: "b", name: "图2", width: 10, height: 20, generation: {} },
      { id: "c", name: "图1", width: 30, height: 30, toolResult: {} },
    ],
    snapshot = structuredClone(assets);
  assert.deepEqual(
    filterMaterials(assets).map((a) => a.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    filterMaterials(assets, { sort: "name" }).map((a) => a.id),
    ["c", "b", "a"],
  );
  assert.deepEqual(
    filterMaterials(assets, { sort: "oldest" }).map((a) => a.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    filterMaterials(assets, {
      query: " 图2 ",
      source: "generated",
      shape: "portrait",
    }).map((a) => a.id),
    ["b"],
  );
  assert.equal(
    filterMaterials(assets, { source: "imported", shape: "square" }).length,
    0,
  );
  assert.equal(
    filterMaterials(assets, { source: "processed", sort: "pixels" })[0].id,
    "c",
  );
  assert.deepEqual(assets, snapshot);
});
test("layer replacement retains transformed quad center, width, hierarchy, mask and effects; prior raster edits remain material", () => {
  const assets = [
      { id: "a", width: 20, height: 10 },
      { id: "b", width: 10, height: 20 },
    ],
    group = createLayer("group", {
      id: "g",
      x: 100,
      y: 20,
      rotation: 17,
      scaleX: 1.3,
      scaleY: 0.6,
    }),
    layer = createLayer("image", {
      id: "l",
      parentId: "g",
      assetId: "a",
      x: 30,
      y: 80,
      width: 40,
      height: 20,
      rotation: 31,
      skewX: 12,
      flipY: true,
      warp: [0.1, 0.1, 0.9, 0, 1, 0.8, 0, 1],
      bitmap: {
        id: "paint",
        name: "笔刷",
        width: 20,
        height: 10,
        resource: "paint.png",
      },
      mask: { future: 42 },
      effects: [{ future: 42 }],
      unknown: 42,
    });
  const doc = { assets, layers: [group, layer], unknown: { keep: true } },
    before = structuredClone(doc),
    next = replaceLayerAsset(doc, "l", "a", assets[1]),
    changed = next.layers[1];
  const center = (pts) => ({
    x: pts.reduce((n, p) => n + p.x, 0) / 4,
    y: pts.reduce((n, p) => n + p.y, 0) / 4,
  });
  const a = center(corners(doc.layers, layer)),
    b = center(corners(next.layers, changed));
  assert.ok(Math.abs(a.x - b.x) < 1e-8 && Math.abs(a.y - b.y) < 1e-8);
  assert.equal(changed.width, 40);
  assert.equal(changed.height, 80);
  assert.equal(changed.bitmap, undefined);
  assert.equal(changed.parentId, "g");
  assert.deepEqual(changed.mask, layer.mask);
  assert.deepEqual(changed.effects, layer.effects);
  assert.deepEqual(changed.warp, layer.warp);
  assert.equal(changed.unknown, 42);
  assert.equal(next.assets.at(-1).id, "paint");
  assert.equal(filterMaterials(next.assets,{source:'processed'})[0].id,'paint');
  assert.deepEqual(doc, before);
  assert.equal(next.unknown, doc.unknown);
});
test("replacement rejects stale, missing, locked or invalid targets and keeps imported assets atomic", () => {
  const a = { id: "a", width: 20, height: 10 },
    b = { id: "b", width: 10, height: 20 },
    layer = createLayer("image", { id: "l", assetId: "a" }),
    doc = { assets: [a], layers: [layer] };
  const next = replaceLayerAsset(doc, "l", "a", b);
  assert.equal(next.assets.length, 2);
  assert.equal(doc.assets.length, 1);
  assert.equal(replaceLayerAsset(doc, "l", "a", a), doc);
  assert.throws(() => replaceLayerAsset(next, "l", "a", a), /变化/);
  assert.throws(() => replaceLayerAsset(doc, "missing", "a", b), /变化/);
  assert.throws(
    () => replaceLayerAsset(doc, "l", "a", { ...b, width: 0 }),
    /尺寸/,
  );
  const g = createLayer("group", { id: "g", locked: true });
  assert.throws(
    () =>
      replaceLayerAsset(
        { ...doc, layers: [g, { ...layer, parentId: "g" }] },
        "l",
        "a",
        b,
      ),
    /解锁/,
  );
});
