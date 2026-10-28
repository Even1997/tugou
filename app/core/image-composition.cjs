const { dimensions } = require("./image-tools.cjs");
const compositionNames = {
  mattePair: "黑白底提取透明",
  texture: "选区材质",
  split: "素材拆分",
  crop: "裁剪",
  extract: "框选提取",
  patch: "选区替换",
};
const compositionDefaults = {
  crop: { left: 0, top: 0, width: 256, height: 256 },
  extract: { left: 0, top: 0, width: 256, height: 256, feather: 0 },
  patch: {
    secondaryId: "",
    left: 0,
    top: 0,
    width: 256,
    height: 256,
    feather: 0,
  },
  mattePair: { secondaryId: "", shrink: 0, feather: 0, matte: "none" },
  texture: {
    secondaryId: "",
    left: 0,
    top: 0,
    width: 256,
    height: 256,
    feather: 0,
    strength: 100,
  },
  split: { splitMode: "alpha", rows: 2, columns: 2, minArea: 16 },
};
function validateComposition(s, width, height, secondary) {
  dimensions(width, height);
  if (!Object.hasOwn(compositionNames, s.operation))
    throw Error("不支持的组合工具");
  const integer = (key, min, max) => {
    if (!Number.isInteger(s[key]) || s[key] < min || s[key] > max)
      throw Error("参数超出范围：" + key);
  };
  if (["crop", "extract", "patch"].includes(s.operation)) {
    integer("left", 0, width - 1);
    integer("top", 0, height - 1);
    integer("width", 1, width - s.left);
    integer("height", 1, height - s.top);
    if (s.operation !== "crop") integer("feather", 0, 1000);
    if (s.operation === "patch") {
      if (!secondary) throw Error("请选择替换素材");
      dimensions(secondary.width, secondary.height);
    }
  } else if (s.operation === "split") {
    integer("rows", 1, 16);
    integer("columns", 1, 16);
    integer("minArea", 1, 1000000);
    if (!["grid", "alpha"].includes(s.splitMode)) throw Error("拆分方式无效");
    if (
      s.splitMode === "grid" &&
      (s.rows * s.columns > 64 || s.rows > height || s.columns > width)
    )
      throw Error("最多拆分 64 格，行列不能超过原图像素");
  } else {
    if (!secondary)
      throw Error(
        s.operation === "mattePair" ? "请选择白底版本" : "请选择材质素材",
      );
    dimensions(secondary.width, secondary.height);
    if (s.operation === "mattePair") {
      if (secondary.width !== width || secondary.height !== height)
        throw Error("黑白底图片尺寸必须相同，主体须逐像素对齐");
      integer("shrink", 0, 32);
      integer("feather", 0, 32);
      if (!["none", "white", "black"].includes(s.matte))
        throw Error("去底色模式无效");
    } else {
      integer("left", 0, width - 1);
      integer("top", 0, height - 1);
      integer("width", 1, width - s.left);
      integer("height", 1, height - s.top);
      integer("feather", 0, 1000);
      integer("strength", 0, 100);
    }
  }
}

// Solve two compositing equations in the encoded (sRGB) channel domain.
function recoverMatte(black, white) {
  if (black.length !== white.length || black.length % 4)
    throw Error("配对像素尺寸不一致");
  let inconsistent = 0,
    transparent = 0;
  for (let i = 0; i < black.length; i += 4) {
    if (black[i + 3] !== 255 || white[i + 3] !== 255) transparent++;
    const d0 = white[i] - black[i],
      d1 = white[i + 1] - black[i + 1],
      d2 = white[i + 2] - black[i + 2];
    const lo = Math.min(d0, d1, d2),
      hi = Math.max(d0, d1, d2),
      median = d0 + d1 + d2 - lo - hi;
    if (lo < -3 || hi - lo > 6) inconsistent++;
    const alpha = Math.max(0, Math.min(255, 255 - median));
    for (let c = 0; c < 3; c++)
      black[i + c] = alpha
        ? Math.round(
            Math.max(
              0,
              Math.min(
                255,
                ((black[i + c] + white[i + c] - (255 - alpha)) * 127.5) / alpha,
              ),
            ),
          )
        : 0;
    black[i + 3] = alpha;
  }
  return { inconsistent, transparent };
}

function applyTexture(original, texture, width, height, s, originX, originY) {
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const px = originX + x - s.left,
        py = originY + y - s.top;
      if (px < 0 || py < 0 || px >= s.width || py >= s.height) continue;
      const i = (y * width + x) * 4;
      const edge = s.feather
        ? Math.min(
            1,
            Math.min(
              px + 0.5,
              py + 0.5,
              s.width - px - 0.5,
              s.height - py - 0.5,
            ) / s.feather,
          )
        : 1;
      const mix = (((edge * s.strength) / 100) * texture[i + 3]) / 255;
      for (let c = 0; c < 3; c++)
        original[i + c] = Math.round(
          original[i + c] * (1 - mix) + texture[i + c] * mix,
        );
    }
  return original;
}

