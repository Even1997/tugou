import { createRetouchStroke, retouchTools } from "../renderer/retouch.js";
import { Compositor } from "../renderer/composite.js";
import {
  createLayer,
  worldMatrix,
  point,
  homography,
  project,
} from "../core/layers.cjs";
import { surface, pngBytes } from "../renderer/selection.js";
window.retouchQA = {
  createRetouchStroke,
  Compositor,
  createLayer,
  surface,
  pngBytes,
};
window.retouchQA.verify = async () => {
  const checks = [],
    check = (name, ok) => {
      if (!ok) throw new Error(name);
      checks.push(name);
    };
  const pixel = (c, x, y) => [
    ...c.getContext("2d").getImageData(x, y, 1, 1).data,
  ];
  const engine = new Compositor(),
    source = surface(128, 96),
    ctx = source.getContext("2d");
  ctx.fillStyle = "#0000ff";
  ctx.fillRect(0, 0, 128, 96);
  ctx.fillStyle = "#00ff00";
  ctx.fillRect(32, 0, 32, 96);
  ctx.fillStyle = "#ff0000";
  ctx.fillRect(0, 0, 32, 96);
  const layer = createLayer("image", {
      x: 0,
      y: 0,
      width: 128,
      height: 96,
      bitmap: { dataUrl: source.toDataURL() },
    }),
    doc = {
      width: 128,
      height: 96,
      background: "transparent",
      assets: [],
      layers: [layer],
    };
  const options = {
    tool: "clone",
    size: 16,
    opacity: 100,
    hardness: 100,
    smoothing: 0,
    pressure: false,
    aligned: false,
    blurRadius: 4,
    source: { u: 16 / 128, v: 32 / 96 },
  };
  const clone = await createRetouchStroke(doc, layer, engine, options);
  await clone.add({ x: 48, y: 32 });
  await clone.add({ x: 80, y: 32 });
  check(
    "clone uses immutable source even when the stroke overlaps its sampling path",
    pixel(clone.canvas, 48, 32)[0] === 255 &&
      pixel(clone.canvas, 80, 32)[1] === 255,
  );
  clone.dispose();
  const translucent = await createRetouchStroke(doc, layer, engine, {
    ...options,
    opacity: 50,
  });
  await translucent.add({ x: 48, y: 32 });
  await translucent.add({ x: 48, y: 32 });
  check(
    "clone strength is applied once per stroke",
    Math.abs(pixel(translucent.canvas, 48, 32)[0] - 128) <= 1 &&
      Math.abs(pixel(translucent.canvas, 48, 32)[1] - 128) <= 1,
  );
  translucent.dispose();
  for (const aligned of [true, false]) {
    const s = await createRetouchStroke(doc, layer, engine, {
      ...options,
      aligned,
      source: { ...options.source, offset: { u: -32 / 128, v: 0 } },
    });
    await s.add({ x: 80, y: 32 });
    check(
      `${aligned ? "aligned" : "unaligned"} clone uses the intended cross-stroke origin`,
      pixel(s.canvas, 80, 32)[aligned ? 1 : 0] === 255,
    );
    s.dispose();
  }
  const healSource = surface(256, 128),
    hctx = healSource.getContext("2d"),
    clean = hctx.createImageData(256, 128);
  for (let y = 0; y < 128; y++)
    for (let x = 0; x < 256; x++) {
      const n = (y * 256 + x) * 4,
        v = (x < 128 ? 190 : 110) + ((x + y) % 4) * 7;
      clean.data.set([v, v, v, 255], n);
    }
  hctx.putImageData(clean, 0, 0);
  hctx.fillStyle = "#050505";
  hctx.fillRect(156, 60, 8, 8);
  const healLayer = createLayer("image", {
      x: 0,
      y: 0,
      width: 256,
      height: 128,
      bitmap: { dataUrl: healSource.toDataURL() },
    }),
    healDoc = { ...doc, width: 256, height: 128, layers: [healLayer] };
  for (const manual of [true, false]) {
    const heal = await createRetouchStroke(healDoc, healLayer, engine, {
      ...options,
      tool: "heal",
      size: 24,
      source: manual ? { u: 64 / 256, v: 64 / 128 } : null,
    });
    await heal.add({ x: 160, y: 64 });
    const values = [156, 157, 158, 159, 160, 161, 162, 163].map(
      (x) => pixel(heal.canvas, x, 64)[0],
    );
    check(
      `${manual ? "manual" : "automatic"} healing removes dark defect while retaining local brightness and texture`,
      values.every((v) => v > 90 && v < 150) &&
        Math.max(...values) - Math.min(...values) > 10 &&
        pixel(heal.canvas, 160, 64)[3] === 255,
    );
    heal.dispose();
  }
  const blur = await createRetouchStroke(doc, layer, engine, {
    ...options,
    tool: "blur",
    size: 24,
  });
  await blur.add({ x: 64, y: 32 });
  check(
    "Gaussian blur mixes neighboring colors locally",
    pixel(blur.canvas, 63, 32)[2] > 30 &&
      pixel(blur.canvas, 64, 32)[1] > 30 &&
      pixel(blur.canvas, 100, 32)[2] === 255,
  );
  const blurredLayer = {
      ...layer,
      bitmap: { dataUrl: blur.canvas.toDataURL() },
    },
    secondBlur = await createRetouchStroke(
      { ...doc, layers: [blurredLayer] },
      blurredLayer,
      engine,
      { ...options, tool: "blur", size: 24 },
    );
  await secondBlur.add({ x: 64, y: 32 });
  check(
    "a new blur stroke continues softening the previous result",
    pixel(secondBlur.canvas, 60, 32)[2] > pixel(blur.canvas, 60, 32)[2],
  );
  secondBlur.dispose();
  blur.dispose();
  const alpha = surface(128, 96);
  alpha.getContext("2d").fillStyle = "#ff0000";
  alpha.getContext("2d").fillRect(0, 0, 64, 96);
  const alphaLayer = { ...layer, bitmap: { dataUrl: alpha.toDataURL() } },
    alphaBlur = await createRetouchStroke(
      { ...doc, layers: [alphaLayer] },
      alphaLayer,
      engine,
      { ...options, tool: "blur", size: 32 },
    );
  await alphaBlur.add({ x: 64, y: 32 });
  const edge = pixel(alphaBlur.canvas, 68, 32);
  check(
    "blur preserves premultiplied red at transparent edges",
    edge[0] > 250 && edge[1] === 0 && edge[3] > 0 && edge[3] < 128,
  );
  alphaBlur.dispose();
  for (const tool of ["smudge", "liquify"]) {
    const s = await createRetouchStroke(
      { ...doc, layers: [alphaLayer] },
      alphaLayer,
      engine,
      { ...options, tool, size: 24 },
    );
    await s.add({ x: 56, y: 32 });
    await s.add({ x: 78, y: 32 });
    const edge = pixel(s.canvas, 68, 32);
    check(
      `${tool} transports alpha without a black fringe`,
      edge[0] > 250 && edge[3] > 0,
    );
    s.dispose();
  }
  for (const tool of ["smudge", "liquify"]) {
    const s = await createRetouchStroke(doc, layer, engine, {
      ...options,
      tool,
      size: 24,
    });
    await s.add({ x: 56, y: 32 });
    await s.add({ x: 78, y: 32 });
    check(
      `${tool} transports pixels in drag direction`,
      pixel(s.canvas, 68, 32)[1] > 40 && pixel(s.canvas, 100, 32)[2] === 255,
    );
    s.dispose();
  }
  for (const [tool] of retouchTools) {
    const selected = {
      ...doc,
      selection: {
        paths: [{ operation: "add", points: [0, 0, 72, 0, 72, 96, 0, 96] }],
      },
    };
    const s = await createRetouchStroke(selected, layer, engine, {
      ...options,
      tool,
      size: 24,
    });
    await s.add({ x: 68, y: 48 });
    await s.add({ x: 88, y: 48 });
    const before = ctx.getImageData(72, 0, 56, 96).data,
      after = s.canvas.getContext("2d").getImageData(72, 0, 56, 96).data;
    check(
      `${tool} preserves every RGBA channel outside selection`,
      before.every((v, i) => v === after[i]),
    );
    s.dispose();
  }
  const warped = {
    ...layer,
    x: 30,
    y: 20,
    rotation: 24,
    warp: [0, 0, 0.9, 0.05, 1, 1, 0.1, 0.9],
  };
  const q = project(homography(warped.warp), 48 / 128, 32 / 96),
    world = point(worldMatrix([warped], warped), q.x * 128, q.y * 96);
  const transformed = await createRetouchStroke(
    { ...doc, layers: [warped] },
    warped,
    engine,
    options,
  );
  await transformed.add(world);
  check(
    "perspective and rotation map retouch to original pixel coordinates",
    pixel(transformed.canvas, 48, 32)[0] === 255,
  );
  transformed.dispose();
  let missing = false;
  try {
    const s = await createRetouchStroke(doc, layer, engine, {
      ...options,
      source: null,
    });
    await s.add({ x: 48, y: 32 });
  } catch (e) {
    missing = e.message.includes("来源");
  }
  check("clone requires an explicit sample before mutation", missing);
  for (const candidate of [
    { ...layer, locked: true },
    { ...layer, kind: "text" },
  ]) {
    let rejected = false;
    try {
      await createRetouchStroke(
        { ...doc, layers: [candidate] },
        candidate,
        engine,
        options,
      );
    } catch {
      rejected = true;
    }
    check(
      `${candidate.locked ? "locked" : "non-image"} layer rejects retouching`,
      rejected,
    );
  }
  const big = surface(1200, 1200);
  big.getContext("2d").fillStyle = "#808080";
  big.getContext("2d").fillRect(0, 0, 1200, 1200);
  const bigLayer = {
      ...layer,
      width: 1200,
      height: 1200,
      bitmap: { dataUrl: big.toDataURL() },
    },
    cancel = await createRetouchStroke(
      { ...doc, width: 1200, height: 1200, layers: [bigLayer] },
      bigLayer,
      engine,
      { ...options, tool: "blur", size: 1000 },
    );
  const start = performance.now(),
    pending = cancel.add({ x: 600, y: 600 }).then(
      () => false,
      (e) => e.name === "AbortError",
    );
  setTimeout(() => cancel.dispose(), 10);
  check(
    "large retouch computation yields and cancels before commit",
    await pending,
  );
  const cancelMs = performance.now() - start;
  engine.dispose();
  return { checks, cancelMs };
};
window.retouchQA.verifyLarge = async () => {
  const base = surface(10000, 10000),
    ctx = base.getContext("2d");
  ctx.fillStyle = "#607080";
  ctx.fillRect(0, 0, 10000, 10000);
  ctx.fillStyle = "#d0a090";
  for (let x = 0; x < 10000; x += 16) ctx.fillRect(x, 0, 4, 10000);
  ctx.fillStyle = "#050505";
  ctx.fillRect(9946, 9946, 8, 8);
  const bitmap = await window.tugou.storeRaster(
    await pngBytes(base),
    "100MP 修图样图",
  );
  base.width = base.height = 1;
  const engine = new Compositor(),
    layer = createLayer("image", {
      x: 0,
      y: 0,
      width: 10000,
      height: 10000,
      bitmap,
    }),
    doc = {
      width: 10000,
      height: 10000,
      background: "transparent",
      assets: [],
      layers: [layer],
    },
    results = [];
  const original = await engine.image(bitmap),
    probe = surface(64, 64);
  probe.getContext("2d").drawImage(original, 9920, 9920, 64, 64, 0, 0, 64, 64);
  const before = [...probe.getContext("2d").getImageData(0, 0, 64, 64).data];
  for (const [tool] of retouchTools) {
    const started = performance.now(),
      s = await createRetouchStroke(doc, layer, engine, {
        tool,
        size: 40,
        opacity: 100,
        hardness: 80,
        smoothing: 0,
        blurRadius: 5,
        source: { u: 100 / 10000, v: 9950 / 10000 },
      }),
      prepared = performance.now();
    await s.add({ x: 9950, y: 9950 });
    await s.add({ x: 9970, y: 9950 });
    const processed = performance.now();
    const rgba = [
        ...s.canvas.getContext("2d").getImageData(9920, 9920, 64, 64).data,
      ],
      saved = await window.tugou.storeRaster(
        await pngBytes(s.canvas),
        `100MP ${tool}`,
      );
    if (!rgba.some((v, i) => v !== before[i]))
      throw new Error(`100MP ${tool} did not change pixels`);
    results.push({
      tool,
      prepareMs: prepared - started,
      strokeMs: processed - prepared,
      encodeAndStoreMs: performance.now() - processed,
      workingBytes: s.workingBytes,
      bitmap: saved,
      rgba,
    });
    s.dispose();
    await new Promise((r) => setTimeout(r, 20));
  }
  engine.dispose();
  probe.width = probe.height = 1;
  return results;
};
