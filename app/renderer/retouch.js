import { inherited, localPoint } from "../core/layers.cjs";
import { surface, selectionCanvas } from "./selection.js";

export const retouchTools = [
  ["clone", "仿制图章"],
  ["heal", "修复"],
  ["blur", "模糊"],
  ["smudge", "涂抹"],
  ["liquify", "液化"],
];
export const isBrushTool = (tool) =>
  ["brush", "eraser", ...retouchTools.map(([id]) => id)].includes(tool);
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const yieldFrame = () => new Promise((resolve) => setTimeout(resolve, 0));

// Bilinear sampling and mixing use premultiplied colors to protect alpha edges.
function sample(data, w, h, x, y, out) {
  x = clamp(x, 0, w - 1);
  y = clamp(y, 0, h - 1);
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy;
  out.fill(0);
  for (let index = 0; index < 4; index++) {
    const right = index % 2,
      bottom = index > 1,
      px = right ? Math.min(ix + 1, w - 1) : ix,
      py = bottom ? Math.min(iy + 1, h - 1) : iy,
      weight = (right ? fx : 1 - fx) * (bottom ? fy : 1 - fy);
    const n = (py * w + px) * 4,
      a = data[n + 3] / 255;
    out[3] += a * weight;
    for (let k = 0; k < 3; k++) out[k] += data[n + k] * a * weight;
  }
  return out;
}
function mix(data, n, source, weight) {
  const a = data[n + 3] / 255,
    alpha = a * (1 - weight) + source[3] * weight;
  for (let k = 0; k < 3; k++)
    data[n + k] = alpha
      ? (data[n + k] * a * (1 - weight) + source[k] * weight) / alpha
      : 0;
  data[n + 3] = alpha * 255;
}

