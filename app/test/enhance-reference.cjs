// Deliberately direct 2D reference, independent of the production separable implementation.
function reference(input, width, height, strength) {
  const out = input.slice();
  if (!strength) return out;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!input[i + 3]) continue;
      const luma = (j) =>
        input[j] * 0.2126 + input[j + 1] * 0.7152 + input[j + 2] * 0.0722;
      let sum = 0,
        total = 0;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++)
        for (
          let xx = Math.max(0, x - 1);
          xx <= Math.min(width - 1, x + 1);
          xx++
        ) {
          const j = (yy * width + xx) * 4,
            k = (xx === x ? 2 : 1) * (yy === y ? 2 : 1) * input[j + 3];
          sum += luma(j) * k;
          total += k;
        }
      const grey = luma(i),
        difference = ((grey - sum / total) * strength) / 100;
      for (let c = 0; c < 3; c++)
        out[i + c] = Math.max(
          0,
          Math.min(
            255,
            Math.round(
              grey +
                (input[i + c] - grey) * (1 + strength * 0.0015) +
                difference,
            ),
          ),
        );
    }
  return out;
}
module.exports = { reference };
