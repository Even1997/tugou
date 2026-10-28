const operations = {
  resize: "分辨率调整",
  mirror: "水平镜像",
  rotate: "顺时针旋转",
  extend: "透明扩边",
  alpha: "透明边缘",
  lut: "LUT 调色",
  light: "局部打光",
  pattern: "重复图案",
  tile: "图片平铺",
  enhance: "质感调整",
};
const defaults = {
  tile: { width: 2048, height: 2048 },
  enhance: { strength: 50 },
  resize: { sizeMode: "scale", width: 1024, height: 1024, lockRatio: true },
  extend: { sizeMode: "padding", width: 1024, height: 1024, left: 0, top: 0 },
  alpha: { shrink: 0, feather: 0, matte: "none" },
  lut: { lutId: "", strength: 100 },
  light: {
    exposure: 1,
    color: "#ffffff",
    centerX: 50,
    centerY: 50,
    radius: 50,
    kind: "radial",
    angle: 0,
  },
  pattern: {
    width: 2048,
    height: 2048,
    motifScale: 0.5,
    gap: 0,
    layout: "repeat",
  },
};
const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
function dimensions(width, height) {
  if (
    ![width, height].every((n) => Number.isInteger(n) && n > 0 && n <= 30000) ||
    width * height > 100000000
  )
    throw new Error("输出尺寸须在单边 30000、总量 1 亿像素以内。");
}
function validateSettings(s) {
  if (!operations[s.operation]) throw new Error("不支持的处理方式");
  const range = (key, lo, hi, integer = false) => {
    if (
      !Number.isFinite(s[key]) ||
      s[key] < lo ||
      s[key] > hi ||
      (integer && !Number.isInteger(s[key]))
    )
      throw new Error("参数超出范围：" + key);
  };
  if (s.operation === "alpha") {
    range("shrink", 0, 32, true);
    range("feather", 0, 32, true);
    if (!["none", "white", "black"].includes(s.matte))
      throw new Error("请选择有效的去底色模式");
  } else if (s.operation === "lut") {
    range("strength", 0, 100);
  } else if (s.operation === "light") {
    range("exposure", -4, 4);
    range("centerX", 0, 100);
    range("centerY", 0, 100);
    range("radius", 1, 200);
    range("angle", -180, 180);
    if (
      !/^#[\da-f]{6}$/i.test(s.color) ||
      !["radial", "directional"].includes(s.kind)
    )
      throw new Error("打光参数无效");
  } else if (s.operation === "enhance") {
    range("strength", 0, 100);
  } else if (s.operation === "tile") {
    dimensions(s.width, s.height);
  } else if (s.operation === "pattern") {
    dimensions(s.width, s.height);
    range("motifScale", 0.01, 4);
    range("gap", 0, 5000, true);
    if (!["repeat", "mirror", "halfdrop"].includes(s.layout))
      throw new Error("图案排列无效");
  }
}

// Alpha-weighted binomial luminance blur followed by an unsharp luminance residual.
// Zero-alpha neighbours cannot introduce dark/colored fringes; the original alpha is retained.
function enhancePixels(pixels, width, height, strength, buffers = {}) {
  if (!strength) return pixels;
  const amount = strength / 100,
    n = width * height;
  const [luminance, horizontal, coverage] = [
    "luminance",
    "horizontal",
    "coverage",
  ].map((key) => {
    if (!buffers[key] || buffers[key].length < n)
      buffers[key] = new Float64Array(n);
    return buffers[key];
  });
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    luminance[i] =
      0.2126 * pixels[p] + 0.7152 * pixels[p + 1] + 0.0722 * pixels[p + 2];
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let weighted = 0,
        alpha = 0;
      for (let dx = -1; dx <= 1; dx++) {
        if (x + dx < 0 || x + dx >= width) continue;
        const j = i + dx,
          weight = (dx ? 1 : 2) * pixels[j * 4 + 3];
        weighted += luminance[j] * weight;
        alpha += weight;
      }
      horizontal[i] = weighted;
      coverage[i] = alpha;
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        p = i * 4;
      if (!pixels[p + 3]) continue;
      let sum = 0,
        weight = 0;
      for (let dy = -1; dy <= 1; dy++) {
        if (y + dy < 0 || y + dy >= height) continue;
        const j = i + dy * width,
          k = dy ? 1 : 2;
        sum += horizontal[j] * k;
        weight += coverage[j] * k;
      }
      const base = luminance[i],
        detail = (base - sum / weight) * amount;
      for (let c = 0; c < 3; c++)
        pixels[p + c] = Math.round(
          clamp(
            base + (pixels[p + c] - base) * (1 + 0.15 * amount) + detail,
            0,
            255,
          ),
        );
    }
  return pixels;
}

