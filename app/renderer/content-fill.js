import { inherited, localPoint } from "../core/layers.cjs";
import { surface, alphaOf } from "./selection.js";

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
function maskRegion(doc, bitmap, box) {
  const margin = Math.ceil((doc.selection.feather || 0) * 3) + 2,
    base = surface(box.width + margin * 2, box.height + margin * 2),
    ctx = base.getContext("2d"),
    x = box.x - margin,
    y = box.y - margin;
  ctx.beginPath();
  ctx.rect(-x, -y, doc.width, doc.height);
  ctx.clip();
  if (bitmap) ctx.drawImage(bitmap, -x, -y, doc.width, doc.height);
  for (const path of doc.selection.paths || []) {
    const tmp = surface(base.width, base.height),
      c = tmp.getContext("2d");
    c.translate(-x, -y);
    c.beginPath();
    for (let i = 0; i < path.points.length; i += 2)
      i
        ? c.lineTo(path.points[i], path.points[i + 1])
        : c.moveTo(path.points[i], path.points[i + 1]);
    c.closePath();
    c.fill();
    ctx.globalCompositeOperation =
      path.operation === "subtract"
        ? "destination-out"
        : path.operation === "intersect"
          ? "destination-in"
          : "source-over";
    ctx.drawImage(tmp, 0, 0);
    tmp.width = tmp.height = 1;
  }
  if (doc.selection.inverted) {
    ctx.globalCompositeOperation = "source-out";
    ctx.fillRect(-x, -y, doc.width, doc.height);
  }
  const out = surface(box.width, box.height),
    c = out.getContext("2d");
  if (doc.selection.feather) c.filter = `blur(${doc.selection.feather}px)`;
  c.drawImage(base, -margin, -margin);
  base.width = base.height = 1;
  return out;
}
function alphaBounds(rgba, w, h) {
  let left = w,
    top = h,
    right = 0,
    bottom = 0;
  for (let i = 0; i < w * h; i++)
    if (rgba[i * 4 + 3]) {
      left = Math.min(left, i % w);
      top = Math.min(top, Math.floor(i / w));
      right = Math.max(right, (i % w) + 1);
      bottom = Math.max(bottom, Math.floor(i / w) + 1);
    }
  return right
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
}
async function selectionBounds(doc, bitmap, signal) {
  let rough = { x: 0, y: 0, width: doc.width, height: doc.height };
  if (!bitmap && !doc.selection.inverted) {
    let left = Infinity,
      top = Infinity,
      right = -Infinity,
      bottom = -Infinity;
    for (const path of doc.selection.paths || [])
      for (let i = 0; i < path.points.length; i += 2) {
        left = Math.min(left, path.points[i]);
        right = Math.max(right, path.points[i]);
        top = Math.min(top, path.points[i + 1]);
        bottom = Math.max(bottom, path.points[i + 1]);
      }
    if (!Number.isFinite(left)) throw new Error("选区为空");
    const margin = Math.ceil((doc.selection.feather || 0) * 3) + 2,
      x = Math.max(0, Math.floor(left - margin)),
      y = Math.max(0, Math.floor(top - margin));
    rough = {
      x,
      y,
      width: Math.min(doc.width, Math.ceil(right + margin)) - x,
      height: Math.min(doc.height, Math.ceil(bottom + margin)) - y,
    };
  }
  let left = Infinity,
    top = Infinity,
    right = 0,
    bottom = 0;
  for (let y = rough.y; y < rough.y + rough.height; y += 256) {
    signal?.throwIfAborted();
    await pause();
    for (let x = rough.x; x < rough.x + rough.width; x += 256) {
      const box = {
          x,
          y,
          width: Math.min(256, rough.x + rough.width - x),
          height: Math.min(256, rough.y + rough.height - y),
        },
        c = maskRegion(doc, bitmap, box),
        b = alphaBounds(
          c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
          c.width,
          c.height,
        );
      c.width = c.height = 1;
      if (b) {
        left = Math.min(left, x + b.x);
        top = Math.min(top, y + b.y);
        right = Math.max(right, x + b.x + b.width);
        bottom = Math.max(bottom, y + b.y + b.height);
      }
    }
  }
  if (!right) throw new Error("选区为空");
  return { x: left, y: top, width: right - left, height: bottom - top };
}
export function calculateFill(data, signal, progress = () => {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
        new URL("./content-fill-worker.js", document.baseURI),
      ),
      close = () => {
        worker.terminate();
        signal?.removeEventListener("abort", abort);
      },
      abort = () => {
        close();
        reject(new DOMException("已取消", "AbortError"));
      };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({ data }) => {
      if (data.progress !== undefined) {
        progress(data.progress);
        return;
      }
      close();
      data.error ? reject(new Error(data.error)) : resolve(data);
    };
    worker.onerror = (e) => {
      close();
      reject(new Error(e.message || "纹理计算失败"));
    };
    worker.postMessage(data, [data.rgba.buffer, data.mask.buffer]);
  });
}
export async function fillImageSelection(doc, layer, engine, signal, progress) {
  if (!layer || layer.kind !== "image" || !doc.selection)
    throw new Error("请选择图片图层并建立选区");
  if (
    inherited(doc.layers, layer, "locked") ||
    inherited(doc.layers, layer, "hidden")
  )
    throw new Error("请先显示并解锁图层及所属分组");
  const image = await engine.image(
      layer.bitmap || doc.assets.find((a) => a.id === layer.assetId),
    ),
    width = image.naturalWidth,
    height = image.naturalHeight,
    bitmap = doc.selection.bitmap
      ? await engine.image(doc.selection.bitmap)
      : null;
  signal?.throwIfAborted();
  const world = await selectionBounds(doc, bitmap, signal);
  const map = (x, y) => {
    const p = localPoint(doc.layers, layer, x, y);
    return { x: (p.x / layer.width) * width, y: (p.y / layer.height) * height };
  };
  const corners = [
    [world.x, world.y],
    [world.x + world.width, world.y],
    [world.x + world.width, world.y + world.height],
    [world.x, world.y + world.height],
  ].map(([x, y]) => map(x, y));
  if (corners.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    throw new Error("选区跨过透视边界，请调整选区");
  const x = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.x))) - 2),
    y = Math.max(0, Math.floor(Math.min(...corners.map((p) => p.y))) - 2),
    right = Math.min(
      width,
      Math.ceil(Math.max(...corners.map((p) => p.x))) + 2,
    ),
    bottom = Math.min(
      height,
      Math.ceil(Math.max(...corners.map((p) => p.y))) + 2,
    );
  if (right <= x || bottom <= y) throw new Error("选区未覆盖当前图片");
  const padding = Math.max(
      32,
      Math.ceil(Math.max(right - x, bottom - y) * 1.25),
    ),
    roi = { x: Math.max(0, x - padding), y: Math.max(0, y - padding) };
  roi.width = Math.min(width, right + padding) - roi.x;
  roi.height = Math.min(height, bottom + padding) - roi.y;
  if (roi.width * roi.height > 4000000)
    throw new Error("选区与周围取样超过400万像素，请缩小选区");
  // Render only world tiles that overlap this layer ROI. A tiled source also
  // keeps selection preparation bounded on very large documents.
  const mask = surface(roi.width, roi.height),
    maskContext = mask.getContext("2d");
  let alpha;
  try {
    for (let wy = world.y; wy < world.y + world.height; wy += 512) {
      signal?.throwIfAborted();
      await pause();
      signal?.throwIfAborted();
      for (let wx = world.x; wx < world.x + world.width; wx += 512) {
        const tile = {
            x: wx,
            y: wy,
            width: Math.min(512, world.x + world.width - wx),
            height: Math.min(512, world.y + world.height - wy),
          },
          source = maskRegion(doc, bitmap, tile),
          points = [
            [wx, wy],
            [wx + tile.width, wy],
            [wx + tile.width, wy + tile.height],
            [wx, wy + tile.height],
          ].map(([x, y]) => {
            const p = map(x, y);
            return { x: p.x - roi.x, y: p.y - roi.y };
          });
        try {
          if (layer.warp) {
            engine.geometry(
              maskContext,
              source,
              {
                width: roi.width,
                height: roi.height,
                warp: points.flatMap((p) => [
                  p.x / roi.width,
                  p.y / roi.height,
                ]),
              },
              [1, 0, 0, 1, 0, 0],
            );
          } else {
            const [a, b, , d] = points;
            engine.geometry(maskContext, source, tile, [
              (b.x - a.x) / tile.width,
              (b.y - a.y) / tile.width,
              (d.x - a.x) / tile.height,
              (d.y - a.y) / tile.height,
              a.x,
              a.y,
            ]);
          }
        } finally {
          source.width = source.height = 1;
        }
      }
    }
    alpha = alphaOf(mask);
  } finally {
    mask.width = mask.height = 1;
  }
  signal?.throwIfAborted();
  const patch = surface(roi.width, roi.height),
    ctx = patch.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(
    image,
    roi.x,
    roi.y,
    roi.width,
    roi.height,
    0,
    0,
    roi.width,
    roi.height,
  );
  const rgba = ctx.getImageData(0, 0, roi.width, roi.height).data;
  patch.width = patch.height = 1;
  const result = await calculateFill(
    { rgba, mask: alpha, width: roi.width, height: roi.height },
    signal,
    progress,
  );
  signal?.throwIfAborted();
  const out = surface(width, height),
    c = out.getContext("2d");
  c.drawImage(image, 0, 0);
  c.putImageData(
    new ImageData(result.rgba, roi.width, roi.height),
    roi.x,
    roi.y,
  );
  return { canvas: out, method: result.method, roi };
}
