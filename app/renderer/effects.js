import { distanceField, validateEffect } from "../core/effects.cjs";

const canvas = (w, h) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};
const clamp = (v) => Math.max(0, Math.min(1, v));
const order=['shadow','outerGlow','overlay','innerShadow','innerGlow','stroke'];
export function applyEffects(target, effects, scale = 1) {
  const active = (effects || []).filter((e) => e.enabled && e.opacity > 0).sort((a,b)=>order.indexOf(a.type)-order.indexOf(b.type));
  if (!active.length) return;
  active.forEach(validateEffect);
  const width = target.width,
    height = target.height,
    ctx = target.getContext("2d", { willReadFrequently: true }),
    original = ctx.getImageData(0, 0, width, height),
    alpha = Uint8Array.from(
      { length: width * height },
      (_, i) => original.data[i * 4 + 3],
    );
  if (!alpha.some((v) => v > 0)) return;
  const content = new ImageData(
      new Uint8ClampedArray(original.data),
      width,
      height,
    ),
    behind = canvas(width, height),
    front = canvas(width, height);
  let toInside, toOutside;
  const distance = (inside) =>
    inside
      ? (toInside ||= distanceField(alpha, width, height, true))
      : (toOutside ||= distanceField(alpha, width, height, false));
  const coverage = (e) => {
    const mask = new Uint8ClampedArray(width * height),
      r = (e.type === "stroke" ? e.size : e.spread || 0) * scale;
    if (e.type === "overlay") {
      mask.fill(255);
      return mask;
    }
    if (e.type === "stroke") {
      const inward =
          e.position === "inside" ? r : e.position === "center" ? r / 2 : 0,
        outward =
          e.position === "outside" ? r : e.position === "center" ? r / 2 : 0,
        di = inward ? distance(false) : null,
        doo = outward ? distance(true) : null;
      for (let i = 0; i < mask.length; i++)
        mask[i] =
          255 *
          (alpha[i] >= 128
            ? inward
              ? clamp(inward + 0.5 - Math.sqrt(di[i]))
              : 0
            : outward
              ? clamp(outward + 0.5 - Math.sqrt(doo[i]))
              : 0);
      return mask;
    }
    const inner = e.type === "innerGlow" || e.type === "innerShadow";
    const dist = r ? distance(inner ? false : true) : null;
    for (let i = 0; i < mask.length; i++)
      mask[i] = r
        ? inner
          ? Math.min(alpha[i], 255 * clamp(Math.sqrt(dist[i]) - 0.5 - r))
          : Math.max(alpha[i], 255 * clamp(r + 0.5 - Math.sqrt(dist[i])))
        : alpha[i];
    const seed = canvas(width, height),
      blurred = canvas(width, height),
      s = seed.getContext("2d", { willReadFrequently: true }),
      b = blurred.getContext("2d", { willReadFrequently: true }),
      image = s.createImageData(width, height);
    try {
      for (let i = 0; i < mask.length; i++) image.data[i * 4 + 3] = mask[i];
      s.putImageData(image, 0, 0);
      b.filter = `blur(${(e.radius || 0) * scale}px)`;
      const angle = ((e.angle || 0) * Math.PI) / 180,
        dx = Math.cos(angle) * (e.distance || 0) * scale,
        dy = Math.sin(angle) * (e.distance || 0) * scale;
      b.drawImage(seed, dx, dy);
      const pixels = b.getImageData(0, 0, width, height).data;
      for (let i = 0; i < mask.length; i++)
        mask[i] = inner ? 255 - pixels[i * 4 + 3] : pixels[i * 4 + 3];
      return mask;
    } finally {
      seed.width = seed.height = blurred.width = blurred.height = 1;
    }
  };
  const colorPixels = (data, color, blend) => {
    const mixed = canvas(width, height),
      m = mixed.getContext("2d", { willReadFrequently: true }),
      opaque = new ImageData(new Uint8ClampedArray(data), width, height);
    try {
      for (let i = 3; i < opaque.data.length; i += 4) opaque.data[i] = 255;
      m.putImageData(opaque, 0, 0);
      m.globalCompositeOperation = blend;
      m.fillStyle = color;
      m.fillRect(0, 0, width, height);
      return m.getImageData(0, 0, width, height).data;
    } finally {
      mixed.width = mixed.height = 1;
    }
  };
  try {
    for (const e of active) {
      const mask = coverage(e),
        opacity = e.opacity / 100,
        inner =
          e.type === "overlay" ||
          e.type === "innerGlow" ||
          e.type === "innerShadow" ||
          e.type === "stroke";
      if (inner) {
        const mixed = colorPixels(content.data, e.color, e.blend);
        for (let i = 0; i < mask.length; i++) {
          if (!alpha[i]) continue;
          const weight = (mask[i] / 255) * opacity;
          for (let c = 0; c < 3; c++)
            content.data[i * 4 + c] +=
              (mixed[i * 4 + c] - content.data[i * 4 + c]) * weight;
        }
      }
      if (!inner || (e.type === "stroke" && e.position !== "inside")) {
        const color = [1, 3, 5].map((i) =>
            parseInt(e.color.slice(i, i + 2), 16),
          ),
          paint = canvas(width, height),
          p = paint.getContext("2d", { willReadFrequently: true }),
          rgba = p.createImageData(width, height);
        try {
          for (let i = 0; i < mask.length; i++) {
            for (let c = 0; c < 3; c++) rgba.data[i * 4 + c] = color[c];
            rgba.data[i * 4 + 3] =
              mask[i] *
              opacity *
              (e.type === "stroke" ? 1 - alpha[i] / 255 : 1);
          }
          p.putImageData(rgba, 0, 0);
          const b = behind.getContext("2d", { willReadFrequently: true });
          b.globalCompositeOperation = e.blend;
          b.drawImage(paint, 0, 0);
        } finally {
          paint.width = paint.height = 1;
        }
      }
    }
    const f = front.getContext("2d", { willReadFrequently: true });
    f.putImageData(content, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(behind, 0, 0);
    ctx.drawImage(front, 0, 0);
  } finally {
    behind.width = behind.height = front.width = front.height = 1;
  }
}
