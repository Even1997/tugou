// Two-pass chamfer distance, clipped to the existing mask: no protected pixel is added.
// The image edge is not a selection edge; selecting the whole image stays fully selected.
function featherMask(alpha, width, height, radius) {
  if (!radius) return alpha;
  const distance = new Float32Array(alpha.length), diagonal = Math.SQRT2;
  for (let i = 0; i < alpha.length; i++) distance[i] = alpha[i] ? radius + 1 : 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (x) distance[i] = Math.min(distance[i], distance[i - 1] + 1);
    if (y) {
      distance[i] = Math.min(distance[i], distance[i - width] + 1);
      if (x) distance[i] = Math.min(distance[i], distance[i - width - 1] + diagonal);
      if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i - width + 1] + diagonal);
    }
  }
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x;
    if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + 1] + 1);
    if (y + 1 < height) {
      distance[i] = Math.min(distance[i], distance[i + width] + 1);
      if (x) distance[i] = Math.min(distance[i], distance[i + width - 1] + diagonal);
      if (x + 1 < width) distance[i] = Math.min(distance[i], distance[i + width + 1] + diagonal);
    }
  }
  return Uint8Array.from(alpha, (a, i) => Math.round(a * Math.min(1, Math.max(0, distance[i] - .5) / radius)));
}
module.exports = { featherMask };
