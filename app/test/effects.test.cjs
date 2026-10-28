const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  types,
  defaults,
  validateEffect,
  distanceField,
  effectPadding,
} = require("../core/effects.cjs");
const L = require("../core/layers.cjs");
test("six effect definitions validate values and retain opaque metadata", () => {
  assert.equal(Object.keys(types).length, 6);
  for (const type of Object.keys(types)) {
    const e = { ...defaults(type), future: { keep: 1 } };
    assert.equal(validateEffect(e).future.keep, 1);
  }
  for (const e of [
    { ...defaults("stroke"), size: -1 },
    { ...defaults("stroke"), position: "invalid" },
    { ...defaults("shadow"), radius: Infinity },
    { ...defaults("overlay"), color: "url(x)" },
    { ...defaults("overlay"), opacity: 101 },
  ])
    assert.throws(() => validateEffect(e));
  const e = defaults("shadow");
  assert.throws(
    () => L.validateLayers([L.createLayer("shape", { effects: [e, e] })]),
    /标识/,
  );
});
test("distance field matches brute force squared Euclidean distance", () => {
  const w = 13,
    h = 9,
    a = Uint8Array.from({ length: w * h }, (_, i) =>
      i % 11 === 2 || i % 17 === 5 ? 255 : 0,
    );
  for (const inside of [true, false]) {
    const actual = distanceField(a, w, h, inside);
    for (let i = 0; i < a.length; i++) {
      let best = 1e12;
      for (let j = 0; j < a.length; j++)
        if (a[j] >= 128 === inside)
          best = Math.min(
            best,
            ((i % w) - (j % w)) ** 2 +
              (Math.floor(i / w) - Math.floor(j / w)) ** 2,
          );
      assert.equal(actual[i], best);
    }
  }
  assert.ok(
    [...distanceField(new Uint8Array(16), 4, 4, true)].every(
      (n) => Number.isFinite(n) && n > 1e10,
    ),
  );
});
test("effect padding includes blur spread and offset while ignoring disabled effects", () => {
  assert.equal(
    effectPadding({
      ...defaults("shadow"),
      radius: 10,
      spread: 3,
      distance: 20,
    }),
    65,
  );
  assert.equal(effectPadding({ ...defaults("shadow"), enabled: false }), 0);
  assert.equal(effectPadding(defaults("overlay")), 0);
  const g = L.createLayer("group", { effects: [defaults("shadow")] });
  assert.throws(() => L.ungroupLayers([g], g.id), /先合并/);
});
