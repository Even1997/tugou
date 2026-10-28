import { surface, pngBytes } from "./selection.js";
import { validateSettings } from "../core/image-tools.cjs";

export function originalUrl(asset) {
  const resource =
    asset.resource ||
    asset.dataUrl?.match(/^\/api\/studio\/resource\/(.+)$/)?.[1];
  return resource ? `tugou-media://original/${resource}` : asset.dataUrl;
}
export async function loadOriginal(asset) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("原图加载失败"));
    image.src = originalUrl(asset);
  });
}
export async function processImage(
  asset,
  settings,
  signal,
  progress = () => {},
) {
  signal.throwIfAborted();
  validateSettings(settings);
  const image = await loadOriginal(asset);
  let bitmap, worker;
  try {
    signal.throwIfAborted();
    bitmap = await createImageBitmap(image);
    signal.throwIfAborted();
    worker = new Worker(new URL("./image-tools-worker.js", document.baseURI));
    return await new Promise((resolve, reject) => {
      const close = () => {
        worker.terminate();
        signal.removeEventListener("abort", cancel);
      };
      const cancel = () => {
        close();
        reject(new DOMException("已取消", "AbortError"));
      };
      worker.onmessage = ({ data }) => {
        if (data.progress !== undefined) {
          progress(data.progress);
          return;
        }
        close();
        data.error ? reject(new Error(data.error)) : resolve(data.bytes);
      };
      worker.onerror = (e) => {
        close();
        reject(new Error(e.message || "图像处理失败"));
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else
        worker.postMessage({ bitmap, settings, lutText: settings.lutText }, [
          bitmap,
        ]);
    });
  } finally {
    worker?.terminate();
    bitmap?.close();
    image.src = "";
  }
}

export async function exportMaterial(asset) {
  const choice = await window.tugou.chooseExport(asset.name);
  if (!choice) return false;
  let canvas;
  try {
    const image = await loadOriginal(asset);
    canvas = surface(image.naturalWidth, image.naturalHeight);
    canvas.getContext("2d").drawImage(image, 0, 0);
    await window.tugou.writeExport(choice.token, await pngBytes(canvas));
    return true;
  } finally {
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
    await window.tugou.cancelExport(choice.token);
  }
}
