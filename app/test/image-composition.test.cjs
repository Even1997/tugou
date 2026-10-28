const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  compositionDefaults,
  validateComposition,
  recoverMatte,
  applyTexture,
  gridRegions,
  alphaRegions,
} = require("../core/image-composition.cjs");
test("paired backgrounds recover alpha and reproduce both composites within quantization", () => {
  const black = new Uint8ClampedArray(256 * 4),
    white = new Uint8ClampedArray(256 * 4);
  for (let a = 0; a < 256; a++) {
    for (let c = 0; c < 3; c++) {
      const f = [39, 147, 219][c];
      black[a * 4 + c] = Math.round((f * a) / 255);
      white[a * 4 + c] = Math.round((f * a) / 255 + 255 - a);
    }
    black[a * 4 + 3] = white[a * 4 + 3] = 255;
  }
  const before = black.slice(),
    w = white.slice(),
    r = recoverMatte(black, white);
  assert.deepEqual(r, { inconsistent: 0, transparent: 0 });
  assert.deepEqual(w, white);
  for (let a = 0; a < 256; a++) {
    assert.equal(black[a * 4 + 3], a);
    for (let c = 0; c < 3; c++) {
      assert.ok(
        Math.abs((black[a * 4 + c] * a) / 255 - before[a * 4 + c]) <= 1,
      );
      assert.ok(
        Math.abs((black[a * 4 + c] * a) / 255 + 255 - a - white[a * 4 + c]) <=
          1,
      );
    }
  }
  assert.deepEqual([...black.subarray(0, 4)], [0, 0, 0, 0]);
  assert.equal(
    recoverMatte(
      Uint8ClampedArray.from([220, 30, 40, 255]),
      Uint8ClampedArray.from([20, 100, 200, 255]),
    ).inconsistent,
    1,
  );
  assert.equal(
    recoverMatte(
      Uint8ClampedArray.from([0, 0, 0, 0]),
      Uint8ClampedArray.from([255, 255, 255, 255]),
    ).transparent,
    1,
  );
});
test("texture preserves alpha and exterior while honoring feather, strength and material alpha", () => {
  const w = 7,
    h = 5,
    original = new Uint8ClampedArray(w * h * 4),
    material = new Uint8ClampedArray(original.length);
  for (let i = 0; i < w * h; i++) {
    original.set([60, 120, 180, i % 256], i * 4);
    material.set([200, 40, 90, 128], i * 4);
  }
  const before = original.slice(),
    s = { left: 2, top: 1, width: 3, height: 3, feather: 1, strength: 50 };
  applyTexture(original, material, w, h, s, 0, 0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      assert.equal(original[i + 3], before[i + 3]);
      if (x < 2 || x >= 5 || y < 1 || y >= 4)
        assert.deepEqual(
          original.subarray(i, i + 4),
          before.subarray(i, i + 4),
        );
      else {
        const edge = x === 3 && y === 2 ? 1 : 0.5,
          mix = (edge * 0.5 * 128) / 255;
        assert.equal(original[i], Math.round(60 * (1 - mix) + 200 * mix));
      }
    }
  const tile = before.slice(2 * w * 4, 3 * w * 4),
    m = material.slice(0, w * 4);
  applyTexture(tile, m, w, 1, s, 0, 2);
  assert.deepEqual(
    tile,
    original.slice(2 * w * 4, 3 * w * 4),
    "tile boundaries do not change blending",
  );
});
test("grid partitions odd dimensions once and retains full source coordinates", () => {
  const parts = gridRegions(17, 13, 3, 4),
    counts = new Uint8Array(17 * 13);
  for (const { bounds: b } of parts)
    for (let y = b.top; y < b.top + b.height; y++)
      for (let x = b.left; x < b.left + b.width; x++) counts[y * 17 + x]++;
  assert.equal(parts.length, 12);
  assert.ok(counts.every((n) => n === 1));
  assert.throws(() => gridRegions(10, 10, 16, 1));
  assert.throws(() => gridRegions(100, 100, 9, 8));
});
test("component labels match an independent flood oracle, retaining small pieces and diagonal connections", () => {
  let seed = 391;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let trial = 0; trial < 25; trial++) {
    const width = 23,
      height = 19,
      data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++)
      if (random() < 0.28) data[i * 4 + 3] = 1 + Math.floor(random() * 255);
    const visited = new Set(),
      groups = [];
    for (let i = 0; i < width * height; i++)
      if (data[i * 4 + 3] && !visited.has(i)) {
        const q = [i];
        visited.add(i);
        for (let j = 0; j < q.length; j++) {
          const p = q[j],
            x = p % width,
            y = Math.floor(p / width);
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx,
                ny = y + dy,
                k = ny * width + nx;
              if (
                nx >= 0 &&
                nx < width &&
                ny >= 0 &&
                ny < height &&
                data[k * 4 + 3] &&
                !visited.has(k)
              ) {
                visited.add(k);
                q.push(k);
              }
            }
        }
        groups.push(q);
      }
    const { labels, parts } = alphaRegions(data, width, height, 4);
    assert.equal(
      parts.length,
      groups.filter((g) => g.length >= 4).length +
        (groups.some((g) => g.length < 4) ? 1 : 0),
    );
    for (const group of groups) {
      const label = labels[group[0]];
      assert.ok(label !== 0);
      assert.ok(group.every((i) => labels[i] === label));
      assert.equal(label === -1, group.length < 4);
    }
    for (let i = 0; i < width * height; i++)
      assert.equal(labels[i] !== 0, data[i * 4 + 3] > 0);
    for (const p of parts) {
      assert.equal(
        p.pixels,
        Array.from(labels).filter((n) => n === p.label).length,
      );
      assert.ok(
        p.bounds.left >= 0 &&
          p.bounds.top >= 0 &&
          p.bounds.width > 0 &&
          p.bounds.height > 0,
      );
    }
  }
});
test("composition rejects misaligned pairs, invalid regions and unsplittable inputs", () => {
  assert.throws(() =>
    validateComposition(
      { operation: "mattePair", ...compositionDefaults.mattePair },
      20,
      30,
      { width: 20, height: 29 },
    ),
  );
  assert.throws(() =>
    validateComposition(
      {
        operation: "texture",
        ...compositionDefaults.texture,
        width: 30,
        height: 30,
      },
      20,
      30,
      { width: 1, height: 1 },
    ),
  );
  assert.throws(
    () => alphaRegions(new Uint8ClampedArray(16), 2, 2, 1),
    /完全透明/,
  );
  assert.throws(
    () => alphaRegions(new Uint8ClampedArray(16).fill(255), 2, 2, 1),
    /透明底/,
  );
  const many = new Uint8ClampedArray(30 * 30 * 4);
  for (let y = 0; y < 30; y += 3)
    for (let x = 0; x < 30; x += 3) many[(y * 30 + x) * 4 + 3] = 255;
  assert.throws(() => alphaRegions(many, 30, 30, 1), /64/);
  assert.equal(alphaRegions(many, 30, 30, 2).parts.length, 1);
});