function outputGeometry(s, width, height) {
  dimensions(width, height);
  let result = { width, height, left: 0, top: 0 };
  if (s.operation === "resize") {
    if (s.sizeMode === "size")
      result = { ...result, width: s.width, height: s.height };
    else {
      if (s.sizeMode && s.sizeMode !== "scale") throw Error("缩放方式无效");
      if (!Number.isFinite(s.scale) || s.scale <= 0)
        throw Error("缩放倍率必须大于 0");
      result.width = Math.round(width * s.scale);
      result.height = Math.round(height * s.scale);
    }
  } else if (s.operation === "extend") {
    if (s.sizeMode === "size") {
      result = { width: s.width, height: s.height, left: s.left, top: s.top };
      if (
        ![s.left, s.top].every((n) => Number.isInteger(n) && n >= 0) ||
        s.left + width > s.width ||
        s.top + height > s.height
      )
        throw Error("扩边尺寸须容纳原图及偏移，请调整目标宽高或原图位置");
    } else {
      if (s.sizeMode && s.sizeMode !== "padding") throw Error("扩边方式无效");
      if (!Number.isInteger(s.padding) || s.padding < 0 || s.padding > 5000)
        throw Error("扩边像素须为 0 到 5000 的整数");
      result = {
        width: width + s.padding * 2,
        height: height + s.padding * 2,
        left: s.padding,
        top: s.padding,
      };
    }
  } else if (s.operation === "rotate")
    result = { ...result, width: height, height: width };
  else if (s.operation !== "mirror") throw Error("几何处理方式无效");
  dimensions(result.width, result.height);
  return result;
}

// Cube 1.0 table order is R, G, B (R varies fastest). No source code is imported.
function parseCube(text) {
  if (typeof text !== "string" || text.length > 16 * 1024 * 1024)
    throw new Error("LUT 文件须小于 16 MiB");
  const lut = {
      title: "",
      size: 0,
      dimension: 0,
      min: [0, 0, 0],
      max: [1, 1, 1],
    },
    seen = new Set();
  let table,
    count = 0;
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("TITLE")) {
      const match = /^TITLE\s+"([^"]*)"\s*(?:#.*)?$/.exec(line);
      if (!match || seen.has("TITLE") || count)
        throw new Error("LUT 标题无效或重复");
      seen.add("TITLE");
      lut.title = match[1];
      continue;
    }
    const parts = line.split("#")[0].trim().split(/\s+/),
      key = parts[0];
    if (/^[A-Z_]/.test(key)) {
      if (seen.has(key) || count) throw new Error("LUT 字段重复或顺序无效");
      seen.add(key);
      const nums = parts.slice(1).map(Number);
      if (["LUT_1D_SIZE", "LUT_3D_SIZE"].includes(key)) {
        const n = nums[0],
          dim = key === "LUT_1D_SIZE" ? 1 : 3;
        if (
          lut.size ||
          nums.length !== 1 ||
          !Number.isInteger(n) ||
          n < 2 ||
          n > (dim === 1 ? 65536 : 65)
        )
          throw new Error("支持单独 1D（2–65536 点）或 3D（2–65 点）LUT");
        lut.size = n;
        lut.dimension = dim;
        table = new Float32Array(n ** dim * 3);
      } else if (["DOMAIN_MIN", "DOMAIN_MAX"].includes(key)) {
        if (nums.length !== 3 || !nums.every(Number.isFinite))
          throw new Error("LUT 输入范围无效");
        lut[key === "DOMAIN_MIN" ? "min" : "max"] = nums;
      } else throw new Error("不支持的 LUT 字段：" + key);
    } else {
      const nums = parts.map(Number);
      if (
        !table ||
        nums.length !== 3 ||
        !nums.every((n) => Number.isFinite(n) && Math.abs(n) <= 65504) ||
        count + 3 > table.length
      )
        throw new Error("LUT 数据无效或行数不匹配");
      table.set(nums, count);
      count += 3;
    }
  }
  if (
    !table ||
    count !== table.length ||
    lut.min.some((v, i) => v >= lut.max[i])
  )
    throw new Error("LUT 数据不完整或输入范围无效");
  return { ...lut, table };
}
function applyLut(rgba, lut, strength) {
  const { size: n, table, min, max } = lut,
    mix = strength / 100;
  if (!mix) return rgba;
  const coords = new Float64Array(3),
    lo = new Int32Array(3),
    hi = new Int32Array(3),
    f = new Float64Array(3);
  for (let p = 0; p < rgba.length; p += 4) {
    if (!rgba[p + 3]) continue;
    for (let c = 0; c < 3; c++) {
      coords[c] =
        clamp((rgba[p + c] / 255 - min[c]) / (max[c] - min[c])) * (n - 1);
      lo[c] = Math.floor(coords[c]);
      hi[c] = Math.min(n - 1, lo[c] + 1);
      f[c] = coords[c] - lo[c];
    }
    for (let c = 0; c < 3; c++) {
      let value = 0;
      if (lut.dimension === 1)
        value = table[lo[c] * 3 + c] * (1 - f[c]) + table[hi[c] * 3 + c] * f[c];
      else
        for (let b = 0; b < 2; b++)
          for (let g = 0; g < 2; g++)
            for (let r = 0; r < 2; r++)
              value +=
                table[
                  ((b ? hi[2] : lo[2]) * n * n +
                    (g ? hi[1] : lo[1]) * n +
                    (r ? hi[0] : lo[0])) *
                    3 +
                    c
                ] *
                (r ? f[0] : 1 - f[0]) *
                (g ? f[1] : 1 - f[1]) *
                (b ? f[2] : 1 - f[2]);
      rgba[p + c] = Math.round(
        rgba[p + c] * (1 - mix) + clamp(value) * 255 * mix,
      );
    }
  }
  return rgba;
}

