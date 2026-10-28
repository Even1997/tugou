export function surface(width, height) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
export async function selectionCanvas(doc, engine) {
  const out = surface(doc.width, doc.height),
    ctx = out.getContext("2d", { willReadFrequently: true }),
    s = doc.selection;
  if (!s) return out;
  if (s.bitmap)
    ctx.drawImage(await engine.image(s.bitmap), 0, 0, doc.width, doc.height);
  for (const path of s.paths || []) {
    const tmp = surface(doc.width, doc.height),
      c = tmp.getContext("2d", { willReadFrequently: true });
    c.beginPath();
    for (let i = 0; i < path.points.length; i += 2)
      i
        ? c.lineTo(path.points[i], path.points[i + 1])
        : c.moveTo(path.points[i], path.points[i + 1]);
    c.closePath();
    c.fill();
    ctx.globalCompositeOperation =
      path.operation === "subtract"
        ? "destination-out"
        : path.operation === "intersect"
          ? "destination-in"
          : "source-over";
    ctx.drawImage(tmp, 0, 0);
    tmp.width = tmp.height = 1;
  }
  ctx.globalCompositeOperation = "source-over";
  if (s.inverted) {
    ctx.globalCompositeOperation = "source-out";
    ctx.fillRect(0, 0, doc.width, doc.height);
    ctx.globalCompositeOperation = "source-over";
  }
  if (s.feather) {
    const tmp = surface(doc.width, doc.height),
      c = tmp.getContext("2d");
    c.filter = `blur(${s.feather}px)`;
    c.drawImage(out, 0, 0);
    ctx.clearRect(0, 0, doc.width, doc.height);
    ctx.drawImage(tmp, 0, 0);
    tmp.width = tmp.height = 1;
  }
  return out;
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
