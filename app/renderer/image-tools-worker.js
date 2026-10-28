import {
  dimensions,
  outputGeometry,
  validateSettings,
  parseCube,
  applyLut,
  alphaEdges,
  lighting,
  enhancePixels,
} from "../core/image-tools.cjs";

self.onmessage = async ({ data: { bitmap, settings: s, lutText } }) => {
  let output, tile;
  const enhanceBuffers = {};
  try {
    validateSettings(s);
    const geometric = ["resize", "extend", "rotate", "mirror"].includes(
      s.operation,
    );
    const geometry = geometric
      ? outputGeometry(s, bitmap.width, bitmap.height)
      : null;
    const width =
        geometry?.width ??
        (["pattern", "tile"].includes(s.operation) ? s.width : bitmap.width),
      height =
        geometry?.height ??
        (["pattern", "tile"].includes(s.operation) ? s.height : bitmap.height);
    dimensions(width, height);
    output = new OffscreenCanvas(width, height);
    const ctx = output.getContext("2d");
    if (geometric) {
      ctx.imageSmoothingQuality = "high";
      if (s.operation === "rotate") {
        ctx.translate(width, 0);
        ctx.rotate(Math.PI / 2);
      }
      if (s.operation === "mirror") {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }
      if (s.operation === "resize") ctx.drawImage(bitmap, 0, 0, width, height);
      else ctx.drawImage(bitmap, geometry.left, geometry.top);
      self.postMessage({ progress: 90 });
    } else if (s.operation === "tile") {
      ctx.fillStyle = ctx.createPattern(bitmap, "repeat");
      ctx.fillRect(0, 0, width, height);
      self.postMessage({ progress: 90 });
    } else if (s.operation === "pattern") {
      const w = Math.max(1, Math.round(bitmap.width * s.motifScale)),
        h = Math.max(1, Math.round(bitmap.height * s.motifScale)),
        cw = w + s.gap,
        ch = h + s.gap,
        pw = cw * (s.layout === "repeat" ? 1 : 2),
        ph = ch * (s.layout === "mirror" ? 2 : 1);
      const draw = (c, x, y, col, row) => {
        c.save();
        c.translate(
          x + (s.layout === "mirror" && col % 2 ? w : 0),
          y + (s.layout === "mirror" && row % 2 ? h : 0),
        );
        c.scale(
          s.layout === "mirror" && col % 2 ? -1 : 1,
          s.layout === "mirror" && row % 2 ? -1 : 1,
        );
        c.drawImage(bitmap, 0, 0, w, h);
        c.restore();
      };
      // Small repeats use a single pattern; large motifs draw directly to avoid a giant repeat cell.
      if (pw * ph <= 16777216) {
        tile = new OffscreenCanvas(pw, ph);
        const c = tile.getContext("2d");
        c.imageSmoothingQuality = "high";
        for (let row = -1; row < 3; row++)
          for (let col = 0; col < 2; col++)
            draw(
              c,
              col * cw,
              row * ch + (s.layout === "halfdrop" && col % 2 ? ch / 2 : 0),
              col,
              row,
            );
        ctx.fillStyle = ctx.createPattern(tile, "repeat");
        ctx.fillRect(0, 0, width, height);
      } else {
        ctx.imageSmoothingQuality = "high";
        for (let col = 0; col * cw < width; col++)
          for (let row = -1; row * ch < height; row++)
            draw(
              ctx,
              col * cw,
              row * ch + (s.layout === "halfdrop" && col % 2 ? ch / 2 : 0),
              col,
              row,
            );
      }
      self.postMessage({ progress: 90 });
    } else {
      const lut = s.operation === "lut" ? parseCube(lutText) : null,
        pad =
          s.operation === "alpha"
            ? s.shrink + s.feather
            : s.operation === "enhance"
              ? 1
              : 0,
        size = 512;
      tile = new OffscreenCanvas(size + pad * 2, size + pad * 2);
      const c = tile.getContext("2d", { willReadFrequently: true });
      for (let y = 0; y < height; y += size)
        for (let x = 0; x < width; x += size) {
          const w = Math.min(size, width - x),
            h = Math.min(size, height - y);
          c.clearRect(0, 0, tile.width, tile.height);
          c.drawImage(bitmap, pad - x, pad - y);
          const pixels = c.getImageData(0, 0, w + pad * 2, h + pad * 2);
          if (s.operation === "lut") applyLut(pixels.data, lut, s.strength);
          else if (s.operation === "alpha")
            alphaEdges(pixels.data, pixels.width, pixels.height, s);
          else if (s.operation === "light")
            lighting(pixels.data, w, h, s, x, y, width, height);
          else if (s.operation === "enhance")
            enhancePixels(
              pixels.data,
              pixels.width,
              pixels.height,
              s.strength,
              enhanceBuffers,
            );
          else throw new Error("该处理方式尚未接入");
          ctx.putImageData(pixels, x - pad, y - pad, pad, pad, w, h);
          self.postMessage({
            progress: Math.floor(
              (90 *
                (Math.min(y + size, height) * width -
                  Math.max(0, width - x - w) * Math.min(size, height - y))) /
                (width * height),
            ),
          });
        }
    }
    const bytes = new Uint8Array(
      await (await output.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );
    self.postMessage({ bytes }, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ error: error.message });
  } finally {
    bitmap.close();
    if (output) output.width = output.height = 1;
    if (tile) tile.width = tile.height = 1;
  }
};
