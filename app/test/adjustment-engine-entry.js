import { Compositor, renderPadding } from "../renderer/composite.js";
import { defaults, fields } from "../core/adjustments.cjs";
import { createLayer } from "../core/layers.cjs";
import { surface, pngBytes } from "../renderer/selection.js";
const shape = (color, x = 0, y = 0, w = 32, h = 32, extra = {}) =>
  createLayer("shape", {
    x,
    y,
    width: w,
    height: h,
    shape: "rect",
    color,
    ...extra,
  });
const adjustment = (type, params = {}, extra = {}) =>
  createLayer("adjustment", {
    name: fields[type].label,
    x: 0,
    y: 0,
    width: 128,
    height: 128,
    adjustment: { ...defaults(type), ...params },
    ...extra,
  });
window.toneQA = {
  Compositor,
  defaults,
  fields,
  createLayer,
  surface,
  pngBytes,
  shape,
  adjustment,
};
window.toneQA.verify = async () => {
  const checks = [],
    check = (n, v) => {
      if (!v) throw new Error(n);
      checks.push(n);
    },
    e = new Compositor(),
    doc = (layers, w = 64, h = 64) => ({
      width: w,
      height: h,
      background: "transparent",
      assets: [],
      layers,
    }),
    pixel = (c, x = 10, y = 10) => [
      ...c
        .getContext("2d", { willReadFrequently: true })
        .getImageData(x, y, 1, 1).data,
    ],
    render = async (d) => {
      const c = surface(d.width, d.height);
      await e.render(d, c, { transparent: true });
      return c;
    };
  let c = await render(
    doc([
      shape("#204060"),
      adjustment("invert"),
      shape("#ff0000", 40, 0, 10, 10),
    ]),
  );
  check(
    "adjustment only changes lower layers",
    JSON.stringify(pixel(c)) === "[223,191,159,255]" &&
      pixel(c, 42, 2)[0] === 255,
  );
  c = await render(
    doc([
      shape("#204060", 0, 0, 32, 32, { opacity: 0.5 }),
      adjustment("invert"),
    ]),
  );
  check(
    "adjustment preserves translucent alpha",
    pixel(c)[3] === 128 && Math.abs(pixel(c)[0] - 223) <= 1,
  );
  c = await render(
    doc([
      shape("#204060"),
      adjustment("invert", {}, { opacity: 0.5, blend: "multiply" }),
    ]),
  );
  check(
    "blend strength interpolates color without alpha accumulation",
    Math.abs(pixel(c)[0] - 30) <= 1 && pixel(c)[3] === 255,
  );
  const g = createLayer("group", { x: 0, y: 0, width: 64, height: 64 });
  c = await render(
    doc([
      shape("#204060"),
      g,
      shape("#ff0000", 0, 0, 16, 16, { parentId: g.id }),
      adjustment("invert", {}, { parentId: g.id }),
    ]),
  );
  check(
    "group adjustment is isolated",
    pixel(c, 4, 4)[1] === 255 && pixel(c, 25, 25)[0] === 32,
  );
  c = await render(
    doc([
      shape("#204060"),
      shape("#ff0000", 0, 0, 16, 16, { opacity: 0.5 }),
      adjustment("invert", {}, { clipping: true }),
    ]),
  );
  check(
    "clipped adjustment changes base before lower background composition",
    Math.abs(pixel(c, 4, 4)[0] - 16) <= 1 &&
      Math.abs(pixel(c, 4, 4)[1] - 160) <= 1 &&
      pixel(c, 25, 25)[0] === 32,
  );
  c = await render(
    doc([
      shape("#000000"),
      shape("#ff0000", 0, 0, 16, 16, { opacity: 0.5 }),
      shape("#ffffff", 0, 0, 16, 16, { clipping: true }),
    ]),
  );
  check(
    "ordinary clipping retains independent layer opacity",
    pixel(c, 4, 4)[0] === 192 && pixel(c, 4, 4)[1] === 128,
  );
  c = await render(doc([
    shape('#ff0000',0,0,16,16,{opacity:.5}),
    adjustment('invert',{}, {clipping:true}),
    shape('#0000ff',20,0,16,16,{opacity:.5}),
    adjustment('invert',{}, {clipping:true}),
    shape('#00ff00',40,0,16,16,{opacity:.5}),
  ]));
  check('separate clipped adjustment chains compose each neighbour exactly once',
    [4,24,44].every(x=>pixel(c,x,4)[3]===128));
  c = await render(
    doc([
      shape("#204060"),
      adjustment(
        "invert",
        {},
        { mask: { x: 0, y: 0, width: 0.125, height: 1 } },
      ),
    ]),
  );
  check(
    "adjustment mask bounds",
    pixel(c, 5, 5)[0] === 223 && pixel(c, 25, 25)[0] === 32,
  );
  const types = Object.keys(fields),
    results = {};
  for (const type of types) {
    const params =
      type === "brightnessContrast"
        ? { brightness: 10 }
        : type === "exposure"
          ? { exposure: 1 }
          : type === "hueSaturation"
            ? { hue: 80 }
            : {};
    c = await render(doc([shape("#204060"), adjustment(type, params)]));
    results[type] = pixel(c);
    check(
      type + " renders finite RGBA",
      results[type].length === 4 && results[type][3] === 255,
    );
  }
  const large = doc(
    [
      shape("#204060", 0, 0, 2100, 60),
      shape("#ffffff", 1000, 0, 48, 60),
      adjustment("blur", { radius: 7 }),
      adjustment("blur", { radius: 11 }),
      adjustment("noise", { amount: 30 }),
    ],
    2100,
    60,
  );
  const whole = await render(large),
    bytes = await e.export(large, { transparent: true }),
    decoded = await createImageBitmap(new Blob([bytes], { type: "image/png" })),
    out = surface(2100, 60);
  out.getContext("2d", { willReadFrequently: true }).drawImage(decoded, 0, 0);
  decoded.close();
  const a = whole.getContext("2d").getImageData(0, 0, 2100, 60).data,
    b = out.getContext("2d").getImageData(0, 0, 2100, 60).data;
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  check("sequential blur and noise match tiled PNG exactly", max === 0);
  check(
    "sequential blur padding accumulates",
    renderPadding(large.layers) === 72,
  );
  const cancel = new AbortController();
  cancel.abort();
  let aborted = false;
  try {
    await e.export(large, { signal: cancel.signal });
  } catch (err) {
    aborted = err.name === "AbortError";
  }
  check("export cancellation rejects", aborted);
  const mid = new AbortController();
  let progress = 0;
  try {
    await e.export(large, {
      signal: mid.signal,
      progress: (p) => {
        progress = p;
        mid.abort();
      },
    });
  } catch (err) {
    aborted = err.name === "AbortError";
  }
  check(
    "mid-export cancellation stops before completion",
    aborted && progress > 0 && progress < 1,
  );
  e.dispose();
  return { checks, results, max };
};
window.toneQA.fixture = async (id) => {
  const r = await tugou.open(id);
  await tugou.save(
    id,
    {
      ...r.document,
      width: 256,
      height: 192,
      background: "transparent",
      future: { keep: true },
      layers: [
        shape("#204060", 0, 0, 256, 192, {
          name: "调整样图",
          futureLayer: "keep",
        }),
      ],
      selection: {
        paths: [{ operation: "add", points: [0, 0, 128, 0, 128, 192, 0, 192] }],
      },
    },
    r.revision,
  );
};
window.toneQA.large = async () => {
  const src = surface(10000, 10000),
    ctx = src.getContext("2d");
  ctx.fillStyle = "#204060";
  ctx.fillRect(0, 0, 10000, 10000);
  const asset = await tugou.storeRaster(await pngBytes(src), "100MP调整样图");
  src.width = src.height = 1;
  const r = await tugou.create("100MP调整验收"),
    doc = {
      ...r.document,
      width: 10000,
      height: 10000,
      background: "transparent",
      assets: [asset],
      layers: [
        createLayer("image", {
          x: 0,
          y: 0,
          width: 10000,
          height: 10000,
          assetId: asset.id,
        }),
        adjustment(
          "exposure",
          { exposure: 1 },
          { width: 10000, height: 10000 },
        ),
      ],
    },
    e = new Compositor(),
    start = performance.now();
  const bytes = await e.export(doc, { transparent: true }),
    elapsed = performance.now() - start,
    result = await tugou.storeRaster(bytes, "100MP调整导出");
  await tugou.save(r.id, { ...doc, assets: [asset, result] }, r.revision);
  e.dispose();
  return { id: r.id, result, elapsed };
};
window.toneQA.largePixels = async (result) => {
  const e = new Compositor(),
    img = await e.image(result),
    c = surface(1, 1),
    ctx = c.getContext("2d", { willReadFrequently: true });
  const pixels = [
    [0, 0],
    [1023, 1023],
    [1024, 1024],
    [9980, 9980],
  ].map(([x, y]) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.drawImage(img, x, y, 1, 1, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
  e.dispose();
  return { width: img.naturalWidth, height: img.naturalHeight, pixels };
};