// Rectangle mask in original pixel coordinates. Replacement uses source-over in premultiplied space.
function applyRegion(pixels, replacement, width, height, s, originX, originY) {
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const rx = originX + x - s.left,
        ry = originY + y - s.top,
        i = (y * width + x) * 4;
      const inside = rx >= 0 && ry >= 0 && rx < s.width && ry < s.height;
      const edge = Math.min(
        rx + 0.5,
        ry + 0.5,
        s.width - rx - 0.5,
        s.height - ry - 0.5,
      );
      const mask = inside ? (s.feather ? Math.min(1, edge / s.feather) : 1) : 0;
      if (s.operation === "extract") {
        pixels[i + 3] = Math.round(pixels[i + 3] * mask);
        if (!pixels[i + 3]) pixels.fill(0, i, i + 4);
      } else if (mask) {
        const cover = (replacement[i + 3] / 255) * mask;
        if (!cover) continue;
        const retained = (pixels[i + 3] / 255) * (1 - cover),
          alpha = cover + retained;
        for (let c = 0; c < 3; c++)
          pixels[i + c] = Math.round(
            (replacement[i + c] * cover + pixels[i + c] * retained) / alpha,
          );
        pixels[i + 3] = Math.round(alpha * 255);
      }
    }
  return pixels;
}

function gridRegions(width, height, rows, columns) {
  validateComposition(
    { operation: "split", splitMode: "grid", rows, columns, minArea: 1 },
    width,
    height,
  );
  return Array.from({ length: rows * columns }, (_, index) => {
    const row = Math.floor(index / columns),
      col = index % columns;
    const left = Math.floor((col * width) / columns),
      top = Math.floor((row * height) / rows);
    return {
      name: `第 ${row + 1} 行 · 第 ${col + 1} 列`,
      bounds: {
        left,
        top,
        width: Math.floor(((col + 1) * width) / columns) - left,
        height: Math.floor(((row + 1) * height) / rows) - top,
      },
    };
  });
}

// Two-pass connected-component labeling, with eight neighbours and no flood queue.
function alphaRegions(rgba, width, height, minArea, progress = () => {}) {
  validateComposition(
    { operation: "split", splitMode: "alpha", rows: 1, columns: 1, minArea },
    width,
    height,
  );
  if (rgba.length !== width * height * 4) throw Error("像素数据尺寸无效");
  const labels = new Int32Array(width * height),
    parent = [0];
  const root = (id) => {
    let r = id;
    while (parent[r] !== r) r = parent[r];
    while (id !== r) {
      const next = parent[id];
      parent[id] = r;
      id = next;
    }
    return r;
  };
  let hasClear = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!rgba[i * 4 + 3]) {
        hasClear = true;
        continue;
      }
      let label = x ? labels[i - 1] : 0;
      if (y)
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx < 0 || x + dx >= width) continue;
          const above = labels[i - width + dx];
          if (!above) continue;
          if (!label) label = above;
          else {
            const a = root(label),
              b = root(above);
            if (a !== b) parent[Math.max(a, b)] = Math.min(a, b);
            label = Math.min(a, b);
          }
        }
      if (!label) {
        label = parent.length;
        parent.push(label);
      }
      labels[i] = label;
    }
    if (y % 128 === 0) progress(Math.floor((y / height) * 20));
  }
  if (!hasClear) throw Error("透明岛拆分需要透明底图片；普通图片请用网格拆分");
  const counts = new Uint32Array(parent.length);
  for (let i = 0; i < labels.length; i++)
    if (labels[i]) counts[(labels[i] = root(labels[i]))]++;
  const map = new Map(),
    parts = [];
  let small = 0;
  for (let id = 1; id < counts.length; id++)
    if (counts[id]) {
      if (counts[id] < minArea) small += counts[id];
      else {
        map.set(id, parts.length + 1);
        parts.push({
          label: parts.length + 1,
          name: `区域 ${parts.length + 1}`,
          pixels: counts[id],
          bounds: { left: width, top: height, width: 0, height: 0 },
        });
        if (parts.length > 64)
          throw Error("独立区域超过 64 个，请提高最小面积");
      }
    }
  if (small)
    parts.push({
      label: -1,
      name: "细小区域",
      pixels: small,
      bounds: { left: width, top: height, width: 0, height: 0 },
    });
  if (!parts.length) throw Error("图片完全透明，没有可拆分内容");
  if (parts.length > 64)
    throw Error("包含细小区域后超过 64 个，请提高最小面积");
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!labels[i]) continue;
      const label = map.get(labels[i]) || -1;
      labels[i] = label;
      const b = parts[label === -1 ? parts.length - 1 : label - 1].bounds;
      b.left = Math.min(b.left, x);
      b.top = Math.min(b.top, y);
      b.width = Math.max(b.width, x + 1);
      b.height = Math.max(b.height, y + 1);
    }
  for (const part of parts) {
    part.bounds.width -= part.bounds.left;
    part.bounds.height -= part.bounds.top;
  }
  progress(40);
  return { labels, parts };
}
module.exports = {
  compositionNames,
  compositionDefaults,
  validateComposition,
  recoverMatte,
  applyTexture,
  applyRegion,
  gridRegions,
  alphaRegions,
};