// Grayscale erosion preserves partial coverage; deque filtering is linear in pixel count.
function erode(alpha, width, height, radius) {
  if (!radius) return alpha.slice();
  let input = alpha;
  for (const vertical of [false, true]) {
    const length = vertical ? height : width,
      lines = vertical ? width : height,
      output = new Uint8Array(alpha.length),
      deque = new Int32Array(length + 2 * radius);
    for (let line = 0; line < lines; line++) {
      let head = 0,
        tail = 0;
      const at = (i) =>
        i < 0 || i >= length
          ? 0
          : input[vertical ? i * width + line : line * width + i];
      for (let i = -radius; i < length + radius; i++) {
        while (head < tail && at(deque[tail - 1]) >= at(i)) tail--;
        deque[tail++] = i;
        while (head < tail && deque[head] < i - 2 * radius) head++;
        const pos = i - radius;
        if (pos >= 0)
          output[vertical ? pos * width + line : line * width + pos] = at(
            deque[head],
          );
      }
    }
    input = output;
  }
  return input;
}
function soften(alpha, width, height, radius) {
  let input = alpha;
  for (const vertical of [false, true]) {
    const length = vertical ? height : width,
      lines = vertical ? width : height,
      output = new Float32Array(alpha.length);
    for (let line = 0; line < lines; line++) {
      const at = (i) =>
        i < 0 || i >= length
          ? 0
          : input[vertical ? i * width + line : line * width + i];
      let sum = 0;
      for (let i = -radius; i <= radius; i++) sum += at(i);
      for (let i = 0; i < length; i++) {
        output[vertical ? i * width + line : line * width + i] =
          sum / (2 * radius + 1);
        sum += at(i + radius + 1) - at(i - radius);
      }
    }
    input = output;
  }
  return input;
}
function alphaEdges(rgba, width, height, s) {
  const original = new Uint8Array(width * height);
  for (let i = 0; i < original.length; i++) original[i] = rgba[i * 4 + 3];
  const coverage = erode(original, width, height, s.shrink),
    alpha = s.feather ? soften(coverage, width, height, s.feather) : coverage;
  for (let i = 0; i < original.length; i++) {
    const p = i * 4,
      a = original[i] / 255;
    if (s.matte !== "none" && a > 0 && a < 1)
      for (let c = 0; c < 3; c++)
        rgba[p + c] = Math.round(
          clamp((rgba[p + c] / 255 - (s.matte === "white" ? 1 - a : 0)) / a) *
            255,
        );
    rgba[p + 3] = Math.min(coverage[i], Math.round(alpha[i]));
  }
  return rgba;
}
const linear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const srgb = (x) =>
  x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
const linearBytes = Float64Array.from({ length: 256 }, (_, i) =>
  linear(i / 255),
);
function lighting(
  rgba,
  width,
  height,
  s,
  originX = 0,
  originY = 0,
  fullWidth = width,
  fullHeight = height,
) {
  if (!s.exposure) return rgba;
  const color = [1, 3, 5].map((i) =>
      linear(parseInt(s.color.slice(i, i + 2), 16) / 255),
    ),
    cx = (fullWidth * s.centerX) / 100,
    cy = (fullHeight * s.centerY) / 100,
    r = (Math.max(fullWidth, fullHeight) * s.radius) / 100,
    angle = (s.angle * Math.PI) / 180;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      if (!rgba[p + 3]) continue;
      const dx = x + originX + 0.5 - cx,
        dy = y + originY + 0.5 - cy,
        t = clamp(1 - Math.hypot(dx, dy) / r);
      if (!t) continue;
      const field =
        t *
        t *
        (3 - 2 * t) *
        (s.kind === "directional"
          ? clamp(0.5 + (dx * Math.cos(angle) + dy * Math.sin(angle)) / (2 * r))
          : 1);
      for (let c = 0; c < 3; c++)
        rgba[p + c] = Math.round(
          clamp(
            srgb(
              linearBytes[rgba[p + c]] * 2 ** (s.exposure * field * color[c]),
            ),
          ) * 255,
        );
    }
  return rgba;
}
module.exports = {
  operations,
  defaults,
  dimensions,
  outputGeometry,
  validateSettings,
  parseCube,
  applyLut,
  alphaEdges,
  lighting,
  enhancePixels,
  erode,
};
