import {
  validateComposition,
  recoverMatte,
  applyTexture,
  applyRegion,
  gridRegions,
  alphaRegions,
} from "../core/image-composition.cjs";
import { alphaEdges } from "../core/image-tools.cjs";
let acknowledge;
self.onmessage = async ({ data }) => {
  if (data.ack) {
    acknowledge?.();
    return;
  }
  const { bitmap, secondary, settings: s } = data;
  let output, tile, other, original, replacement;
  const progress = (value) => self.postMessage({ progress: value });
  const emit = async (canvas, meta) => {
    const bytes = new Uint8Array(
      await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
    );
    await new Promise((resolve) => {
      acknowledge = resolve;
      self.postMessage({ part: { ...meta, bytes } }, [bytes.buffer]);
    });
  };
  try {
    const width = bitmap.width,
      height = bitmap.height;
    validateComposition(s, width, height, secondary);
    output = new OffscreenCanvas(
      s.operation === "crop" ? s.width : width,
      s.operation === "crop" ? s.height : height,
    );
    const ctx = output.getContext("2d");
    if (s.operation === "crop") {
      ctx.drawImage(
        bitmap,
        s.left,
        s.top,
        s.width,
        s.height,
        0,
        0,
        s.width,
        s.height,
      );
      progress(90);
      await emit(output, {
        index: 0,
        count: 1,
        bounds: { left: s.left, top: s.top, width: s.width, height: s.height },
      });
    } else if (s.operation === "split") {
      let pixels, labels, parts;
      if (s.splitMode === "grid")
        parts = gridRegions(width, height, s.rows, s.columns);
      else {
        original = new OffscreenCanvas(width, height);
        const read = original.getContext("2d", { willReadFrequently: true });
        read.drawImage(bitmap, 0, 0);
        pixels = read.getImageData(0, 0, width, height).data;
        original.width = original.height = 1;
        bitmap.close();
        ({ labels, parts } = alphaRegions(
          pixels,
          width,
          height,
          s.minArea,
          progress,
        ));
      }
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index],
          b = part.bounds;
        ctx.clearRect(0, 0, width, height);
        if (!labels)
          ctx.drawImage(
            bitmap,
            b.left,
            b.top,
            b.width,
            b.height,
            b.left,
            b.top,
            b.width,
            b.height,
          );
        else {
          const patch = new ImageData(b.width, b.height);
          for (let y = 0; y < b.height; y++)
            for (let x = 0; x < b.width; x++) {
              const p = (b.top + y) * width + b.left + x;
              if (labels[p] !== part.label) continue;
              const o = (y * b.width + x) * 4;
              for (let c = 0; c < 4; c++) patch.data[o + c] = pixels[p * 4 + c];
            }
          ctx.putImageData(patch, b.left, b.top);
        }
        await emit(output, {
          name: part.name,
          bounds: b,
          index,
          count: parts.length,
        });
        progress(40 + Math.floor(((index + 1) / parts.length) * 55));
      }
    } else {
      if (s.operation === "patch") {
        // Resample once: clipping a scaled image into separate tiles can change the native filter at tile edges.
        replacement = new OffscreenCanvas(s.width, s.height);
        const r = replacement.getContext("2d", { willReadFrequently: true });
        r.imageSmoothingQuality = "high";
        r.drawImage(secondary, 0, 0, s.width, s.height);
      }
      const pad = s.operation === "mattePair" ? s.shrink + s.feather : 0,
        size = 512;
      tile = new OffscreenCanvas(size + pad * 2, size + pad * 2);
      other = new OffscreenCanvas(tile.width, tile.height);
      const a = tile.getContext("2d", { willReadFrequently: true }),
        b = other.getContext("2d", { willReadFrequently: true });
      let inconsistent = 0,
        transparent = 0,
        total = 0;
      for (let y = 0; y < height; y += size)
        for (let x = 0; x < width; x += size) {
          const w = Math.min(size, width - x),
            h = Math.min(size, height - y);
          a.clearRect(0, 0, tile.width, tile.height);
          b.clearRect(0, 0, other.width, other.height);
          a.drawImage(bitmap, pad - x, pad - y);
          if (s.operation === "mattePair")
            b.drawImage(secondary, pad - x, pad - y);
          else if (s.operation === "patch") {
            b.imageSmoothingQuality = "high";
            b.drawImage(replacement, s.left - x, s.top - y);
          } else if (s.operation === "texture") {
            b.save();
            b.translate(s.left - x, s.top - y);
            b.fillStyle = b.createPattern(secondary, "repeat");
            b.fillRect(x - s.left, y - s.top, w, h);
            b.restore();
          }
          const p = a.getImageData(0, 0, w + pad * 2, h + pad * 2),
            q = b.getImageData(0, 0, p.width, p.height);
          if (s.operation === "mattePair") {
            // Outside-image halo must be paired as black/white backgrounds, not transparent input.
            for (let py = 0; py < p.height; py++)
              for (let px = 0; px < p.width; px++)
                if (
                  x - pad + px < 0 ||
                  y - pad + py < 0 ||
                  x - pad + px >= width ||
                  y - pad + py >= height
                ) {
                  const i = (py * p.width + px) * 4;
                  p.data[i] = p.data[i + 1] = p.data[i + 2] = 0;
                  p.data[i + 3] = 255;
                  q.data[i] =
                    q.data[i + 1] =
                    q.data[i + 2] =
                    q.data[i + 3] =
                      255;
                }
            const diagnostic = recoverMatte(p.data, q.data);
            inconsistent += diagnostic.inconsistent;
            transparent += diagnostic.transparent;
            total += p.width * p.height;
            alphaEdges(p.data, p.width, p.height, s);
          } else if (["extract", "patch"].includes(s.operation))
            applyRegion(p.data, q.data, w, h, s, x, y);
          else applyTexture(p.data, q.data, w, h, s, x, y);
          ctx.putImageData(p, x - pad, y - pad, pad, pad, w, h);
          progress(Math.floor(((y * width + x + w) / (width * height)) * 90));
        }
      if (transparent)
        throw Error("黑白底版本必须是不透明图片，请先合成纯黑和纯白背景");
      if (inconsistent > total * 0.01)
        throw Error("两图主体、位置或底色不一致，无法可靠提取透明度");
      await emit(output, { index: 0, count: 1 });
    }
    self.postMessage({ done: true });
  } catch (error) {
    self.postMessage({ error: error.message });
  } finally {
    bitmap.close();
    secondary?.close();
    for (const c of [output, tile, other, original, replacement])
      if (c) c.width = c.height = 1;
  }
};
