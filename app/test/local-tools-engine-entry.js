import { processImage, loadOriginal } from "../renderer/image-processing.js";
import { surface, pngBytes } from "../renderer/selection.js";
import {
  defaults,
  alphaEdges,
  lighting,
  parseCube,
  applyLut,
} from "../core/image-tools.cjs";
async function asset(width, height, paint) {
  const c = surface(width, height),
    x = c.getContext("2d", { willReadFrequently: true });
  paint(x, c);
  const result = await window.tugou.storeRaster(await pngBytes(c), "工具样图");
  c.width = c.height = 1;
  return result;
}
async function pixels(source) {
  const img = await loadOriginal(source),
    c = surface(img.naturalWidth, img.naturalHeight),
    x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0);
  const data = x.getImageData(0, 0, c.width, c.height);
  c.width = c.height = 1;
  img.src = "";
  return data;
}
async function processed(source, settings) {
  const bytes = await processImage(
    source,
    settings,
    new AbortController().signal,
  );
  const a = await window.tugou.storeRaster(bytes, "像素验证");
  return { asset: a, pixels: await pixels(a) };
}
async function verify() {
  const checks = [],
    check = (name, pass) => {
      if (!pass) throw Error(name);
      checks.push(name);
    };
  const input = await asset(1100, 80, (x) => {
      x.fillStyle = "#a86a42";
      x.fillRect(1, 1, 1098, 78);
      x.clearRect(500, 20, 32, 35);
      x.globalAlpha = 0.5;
      x.fillStyle = "#c4b2a0";
      x.clearRect(100, 0, 100, 80);
      x.fillRect(100, 0, 100, 80);
    }),
    original = (await pixels(input)).data;
  for (const [operation, settings] of [
    ["alpha", { ...defaults.alpha, shrink: 2, feather: 3, matte: "white" }],
    ["light", { ...defaults.light, radius: 45 }],
    [
      "lut",
      { ...defaults.lut, strength: 75, lutText: "LUT_1D_SIZE 2\n1 0 0\n0 1 1" },
    ],
  ]) {
    const { pixels: p } = await processed(input, { operation, ...settings }),
      expected = original.slice();
    if (operation === "alpha") alphaEdges(expected, 1100, 80, settings);
    if (operation === "light") lighting(expected, 1100, 80, settings);
    if (operation === "lut")
      applyLut(expected, parseCube(settings.lutText), settings.strength);
    let alphaDiff = 0,
      rgbError = 0;
    for (let i = 0; i < expected.length; i += 4) {
      if (p.data[i + 3] !== expected[i + 3]) alphaDiff++;
      if (expected[i + 3] >= 32)
        for (let k = 0; k < 3; k++)
          rgbError = Math.max(
            rgbError,
            Math.abs(p.data[i + k] - expected[i + k]),
          );
    }
    check(
      operation + " worker matches whole-image pixels across 512px tiles",
      alphaDiff === 0 && rgbError <= Math.ceil(255 / 32),
    );
  }
  const noOp = await processed(input, {
    operation: "alpha",
    ...defaults.alpha,
  });
  check(
    "zero alpha settings preserve every pixel",
    noOp.pixels.data.every((v, i) => v === original[i]),
  );
  check(
    "source resource remains unmodified",
    (await pixels(input)).data.every((v, i) => v === original[i]),
  );
  const tiny = await asset(2, 2, (x) => {
    ["#ff0000", "#00ff00", "#0000ff", "#ffffff"].forEach((color, i) => {
      x.fillStyle = color;
      x.fillRect(i % 2, Math.floor(i / 2), 1, 1);
    });
  });
  for (const layout of ["repeat", "mirror", "halfdrop"]) {
    const { pixels: p } = await processed(tiny, {
      operation: "pattern",
      ...defaults.pattern,
      width: 8,
      height: 8,
      motifScale: 1,
      gap: 0,
      layout,
    });
    const colors = [
      [255, 0, 0, 255],
      [0, 255, 0, 255],
      [0, 0, 255, 255],
      [255, 255, 255, 255],
    ];
    let okay = true;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const col = Math.floor(x / 2),
          row = Math.floor(y / 2);
        let sx = x % 2,
          sy = y % 2;
        if (layout === "mirror") {
          if (col % 2) sx = 1 - sx;
          if (row % 2) sy = 1 - sy;
        }
        if (layout === "halfdrop") sy = (y - (col % 2) + 8) % 2;
        const expected = colors[sy * 2 + sx];
        for (let k = 0; k < 4; k++)
          if (p.data[(y * 8 + x) * 4 + k] !== expected[k]) okay = false;
      }
    check(layout + " pattern matches all repeat cells", okay);
  }
  const gap = await processed(tiny, {
    operation: "pattern",
    ...defaults.pattern,
    width: 9,
    height: 9,
    motifScale: 1,
    gap: 1,
  });
  check(
    "pattern gap stays transparent",
    gap.pixels.data
      .filter((_, i) => i % 4 === 3)
      .every(
        (v, i) =>
          v === ((i % 9) % 3 === 2 || Math.floor(i / 9) % 3 === 2 ? 0 : 255),
      ),
  );
  const c = new AbortController();
  c.abort();
  try {
    await processImage(
      input,
      { operation: "alpha", ...defaults.alpha },
      c.signal,
    );
    throw Error("cancel failed");
  } catch (e) {
    check(
      "pre-cancelled worker does not publish bytes",
      e.name === "AbortError",
    );
  }
  let activeCancelled = false;
  const controller = new AbortController();
  try {
    await processImage(
      input,
      { operation: "light", ...defaults.light },
      controller.signal,
      () => controller.abort(),
    );
  } catch (e) {
    activeCancelled = e.name === "AbortError";
  }
  check("in-flight worker cancels on progress", activeCancelled);
  return { checks, input, tiny };
}
async function sample(source) {
  const original = await pixels(source),
    outputs = [];
  for (const operation of ["alpha", "light", "lut"]) {
    const settings =
      operation === "alpha"
        ? { ...defaults.alpha, shrink: 1, feather: 1 }
        : operation === "light"
          ? {
              ...defaults.light,
              exposure: 0.5,
              centerX: 30,
              radius: 60,
              color: "#fff2df",
            }
          : {
              ...defaults.lut,
              lutText: "LUT_1D_SIZE 2\n0.02 0.02 0.02\n1 .97 .92",
              strength: 35,
            };
    const result = await processed(source, { operation, ...settings });
    let alphaDiff = 0,
      alphaIncreased = 0;
    for (let i = 3; i < original.data.length; i += 4) {
      if (result.pixels.data[i] !== original.data[i]) alphaDiff++;
      if (result.pixels.data[i] > original.data[i]) alphaIncreased++;
    }
    outputs.push({ operation, asset: result.asset, alphaDiff, alphaIncreased });
  }
  const c = surface(1200, 480),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#e9e6df";
  ctx.fillRect(0, 0, c.width, c.height);
  for (const [i, a] of [source, ...outputs.map((o) => o.asset)].entries()) {
    const img = await loadOriginal(a);
    ctx.drawImage(img, 300 * i + 10, 32, 280, 420);
    img.src = "";
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#333333";
    ctx.fillText(
      ["原图", "收缩 1 / 内侧羽化 1", "局部暖光 +0.5EV", "暖色 LUT 35%"][i],
      300 * i + 12,
      24,
    );
  }
  const bytes = await pngBytes(c);
  c.width = c.height = 1;
  return { outputs, bytes: [...bytes] };
}
async function large(operation) {
  const input = await asset(
    operation === "pattern" ? 2 : 10000,
    operation === "pattern" ? 2 : 10000,
    (ctx, c) => {
      ctx.fillStyle = "#4080c0";
      ctx.fillRect(0, 0, c.width, c.height);
      if (operation !== "pattern") {
        ctx.clearRect(500, 200, 35, 9000);
        ctx.clearRect(7000, 100, 50, 9000);
      }
    },
  );
  const settings = {
    operation,
    ...defaults[operation],
    ...(operation === "pattern"
      ? { width: 10000, height: 10000, motifScale: 1, gap: 1 }
      : {}),
    ...(operation === "alpha" ? { shrink: 1, feather: 2 } : {}),
    ...(operation === "lut" ? { lutText: "LUT_1D_SIZE 2\n1 1 1\n0 0 0" } : {}),
  };
  let maxHeartbeat = 0,
    last = performance.now(),
    ticks = 0;
  const interval = setInterval(() => {
    const now = performance.now();
    maxHeartbeat = Math.max(maxHeartbeat, now - last);
    last = now;
    ticks++;
  }, 25);
  const started = performance.now();
  let bytes;
  try {
    bytes = await processImage(input, settings, new AbortController().signal);
  } finally {
    clearInterval(interval);
  }
  const elapsedMs = performance.now() - started,
    output = await window.tugou.storeRaster(bytes, "100MP " + operation),
    img = await loadOriginal(output),
    c = surface(1, 1),
    ctx = c.getContext("2d", { willReadFrequently: true }),
    samples = [];
  for (const [x, y] of [
    [0, 0],
    [511, 512],
    [512, 512],
    [1000, 1000],
    [5000, 5000],
    [9999, 9999],
  ]) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
    samples.push([...ctx.getImageData(0, 0, 1, 1).data]);
  }
  img.src = "";
  c.width = c.height = 1;
  return {
    input,
    output,
    settings: { ...settings, lutText: undefined },
    elapsedMs,
    maxHeartbeat,
    ticks,
    samples,
  };
}
globalThis.toolsQA = {
  asset,
  pixels,
  processed,
  verify,
  processImage,
  defaults,
  sample,
  large,
  loadOriginal,
  surface,
};
