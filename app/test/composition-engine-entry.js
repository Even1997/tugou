import { processComposition } from "../renderer/image-composition.js";
import { loadOriginal } from "../renderer/image-processing.js";
import { surface, pngBytes } from "../renderer/selection.js";
import { compositionDefaults } from "../core/image-composition.cjs";
async function asset(name, w, h, draw) {
  const c = surface(w, h),
    x = c.getContext("2d", { willReadFrequently: true });
  draw(x, c);
  const a = await window.tugou.storeRaster(await pngBytes(c), name);
  c.width = c.height = 1;
  return a;
}
async function pixels(a) {
  const image = await loadOriginal(a),
    c = surface(image.naturalWidth, image.naturalHeight),
    x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(image, 0, 0);
  const p = x.getImageData(0, 0, c.width, c.height);
  c.width = c.height = 1;
  image.src = "";
  return p;
}
async function fixtures() {
  const pair = async (white) =>
    asset(white ? "白底" : "黑底", 1025, 513, (x, c) => {
      const p = x.createImageData(c.width, c.height);
      for (let y = 0; y < c.height; y++)
        for (let px = 0; px < c.width; px++) {
          const a = px % 256,
            i = (y * c.width + px) * 4;
          for (let k = 0; k < 3; k++)
            p.data[i + k] = Math.round(
              ([39, 147, 219][k] * a) / 255 + (white ? 255 - a : 0),
            );
          p.data[i + 3] = 255;
        }
      x.putImageData(p, 0, 0);
    });
  const black = await pair(false),
    white = await pair(true);
  const atlas = await asset("图集", 65, 49, (x) => {
    x.fillStyle = "rgba(240,80,20,.5)";
    x.fillRect(4, 3, 12, 10);
    x.fillStyle = "#3479c8";
    x.fillRect(30, 20, 14, 20);
    x.fillStyle = "#40ba60";
    x.fillRect(60, 43, 1, 1);
    x.fillStyle = "#ffffff";
    x.fillRect(0, 0, 1, 1);
  });
  const texture = await asset("材质", 2, 2, (x) => {
    for (const [xx, yy, col] of [
      [0, 0, "#f02040"],
      [1, 0, "#20c060"],
      [0, 1, "rgba(20,50,250,.5)"],
      [1, 1, "#f0ce20"],
    ]) {
      x.fillStyle = col;
      x.fillRect(xx, yy, 1, 1);
    }
  });
  const base = await asset("底图", 65, 49, (x) => {
    x.fillStyle = "rgba(80,130,200,.5)";
    x.fillRect(0, 0, 65, 49);
    x.clearRect(0, 0, 3, 3);
  });
  return { black, white, atlas, texture, base };
}
async function process(
  source,
  secondary,
  operation,
  options = {},
  cancelAfterFirst = false,
) {
  const controller = new AbortController(),
    parts = [],
    progress = [];
  try {
    await processComposition(
      source,
      secondary,
      { operation, ...compositionDefaults[operation], ...options },
      controller.signal,
      (p) => progress.push(p),
      async (part) => {
        const a = await window.tugou.storeRaster(
          part.bytes,
          part.name || operation,
        );
        parts.push({
          ...a,
          bounds: part.bounds,
          index: part.index,
          count: part.count,
        });
        if (cancelAfterFirst) controller.abort();
      },
    );
    return { parts, progress };
  } catch (e) {
    if (cancelAfterFirst && e.name === "AbortError")
      return { parts, cancelled: true };
    throw e;
  }
}
async function reassemble(source, parts) {
  const expected = await pixels(source),
    c = surface(expected.width, expected.height),
    x = c.getContext("2d", { willReadFrequently: true });
  for (const a of parts) {
    const im = await loadOriginal(a);
    x.drawImage(im, 0, 0);
    im.src = "";
  }
  const actual = x.getImageData(0, 0, c.width, c.height).data;
  let max = 0,
    alphaDiff = 0;
  for (let i = 0; i < actual.length; i += 4) {
    if (actual[i + 3] !== expected.data[i + 3]) alphaDiff++;
    for (let k = 0; k < 3; k++)
      max = Math.max(
        max,
        Math.abs(
          (actual[i + k] * actual[i + 3]) / 255 -
            (expected.data[i + k] * expected.data[i + 3]) / 255,
        ),
      );
  }
  c.width = c.height = 1;
  return { max, alphaDiff };
}
async function verify(f) {
  const checks = [],
    check = (name, v) => {
      if (!v) throw Error(name);
      checks.push(name);
    };
  const matte = await process(f.black, f.white, "mattePair"),
    m = await pixels(matte.parts[0]);
  let maxAlpha = 0,
    maxBlack = 0,
    maxWhite = 0;
  const bp = await pixels(f.black),
    wp = await pixels(f.white);
  for (let y = 0; y < m.height; y++)
    for (let x = 0; x < m.width; x++) {
      const i = (y * m.width + x) * 4;
      maxAlpha = Math.max(maxAlpha, Math.abs(m.data[i + 3] - (x % 256)));
      for (let c = 0; c < 3; c++) {
        const v = (m.data[i + c] * m.data[i + 3]) / 255;
        maxBlack = Math.max(maxBlack, Math.abs(v - bp.data[i + c]));
        maxWhite = Math.max(
          maxWhite,
          Math.abs(v + 255 - m.data[i + 3] - wp.data[i + c]),
        );
      }
    }
  check(
    "paired alpha is exact across 512px worker tile boundaries",
    maxAlpha === 0,
  );
  check(
    "recovered foreground reproduces black and white within 1.5 channel levels",
    maxBlack <= 1.5 && maxWhite <= 1.5,
  );
  const edges = await process(f.black, f.white, "mattePair", {
      shrink: 1,
      feather: 2,
    }),
    ep = await pixels(edges.parts[0]);
  check(
    "paired edge cleanup never increases recovered alpha",
    ep.data.every((n, i) => i % 4 !== 3 || n <= m.data[i]),
  );
  let bad = false;
  try {
    await process(f.black, f.texture, "mattePair");
  } catch (e) {
    bad = e.message.includes("尺寸");
  }
  check("mismatched pair dimensions fail before output", bad);
  const islands = await process(f.atlas, null, "split", { minArea: 4 });
  check(
    "two main islands and one tiny-pieces remainder",
    islands.parts.length === 3 && islands.parts[2].count === 3,
  );
  const assembled = await reassemble(f.atlas, islands.parts);
  check(
    "alpha islands recompose to identical visible source",
    assembled.alphaDiff === 0 && assembled.max <= 1,
  );
  const grid = await process(f.atlas, null, "split", {
    splitMode: "grid",
    rows: 3,
    columns: 4,
  });
  const g = await reassemble(f.atlas, grid.parts);
  check(
    "odd-size grid outputs retain full frame and pixel ownership",
    grid.parts.length === 12 &&
      grid.parts.every((p) => p.width === 65 && p.height === 49) &&
      g.alphaDiff === 0 &&
      g.max <= 1,
  );
  const cancelled = await process(
    f.atlas,
    null,
    "split",
    { splitMode: "grid", rows: 3, columns: 4 },
    true,
  );
  check(
    "streaming splitter cancellation stops before a second output",
    cancelled.cancelled && cancelled.parts.length === 1,
  );
  const options = {
    left: 10,
    top: 9,
    width: 35,
    height: 28,
    feather: 3,
    strength: 50,
  };
  const textured = await process(f.base, f.texture, "texture", options),
    p = await pixels(textured.parts[0]),
    base = await pixels(f.base),
    t = await pixels(f.texture);
  let outside = 0,
    alpha = 0,
    error = 0,
    changed = 0;
  for (let y = 0; y < p.height; y++)
    for (let x = 0; x < p.width; x++) {
      const i = (y * p.width + x) * 4;
      alpha += p.data[i + 3] !== base.data[i + 3];
      const rx = x - options.left,
        ry = y - options.top;
      if (rx < 0 || ry < 0 || rx >= options.width || ry >= options.height) {
        for (let k = 0; k < 4; k++)
          outside += p.data[i + k] !== base.data[i + k];
        continue;
      }
      const ti = ((ry % 2) * 2 + (rx % 2)) * 4,
        edge = Math.min(
          1,
          Math.min(
            rx + 0.5,
            ry + 0.5,
            options.width - rx - 0.5,
            options.height - ry - 0.5,
          ) / 3,
        ),
        weight = (0.5 * edge * t.data[ti + 3]) / 255;
      for (let k = 0; k < 3; k++) {
        const expected = Math.round(
          base.data[i + k] * (1 - weight) + t.data[ti + k] * weight,
        );
        error = Math.max(
          error,
          (Math.abs(p.data[i + k] - expected) * p.data[i + 3]) / 255,
        );
        changed += p.data[i + k] !== base.data[i + k];
      }
    }
  check(
    "texture preserves alpha and every exterior pixel",
    alpha === 0 && outside === 0,
  );
  check(
    "texture pattern phase and feather match analytic result",
    error <= 1.1 && changed > 1000,
  );
  return {
    checks,
    metrics: { maxAlpha, maxBlack, maxWhite, textureError: error },
    assets: {
      matte: matte.parts[0],
      edges: edges.parts[0],
      texture: textured.parts[0],
    },
    islands: islands.parts,
  };
}
async function samplePixels(a) {
  const im = await loadOriginal(a),
    c = surface(1, 1),
    x = c.getContext("2d", { willReadFrequently: true }),
    points = [
      [0, 0],
      [511, 512],
      [1000, 1000],
      [2500, 5000],
      [5000, 5000],
      [7000, 7000],
      [9999, 9999],
    ],
    values = [];
  for (const [px, py] of points) {
    x.clearRect(0, 0, 1, 1);
    x.drawImage(im, px, py, 1, 1, 0, 0, 1, 1);
    values.push([...x.getImageData(0, 0, 1, 1).data]);
  }
  im.src = "";
  c.width = c.height = 1;
  return {
    width: im.naturalWidth || a.width,
    height: im.naturalHeight || a.height,
    points,
    values,
  };
}
async function large(mode) {
  const color = (name, col, draw) =>
    asset(name, 10000, 10000, (x, c) => {
      x.fillStyle = col;
      x.fillRect(0, 0, c.width, c.height);
      draw?.(x, c);
    });
  let source,
    second,
    operation,
    settings = {};
  if (mode === "pair") {
    source = await color("100MP黑底", "#204060");
    second = await color("100MP白底", "#9fbfdf");
    operation = "mattePair";
  } else if (mode === "texture") {
    source = await color("100MP底图", "#4080c0", (x) =>
      x.clearRect(0, 0, 128, 128),
    );
    second = await asset("纯色材质", 2, 2, (x) => {
      x.fillStyle = "#c04020";
      x.fillRect(0, 0, 2, 2);
    });
    operation = "texture";
    settings = {
      left: 2500,
      top: 2500,
      width: 5000,
      height: 5000,
      strength: 50,
      feather: 4,
    };
  } else if (mode === "grid") {
    source = await color("100MP网格", "#4080c0");
    operation = "split";
    settings = { splitMode: "grid", rows: 2, columns: 2 };
  } else {
    source = await asset("100MP透明岛", 10000, 10000, (x) => {
      x.fillStyle = "#4080c0";
      x.fillRect(200, 200, 3000, 3000);
      x.fillRect(6000, 6500, 3500, 3000);
      x.fillStyle = "rgba(255,255,255,.25)";
      x.fillRect(9999, 9999, 1, 1);
    });
    operation = "split";
    settings = { splitMode: "alpha", minArea: 10 };
  }
  const start = performance.now();
  let beats = 0,
    gap = 0,
    last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    gap = Math.max(gap, now - last);
    last = now;
    beats++;
  }, 25);
  const result = await process(source, second, operation, settings);
  clearInterval(timer);
  return {
    mode,
    elapsedMs: performance.now() - start,
    beats,
    maxHeartbeatGap: gap,
    source,
    secondary: second,
    parts: result.parts,
    samples: await Promise.all(result.parts.map(samplePixels)),
  };
}
async function sample(source) {
  const im=await loadOriginal(source),w=im.naturalWidth,h=im.naturalHeight;
  const black=await asset('人物黑底',w,h,x=>{x.fillStyle='#000';x.fillRect(0,0,w,h);x.drawImage(im,0,0);});
  const white=await asset('人物白底',w,h,x=>{x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(im,0,0);});
  im.src='';
  const recovered=(await process(black,white,'mattePair')).parts[0];
  const paper=await asset('材质样片',32,32,x=>{x.fillStyle='#c9bdaa';x.fillRect(0,0,32,32);for(let y=0;y<32;y+=4){x.fillStyle=y%8?'#e4dac6':'#a99d87';x.fillRect(0,y,32,1);}});
  const rect={left:Math.floor(w*.2),top:Math.floor(h*.4),width:Math.floor(w*.5),height:Math.floor(h*.5),feather:32,strength:20};
  const textured=(await process(source,paper,'texture',rect)).parts[0];
  const p=await pixels(source),r=await pixels(recovered),t=await pixels(textured);let alphaError=0,colorError=0,outside=0,textureAlpha=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y*w+x)*4;alphaError=Math.max(alphaError,Math.abs(p.data[i+3]-r.data[i+3]));textureAlpha+=p.data[i+3]!==t.data[i+3];for(let c=0;c<3;c++)colorError=Math.max(colorError,Math.abs(p.data[i+c]*p.data[i+3]/255-r.data[i+c]*r.data[i+3]/255));if(x<rect.left||x>=rect.left+rect.width||y<rect.top||y>=rect.top+rect.height)for(let c=0;c<4;c++)outside+=p.data[i+c]!==t.data[i+c];}
  const canvas=surface(1536,800),ctx=canvas.getContext('2d');ctx.fillStyle='#879caf';ctx.fillRect(0,0,1536,800);ctx.font='20px sans-serif';ctx.fillStyle='#fff';
  for(const [index,a]of [source,recovered,textured].entries()){const image=await loadOriginal(a);ctx.drawImage(image,index*512,32,512,768);ctx.fillText(['Original','Paired alpha','Texture region'][index],index*512+16,24);image.src='';}
  const review=await window.tugou.storeRaster(await pngBytes(canvas),'组合工具对照');canvas.width=canvas.height=1;
  return {alphaError,colorError,outside,textureAlpha,review};
}
window.compositionQA = {
  sample,
  large,
  samplePixels,
  fixtures,
  verify,
  process,
  pixels,
  reassemble,
  asset,
  defaults: compositionDefaults,
};
