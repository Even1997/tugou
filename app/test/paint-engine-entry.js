import { createStroke } from "../renderer/painting.js";
import { Compositor } from "../renderer/composite.js";
import { createLayer } from "../core/layers.cjs";
import { surface, pngBytes } from "../renderer/selection.js";
window.paintQA = { Compositor, createStroke, surface, createLayer };
window.paintQA.verify = async () => {
  const checks = [],
    check = (name, ok) => {
      if (!ok) throw new Error(name);
      checks.push(name);
    };
  const pixel = (c, x, y) => [
    ...c.getContext("2d").getImageData(x, y, 1, 1).data,
  ];
  const options = {
    size: 12,
    opacity: 50,
    hardness: 100,
    smoothing: 0,
    color: "#ff0000",
    line: false,
    pressure: false,
  };
  const source = surface(64, 64),
    engine = new Compositor();
  const layer = createLayer("image", {
    x: 0,
    y: 0,
    width: 64,
    height: 64,
    bitmap: { dataUrl: source.toDataURL() },
  });
  const doc = {
    width: 64,
    height: 64,
    background: "transparent",
    assets: [],
    layers: [layer],
  };
  const stroke = await createStroke(doc, layer, engine, options);
  stroke.add({ x: 10, y: 20 });
  stroke.add({ x: 50, y: 20 });
  stroke.render();
  check(
    "brush color, one-stroke opacity and untouched alpha",
    pixel(stroke.canvas, 30, 20)[0] === 255 &&
      Math.abs(pixel(stroke.canvas, 30, 20)[3] - 128) <= 1 &&
      pixel(stroke.canvas, 30, 40)[3] === 0,
  );
  for (let x = 11; x <= 50; x++) stroke.add({ x, y: 20 });
  stroke.render();
  check(
    "overlapping pointer samples do not multiply stroke opacity",
    Math.abs(pixel(stroke.canvas, 30, 20)[3] - 128) <= 1,
  );
  stroke.dispose();
  const selected = {
    ...doc,
    selection: {
      paths: [{ operation: "add", points: [0, 0, 32, 0, 32, 64, 0, 64] }],
    },
  };
  const clipped = await createStroke(selected, layer, engine, {
    ...options,
    opacity: 100,
  });
  clipped.add({ x: 8, y: 20 });
  clipped.add({ x: 55, y: 20 });
  clipped.render();
  check(
    "selection clips painting without touching pixels outside",
    pixel(clipped.canvas, 20, 20)[3] === 255 &&
      pixel(clipped.canvas, 45, 20)[3] === 0,
  );
  clipped.dispose();
  source.getContext("2d").fillStyle = "#0000ff";
  source.getContext("2d").fillRect(0, 0, 64, 64);
  const blue = { ...layer, bitmap: { dataUrl: source.toDataURL() } };
  const erase = await createStroke(
    { ...selected, layers: [blue] },
    blue,
    engine,
    { ...options, erase: true },
  );
  erase.add({ x: 10, y: 20 });
  erase.add({ x: 50, y: 20 });
  erase.render();
  check(
    "eraser changes alpha only inside selection and preserves source",
    Math.abs(pixel(erase.canvas, 20, 20)[3] - 127) <= 1 &&
      pixel(erase.canvas, 45, 20)[3] === 255 &&
      pixel(source, 20, 20)[3] === 255,
  );
  erase.dispose();
  const line = await createStroke(doc, layer, engine, {
    ...options,
    line: true,
    opacity: 100,
  });
  line.add({ x: 10, y: 10 });
  line.add({ x: 30, y: 40 });
  line.add({ x: 50, y: 10 });
  line.render();
  check('straight-line drag leaves image unchanged before release',pixel(line.canvas,30,10)[3]===0);
  line.finish();line.render();
  check(
    "line release ignores intermediate bent path",
    pixel(line.canvas, 30, 10)[3] === 255 &&
      pixel(line.canvas, 30, 40)[3] === 0,
  );
  line.dispose();
  const soft = await createStroke(doc, layer, engine, {
    ...options,
    size: 24,
    hardness: 0,
    opacity: 100,
  });
  soft.add({ x: 32, y: 32 });
  soft.render();
  check(
    "soft brush has graduated alpha edge",
    pixel(soft.canvas, 32, 32)[3] > pixel(soft.canvas, 40, 32)[3] &&
      pixel(soft.canvas, 40, 32)[3] > 0 &&
      pixel(soft.canvas, 46, 32)[3] === 0,
  );
  soft.dispose();
  const rotated = { ...layer, x: 40, y: 10, rotation: 90 };
  const transformed = await createStroke(
    { ...doc, layers: [rotated] },
    rotated,
    engine,
    { ...options, opacity: 100 },
  );
  transformed.add({ x: 20, y: 20 });
  transformed.render();
  check(
    "world coordinates map to rotated original pixels",
    pixel(transformed.canvas, 10, 20)[3] === 255 &&
      pixel(transformed.canvas, 20, 20)[3] === 0,
  );
  transformed.dispose();
  const clippedFar=await createStroke(doc,layer,engine,{...options,opacity:100});
  clippedFar.add({x:-1e9,y:32});clippedFar.add({x:1e9,y:32});clippedFar.add({x:Infinity,y:32});clippedFar.render();
  check('off-bitmap sampling is clipped and nonfinite perspective positions ignored',pixel(clippedFar.canvas,32,32)[3]===255);clippedFar.dispose();
  const viewport=surface(64,64);await engine.render(doc,viewport);await engine.render({...doc,layers:[blue]},viewport);
  check('compositor releases obsolete decoded raster revisions',engine.images.size===1&&pixel(viewport,20,20)[2]===255);viewport.width=viewport.height=1;
  const pen = await createStroke(doc, layer, engine, {
    ...options,
    pressure: true,
    size: 20,
    opacity: 100,
  });
  pen.add({ x: 10, y: 10, pointerType: "pen", pressure: 0.2 });
  pen.add({ x: 50, y: 10, pointerType: "pen", pressure: 1 });
  pen.render();
  check(
    "pen pressure varies brush footprint",
    pixel(pen.canvas, 10, 16)[3] === 0 && pixel(pen.canvas, 50, 16)[3] > 0,
  );
  pen.dispose();
  const smooth = await createStroke(doc, layer, engine, {
    ...options,
    smoothing: 20,
    zoom:2,
    opacity: 100,
  });
  smooth.add({ x: 10, y: 10 });
  smooth.add({ x: 50, y: 10 });
  smooth.render();
  check(
    "rope follows at twenty screen pixels with zoom two",
    pixel(smooth.canvas, 40, 10)[3] === 255 &&
      pixel(smooth.canvas, 50, 10)[3] === 0,
  );
  smooth.finish();smooth.render();check('release completes smoothed endpoint',pixel(smooth.canvas,50,10)[3]===255);
  smooth.dispose();
  let rejected = false;
  try {
    await createStroke(
      { ...doc, layers: [{ ...layer, locked: true }] },
      { ...layer, locked: true },
      engine,
      options,
    );
  } catch {
    rejected = true;
  }
  check("locked layer rejects drawing", rejected);
  const large = surface(3840, 2160),
    big = createLayer("image", {
      x: 0,
      y: 0,
      width: 3840,
      height: 2160,
      bitmap: { dataUrl: large.toDataURL() },
    });
  const start = performance.now(),
    largeStroke = await createStroke(
      { ...doc, width: 3840, height: 2160, layers: [big] },
      big,
      engine,
      { ...options, opacity: 100 },
    );
  largeStroke.add({ x: 100, y: 100 });
  largeStroke.add({ x: 3000, y: 100 });
  largeStroke.render();
  const elapsed = performance.now() - start;
  const workingBytes = largeStroke.workingBytes;
  check(
    "tiled stroke has no seams across 256px boundaries",
    [255, 256, 511, 512, 1023, 1024].every(
      (x) => pixel(largeStroke.canvas, x, 100)[3] === 255,
    ),
  );
  check(
    "4K working surfaces stay below 40MiB",
    workingBytes < 40 * 1024 * 1024,
  );
  check(
    "4K stroke keeps original dimensions and distant pixels",
    largeStroke.canvas.width === 3840 &&
      pixel(largeStroke.canvas, 2500, 100)[3] === 255 &&
      pixel(largeStroke.canvas, 2500, 300)[3] === 0,
  );
  largeStroke.dispose();
  large.width = large.height = 1;
  engine.dispose();
  return { checks, elapsed, workingBytes };
};
window.paintQA.verifyLarge = async () => {
  const base = surface(10000, 10000),
    bitmap = { dataUrl: base.toDataURL() };
  base.width = base.height = 1;
  const engine = new Compositor(),
    layer = createLayer("image", {
      x: 0,
      y: 0,
      width: 10000,
      height: 10000,
      bitmap,
    });
  const doc = { width: 10000, height: 10000, assets: [], layers: [layer] },
    start = performance.now();
  const stroke = await createStroke(doc, layer, engine, {
    size: 24,
    opacity: 100,
    hardness: 100,
    smoothing: 0,
    color: "#ff0000",
  });
  stroke.add({ x: 9980, y: 9980 });
  stroke.add({ x: 9990, y: 9980 });
  stroke.render();
  const pixel = [
    ...stroke.canvas.getContext("2d").getImageData(9985, 9980, 1, 1).data,
  ];
  const result = {
    elapsed: performance.now() - start,
    workingBytes: stroke.workingBytes,
    pixel,
    width: stroke.canvas.width,
    height: stroke.canvas.height,
  };
  result.bitmap=await window.tugou.storeRaster(await pngBytes(stroke.canvas),'100MP 绘画验收');
  stroke.dispose();
  engine.dispose();
  return result;
};
