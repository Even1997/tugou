const fields = {
  brightnessContrast: {
    label: "亮度与对比度",
    values: {
      brightness: ["亮度", 0, -100, 100],
      contrast: ["对比度", 0, -100, 100],
    },
  },
  hueSaturation: {
    label: "色相与饱和度",
    values: {
      hue: ["色相", 0, -180, 180],
      saturation: ["饱和度", 0, -100, 100],
      lightness: ["明度", 0, -100, 100],
    },
  },
  levels: {
    label: "色阶",
    values: {
      black: ["输入黑场", 0, 0, 254],
      white: ["输入白场", 255, 1, 255],
      gamma: ["中间调", 1, 0.1, 10, 0.01],
      outputBlack: ["输出黑场", 0, 0, 255],
      outputWhite: ["输出白场", 255, 0, 255],
    },
  },
  curves: { label: "曲线", values: {} },
  exposure: {
    label: "曝光",
    values: {
      exposure: ["曝光补偿", 0, -10, 10, 0.1],
      offset: ["偏移", 0, -0.5, 0.5, 0.01],
      gamma: ["伽马", 1, 0.1, 10, 0.01],
    },
  },
  gradientMap: { label: "渐变映射", values: {} },
  blackWhite: {
    label: "黑白",
    values: {
      red: ["红色权重", 30, -200, 200],
      green: ["绿色权重", 59, -200, 200],
      blue: ["蓝色权重", 11, -200, 200],
    },
  },
  colorBalance: {
    label: "色彩平衡",
    values: {
      red: ["青色—红色", 0, -100, 100],
      green: ["洋红—绿色", 0, -100, 100],
      blue: ["黄色—蓝色", 0, -100, 100],
    },
  },
  grain: {
    label: "颗粒",
    values: { amount: ["颗粒强度", 10, 0, 100], size: ["颗粒大小", 2, 1, 30] },
  },
  invert: { label: "反相", values: {} },
  noise: { label: "噪点", values: { amount: ["噪点强度", 10, 0, 100] } },
  blur: { label: "高斯模糊", values: { radius: ["模糊半径", 5, 0, 200, 0.1] } },
};
const clamp = (v, a = 0, b = 255) => Math.max(a, Math.min(b, v));
function defaults(type) {
  const spec = fields[type];
  if (!spec) throw new Error("不支持的调整类型");
  return {
    type,
    ...Object.fromEntries(
      Object.entries(spec.values).map(([k, v]) => [k, v[1]]),
    ),
    ...(type === "curves"
      ? {
          channels: Object.fromEntries(
            ["rgb", "red", "green", "blue"].map((k) => [
              k,
              [
                [0, 0],
                [255, 255],
              ],
            ]),
          ),
        }
      : {}),
    ...(type === "gradientMap" ? { dark: "#000000", light: "#ffffff" } : {}),
    ...(type === "colorBalance"
      ? { range: "midtones", preserveLightness: true }
      : {}),
    ...(["noise", "grain"].includes(type) ? { monochrome: true, seed: 1 } : {}),
  };
}
function validateAdjustment(value) {
  if (!value || !fields[value.type]) throw new Error("不支持的调整类型");
  for (const [key, [, , min, max]] of Object.entries(fields[value.type].values))
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max)
      throw new Error("调整参数超出范围：" + key);
  if (value.type === "levels" && value.black >= value.white)
    throw new Error("输入黑场必须小于白场");
  if (value.type === "curves")
    for (const key of ["rgb", "red", "green", "blue"]) {
      const points = value.channels?.[key];
      if (
        !Array.isArray(points) ||
        points.length < 2 ||
        points.length > 32 ||
        points[0]?.[0] !== 0 ||
        points.at(-1)?.[0] !== 255 ||
        points.some(
          (p, i) =>
            !Array.isArray(p) ||
            p.length !== 2 ||
            p.some((n) => !Number.isFinite(n) || n < 0 || n > 255) ||
            (i && p[0] <= points[i - 1][0]),
        )
      )
        throw new Error("曲线控制点无效");
    }
  if (
    value.type === "gradientMap" &&
    [value.dark, value.light].some((c) => !/^#[a-f0-9]{6}$/i.test(c))
  )
    throw new Error("渐变颜色无效");
  if (
    value.type === "colorBalance" &&
    !["shadows", "midtones", "highlights"].includes(value.range)
  )
    throw new Error("色彩平衡范围无效");
  if (
    ["noise", "grain"].includes(value.type) &&
    (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 2147483647)
  )
    throw new Error("噪点种子无效");
  return value;
}
function curveTable(points) {
  // Monotone cubic interpolation prevents overshoot between neighbouring controls.
  const slopes = points
    .slice(1)
    .map((p, i) => (p[1] - points[i][1]) / (p[0] - points[i][0]));
  const tangent = points.map((_, i) =>
    i === 0
      ? slopes[0]
      : i === points.length - 1
        ? slopes.at(-1)
        : slopes[i - 1] * slopes[i] <= 0
          ? 0
          : 2 / (1 / slopes[i - 1] + 1 / slopes[i]),
  );
  return Uint8ClampedArray.from({ length: 256 }, (_, x) => {
    let i = 0;
    while (i < points.length - 2 && x > points[i + 1][0]) i++;
    const a = points[i],
      b = points[i + 1],
      h = b[0] - a[0],
      t = (x - a[0]) / h;
    return clamp(
      (2 * t ** 3 - 3 * t * t + 1) * a[1] +
        (t ** 3 - 2 * t * t + t) * h * tangent[i] +
        (-2 * t ** 3 + 3 * t * t) * b[1] +
        (t ** 3 - t * t) * h * tangent[i + 1],
      Math.min(a[1], b[1]),
      Math.max(a[1], b[1]),
    );
  });
}
function noise(x, y, seed) {
  let n =
    Math.imul(x | 0, 374761393) ^
    Math.imul(y | 0, 668265263) ^
    Math.imul(seed, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295 - 0.5;
}
function adjustPixels(data, width, a, { scale = 1, x = 0, y = 0 } = {}) {
  validateAdjustment(a);
  const type = a.type;
  const lut = ["levels", "exposure", "brightnessContrast", "invert"].includes(
    type,
  )
    ? Uint8ClampedArray.from({ length: 256 }, (_, v) => {
        if (type === "invert") return 255 - v;
        if (type === "exposure")
          return (
            255 *
            Math.pow(
              clamp((v / 255) * 2 ** a.exposure + a.offset, 0, 1),
              1 / a.gamma,
            )
          );
        if (type === "levels")
          return (
            a.outputBlack +
            (a.outputWhite - a.outputBlack) *
              Math.pow(
                clamp((v - a.black) / (a.white - a.black), 0, 1),
                1 / a.gamma,
              )
          );
        const c =
          (259 * (a.contrast * 2.55 + 255)) / (255 * (259 - a.contrast * 2.55));
        return c * (v - 128) + 128 + a.brightness * 2.55;
      })
    : null;
  const curves =
    type === "curves"
      ? ["red", "green", "blue"].map((k) => {
          const master = curveTable(a.channels.rgb),
            channel = curveTable(a.channels[k]);
          return Uint8ClampedArray.from(master, (v) => channel[v]);
        })
      : null;
  const colors =
    type === "gradientMap"
      ? [a.dark, a.light].map((c) =>
          [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)),
        )
      : null;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    if (lut) {
      data[i] = lut[r];
      data[i + 1] = lut[g];
      data[i + 2] = lut[b];
      continue;
    }
    if (curves) {
      data[i] = curves[0][r];
      data[i + 1] = curves[1][g];
      data[i + 2] = curves[2][b];
      continue;
    }
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (type === "blackWhite") {
      data[i] =
        data[i + 1] =
        data[i + 2] =
          (a.red * r + a.green * g + a.blue * b) / 100;
      continue;
    }
    if (type === "gradientMap") {
      for (let c = 0; c < 3; c++)
        data[i + c] =
          colors[0][c] + ((colors[1][c] - colors[0][c]) * luminance) / 255;
      continue;
    }
    if (type === "hueSaturation") {
      const max = Math.max(r, g, b) / 255,
        min = Math.min(r, g, b) / 255,
        d = max - min,
        L = (max + min) / 2;
      let h =
        d === 0
          ? 0
          : max === r / 255
            ? ((g - b) / 255 / d) % 6
            : max === g / 255
              ? (b - r) / 255 / d + 2
              : (r - g) / 255 / d + 4;
      h = (((h + a.hue / 60) % 6) + 6) % 6;
      const s = clamp(
          (d === 0 ? 0 : d / (1 - Math.abs(2 * L - 1))) *
            (1 + a.saturation / 100),
          0,
          1,
        ),
        light = clamp(L + a.lightness / 100, 0, 1),
        chroma = (1 - Math.abs(2 * light - 1)) * s,
        t = chroma * (1 - Math.abs((h % 2) - 1)),
        m = light - chroma / 2;
      const rgb =
        h < 1
          ? [chroma, t, 0]
          : h < 2
            ? [t, chroma, 0]
            : h < 3
              ? [0, chroma, t]
              : h < 4
                ? [0, t, chroma]
                : h < 5
                  ? [t, 0, chroma]
                  : [chroma, 0, t];
      for (let c = 0; c < 3; c++) data[i + c] = (rgb[c] + m) * 255;
    } else if (type === "colorBalance") {
      const l = luminance / 255,
        weight =
          a.range === "shadows"
            ? (1 - l) ** 2
            : a.range === "highlights"
              ? l * l
              : 4 * l * (1 - l),
        v = [r + a.red * weight, g + a.green * weight, b + a.blue * weight];
      const delta = a.preserveLightness
        ? luminance - (0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2])
        : 0;
      for (let c = 0; c < 3; c++) data[i + c] = v[c] + delta;
    } else if (type === "grain" || type === "noise") {
      const index = i / 4,
        size = type === "grain" ? a.size : 1,
        px = Math.floor((x + (index % width) / scale) / size),
        py = Math.floor((y + Math.floor(index / width) / scale) / size);
      for (let c = 0; c < 3; c++)
        data[i + c] +=
          noise(px, py, a.seed + (a.monochrome ? 0 : c * 107)) *
          a.amount *
          2.55;
    }
  }
  return data;
}
module.exports = {
  fields,
  defaults,
  validateAdjustment,
  curveTable,
  adjustPixels,
};
