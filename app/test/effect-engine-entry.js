import { Compositor, renderPadding } from "../renderer/composite.js";
import { applyEffects } from "../renderer/effects.js";
import { defaults, types } from "../core/effects.cjs";
import { defaults as adjustDefaults } from "../core/adjustments.cjs";
import { createLayer } from "../core/layers.cjs";
import { surface, pngBytes } from "../renderer/selection.js";
const effect = (type, p = {}) => ({ ...defaults(type), ...p });
const shape = (extra = {}) =>
  createLayer("shape", {
    name: "特效样图",
    x: 20,
    y: 20,
    width: 40,
    height: 40,
    shape: "rect",
    color: "#336699",
    ...extra,
  });
const doc = (layers, width = 100, height = 100) => ({
  width,
  height,
  background: "transparent",
  assets: [],
  layers,
});
window.fxQA = {
  Compositor,
  renderPadding,
  applyEffects,
  defaults,
  types,
  createLayer,
  surface,
  pngBytes,
  effect,
  shape,
  doc,
};
window.fxQA.verify = async () => {
  const checks = [],
    check = (n, v) => {
      if (!v) throw new Error(n);
      checks.push(n);
    },
    engine = new Compositor(),
    pixel = (c, x, y) => [
      ...c
        .getContext("2d", { willReadFrequently: true })
        .getImageData(x, y, 1, 1).data,
    ],
    render = async (d) => {
      const c = surface(d.width, d.height);
      await engine.render(d, c, { transparent: true });
      return c;
    };
  let c = await render(
    doc([shape({ effects: [effect("overlay", { color: "#ff0000" })] })]),
  );
  check(
    "color overlay changes RGB and preserves opacity",
    pixel(c, 30, 30).join() === "255,0,0,255" && pixel(c, 5, 5)[3] === 0,
  );
  c = await render(
    doc([
      shape({ effects: [effect("stroke", { size: 4, color: "#ff0000" })] }),
    ]),
  );
  check(
    "outside stroke expands exactly around content",
    pixel(c, 18, 30).join() === "255,0,0,255" &&
      pixel(c, 14, 30)[3] === 0 &&
      pixel(c, 30, 30)[2] === 153,
  );
  check(
    "stroke corners use circular distance",
    pixel(c, 17, 17)[3] > 0 && pixel(c, 16, 16)[3] === 0,
  );
  c=await render(doc([shape({effects:[effect('stroke',{size:4,color:'#ff0000'}),effect('outerGlow',{radius:12}),effect('shadow')]})]));
  check('stroke stays above glow and shadow regardless of insertion order',pixel(c,18,30).join()==='255,0,0,255');
  c = await render(
    doc([
      shape({
        effects: [
          effect("shadow", {
            radius: 0,
            distance: 10,
            angle: 90,
            opacity: 100,
          }),
        ],
      }),
    ]),
  );
  check(
    "shadow offset direction and distance",
    pixel(c, 30, 65).join() === "0,0,0,255" &&
      pixel(c, 30, 74)[3] === 0 &&
      pixel(c, 30, 15)[3] === 0,
  );
  c = await render(
    doc([
      shape({
        effects: [
          effect("innerShadow", {
            radius: 0,
            distance: 6,
            angle: 0,
            opacity: 100,
          }),
        ],
      }),
    ]),
  );
  check(
    "inner shadow darkens inset edge only",
    pixel(c, 22, 30)[0] === 0 &&
      pixel(c, 40, 40)[0] === 51 &&
      pixel(c, 18, 30)[3] === 0,
  );
  c = await render(
    doc([shape({ effects: [effect("innerGlow", { radius: 4 })] })]),
  );
  check(
    "inner glow brightens edge and keeps exterior transparent",
    pixel(c, 20, 30)[0] > pixel(c, 40, 40)[0] && pixel(c, 18, 30)[3] === 0,
  );
  c = await render(
    doc([
      shape({
        effects: [effect("outerGlow", { radius: 4, color: "#ffffff" })],
      }),
    ]),
  );
  check(
    "outer glow extends soft alpha without replacing content",
    pixel(c, 17, 30)[3] > 0 &&
      pixel(c, 5, 30)[3] === 0 &&
      pixel(c, 40, 40)[0] === 51,
  );
  const source = surface(40, 40),
    ctx = source.getContext("2d", { willReadFrequently: true }),
    rgba = ctx.createImageData(40, 40);
  for (let i = 0; i < rgba.data.length; i += 4) {
    rgba.data[i] = 51;
    rgba.data[i + 1] = 102;
    rgba.data[i + 2] = 153;
    rgba.data[i + 3] = Math.floor(i / 4) % 40 < 5 ? 40 : 128;
  }
  ctx.putImageData(rgba, 0, 0);
  for (const type of ["overlay", "innerGlow", "innerShadow", "stroke"]) {
    const copy = surface(40, 40),
      cc = copy.getContext("2d", { willReadFrequently: true });
    cc.drawImage(source, 0, 0);
    const before = cc.getImageData(0, 0, 40, 40).data;
    applyEffects(copy, [
      effect(type, { position: "inside", color: "#ff0000" }),
    ]);
    const after = cc.getImageData(0, 0, 40, 40).data;
    check(
      type + " preserves every translucent alpha",
      after.every((v, i) => i % 4 !== 3 || v === before[i]),
    );
  }
  c = await render(
    doc([
      shape({
        mask: { x: 0, y: 0, width: 0.5, height: 1 },
        effects: [effect("stroke", { color: "#ff0000", size: 3 })],
      }),
    ]),
  );
  check(
    "effects follow masked contour",
    pixel(c, 41, 30)[0] === 255 && pixel(c, 45, 30)[3] === 0,
  );
  const g = createLayer("group", {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    effects: [effect("overlay", { color: "#00ff00" })],
  });
  c = await render(doc([g, shape({ parentId: g.id })]));
  check(
    "group effects compose children",
    pixel(c, 30, 30).join() === "0,255,0,255",
  );
  const bitmap = { dataUrl: source.toDataURL() };
  c = await render(
    doc([
      createLayer("image", {
        x: 20,
        y: 20,
        width: 40,
        height: 40,
        bitmap,
        effects: [effect("overlay", { color: "#ff0000" })],
      }),
    ]),
  );
  check(
    "image effects preserve original resource",
    pixel(c, 30, 30)[0] === 255 && bitmap.dataUrl === source.toDataURL(),
  );
  c = await render(
    doc([
      createLayer("text", {
        x: 10,
        y: 10,
        width: 80,
        height: 70,
        text: "A",
        fontSize: 50,
        color: "#336699",
        effects: [effect("overlay", { color: "#ff0000" })],
      }),
    ]),
  );
  check(
    "text effects keep editable vector text",
    c
      .getContext("2d")
      .getImageData(0, 0, 100, 100)
      .data.some((v, i) => i % 4 === 0 && v === 255),
  );
  const layer = shape({
    effects: [effect("overlay", { color: "#ff0000", enabled: false })],
  });
  c = await render(doc([layer]));
  check(
    "disabled effect returns original pixels",
    pixel(c, 30, 30).join() === "51,102,153,255",
  );
  const tiled = doc(
    [
      shape({
        x: 980,
        y: 40,
        width: 90,
        height: 80,
        mask: { x: 0, y: 0, width: 0.75, height: 1, feather: 3 },
        effects: [
          effect("stroke", { size: 5 }),
          effect("shadow", { radius: 8, distance: 20 }),
          effect("outerGlow", { radius: 12 }),
          effect("overlay", { color: "#dd8833", opacity: 30 }),
        ],
      }),
      createLayer("adjustment", {
        x: 0,
        y: 0,
        width: 2100,
        height: 160,
        adjustment: { ...adjustDefaults("blur"), radius: 3 },
      }),
    ],
    2100,
    160,
  );
  const whole = await render(tiled),
    bytes = await engine.export(tiled, { transparent: true }),
    img = await createImageBitmap(new Blob([bytes], { type: "image/png" })),
    output = surface(2100, 160),
    out = output.getContext("2d", { willReadFrequently: true });
  out.drawImage(img, 0, 0);
  img.close();
  const a = whole.getContext("2d").getImageData(0, 0, 2100, 160).data,
    b = out.getImageData(0, 0, 2100, 160).data;
  let max = 0;
  for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
  check("effects mask feather and adjustment match tiled PNG", max === 0);
  const independent = Array.from({ length: 100 }, () =>
    shape({ effects: [effect("shadow", { radius: 10, distance: 20 })] }),
  );
  check(
    "independent layers do not add padding cumulatively",
    renderPadding(independent) === 62,
  );
  const nested = createLayer("group", {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    effects: [effect("outerGlow", { radius: 10 })],
  });
  check(
    "nested effect padding accumulates",
    renderPadding([
      nested,
      shape({
        parentId: nested.id,
        effects: [effect("shadow", { radius: 10, distance: 20 })],
      }),
    ]) === 104,
  );
  engine.dispose();
  return { checks, max, padding: renderPadding(tiled.layers) };
};
window.fxQA.fixture = async (id) => {
  const r = await tugou.open(id);
  await tugou.save(
    id,
    {
      ...r.document,
      width: 256,
      height: 192,
      background: "transparent",
      futureField: { keep: true },
      layers: [
        shape({ x: 60, y: 40, width: 100, height: 100, futureLayer: "keep" }),
      ],
    },
    r.revision,
  );
};
window.fxQA.large = async () => {
  const c = surface(10000, 10000),
    ctx = c.getContext("2d");
  ctx.fillStyle = "#336699";
  ctx.fillRect(1000, 1000, 70, 70);
  ctx.fillRect(9950, 9950, 25, 25);
  const asset = await tugou.storeRaster(await pngBytes(c), "100MP特效样图");
  c.width = c.height = 1;
  const r = await tugou.create("100MP特效验收"),
    document = {
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
          effects: [
            effect("stroke", { size: 3, color: "#ff0000" }),
            effect("shadow", { radius: 4, distance: 8, angle: 90 }),
            effect("outerGlow", { radius: 5, color: "#ffffff" }),
          ],
        }),
      ],
    },
    engine = new Compositor(),
    start = performance.now();
  const bytes = await engine.export(document, { transparent: true }),
    elapsed = performance.now() - start,
    result = await tugou.storeRaster(bytes, "100MP特效结果");
  await tugou.save(r.id, { ...document, assets: [asset, result] }, r.revision);
  engine.dispose();
  return { id: r.id, result, elapsed };
};
window.fxQA.largePixels = async (result) => {
  const engine = new Compositor(),
    image = await engine.image(result),
    c = surface(1, 1),
    ctx = c.getContext("2d", { willReadFrequently: true }),
    pixels = [
      [1023, 1023],
      [1024, 1024],
      [9960, 9960],
      [9948, 9960],
      [9944, 9960],
      [5000, 5000],
    ].map(([x, y]) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.drawImage(image, x, y, 1, 1, 0, 0, 1, 1);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    });
  engine.dispose();
  return { width: image.naturalWidth, height: image.naturalHeight, pixels };
};
window.fxQA.sample=async dataUrl=>{
 const e=new Compositor(),image=await e.image({dataUrl}),w=image.naturalWidth,h=image.naturalHeight,raw=surface(w,h),r=raw.getContext('2d',{willReadFrequently:true});r.drawImage(image,0,0);
 const before=r.getImageData(0,0,w,h).data;applyEffects(raw,[effect('innerGlow',{radius:8,opacity:20})]);const after=r.getImageData(0,0,w,h).data;
 let alphaDiff=0,soft=0;for(let i=3;i<before.length;i+=4){if(before[i]!==after[i])alphaDiff++;if(before[i]>0&&before[i]<255)soft++;}
 const frame=doc([createLayer('image',{x:60,y:60,width:w,height:h,bitmap:{dataUrl},effects:[effect('stroke',{size:3,color:'#edf4ff'}),effect('shadow',{radius:10,distance:10,color:'#203552',opacity:25})]})],w+120,h+120),styled=surface(frame.width,frame.height);await e.render(frame,styled,{transparent:true});
 const scale=Math.min(580/frame.height,450/frame.width),pw=Math.ceil(frame.width*scale),ph=Math.ceil(frame.height*scale),comparison=surface(pw*2+24,ph+44),c=comparison.getContext('2d');c.fillStyle='#f3efe7';c.fillRect(0,0,comparison.width,comparison.height);c.fillStyle='#393d45';c.font='16px sans-serif';c.fillText('原图',12,24);c.fillText('描边与投影',pw+24,24);c.drawImage(image,60*scale,44+60*scale,w*scale,h*scale);c.drawImage(styled,pw+24,44,pw,ph);
 const bytes=await pngBytes(comparison);e.dispose();return {width:w,height:h,alphaDiff,soft,bytes:[...bytes]};
};
