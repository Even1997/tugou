const {
  worldMatrix,
  inverse,
  homography,
  project,
  point,
} = require("./layers.cjs");

// Sample document coverage at each source pixel's transformed centre. Pixels
// outside the document stay protected, including when the selection is inverted.
function mapSelection({
  alpha,
  width,
  height,
  targetWidth,
  targetHeight,
  layers,
  layerId,
}) {
  for (const [w, h] of [
    [width, height],
    [targetWidth, targetHeight],
  ])
    if (
      !Number.isInteger(w) ||
      !Number.isInteger(h) ||
      w < 1 ||
      h < 1 ||
      w * h > 100000000
    )
      throw Error("选区超出一亿像素范围");
  if (alpha?.length !== width * height) throw Error("选区像素尺寸不符");
  const layer = layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "image") throw Error("请选择来源图片对应的图层");
  const m = worldMatrix(layers, layer),
    h = layer.warp ? homography(layer.warp) : null;
  inverse(m);
  const out = new Uint8Array(targetWidth * targetHeight);
  const sample = (x, y) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : alpha[y * width + x];
  for (let y = 0; y < targetHeight; y++)
    for (let x = 0; x < targetWidth; x++) {
      const u = (x + 0.5) / targetWidth,
        v = (y + 0.5) / targetHeight;
      const q = h ? project(h, u, v) : { x: u, y: v };
      const p = point(m, q.x * layer.width, q.y * layer.height);
      if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) continue;
      const px = p.x - 0.5,
        py = p.y - 0.5,
        ix = Math.floor(px),
        iy = Math.floor(py),
        dx = px - ix,
        dy = py - iy;
      out[y * targetWidth + x] = Math.round(
        sample(ix, iy) * (1 - dx) * (1 - dy) +
          sample(ix + 1, iy) * dx * (1 - dy) +
          sample(ix, iy + 1) * (1 - dx) * dy +
          sample(ix + 1, iy + 1) * dx * dy,
      );
    }
  return out;
}
module.exports = { mapSelection };
