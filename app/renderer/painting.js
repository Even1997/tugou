import { inherited } from "../core/layers.cjs";
import { surface } from "./selection.js";
import { paintTarget, targetSelection } from "./paint-target.js";

// One stroke owns its original pixels and coverage. Opacity is applied once,
// so receiving more pointer events does not darken a translucent stroke.
export async function createStroke(doc, layer, engine, options) {
  if (!layer || (options.target !== "mask" && layer.kind !== "image"))
    throw new Error("请选择图片图层，或新建绘画图层");
  if (
    inherited(doc.layers, layer, "locked") ||
    inherited(doc.layers, layer, "hidden")
  )
    throw new Error("请先显示并解锁图层及所属分组");
  const target = await paintTarget(doc, layer, engine, options),
    { image, width, height, geometry } = target;
  if (target.mask)
    options = {
      ...options,
      color: "#ffffff",
      erase: (options.maskMode !== "reveal") !== Boolean(target.mask.inverted),
    };
  const tileSize = 256,
    tiles = new Map();
  const output = surface(width, height),
    ink = surface(tileSize, tileSize);
  output.getContext("2d").drawImage(image, 0, 0);
  let mask, last, first, filtered, input;
  const local = (p) => {
    const q = geometry.local(p.x, p.y);
    return {
      x: q.x * width,
      y: q.y * height,
      pressure:
        options.pressure && p.pointerType === "pen"
          ? Math.max(0.05, p.pressure || 0.05)
          : 1,
    };
  };
  mask = await targetSelection(doc,engine,target);
  const stamp = (p) => {
    const radius = Math.max(0.25, (options.size * p.pressure) / 2);
    const hardness = options.hardness / 100;
    for (
      let y = Math.max(0, Math.floor((p.y - radius) / tileSize)) * tileSize;
      y < Math.min(height, p.y + radius);
      y += tileSize
    )
      for (
        let x = Math.max(0, Math.floor((p.x - radius) / tileSize)) * tileSize;
        x < Math.min(width, p.x + radius);
        x += tileSize
      ) {
        const key = `${x},${y}`;
        if (!tiles.has(key))
          tiles.set(key, {
            x,
            y,
            canvas: surface(
              Math.min(tileSize, width - x),
              Math.min(tileSize, height - y),
            ),
          });
        const tile = tiles.get(key),
          c = tile.canvas.getContext("2d");
        tile.dirty = true;
        c.setTransform(1, 0, 0, 1, -x, -y);
        if (hardness < 1) {
          const g = c.createRadialGradient(
            p.x,
            p.y,
            radius * hardness,
            p.x,
            p.y,
            radius,
          );
          g.addColorStop(0, options.color);
          g.addColorStop(1, options.color + "00");
          c.fillStyle = g;
        } else c.fillStyle = options.color;
        c.beginPath();
        c.arc(p.x, p.y, radius, 0, Math.PI * 2);
        c.fill();
      }
  };
  const segment = (a, b) => {
    // Clip sampling to the bitmap plus brush radius. Perspective may map an
    // off-layer pointer very far away; those empty samples must not block UI.
    const dx = b.x - a.x,
      dy = b.y - a.y,
      margin = options.size / 2;
    let from = 0,
      to = 1;
    for (const [p, q] of [
      [-dx, a.x + margin],
      [dx, width + margin - a.x],
      [-dy, a.y + margin],
      [dy, height + margin - a.y],
    ]) {
      if (p === 0) {
        if (q < 0) return;
        continue;
      }
      const t = q / p;
      if (p < 0) from = Math.max(from, t);
      else to = Math.min(to, t);
      if (from > to) return;
    }
    const distance = Math.hypot(dx, dy) * (to - from);
    const count = Math.max(
      1,
      Math.ceil(
        distance /
          Math.max(0.5, options.size * Math.min(a.pressure, b.pressure) * 0.1),
      ),
    );
    for (let i = 1; i <= count; i++) {
      const t = from + ((to - from) * i) / count;
      stamp({
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        pressure: a.pressure + (b.pressure - a.pressure) * t,
      });
    }
  };
  return {
    canvas: output,
    mask: target.mask,
    get workingBytes() {
      return (
        (output.width * output.height +
          ink.width * ink.height +
          (mask ? mask.width * mask.height : 0) +
          [...tiles.values()].reduce(
            (n, t) => n + t.canvas.width * t.canvas.height,
            0,
          )) *
        4
      );
    },
    add(point) {
      const p = local(point);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      input = point;
      if (!first) {
        first = last = p;
        filtered = point;
        if (!options.line) stamp(p);
        return;
      }
      if (options.line) return;
      const distance = Math.hypot(point.x - filtered.x, point.y - filtered.y),
        rope = (options.smoothing || 0) / (options.zoom || 1);
      if (distance <= rope) return;
      const follow = (distance - rope) / distance;
      filtered = {
        ...point,
        x: filtered.x + (point.x - filtered.x) * follow,
        y: filtered.y + (point.y - filtered.y) * follow,
      };
      const next = local(filtered);
      segment(last, next);
      last = next;
    },
    finish(point = input, from) {
      if (!first || !point) return;
      const p = local(point);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return;
      if (options.line) {
        const start = from ? local(from) : first;
        stamp(start);
        segment(start, p);
      } else segment(last, p);
      last = p;
    },
    render() {
      const i = ink.getContext("2d");
      const out = output.getContext("2d");
      for (const tile of tiles.values()) {
        if (!tile.dirty) continue;
        const { x, y, canvas } = tile,
          w = canvas.width,
          h = canvas.height;
        i.clearRect(0, 0, tileSize, tileSize);
        i.globalCompositeOperation = "source-over";
        i.drawImage(canvas, 0, 0);
        if (mask) {
          i.globalCompositeOperation = "destination-in";
          i.drawImage(mask, x, y, w, h, 0, 0, w, h);
        }
        out.globalAlpha = 1;
        out.globalCompositeOperation = "source-over";
        out.clearRect(x, y, w, h);
        out.drawImage(image, x, y, w, h, x, y, w, h);
        out.globalCompositeOperation = options.erase
          ? "destination-out"
          : "source-over";
        out.globalAlpha = options.opacity / 100;
        out.drawImage(ink, 0, 0, w, h, x, y, w, h);
        out.globalAlpha = 1;
        out.globalCompositeOperation = "source-over";
        tile.dirty = false;
      }
      return output;
    },
    dispose() {
      for (const canvas of [
        ink,
        output,
        mask,
        target.owned ? image : null,
        ...[...tiles.values()].map((t) => t.canvas),
      ])
        if (canvas) canvas.width = canvas.height = 1;
      tiles.clear();
    },
  };
}
