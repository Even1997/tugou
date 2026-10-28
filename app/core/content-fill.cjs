const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
function integralInvalid(rgba, mask, w, h) {
  const table = new Uint32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      sum += mask[i] > 0 || rgba[i * 4 + 3] < 250 ? 1 : 0;
      table[(y + 1) * (w + 1) + x + 1] = table[y * (w + 1) + x + 1] + sum;
    }
  }
  return (x, y, width, height) =>
    x >= 0 &&
    y >= 0 &&
    x + width <= w &&
    y + height <= h &&
    table[(y + height) * (w + 1) + x + width] -
      table[y * (w + 1) + x + width] -
      table[(y + height) * (w + 1) + x] +
      table[y * (w + 1) + x] ===
      0;
}
function bounds(mask, w, h) {
  let x = w,
    y = h,
    right = 0,
    bottom = 0,
    count = 0;
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      x = Math.min(x, i % w);
      y = Math.min(y, Math.floor(i / w));
      right = Math.max(right, (i % w) + 1);
      bottom = Math.max(bottom, Math.floor(i / w) + 1);
      count++;
    }
  return { x, y, width: right - x, height: bottom - y, count };
}
// A coherent donor translation keeps exact repeated patterns in phase.
function coherent(rgba, mask, w, h, valid, box) {
  const pad = 2,
    bx = box.x - pad,
    by = box.y - pad,
    bw = box.width + pad * 2,
    bh = box.height + pad * 2;
  if (bx < 0 || by < 0 || bx + bw > w || by + bh > h) return null;
  const ring = [];
  for (let y = by; y < by + bh; y++)
    for (let x = bx; x < bx + bw; x++)
      if (
        !mask[y * w + x] &&
        (x < box.x ||
          x >= box.x + box.width ||
          y < box.y ||
          y >= box.y + box.height)
      )
        ring.push(y * w + x);
  const samples = ring.filter(
    (_, i) => i % Math.max(1, Math.ceil(ring.length / 160)) === 0,
  );
  if (samples.length < 8) return null;
  const step = Math.max(1, Math.ceil(Math.sqrt((w * h) / 4096))),
    best = [];
  const evaluate = (x, y) => {
    if (!valid(x, y, bw, bh)) return;
    const dx = x - bx,
      dy = y - by;
    let cost = 0;
    for (const i of samples) {
      const j = i + dy * w + dx;
      for (let k = 0; k < 3; k++)
        cost += (rgba[i * 4 + k] - rgba[j * 4 + k]) ** 2;
    }
    cost /= samples.length * 3;
    // Sparse samples can alias repeated patterns by one pixel. Verify every
    // boundary pixel before accepting an apparently exact donor translation.
    if (cost <= 9 && samples.length < ring.length) {
      cost = 0;
      for (const i of ring) {
        const j = i + dy * w + dx;
        for (let k = 0; k < 3; k++)
          cost += (rgba[i * 4 + k] - rgba[j * 4 + k]) ** 2;
      }
      cost /= ring.length * 3;
    }
    best.push({ dx, dy, cost });
    best.sort((a, b) => a.cost - b.cost);
    best.length = Math.min(8, best.length);
  };
  for (let y = 0; y <= h - bh; y += step)
    for (let x = 0; x <= w - bw; x += step) evaluate(x, y);
  const seeds = [...best];
  for (const p of seeds)
    for (
      let y = Math.max(0, by + p.dy - step);
      y <= Math.min(h - bh, by + p.dy + step);
      y++
    )
      for (
        let x = Math.max(0, bx + p.dx - step);
        x <= Math.min(w - bw, bx + p.dx + step);
        x++
      )
        evaluate(x, y);
  return best[0]?.cost <= 9 ? best[0] : null;
}
function reduce(rgba, mask, w, h) {
  const width = Math.ceil(w / 2),
    height = Math.ceil(h / 2),
    data = new Uint8ClampedArray(width * height * 4),
    alpha = new Uint8Array(width * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const sums = [0, 0, 0, 0];
      let count = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++)
          if (x * 2 + dx < w && y * 2 + dy < h) {
            const i = (y * 2 + dy) * w + x * 2 + dx;
            for (let k = 0; k < 4; k++) sums[k] += rgba[i * 4 + k];
            alpha[y * width + x] = Math.max(alpha[y * width + x], mask[i]);
            count++;
          }
      for (let k = 0; k < 4; k++)
        data[(y * width + x) * 4 + k] = sums[k] / count;
    }
  return { rgba: data, mask: alpha, w: width, h: height };
}
function match(rgba, mask, w, h, progress, depth = 0) {
  const valid = integralInvalid(rgba, mask, w, h),
    box = bounds(mask, w, h),
    out = new Uint8ClampedArray(rgba),
    field = new Int32Array(w * h).fill(-1);
  const whole = coherent(rgba, mask, w, h, valid, box);
  if (whole) {
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        const j = i + whole.dy * w + whole.dx;
        field[i] = j;
        for (let k = 0; k < 4; k++) out[i * 4 + k] = rgba[j * 4 + k];
      }
    return { out, field, w, h, method: "coherent" };
  }
  const donors = [];
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++)
      if (valid(x - 2, y - 2, 5, 5)) donors.push(y * w + x);
  if (!donors.length)
    throw Object.assign(new Error("选区周围没有足够的不透明纹理，请缩小选区"), {
      code: "NO_DONOR",
    });
  let coarse;
  if (Math.max(w, h) > 96 && Math.min(w, h) >= 16) {
    const next = reduce(rgba, mask, w, h);
    try {
      coarse = match(next.rgba, next.mask, next.w, next.h, () => {}, depth + 1);
    } catch (error) {
      if (error.code !== "NO_DONOR") throw error;
    }
  }
  let seed = 923521;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const holes = [];
  const allowed = (j) =>
    j >= 0 && j < w * h && valid((j % w) - 2, Math.floor(j / w) - 2, 5, 5);
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      holes.push(i);
      let j = -1;
      if (coarse) {
        const x = i % w,
          y = Math.floor(i / w),
          q = coarse.field[Math.floor(y / 2) * coarse.w + Math.floor(x / 2)];
        if (q >= 0)
          j =
            (Math.floor(q / coarse.w) * 2 + (y % 2)) * w +
            (q % coarse.w) * 2 +
            (x % 2);
      }
      if (!allowed(j)) j = donors[Math.floor(random() * donors.length)];
      field[i] = j;
      for (let k = 0; k < 4; k++) out[i * 4 + k] = rgba[j * 4 + k];
    }
  const score = (i, j) => {
    const x = i % w,
      y = Math.floor(i / w),
      sx = j % w,
      sy = Math.floor(j / w);
    let sum = 0,
      weight = 0;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        if (x + dx >= 0 && y + dy >= 0 && x + dx < w && y + dy < h) {
          const a = (y + dy) * w + x + dx,
            b = (sy + dy) * w + sx + dx,
            f = mask[a] ? 1 : 4;
          for (let k = 0; k < 3; k++)
            sum += (out[a * 4 + k] - rgba[b * 4 + k]) ** 2 * f;
          weight += 3 * f;
        }
    return sum / weight;
  };
  for (let pass = 0; pass < 4; pass++) {
    const reverse = pass % 2,
      direction = reverse ? -1 : 1;
    for (let n = 0; n < holes.length; n++) {
      const i = holes[reverse ? holes.length - 1 - n : n],
        x = i % w,
        y = Math.floor(i / w);
      let best = field[i],
        cost = score(i, best);
      const tryAt = (j) => {
        if (!allowed(j)) return;
        const next = score(i, j);
        if (next < cost) {
          best = j;
          cost = next;
        }
      };
      if (x - direction >= 0 && x - direction < w && field[i - direction] >= 0)
        tryAt(field[i - direction] + direction);
      if (
        y - direction >= 0 &&
        y - direction < h &&
        field[i - direction * w] >= 0
      )
        tryAt(field[i - direction * w] + direction * w);
      for (
        let radius = Math.max(w, h);
        radius >= 1;
        radius = Math.floor(radius / 2)
      ) {
        const sx = clamp(
            (best % w) + Math.floor((random() * 2 - 1) * radius),
            2,
            w - 3,
          ),
          sy = clamp(
            Math.floor(best / w) + Math.floor((random() * 2 - 1) * radius),
            2,
            h - 3,
          );
        tryAt(sy * w + sx);
      }
      field[i] = best;
      for (let k = 0; k < 4; k++) out[i * 4 + k] = rgba[best * 4 + k];
      if (n % 8192 === 0) progress((pass + n / holes.length) / 4);
    }
  }
  return { out, field, w, h, method: "patchmatch" };
}
function contentFill({ rgba, mask, width, height }, progress = () => {}) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width * height > 4000000 ||
    rgba?.length !== width * height * 4 ||
    mask?.length !== width * height
  )
    throw new Error("填充范围无效，选区与周围取样最多支持400万像素");
  const box = bounds(mask, width, height);
  if (!box.count) throw new Error("选区未覆盖当前图片");
  if (box.count === width * height)
    throw new Error("不能用全部选中的图片作为纹理来源");
  progress(0.02);
  const result = match(rgba, mask, width, height, (v) =>
    progress(0.1 + v * 0.85),
  );
  // Match boundary tone locally without flattening donor texture. Diffuse only
  // the boundary residual, leaving the copied high-frequency detail intact.
  if (result.method !== "coherent") {
    let bias = new Float32Array(width * height * 3),
      next = new Float32Array(bias.length);
    const fixed = new Uint8Array(mask.length);
    for (let i = 0; i < mask.length; i++)
      if (mask[i]) {
        const x = i % width,
          y = Math.floor(i / width),
          j = result.field[i],
          sx = j % width,
          sy = Math.floor(j / width);
        let count = 0;
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ])
          if (
            x + dx >= 0 &&
            x + dx < width &&
            y + dy >= 0 &&
            y + dy < height &&
            sx + dx >= 0 &&
            sx + dx < width &&
            sy + dy >= 0 &&
            sy + dy < height
          ) {
            const a = (y + dy) * width + x + dx,
              b = (sy + dy) * width + sx + dx;
            if (!mask[a]) {
              for (let k = 0; k < 3; k++)
                bias[i * 3 + k] += rgba[a * 4 + k] - rgba[b * 4 + k];
              count++;
            }
          }
        if (count) {
          fixed[i] = 1;
          for (let k = 0; k < 3; k++) bias[i * 3 + k] /= count;
        }
      }
    for (let pass = 0; pass < 12; pass++) {
      next.set(bias);
      for (let i = 0; i < mask.length; i++)
        if (mask[i] && !fixed[i]) {
          const x = i % width,
            y = Math.floor(i / width);
          let count = 0;
          const sum = [0, 0, 0];
          for (const j of [
            x ? i - 1 : -1,
            x < width - 1 ? i + 1 : -1,
            y ? i - width : -1,
            y < height - 1 ? i + width : -1,
          ])
            if (j >= 0 && mask[j]) {
              count++;
              for (let k = 0; k < 3; k++) sum[k] += bias[j * 3 + k];
            }
          if (count)
            for (let k = 0; k < 3; k++) next[i * 3 + k] = sum[k] / count;
        }
      [bias, next] = [next, bias];
    }
    for (let i = 0; i < mask.length; i++)
      if (mask[i])
        for (let k = 0; k < 3; k++)
          result.out[i * 4 + k] = clamp(
            result.out[i * 4 + k] + bias[i * 3 + k],
            0,
            255,
          );
  }
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      const n = i * 4,
        t = mask[i] / 255,
        a = rgba[n + 3] / 255,
        b = result.out[n + 3] / 255,
        alpha = a * (1 - t) + b * t;
      for (let k = 0; k < 3; k++)
        result.out[n + k] = alpha
          ? (rgba[n + k] * a * (1 - t) + result.out[n + k] * b * t) / alpha
          : 0;
      result.out[n + 3] = alpha * 255;
    }
  progress(1);
  return { rgba: result.out, method: result.method };
}
module.exports = { contentFill };
