import { loadOriginal } from "./image-processing.js";
import { validateComposition } from "../core/image-composition.cjs";

export async function processComposition(
  source,
  secondary,
  settings,
  signal,
  progress,
  onPart,
) {
  const bitmaps = [];
  let worker;
  try {
    for (const asset of [source, secondary].filter(Boolean)) {
      signal.throwIfAborted();
      const image = await loadOriginal(asset);
      try {
        signal.throwIfAborted();
        bitmaps.push(await createImageBitmap(image));
      } finally {
        image.src = "";
      }
    }
    signal.throwIfAborted();
    validateComposition(
      settings,
      bitmaps[0].width,
      bitmaps[0].height,
      bitmaps[1],
    );
    worker = new Worker(
      new URL("./image-composition-worker.js", document.baseURI),
    );
    await new Promise((resolve, reject) => {
      let ended = false;
      const finish = (error) => {
        if (ended) return;
        ended = true;
        worker.terminate();
        signal.removeEventListener("abort", cancel);
        error ? reject(error) : resolve();
      };
      const cancel = () => finish(new DOMException("已取消", "AbortError"));
      worker.onerror = (e) => finish(new Error(e.message || "图像处理失败"));
      worker.onmessage = async ({ data }) => {
        if (ended) return;
        try {
          if (data.error) finish(new Error(data.error));
          else if (data.done) finish();
          else if (data.progress !== undefined) progress(data.progress);
          else if (data.part) {
            await onPart(data.part);
            signal.throwIfAborted();
            if (!ended) worker.postMessage({ ack: true });
          }
        } catch (e) {
          finish(e);
        }
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      else
        worker.postMessage(
          { bitmap: bitmaps[0], secondary: bitmaps[1], settings },
          bitmaps,
        );
    });
  } finally {
    worker?.terminate();
    for (const bitmap of bitmaps) bitmap.close();
  }
}
