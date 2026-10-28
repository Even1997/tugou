import "./composition-engine-entry.js";
import { processImage, loadOriginal } from "../renderer/image-processing.js";
const q = window.compositionQA;
async function run(
  source,
  settings,
  secondary,
  signal = new AbortController().signal,
  progress = () => {},
) {
  if (["crop", "extract", "patch"].includes(settings.operation))
    return (await q.process(source, secondary, settings.operation, settings))
      .parts[0];
  const bytes = await processImage(source, settings, signal, progress);
  return window.tugou.storeRaster(bytes, "geometry " + settings.operation);
}
async function fixtures() {
  const source = await q.asset("像素原图", 65, 49, (ctx, c) => {
    const p = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        p.data.set(
          [
            (x * 11) % 256,
            (y * 17) % 256,
            (x + y) * 2,
            (x + y) % 5 === 0 ? 0 : (x + y) % 3 === 0 ? 128 : 255,
          ],
          i,
        );
      }
    ctx.putImageData(p, 0, 0);
  });
  const secondary = await q.asset("替换原图", 5, 3, (ctx, c) => {
    const p = ctx.createImageData(5, 3);
    for (let i = 0; i < 15; i++)
      p.data.set(
        [220, 30 + i * 7, 170, i % 3 === 0 ? 0 : i % 3 === 1 ? 128 : 255],
        i * 4,
      );
    ctx.putImageData(p, 0, 0);
  });
  return { source, secondary };
}
async function compare(source, output, s, secondary) {
  const p = await q.pixels(source),
    actual = await q.pixels(output),
    w = actual.width,
    h = actual.height;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const original = await loadOriginal(source),
    im = await createImageBitmap(original);
  original.src = "";
  if (s.operation === "resize") ctx.drawImage(im, 0, 0, w, h);
  if (s.operation === "extend")
    ctx.drawImage(
      im,
      s.sizeMode === "size" ? s.left : s.padding,
      s.sizeMode === "size" ? s.top : s.padding,
    );
  if (s.operation === "crop")
    ctx.drawImage(
      im,
      s.left,
      s.top,
      s.width,
      s.height,
      0,
      0,
      s.width,
      s.height,
    );
  if (s.operation === "extract" || s.operation === "patch")
    ctx.drawImage(im, 0, 0);
  im.close();
  const expected = ctx.getImageData(0, 0, w, h);
  let replacement;
  if (s.operation === "patch") {
    const canvas = new OffscreenCanvas(s.width, s.height),
      read = canvas.getContext("2d", { willReadFrequently: true });
    read.imageSmoothingQuality = "high";
    const image = await loadOriginal(secondary),
      b = await createImageBitmap(image);
    image.src = "";
    read.drawImage(b, 0, 0, s.width, s.height);
    b.close();
    replacement = read.getImageData(0, 0, s.width, s.height);
    canvas.width = canvas.height = 1;
  }
  if (["extract", "patch"].includes(s.operation))
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4,
          inside =
            x >= s.left &&
            y >= s.top &&
            x < s.left + s.width &&
            y < s.top + s.height;
        const weight = inside
          ? s.feather
            ? Math.min(
                1,
                (x - s.left + 0.5) / s.feather,
                (y - s.top + 0.5) / s.feather,
                (s.left + s.width - x - 0.5) / s.feather,
                (s.top + s.height - y - 0.5) / s.feather,
              )
            : 1
          : 0;
        if (s.operation === "extract")
          expected.data[i + 3] = Math.round(p.data[i + 3] * weight);
        else if (weight) {
          const j = ((y - s.top) * s.width + x - s.left) * 4;
          const a = (replacement.data[j + 3] / 255) * weight,
            b = p.data[i + 3] / 255,
            outA = a + b - a * b;
          for (let k = 0; k < 3; k++)
            expected.data[i + k] = outA
              ? Math.round(
                  (replacement.data[j + k] * a + p.data[i + k] * b * (1 - a)) /
                    outA,
                )
              : 0;
          expected.data[i + 3] = Math.round(outA * 255);
        }
      }
  let alpha = 0,
    premultiplied = 0,
    outside = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      alpha = Math.max(
        alpha,
        Math.abs(expected.data[i + 3] - actual.data[i + 3]),
      );
      for (let k = 0; k < 3; k++)
        premultiplied = Math.max(
          premultiplied,
          Math.abs(
            (expected.data[i + k] * expected.data[i + 3]) / 255 -
              (actual.data[i + k] * actual.data[i + 3]) / 255,
          ),
        );
      if (
        s.operation === "patch" &&
        (x < s.left ||
          y < s.top ||
          x >= s.left + s.width ||
          y >= s.top + s.height)
      )
        for (let k = 0; k < 4; k++)
          outside += p.data[i + k] !== actual.data[i + k];
    }
  c.width = c.height = 1;
  return { alpha, premultiplied, outside, width: w, height: h };
}
async function verify() {
  const f = await fixtures(),
    results = [];
  const settings = [
    { operation: "resize", sizeMode: "size", width: 31, height: 27 },
    { operation: "resize", scale: 2 },
    {
      operation: "extend",
      sizeMode: "size",
      width: 81,
      height: 63,
      left: 11,
      top: 3,
    },
    { operation: "extend", padding: 7 },
    { operation: "crop", left: 11, top: 7, width: 31, height: 27 },
    {
      operation: "extract",
      left: 11,
      top: 7,
      width: 31,
      height: 27,
      feather: 4,
    },
    { operation: "patch", left: 11, top: 7, width: 31, height: 27, feather: 4 },
  ];
  for (const s of settings) {
    const a = await run(f.source, s, f.secondary);
    results.push({
      settings: s,
      asset: a,
      ...(await compare(f.source, a, s, f.secondary)),
    });
  }
  const large = await q.asset("跨块原图", 1025, 1027, (ctx, c) => {
    ctx.fillStyle = "rgba(50,100,150,.5)";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.clearRect(510, 510, 5, 7);
  });
  const s = {
      operation: "patch",
      left: 499,
      top: 499,
      width: 525,
      height: 527,
      feather: 20,
    },
    a = await run(large, s, f.secondary);
  results.push({
    settings: s,
    asset: a,
    ...(await compare(large, a, s, f.secondary)),
  });
  let cancelled = false;
  const controller = new AbortController();
  try {
    await run(
      large,
      { operation: "resize", scale: 2 },
      null,
      controller.signal,
      () => controller.abort(),
    );
  } catch (e) {
    cancelled = e.name === "AbortError";
  }
  return { fixture: f, results, cancelled };
}
async function sample(a) {
  const im = await loadOriginal(a),
    c = new OffscreenCanvas(1, 1),
    ctx = c.getContext("2d", { willReadFrequently: true });
  const points = [
      [0, 0],
      [1, 1],
      [511, 512],
      [2500, 5000],
      [5000, 5000],
      [a.width - 1, a.height - 1],
    ],
    values = [];
  for (const [x, y] of points) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(im, x, y, 1, 1, 0, 0, 1, 1);
    values.push([...ctx.getImageData(0, 0, 1, 1).data]);
  }
  im.src = "";
  return { points, values };
}
async function large(mode) {
  const size = mode === "resize" ? 5000 : mode === "extend" ? 9998 : 10000;
  const source = await q.asset("大图原图", size, size, (ctx, c) => {
    ctx.fillStyle = "#4080c0";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.clearRect(0, 0, 8, 8);
  });
  const secondary =
    mode === "patch"
      ? await q.asset("大图替换", 2, 2, (ctx) => {
          ctx.fillStyle = "#e02040";
          ctx.fillRect(0, 0, 2, 2);
        })
      : null;
  const settings = {
    operation: mode,
    ...{
      resize: { sizeMode: "size", width: 10000, height: 10000 },
      extend: {
        sizeMode: "size",
        width: 10000,
        height: 10000,
        left: 1,
        top: 1,
      },
      crop: { left: 1, top: 1, width: 9998, height: 9998 },
      extract: { left: 2500, top: 2500, width: 5000, height: 5000, feather: 4 },
      patch: { left: 2500, top: 2500, width: 5000, height: 5000, feather: 4 },
    }[mode],
  };
  let beats = 0,
    maxHeartbeatGap = 0,
    last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    maxHeartbeatGap = Math.max(maxHeartbeatGap, now - last);
    last = now;
    beats++;
  }, 25);
  const start = performance.now();
  let result;
  try {
    result = await run(source, settings, secondary);
  } finally {
    clearInterval(timer);
  }
  return {
    source,
    secondary,
    result,
    settings,
    elapsedMs: performance.now() - start,
    beats,
    maxHeartbeatGap,
    sample: await sample(result),
  };
}
async function wedding(source) {
  const box = { left: 300, top: 450, width: 300, height: 350 };
  const cropSettings = { operation: "crop", ...box },
    extractSettings = { operation: "extract", ...box, feather: 16 };
  const crop = await run(source, cropSettings),
    extract = await run(source, extractSettings);
  const patchSettings = {
    operation: "patch",
    left: 50,
    top: 900,
    width: 350,
    height: 400,
    feather: 25,
  };
  const patch = await run(source, patchSettings, crop);
  const checks = [];
  for (const [a, s, secondary] of [
    [crop, cropSettings],
    [extract, extractSettings],
    [patch, patchSettings, crop],
  ])
    checks.push({
      operation: s.operation,
      ...(await compare(source, a, s, secondary)),
    });
  const pictures = [source, crop, extract, patch],
    canvas = new OffscreenCanvas(1600, 800),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8295a4";
  ctx.fillRect(0, 0, 1600, 800);
  ctx.font = "20px sans-serif";
  for (const [i, a] of pictures.entries()) {
    const image = await loadOriginal(a),
      scale = Math.min(380 / a.width, 740 / a.height);
    ctx.drawImage(
      image,
      i * 400 + (400 - a.width * scale) / 2,
      50 + (740 - a.height * scale) / 2,
      a.width * scale,
      a.height * scale,
    );
    ctx.fillStyle = "#fff";
    ctx.fillText(
      ["Original", "Crop", "Extract (full frame)", "Patch (full frame)"][i],
      i * 400 + 12,
      28,
    );
    image.src = "";
  }
  const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    ),
    review = await window.tugou.storeRaster(bytes, "尺寸区域样图");
  canvas.width = canvas.height = 1;
  return { checks, review };
}
window.geometryQA = { fixtures, run, compare, verify, sample, large, wedding };
