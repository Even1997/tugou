const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  defaults,
  fields,
  validateAdjustment,
  adjustPixels,
  curveTable,
} = require("../core/adjustments.cjs");
test("adjustments validate parameters without dropping opaque fields", () => {
  assert.equal(Object.keys(fields).length, 12);
  for (const type of Object.keys(fields)) {
    const a = { ...defaults(type), future: { keep: true } };
    assert.equal(validateAdjustment(a).future.keep, true);
  }
  for (const a of [
    { ...defaults("levels"), black: 200, white: 100 },
    { ...defaults("exposure"), gamma: 0 },
    { ...defaults("blur"), radius: Infinity },
    {
      ...defaults("curves"),
      channels: {
        rgb: [
          [0, 0],
          [0, 30],
          [255, 255],
        ],
      },
    },
    { ...defaults("gradientMap"), dark: "red" },
  ])
    assert.throws(() => validateAdjustment(a));
});
test("numeric color transforms preserve alpha and known values", () => {
  const run = (a, rgba = [64, 128, 192, 128]) => [
    ...adjustPixels(Uint8ClampedArray.from(rgba), 1, a),
  ];
  assert.deepEqual(run(defaults("invert")), [191, 127, 63, 128]);
  assert.deepEqual(
    run({ ...defaults("exposure"), exposure: 1 }),
    [128, 255, 255, 128],
  );
  assert.deepEqual(
    run({ ...defaults("levels"), black: 64, white: 192 }),
    [0, 128, 255, 128],
  );
  assert.deepEqual(
    run({ ...defaults("hueSaturation"), hue: 120 }, [255, 0, 0, 77]),
    [0, 255, 0, 77],
  );
  assert.deepEqual(
    run(
      { ...defaults("gradientMap"), dark: "#ff0000", light: "#0000ff" },
      [0, 0, 0, 22],
    ),
    [255, 0, 0, 22],
  );
  for (const type of [
    "brightnessContrast",
    "hueSaturation",
    "levels",
    "curves",
    "exposure",
    "colorBalance",
  ])
    assert.deepEqual(run(defaults(type)), [64, 128, 192, 128]);
});
test("curve controls interpolate exact anchors without segment overshoot", () => {
  const t = curveTable([
    [0, 20],
    [64, 200],
    [128, 40],
    [255, 230],
  ]);
  assert.equal(t[0], 20);
  assert.equal(t[64], 200);
  assert.equal(t[128], 40);
  assert.equal(t[255], 230);
  assert.ok([...t.slice(65, 128)].every((v) => v >= 40 && v <= 200));
});
test("noise is deterministic in document coordinates across tile boundaries", () => {
  for (const type of ["noise", "grain"]) {
    const a = { ...defaults(type), monochrome: false, amount: 100 },
      full = Uint8ClampedArray.from({ length: 64 * 4 }, (_, i) =>
        i % 4 === 3 ? 137 : 128,
      ),
      tile = full.slice(24 * 4);
    adjustPixels(full, 64, a, { x: 50, y: 7 });
    adjustPixels(tile, 40, a, { x: 74, y: 7 });
    assert.deepEqual(tile, full.slice(24 * 4));
  }
});
test("ungroup refuses to expand active adjustment scope", () => {
  const L = require("../core/layers.cjs"),
    g = L.createLayer("group"),
    a = L.createLayer("adjustment", {
      parentId: g.id,
      adjustment: defaults("invert"),
    });
  assert.throws(() => L.ungroupLayers([g, a], g.id), /作用范围/);
  assert.equal(
    L.ungroupLayers([g, { ...a, clipping: true }], g.id).layers.length,
    1,
  );
});