export async function createRetouchStroke(doc, layer, engine, options) {
  if (!layer || layer.kind !== "image")
    throw new Error("请选择图片图层进行修图");
  if (
    inherited(doc.layers, layer, "locked") ||
    inherited(doc.layers, layer, "hidden")
  )
    throw new Error("请先显示并解锁图层及所属分组");
  const image = await engine.image(
    layer.bitmap || doc.assets.find((a) => a.id === layer.assetId),
  );
  const width = image.naturalWidth,
    height = image.naturalHeight;
  const output = surface(width, height),
    ctx = output.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const scratch = surface(1, 1),
    coverage = new Map();
  let disposed = false,
    last,
    filtered,
    offset,
    correction = [0, 0, 0],
    mask,
    maskContext,
    peakPatchBytes = 0;
  const abort = () => {
    if (disposed) throw new DOMException("已取消", "AbortError");
  };
  const local = (p) => {
    const q = localPoint(doc.layers, layer, p.x, p.y);
    return {
      x: (q.x / layer.width) * width,
      y: (q.y / layer.height) * height,
      pressure:
        options.pressure && p.pointerType === "pen"
          ? Math.max(0.05, p.pressure || 0.05)
          : 1,
    };
  };
  if (doc.selection) {
    const world = await selectionCanvas(doc, engine);
    mask = surface(width, height);
    const warp = [
      [0, 0],
      [doc.width, 0],
      [doc.width, doc.height],
      [0, doc.height],
    ].flatMap(([x, y]) => {
      const p = localPoint(doc.layers, layer, x, y);
      return [p.x / layer.width, p.y / layer.height];
    });
    engine.geometry(
      mask.getContext("2d"),
      world,
      { width, height, warp },
      [1, 0, 0, 1, 0, 0],
    );
    world.width = world.height = 1;
    maskContext = mask.getContext("2d", { willReadFrequently: true });
  }
  const read = (source, x, y, w, h, blur = 0) => {
    scratch.width = w;
    scratch.height = h;
    const c = scratch.getContext("2d", { willReadFrequently: true });
    if (blur) c.filter = `blur(${blur}px)`;
    // Draw in original coordinates; the scratch bounds clip without rescaling.
    c.drawImage(source, -x, -y);
    return c.getImageData(0, 0, w, h);
  };
  const ring = (p) => {
    const r = options.size * 0.6,
      colors = [];
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2,
        x = Math.round(p.x + Math.cos(angle) * r),
        y = Math.round(p.y + Math.sin(angle) * r);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const rgba = read(image, x, y, 1, 1).data;
      if (rgba[3] > 240) colors.push([...rgba.slice(0, 3)]);
    }
    if (colors.length < 16) return null;
    const mean = [0, 1, 2].map(
      (k) => colors.reduce((sum, c) => sum + c[k], 0) / colors.length,
    );
    return { colors, mean };
  };
  const prepareSource = async (p) => {
    let source = options.source
      ? { x: options.source.u * width, y: options.source.v * height }
      : null;
    if (options.tool === "clone" && !source)
      throw new Error("先按 Alt 点击或使用“设置来源”取样");
    if (options.aligned && options.source?.offset)
      offset = {
        x: options.source.offset.u * width,
        y: options.source.offset.v * height,
      };
    else if (source) offset = { x: source.x - p.x, y: source.y - p.y };
    if (options.tool !== "heal") return;
    const target = ring(p);
    if (!target)
      throw new Error("修复边缘缺少不透明像素，请减小笔刷或改用仿制");
    if (!source) {
      let best = Infinity;
      for (const distance of [1.5, 2.5])
        for (let i = 0; i < 12; i++) {
          await yieldFrame();
          abort();
          const angle = (i / 12) * Math.PI * 2,
            q = {
              x: p.x + Math.cos(angle) * options.size * distance,
              y: p.y + Math.sin(angle) * options.size * distance,
            };
          if (
            q.x - options.size / 2 < 0 ||
            q.y - options.size / 2 < 0 ||
            q.x + options.size / 2 >= width ||
            q.y + options.size / 2 >= height
          )
            continue;
          const candidate = ring(q);
          if (!candidate) continue;
          const center = read(
            image,
            Math.round(q.x),
            Math.round(q.y),
            1,
            1,
          ).data;
          if (center[3] < 240) continue;
          const score =
            candidate.colors.reduce(
              (sum, c, j) =>
                sum +
                c.reduce(
                  (s, v, k) =>
                    s +
                    Math.abs(
                      v -
                        candidate.mean[k] -
                        (target.colors[j % target.colors.length][k] -
                          target.mean[k]),
                    ),
                  0,
                ),
              0,
            ) / candidate.colors.length;
          if (score < best) {
            best = score;
            source = q;
          }
        }
      if (!source) throw new Error("附近没有合适纹理，请减小笔刷或设置来源");
      offset = { x: source.x - p.x, y: source.y - p.y };
    }
    const sourceRing = ring({ x: p.x + offset.x, y: p.y + offset.y });
    if (!sourceRing) throw new Error("来源纹理不足，请重新设置来源");
    correction = target.mean.map((v, k) => v - sourceRing.mean[k]);
  };
  const maximum = (x, y, value) => {
    const tx = Math.floor(x / 256),
      ty = Math.floor(y / 256),
      key = `${tx},${ty}`;
    if (!coverage.has(key)) coverage.set(key, new Float32Array(256 * 256));
    const tile = coverage.get(key),
      n = (y % 256) * 256 + (x % 256);
    if (value <= tile[n]) return false;
    tile[n] = value;
    return true;
  };
  const stamp = async (p, previous) => {
    abort();
    const r = Math.max(0.5, (options.size * p.pressure) / 2),
      x = Math.max(0, Math.floor(p.x - r)),
      y = Math.max(0, Math.floor(p.y - r)),
      right = Math.min(width, Math.ceil(p.x + r)),
      bottom = Math.min(height, Math.ceil(p.y + r)),
      w = right - x,
      h = bottom - y;
    if (w <= 0 || h <= 0) return;
    const moving = ["smudge", "liquify"].includes(options.tool),
      dx = previous ? p.x - previous.x : 0,
      dy = previous ? p.y - previous.y : 0;
    if (moving && !Math.hypot(dx, dy)) return;
    const target = moving
        ? ctx.getImageData(x, y, w, h)
        : read(image, x, y, w, h),
      result = ctx.getImageData(x, y, w, h);
    const selection = maskContext?.getImageData(x, y, w, h).data;
    let source,
      originX,
      originY,
      padding = 0;
    if (options.tool === "clone" || options.tool === "heal") {
      originX = Math.floor(x + offset.x) - 1;
      originY = Math.floor(y + offset.y) - 1;
      source = read(image, originX, originY, w + 3, h + 3);
    } else if (options.tool === "blur") {
      padding = Math.ceil(options.blurRadius * 3);
      originX = x - padding;
      originY = y - padding;
      source = read(
        image,
        originX,
        originY,
        w + padding * 2,
        h + padding * 2,
        options.blurRadius,
      );
    } else {
      padding = Math.ceil(Math.hypot(dx, dy)) + 2;
      originX = Math.max(0, x - padding);
      originY = Math.max(0, y - padding);
      source = ctx.getImageData(
        originX,
        originY,
        Math.min(width - originX, w + padding * 2),
        Math.min(height - originY, h + padding * 2),
      );
    }
    const hardness = Math.min(0.99, options.hardness / 100),
      strength = options.opacity / 100;
    peakPatchBytes = Math.max(
      peakPatchBytes,
      target.data.byteLength +
        result.data.byteLength +
        source.data.byteLength +
        (selection?.byteLength || 0),
    );
    const color = [0, 0, 0, 0];
    for (let row = 0; row < h; row++) {
      if (row % 32 === 0) {
        await yieldFrame();
        abort();
      }
      for (let col = 0; col < w; col++) {
        const gx = x + col,
          gy = y + row,
          n = (row * w + col) * 4,
          d = Math.hypot(gx + 0.5 - p.x, gy + 0.5 - p.y) / r;
        if (d >= 1) continue;
        const falloff = d <= hardness ? 1 : 1 - (d - hardness) / (1 - hardness),
          selected = selection ? selection[n + 3] / 255 : 1;
        const weight = falloff * strength * selected;
        if (!weight) continue;
        if (!moving && !maximum(gx, gy, weight)) continue;
        let sx = gx - originX,
          sy = gy - originY;
        if (options.tool === "clone" || options.tool === "heal") {
          sx += offset.x;
          sy += offset.y;
        } else if (options.tool === "smudge") {
          sx -= dx;
          sy -= dy;
        } else if (options.tool === "liquify") {
          const pull = (1 - d * d) ** 2 * strength;
          sx -= dx * pull;
          sy -= dy * pull;
        }
        sample(source.data, source.width, source.height, sx, sy, color);
        if (options.tool === "heal") {
          if (color[3] < 0.01) continue;
          const alpha = target.data[n + 3] / 255;
          for (let k = 0; k < 3; k++)
            color[k] =
              clamp(color[k] / color[3] + correction[k], 0, 255) * alpha;
          color[3] = alpha;
        }
        for (let k = 0; k < 4; k++) result.data[n + k] = target.data[n + k];
        mix(
          result.data,
          n,
          color,
          options.tool === "liquify" ? selected : weight,
        );
      }
    }
    abort();
    ctx.putImageData(result, x, y);
  };
  return {
    canvas: output,
    async add(point) {
      abort();
      const p = local(point);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      if (!last) {
        last = filtered = p;
        if (["clone", "heal"].includes(options.tool)) await prepareSource(p);
        await stamp(p);
        return;
      }
      const follow = 1 - (options.smoothing / 100) * 0.9;
      filtered = {
        x: filtered.x + (p.x - filtered.x) * follow,
        y: filtered.y + (p.y - filtered.y) * follow,
        pressure: p.pressure,
      };
      // Limit work to a clipped brush envelope, including when perspective
      // sends off-canvas coordinates far beyond the image.
      const dx = filtered.x - last.x,
        dy = filtered.y - last.y,
        margin = options.size / 2;
      let from = 0,
        to = 1;
      for (const [a, b] of [
        [-dx, last.x + margin],
        [dx, width + margin - last.x],
        [-dy, last.y + margin],
        [dy, height + margin - last.y],
      ]) {
        if (!a) {
          if (b < 0) {
            last = filtered;
            return;
          }
          continue;
        }
        if (a < 0) from = Math.max(from, b / a);
        else to = Math.min(to, b / a);
      }
      const count = Math.max(
        1,
        Math.ceil(
          (Math.hypot(dx, dy) * Math.max(0, to - from)) /
            Math.max(2, options.size * 0.2),
        ),
      );
      let previous = { ...last, x: last.x + dx * from, y: last.y + dy * from };
      if (from <= to)
        for (let i = 1; i <= count; i++) {
          const t = from + ((to - from) * i) / count,
            q = {
              x: last.x + dx * t,
              y: last.y + dy * t,
              pressure: last.pressure + (filtered.pressure - last.pressure) * t,
            };
          await stamp(q, previous);
          previous = q;
        }
      last = filtered;
    },
    render() {
      return output;
    },
    dispose() {
      disposed = true;
      output.width = output.height = scratch.width = scratch.height = 1;
      if (mask) mask.width = mask.height = 1;
      coverage.clear();
    },
    get workingBytes() {
      return (
        (output.width * output.height +
          scratch.width * scratch.height +
          (mask ? mask.width * mask.height : 0)) *
          4 +
        coverage.size * 256 * 256 * 4 +
        peakPatchBytes
      );
    },
  };
}
