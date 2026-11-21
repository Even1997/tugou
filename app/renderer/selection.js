import {surface,renderSelectionMask} from './selection-raster.js';
export {surface};
// MCP snapshots clone the selection. Its geometry and content-addressed bitmap
// stay identical when a command only moves layers.
export function selectionKey(selection,width,height){
  return selection?JSON.stringify([width,height,selection]):null;
}
export async function selectionCanvas(doc,engine){
  return renderSelectionMask(doc,doc.selection?.bitmap?await engine.image(doc.selection.bitmap):null);
}
export function alphaOf(canvas) {
  const data = canvas
    .getContext("2d")
    .getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(data.length / 4);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  return alpha;
}
export function alphaCanvas(alpha, width, height) {
  const c = surface(width, height),
    ctx = c.getContext("2d"),
    data = ctx.createImageData(width, height);
  for (let i = 0; i < alpha.length; i++) {
    data.data[i * 4] = data.data[i * 4 + 1] = data.data[i * 4 + 2] = 255;
    data.data[i * 4 + 3] = alpha[i];
  }
  ctx.putImageData(data, 0, 0);
  return c;
}
export async function pngBytes(canvas) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("选区编码失败"))),
      "image/png",
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
export function calculateSelection(data, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./selection-worker.js", document.baseURI),
    );
    const close = () => {
      worker.terminate();
      signal?.removeEventListener("abort", abort);
    };
    const abort = () => {
      close();
      reject(new DOMException("已取消", "AbortError"));
    };
    worker.onmessage = ({ data }) => {
      close();
      data.error ? reject(new Error(data.error)) : resolve(data.alpha);
    };
    worker.onerror = (event) => {
      close();
      reject(new Error(event.message || "选区计算失败"));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    worker.postMessage(data, [
      ...new Set(
        [data.rgba?.buffer, data.base?.buffer, data.alpha?.buffer].filter(
          Boolean,
        ),
      ),
    ]);
  });
}
