import { createStroke } from "../renderer/painting.js";
import { Compositor } from "../renderer/composite.js";
import { surface, pngBytes } from "../renderer/selection.js";
import {
  createLayer,
  worldMatrix,
  point,
  homography,
  project,
} from "../core/layers.cjs";
window.detailQA = { createStroke, Compositor, surface, pngBytes, createLayer };
window.detailQA.verify = async () => {
  const checks = [],
    check = (n, v) => {
      if (!v) throw new Error(n);
      checks.push(n);
    },
    pixel = (c, x, y) => [...c.getContext("2d").getImageData(x, y, 1, 1).data];
  const e = new Compositor(),
    src = surface(128, 96);
  src.getContext("2d").fillStyle = "#336699";
  src.getContext("2d").fillRect(0, 0, 128, 96);
  const l = createLayer("image", {
      x: 0,
      y: 0,
      width: 128,
      height: 96,
      bitmap: { dataUrl: src.toDataURL() },
      futureLayer: "keep",
    }),
    doc = {
      width: 300,
      height: 250,
      background: "transparent",
      layers: [l],
      assets: [],
    };
  const options = {
    target: "mask",
    maskMode: "hide",
    size: 16,
    hardness: 100,
    opacity: 100,
    smoothing: 0,
    color: "#ff0000",
    pressure: false,
    zoom: 1,
  };
  const render = async (layer, stroke) => {
    const c = surface(300, 250);
    await e.render({ ...doc, layers: [{ ...layer, mask: stroke.mask }] }, c, {
      transparent: true,
      maskOverrides: new Map([[layer.id, stroke.canvas]]),
    });
    return c;
  };
  const hide = await createStroke(doc, l, e, options);
  hide.add({ x: 64, y: 48 });
  hide.finish();
  hide.render();
  const hidden = await render(l, hide);
  check(
    "new mask hide preview preserves original image and hides only local pixels",
    pixel(hidden, 64, 48)[3] === 0 &&
      pixel(hidden, 24, 24)[3] === 255 &&
      pixel(src, 64, 48)[3] === 255,
  );
  const masked = {
    ...l,
    mask: { ...hide.mask, bitmap: { dataUrl: hide.canvas.toDataURL() } },
  };
  hide.dispose();
  const reveal = await createStroke({ ...doc, layers: [masked] }, masked, e, {
    ...options,
    maskMode: "reveal",
  });
  reveal.add({ x: 64, y: 48 });
  reveal.finish();
  reveal.render();
  const restored = await render(masked, reveal);
  check(
    "mask reveal restores original RGB and alpha",
    JSON.stringify(pixel(restored, 64, 48)) === "[51,102,153,255]",
  );
  reveal.dispose();
  const vector = {
    ...l,
    mask: {
      paths: [{ operation: "add", points: [0, 0, 0.5, 0, 0.5, 1, 0, 1] }],
      inverted: true,
      feather: 2,
      futureMask: { keep: true },
    },
  };
  const inverse = await createStroke(
    { ...doc, layers: [vector] },
    vector,
    e,
    options,
  );
  inverse.add({ x: 96, y: 48 });
  inverse.finish();
  inverse.render();
  const inverted = await render(vector, inverse);
  check(
    "inverted vector mask hide retains feather and opaque metadata",
    pixel(inverted, 96, 48)[3] < 5 &&
      pixel(inverted, 80, 20)[3] === 255 &&
      inverse.mask.inverted &&
      inverse.mask.feather === 2 &&
      inverse.mask.futureMask.keep &&
      pixel(inverse.canvas, 16, 48)[3] === 255,
  );
  inverse.dispose();
  const anchor = {
    ...l,
    mask: {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      anchor: { width: 128, height: 96, matrix: [1, 0, 0, 1, 8, 4] },
      offset: { x: 12, y: 8, scale: 1, rotation: 0 },
    },
  };
  const anchored = await createStroke(
    { ...doc, layers: [anchor] },
    anchor,
    e,
    options,
  );
  anchored.add({ x: 84, y: 60 });
  anchored.finish();
  anchored.render();
  const ar = await render(anchor, anchored);
  check(
    "independent mask anchor and offset map cursor to raw mask",
    pixel(anchored.canvas, 64, 48)[3] === 0 &&
      pixel(ar, 84, 60)[3] === 0 &&
      pixel(ar, 60, 60)[3] === 255 &&
      JSON.stringify(anchored.mask) === JSON.stringify(anchor.mask),
  );
  anchored.dispose();
  for (const warp of [
    undefined,
    [0.05, 0.03, 0.95, 0.1, 0.98, 0.92, 0.02, 0.98],
  ]) {
    const moved = {
        ...l,
        x: 100,
        y: 40,
        rotation: 23,
        scaleX: 1.2,
        scaleY: 0.8,
        warp,
      },
      q = warp ? project(homography(warp), 0.5, 0.5) : { x: 0.5, y: 0.5 },
      p = point(worldMatrix([moved], moved), q.x * 128, q.y * 96),
      s = await createStroke({ ...doc, layers: [moved] }, moved, e, options);
    s.add(p);
    s.finish();
    s.render();
    check(
      `${warp ? "perspective" : "rotated"} mask stroke writes correct original coordinate`,
      pixel(s.canvas, 64, 48)[3] === 0 && pixel(s.canvas, 20, 20)[3] === 255,
    );
    s.dispose();
  }
  const selected = {
      ...doc,
      selection: {
        paths: [{ operation: "add", points: [0, 0, 60, 0, 60, 96, 0, 96] }],
      },
    },
    clip = await createStroke(selected, l, e, options);
  clip.add({ x: 20, y: 48 });
  clip.add({ x: 100, y: 48 });
  clip.finish();
  clip.render();
  check(
    "mask painting respects selection without hiding outside",
    pixel(clip.canvas, 40, 48)[3] === 0 &&
      pixel(clip.canvas, 80, 48)[3] === 255,
  );
  clip.dispose();
  for (const kind of ["text", "shape", "group"]) {
    const layer = createLayer(kind, { x: 0, y: 0, width: 128, height: 96 }),
      s = await createStroke({ ...doc, layers: [layer] }, layer, e, options);
    s.add({ x: 64, y: 48 });
    s.finish();
    s.render();
    check(
      kind + " supports mask painting without rasterizing content",
      pixel(s.canvas, 64, 48)[3] === 0 && layer.kind === kind,
    );
    s.dispose();
  }
  for (const patch of [
    { locked: true },
    { visible: false },
    { mask: { disabled: true } },
  ]) {
    const layer = { ...l, ...patch };
    let error;
    try {
      await createStroke({ ...doc, layers: [layer] }, layer, e, options);
    } catch (ex) {
      error = ex.message;
    }
    check("rejects mask painting for " + Object.keys(patch)[0], !!error);
  }
  const blank = surface(128, 96),
    plain = { ...l, bitmap: { dataUrl: blank.toDataURL() } };
  for (const zoom of [0.5, 1, 2]) {
    const s = await createStroke({ ...doc, layers: [plain] }, plain, e, {
      ...options,
      target: "image",
      size: 2,
      smoothing: 20,
      zoom,
    });
    s.add({ x: 10, y: 48 });
    s.add({ x: 100, y: 48 });
    s.render();
    const end = 100 - 20 / zoom;
    check(
      "rope is twenty screen pixels at zoom " + zoom,
      pixel(s.canvas, end - 2, 48)[3] > 0 &&
        pixel(s.canvas, end + 3, 48)[3] === 0,
    );
    s.finish();
    s.render();
    check("endpoint flush at zoom " + zoom, pixel(s.canvas, 99, 48)[3] > 0);
    s.dispose();
  }
  e.dispose();
  return { checks };
};
window.detailQA.fixture = async (id) => {
  const c = surface(256, 192),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#336699";
  ctx.fillRect(0, 0, c.width, c.height);
  const a = await tugou.storeRaster(await pngBytes(c), "绘画交互样图"),
    r = await tugou.open(id);
  await tugou.save(
    id,
    {
      ...r.document,
      width: 256,
      height: 192,
      background: "transparent",
      futureField: { keep: true },
      assets: [a],
      layers: [
        createLayer("image", {
          name: "绘画交互样图",
          assetId: a.id,
          x: 0,
          y: 0,
          width: 256,
          height: 192,
          futureLayer: "保留",
        }),
      ],
    },
    r.revision,
  );
};
