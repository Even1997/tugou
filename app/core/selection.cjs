function selectColor(rgba, width, height, x, y, tolerance, contiguous) {
  const count = width * height;
  if (
    rgba.length !== count * 4 ||
    count > 100000000 ||
    x < 0 ||
    y < 0 ||
    x >= width ||
    y >= height
  )
    throw new Error("取样点或图片尺寸无效");
  const seed = (Math.floor(y) * width + Math.floor(x)) * 4;
  const alpha = new Uint8Array(count),
    seen = new Uint8Array(contiguous ? count : 0);
  const matches = (i) => {
    const p = i * 4,
      a = rgba[p + 3] / 255,
      b = rgba[seed + 3] / 255;
    return (
      Math.max(
        Math.abs(rgba[p] * a - rgba[seed] * b),
        Math.abs(rgba[p + 1] * a - rgba[seed + 1] * b),
        Math.abs(rgba[p + 2] * a - rgba[seed + 2] * b),
        Math.abs(rgba[p + 3] - rgba[seed + 3]),
      ) <= tolerance
    );
  };
  if (!contiguous) {
    for (let i = 0; i < count; i++) if (matches(i)) alpha[i] = 255;
    return alpha;
  }
  const queue = new Uint32Array(count);
  let head = 0,
    tail = 0;
  const visit = (i) => {
    if (seen[i]) return;
    seen[i] = 1;
    if (matches(i)) {
      alpha[i] = 255;
      queue[tail++] = i;
    }
  };
  visit(seed / 4);
  while (head < tail) {
    const i = queue[head++],
      col = i % width;
    if (col) visit(i - 1);
    if (col < width - 1) visit(i + 1);
    if (i >= width) visit(i - width);
    if (i + width < count) visit(i + width);
  }
  return alpha;
}
function combineAlpha(base, added, operation) {
  if (!base || operation === "replace") return added;
  if (base.length !== added.length) throw new Error("选区尺寸不一致");
  return added.map((value, i) =>
    operation === "subtract"
      ? Math.round((base[i] * (255 - value)) / 255)
      : operation === "intersect"
        ? Math.round((base[i] * value) / 255)
        : Math.max(base[i], value),
  );
}
// Squared Euclidean distance: lower envelope of parabolas, two linear passes.
function growAlpha(alpha, width, height, radius) {
  if (!radius) return alpha.slice();
  const n = width * height,
    shrink = radius < 0,
    distance = new Float32Array(n);
  for (let i = 0; i < n; i++)
    distance[i] = (shrink ? alpha[i] < 128 : alpha[i] >= 128) ? 0 : 1e12;
  const size = Math.max(width, height),
    f = new Float64Array(size),
    result = new Float64Array(size),
    vertices = new Int32Array(size),
    limits = new Float64Array(size + 1);
  const transform = (length) => {
    let k = 0;
    vertices[0] = 0;
    limits[0] = -Infinity;
    limits[1] = Infinity;
    for (let q = 1; q < length; q++) {
      let cut;
      do {
        const p = vertices[k];
        cut = (f[q] + q * q - f[p] - p * p) / (2 * (q - p));
        if (cut > limits[k]) break;
        k--;
      } while (k >= 0);
      vertices[++k] = q;
      limits[k] = cut;
      limits[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (limits[k + 1] < q) k++;
      result[q] = (q - vertices[k]) ** 2 + f[vertices[k]];
    }
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = distance[y * width + x];
    transform(width);
    for (let x = 0; x < width; x++) distance[y * width + x] = result[x];
  }
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = distance[y * width + x];
    transform(height);
    for (let y = 0; y < height; y++) distance[y * width + x] = result[y];
  }
  const out = new Uint8Array(n),
    threshold = radius * radius;
  for (let i = 0; i < n; i++) {
    const x = i % width,
      y = Math.floor(i / width);
    const d = shrink
      ? Math.min(
          distance[i],
          (x + 1) ** 2,
          (width - x) ** 2,
          (y + 1) ** 2,
          (height - y) ** 2,
        )
      : distance[i];
    out[i] = (shrink ? d > threshold : d <= threshold) ? 255 : 0;
  }
  return out;
}
module.exports = { selectColor, combineAlpha, growAlpha };
