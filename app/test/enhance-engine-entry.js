import "./geometry-engine-entry.js";
import { processImage } from "../renderer/image-processing.js";
import { reference } from "./enhance-reference.cjs";
const q = window.compositionQA;
async function run(
  source,
  settings,
  signal = new AbortController().signal,
  progress = () => {},
) {
  return window.tugou.storeRaster(
    await processImage(source, settings, signal, progress),
    settings.operation,
  );
}
async function compare(source, result, s) {
  const p = await q.pixels(source),
    r = await q.pixels(result),
    expected =
      s.operation === "enhance"
        ? reference(p.data, p.width, p.height, s.strength)
        : p.data;
  let alpha = 0,
    premultiplied = 0,
    changed = 0;
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const i = (y * r.width + x) * 4,
        j =
          s.operation === "tile"
            ? ((y % p.height) * p.width + (x % p.width)) * 4
            : i;
      alpha = Math.max(alpha, Math.abs(expected[j + 3] - r.data[i + 3]));
      for (let c = 0; c < 3; c++) {
        premultiplied = Math.max(
          premultiplied,
          Math.abs(
            (expected[j + c] * expected[j + 3]) / 255 -
              (r.data[i + c] * r.data[i + 3]) / 255,
          ),
        );
        if (
          s.operation === "enhance" &&
          p.data[j + c] !== r.data[i + c] &&
          p.data[j + 3]
        )
          changed++;
      }
    }
  return { alpha, premultiplied, changed, width: r.width, height: r.height };
}
async function verify() {
  const f = await window.geometryQA.fixtures(),
    results = [];
  const cross = await q.asset("跨块质感", 1025, 513, (ctx, c) => {
    const p = ctx.createImageData(c.width, c.height);
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4;
        p.data.set(
          [
            (x * 13 + y * 3) % 256,
            (y * 17) % 256,
            (x + y * 7) % 256,
            (x + y) % 7 === 0 ? 0 : 128 + (x % 2) * 127,
          ],
          i,
        );
      }
    ctx.putImageData(p, 0, 0);
  });
  for (const [source, s] of [
    [f.source, { operation: "enhance", strength: 0 }],
    [f.source, { operation: "enhance", strength: 65 }],
    [cross, { operation: "enhance", strength: 100 }],
    [f.source, { operation: "tile", width: 137, height: 103 }],
    [f.source, { operation: "tile", width: 3, height: 2 }],
  ]) {
    const result = await run(source, s);
    results.push({ settings: s, ...(await compare(source, result, s)) });
  }
  const controller = new AbortController();
  let cancelled = false;
  try {
    await run(
      cross,
      { operation: "enhance", strength: 100 },
      controller.signal,
      () => controller.abort(),
    );
  } catch (e) {
    cancelled = e.name === "AbortError";
  }
  return { results, cancelled };
}
async function large(mode) {
  const source =
    mode === "tile"
      ? await q.asset("平铺单元", 2, 2, (ctx) => {
          ctx.fillStyle = "#4080c0";
          ctx.fillRect(0, 0, 2, 2);
          ctx.clearRect(0, 0, 1, 1);
        })
      : await q.asset("质感大图", 10000, 10000, (ctx, c) => {
          ctx.fillStyle = "#808080";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.clearRect(0, 0, 128, 128);
          ctx.fillStyle = "#4080c0";
          ctx.fillRect(2500, 2500, 5000, 5000);
        });
  let beats = 0,
    maxHeartbeatGap = 0,
    last = performance.now();
  const timer = setInterval(() => {
      const now = performance.now();
      maxHeartbeatGap = Math.max(maxHeartbeatGap, now - last);
      last = now;
      beats++;
    }, 25),
    start = performance.now();
  const settings =
    mode === "tile"
      ? { operation: mode, width: 10000, height: 10000 }
      : { operation: mode, strength: 100 };
  let result;
  try {
    result = await run(source, settings);
  } finally {
    clearInterval(timer);
  }
  return {
    source,
    result,
    settings,
    beats,
    maxHeartbeatGap,
    elapsedMs: performance.now() - start,
    sample: await window.geometryQA.sample(result),
  };
}
window.enhanceQA = { run, compare, verify, large };
