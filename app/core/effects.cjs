const types = {
  stroke: { label: "描边", values: { size: ["描边宽度", 4, 0, 200, 0.5] } },
  shadow: {
    label: "投影",
    values: {
      radius: ["模糊半径", 12, 0, 200, 0.5],
      distance: ["距离", 12, 0, 500, 0.5],
      angle: ["角度", 90, -180, 180],
      spread: ["扩展", 0, 0, 200, 0.5],
    },
  },
  overlay: { label: "颜色叠加", values: {} },
  innerShadow: {
    label: "内阴影",
    values: {
      radius: ["模糊半径", 8, 0, 200, 0.5],
      distance: ["距离", 6, 0, 500, 0.5],
      angle: ["角度", 90, -180, 180],
      spread: ["扩展", 0, 0, 200, 0.5],
    },
  },
  innerGlow: {
    label: "内发光",
    values: {
      radius: ["发光半径", 12, 0, 200, 0.5],
      spread: ["扩展", 0, 0, 200, 0.5],
    },
  },
  outerGlow: {
    label: "外发光",
    values: {
      radius: ["发光半径", 12, 0, 200, 0.5],
      spread: ["扩展", 0, 0, 200, 0.5],
    },
  },
};
const blends = [
  "source-over",
  "multiply",
  "screen",
  "overlay",
  "soft-light",
  "hard-light",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];
function defaults(type) {
  if (!types[type]) throw new Error("不支持的特效类型");
  return {
    id: crypto.randomUUID(),
    type,
    enabled: true,
    color: type.includes("Glow") ? "#ffffff" : "#000000",
    opacity: type === "shadow" || type === "innerShadow" ? 50 : 100,
    blend: "source-over",
    ...Object.fromEntries(
      Object.entries(types[type].values).map(([k, v]) => [k, v[1]]),
    ),
    ...(type === "stroke" ? { position: "outside" } : {}),
  };
}
function validateEffect(e) {
  if (!e || !types[e.type] || typeof e.id !== "string")
    throw new Error("特效类型或标识无效");
  if (
    typeof e.enabled !== "boolean" ||
    !Number.isFinite(e.opacity) ||
    e.opacity < 0 ||
    e.opacity > 100 ||
    !/^#[a-f0-9]{6}$/i.test(e.color) ||
    !blends.includes(e.blend)
  )
    throw new Error("特效颜色、透明度或混合模式无效");
  for (const [k, [, , min, max]] of Object.entries(types[e.type].values))
    if (!Number.isFinite(e[k]) || e[k] < min || e[k] > max)
      throw new Error("特效参数超出范围：" + k);
  if (
    e.type === "stroke" &&
    !["inside", "center", "outside"].includes(e.position)
  )
    throw new Error("描边位置无效");
  return e;
}
function effectPadding(e) {
  if (!e.enabled || !e.opacity || e.type === "overlay") return 0;
  if (e.type === "stroke") return e.size;
  return (e.radius || 0) * 4 + (e.spread || 0) + (e.distance || 0) + 2;
}
// Exact squared Euclidean distance: lower envelopes of parabolas in each axis.
// The finite sentinel also handles fully empty/opaque tiles without NaN.
function distanceField(alpha, width, height, inside) {
  const out = new Float32Array(width * height),
    limit = 1e12,
    length = Math.max(width, height),
    f = new Float64Array(length),
    v = new Int32Array(length),
    z = new Float64Array(length + 1),
    d = new Float64Array(length);
  const line = (n) => {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
      while (s <= z[k] && k > 0) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) ** 2 + f[v[k]];
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++)
      f[x] = alpha[y * width + x] >= 128 === inside ? 0 : limit;
    line(width);
    for (let x = 0; x < width; x++) out[y * width + x] = d[x];
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = out[y * width + x];
    line(height);
    for (let y = 0; y < height; y++) out[y * width + x] = d[y];
  }
  return out;
}
module.exports = {
  types,
  blends,
  defaults,
  validateEffect,
  effectPadding,
  distanceField,
};
