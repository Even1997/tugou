import React, { useEffect, useRef, useState } from "react";
import { loadOriginal } from "./image-processing.js";
import { maskValue } from "../core/cloud-settings.cjs";
import { featherMask } from '../core/mask-feather.cjs';
export function CloudMaskPreview({ source, mask, settings }) {
  const ref = useRef(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const c = ref.current;
    setError("");
    (async () => {
      const original = await loadOriginal(source);
      if (!active) return;
      const scale = Math.min(
        1,
        1024 / Math.max(original.width, original.height),
      );
      c.width = Math.max(1, Math.round(original.width * scale));
      c.height = Math.max(1, Math.round(original.height * scale));
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(original, 0, 0, c.width, c.height);
      if (!mask) return;
      const image = await loadOriginal(mask);
      if (!active) return;
      if (image.width !== original.width || image.height !== original.height)
        throw new Error("蒙版与原图尺寸不同，请重新选择");
      const overlay = document.createElement("canvas");
      overlay.width = c.width;
      overlay.height = c.height;
      const o = overlay.getContext("2d", { willReadFrequently: true });
      o.drawImage(image, 0, 0, c.width, c.height);
      const pixels = o.getImageData(0, 0, c.width, c.height);
      const values = new Uint8Array(c.width * c.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        values[i / 4] = maskValue(
          pixels.data,
          i,
          settings.maskChannel,
          settings.invertMask,
        );
      }
      const alpha = featherMask(values, c.width, c.height, (settings.feather || 0) * scale);
      for (let i = 0; i < pixels.data.length; i += 4)
        pixels.data.set([80, 140, 255, Math.round(alpha[i / 4] * 0.45)], i);
      o.putImageData(pixels, 0, 0);
      ctx.drawImage(overlay, 0, 0);
      overlay.width = overlay.height = 1;
    })().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [source, mask, settings.maskChannel, settings.invertMask, settings.feather]);
  return (
    <div className="cloud-mask-preview">
      <canvas ref={ref} aria-label="修改蒙版预览" />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
