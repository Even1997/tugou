import { fillImageSelection, calculateFill } from "../renderer/content-fill.js";
import { Compositor } from "../renderer/composite.js";
import {
  surface,
  pngBytes,
  selectionCanvas,
  alphaOf,
} from "../renderer/selection.js";
import {
  createLayer,
  worldMatrix,
  point,
  homography,
  project,
} from "../core/layers.cjs";
window.fillQA = {
  fillImageSelection,
  Compositor,
  surface,
  pngBytes,
  createLayer,
};
const selection = (x, y, w, h) => ({
  paths: [
    { operation: "add", points: [x, y, x + w, y, x + w, y + h, x, y + h] },
  ],
});
function pattern(w, h, hole = true) {
  const c = surface(w, h),
    ctx = c.getContext("2d"),
    data = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = (((x >> 3) + (y >> 3)) % 2) * 180 + 30;
      data.data.set([v, v * 0.8, v * 0.6, 255], (y * w + x) * 4);
    }
  ctx.putImageData(data, 0, 0);
  if (hole) {
    ctx.fillStyle = "#ff00ff";
    ctx.fillRect(w / 2 - 8, h / 2 - 8, 16, 16);
  }
  return c;
}
const pixels = (c) =>
  c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
window.fillQA.verify = async () => {
  const checks = [],
    check = (n, ok) => {
      if (!ok) throw new Error(n);
      checks.push(n);
    },
    engine = new Compositor(),
    base = pattern(128, 96),
    expected = pixels(pattern(128, 96, false)),
    original = pixels(base),
    layer = createLayer("image", {
      x: 0,
      y: 0,
      width: 128,
      height: 96,
      bitmap: { dataUrl: base.toDataURL() },
    });
  let doc = {
    width: 128,
    height: 96,
    assets: [],
    layers: [layer],
    selection: selection(56, 40, 16, 16),
  };
  const result = await fillImageSelection(
      doc,
      layer,
      engine,
      new AbortController().signal,
    ),
    filled = pixels(result.canvas);
  check(
    "real Worker restores exact pattern at original image size",
    filled.every((v, i) => v === expected[i]) &&
      result.canvas.width === 128 &&
      result.canvas.height === 96,
  );
  result.canvas.width = result.canvas.height = 1;
  const featherDoc = { ...doc, selection: { ...doc.selection, feather: 3 } },
    featherMask = alphaOf(await selectionCanvas(featherDoc, engine));
  const feather = await fillImageSelection(
      featherDoc,
      layer,
      engine,
      new AbortController().signal,
    ),
    f = pixels(feather.canvas);
  let max = 0;
  for (let i = 0; i < featherMask.length; i++)
    for (let k = 0; k < 4; k++) {
      const a = featherMask[i] / 255;
      max = Math.max(
        max,
        Math.abs(
          f[i * 4 + k] -
            (original[i * 4 + k] * (1 - a) + expected[i * 4 + k] * a),
        ),
      );
    }
  check(
    "feather agrees with document selection alpha within one channel level: " +
      max,
    max <= 1,
  );
  feather.canvas.width = feather.canvas.height = 1;
  const mask = await selectionCanvas(doc, engine),
    bitmapDoc = {
      ...doc,
      selection: { bitmap: { dataUrl: mask.toDataURL() } },
    };
  const bitmap = await fillImageSelection(
    bitmapDoc,
    layer,
    engine,
    new AbortController().signal,
  );
  check(
    "bitmap selections retain exact fill pixels",
    pixels(bitmap.canvas).every((v, i) => v === expected[i]),
  );
  bitmap.canvas.width = bitmap.canvas.height = 1;
  const inverse = {
    ...doc,
    selection: {
      paths: [
        { operation: "add", points: [0, 0, 128, 0, 128, 96, 0, 96] },
        { ...doc.selection.paths[0], operation: "subtract" },
      ],
      inverted: true,
    },
  };
  const inverted = await fillImageSelection(
    inverse,
    layer,
    engine,
    new AbortController().signal,
  );
  check(
    "subtraction plus inversion restores exact selected region",
    pixels(inverted.canvas).every((v, i) => v === expected[i]),
  );
  inverted.canvas.width = inverted.canvas.height = 1;
  for (const warp of [
    undefined,
    [0.05, 0.02, 0.94, 0.08, 0.98, 0.94, 0.01, 0.98],
  ]) {
    const moved = {
        ...layer,
        x: 130,
        y: 90,
        rotation: 23,
        width: 256,
        height: 192,
        warp,
      },
      matrix = worldMatrix([moved], moved),
      world = (u, v) => {
        const p = warp ? project(homography(warp), u, v) : { x: u, y: v };
        return point(matrix, p.x * moved.width, p.y * moved.height);
      };
    const points = [
      [0.39, 0.35],
      [0.61, 0.35],
      [0.61, 0.65],
      [0.39, 0.65],
    ].flatMap(([u, v]) => {
      const p = world(u, v);
      return [p.x, p.y];
    });
    const d = {
        ...doc,
        width: 600,
        height: 450,
        layers: [moved],
        selection: { paths: [{ operation: "add", points }] },
      },
      r = await fillImageSelection(
        d,
        moved,
        engine,
        new AbortController().signal,
      ),
      rgba = pixels(r.canvas);
    check(
      `${warp ? "perspective" : "rotated"} world selection fills original image coordinates`,
      rgba[(48 * 128 + 64) * 4] === expected[(48 * 128 + 64) * 4] &&
        rgba.every((v, i) => Math.abs(v - expected[i]) <= 1),
    );
    r.canvas.width = r.canvas.height = 1;
  }
  for (const patch of [
    { locked: true },
    { visible: false },
    { kind: "text" },
  ]) {
    const l = { ...layer, ...patch };
    let error;
    try {
      await fillImageSelection(
        { ...doc, layers: [l] },
        l,
        engine,
        new AbortController().signal,
      );
    } catch (e) {
      error = e.message;
    }
    check("rejects " + Object.keys(patch)[0], !!error);
  }
  const wide = surface(900, 160),
    wc = wide.getContext("2d");
  wc.fillStyle = "#507090";
  wc.fillRect(0, 0, 900, 160);
  wc.fillStyle = "#ff00ff";
  wc.fillRect(180, 64, 540, 32);
  const wl = createLayer("image", {
      x: 0,
      y: 0,
      width: 900,
      height: 160,
      bitmap: { dataUrl: wide.toDataURL() },
    }),
    wd = {
      width: 900,
      height: 160,
      assets: [],
      layers: [wl],
      selection: { ...selection(180, 64, 540, 32), feather: 3 },
    },
    wa = alphaOf(await selectionCanvas(wd, engine)),
    wr = await fillImageSelection(wd, wl, engine, new AbortController().signal),
    wp = pixels(wr.canvas),
    wo = pixels(wide);
  let seamError = 0;
  for (let i = 0; i < wa.length; i++)
    for (let k = 0; k < 4; k++)
      seamError = Math.max(
        seamError,
        Math.abs(
          wp[i * 4 + k] -
            (wo[i * 4 + k] * (1 - wa[i] / 255) +
              ([80, 112, 144, 255][k] * wa[i]) / 255),
        ),
      );
  check(
    "selection spanning mask tiles has no seam and preserves feather alpha: " +
      seamError,
    seamError <= 1,
  );
  wr.canvas.width = wr.canvas.height = wide.width = wide.height = 1;
  const hole = pattern(128, 96, false);
  hole.getContext("2d").clearRect(56, 40, 16, 16);
  const hl = { ...layer, bitmap: { dataUrl: hole.toDataURL() } },
    hr = await fillImageSelection(
      { ...doc, layers: [hl] },
      hl,
      engine,
      new AbortController().signal,
    );
  check(
    "transparent hole obtains opaque pattern",
    pixels(hr.canvas).every((v, i) => v === expected[i]),
  );
  hr.canvas.width = hr.canvas.height = hole.width = hole.height = 1;
  const cancel = new AbortController(),
    start = performance.now(),
    w = 1024,
    h = 1024,
    data = new Uint8ClampedArray(w * h * 4),
    alpha = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      data.set([x % 251, y % 239, (x * y) % 253, 255], (y * w + x) * 4);
      if (x > 300 && x < 720 && y > 300 && y < 720) alpha[y * w + x] = 255;
    }
  const task = calculateFill(
    { rgba: data, mask: alpha, width: w, height: h },
    cancel.signal,
  );
  setTimeout(() => cancel.abort(), 25);
  let aborted = false;
  try {
    await task;
  } catch (e) {
    aborted = e.name === "AbortError";
  }
  const cancelMs = performance.now() - start;
  check(
    "Worker abort stops computation without a result",
    aborted && cancelMs < 1000,
  );
  engine.dispose();
  return { checks, cancelMs, featherMax: max };
};
window.fillQA.fixture = async (id, size = 256) => {
  const c = pattern(size, 192),
    asset = await tugou.storeRaster(await pngBytes(c), "填充样图"),
    r = await tugou.open(id);
  await tugou.save(
    id,
    {
      ...r.document,
      width: size,
      height: 192,
      futureField: { keep: true },
      assets: [asset],
      selection: selection(size / 2 - 8, 88, 16, 16),
      layers: [
        createLayer("image", {
          name: "填充样图",
          assetId: asset.id,
          x: 0,
          y: 0,
          width: size,
          height: 192,
          futureLayer: "保留",
        }),
      ],
    },
    r.revision,
  );
};
window.fillQA.verifyLarge = async () => {
  const c = surface(10000, 10000),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#7b8c9d";
  ctx.fillRect(0, 0, 10000, 10000);
  ctx.fillStyle = "#ff00ff";
  ctx.fillRect(9950, 9950, 24, 24);
  const asset = await tugou.storeRaster(await pngBytes(c), "100MP 填充源图");
  c.width = c.height = 1;
  const l = createLayer("image", {
      assetId: asset.id,
      x: 0,
      y: 0,
      width: 10000,
      height: 10000,
    }),
    doc = {
      width: 10000,
      height: 10000,
      layers: [l],
      assets: [asset],
      selection: selection(9950, 9950, 24, 24),
    },
    e = new Compositor(),
    start = performance.now();
  const r = await fillImageSelection(doc, l, e, new AbortController().signal),
    fillMs = performance.now() - start,
    rgba = [...r.canvas.getContext("2d").getImageData(9940, 9940, 48, 48).data],
    bitmap = await tugou.storeRaster(
      await pngBytes(r.canvas),
      "100MP 填充结果",
    );
  const report = {
    fillMs,
    totalMs: performance.now() - start,
    roi: r.roi,
    width: r.canvas.width,
    height: r.canvas.height,
    bitmap,
    rgba,
  };
  r.canvas.width = r.canvas.height = 1;
  e.dispose();
  return report;
};
