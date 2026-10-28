import {
  selectionCanvas,
  alphaOf,
  alphaCanvas,
  calculateSelection,
} from "./selection.js";

export async function sourceSelection(doc, source, layerId, engine, signal) {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (layerId && (!layer || layer.assetId !== source.id || layer.bitmap))
    throw Error("此图层不是当前原图，请先将编辑后的图层保存为素材");
  if (!layerId && (doc.width !== source.width || doc.height !== source.height))
    throw Error("请指定来源图片在画面中的图层");
  const canvas = await selectionCanvas(doc, engine);
  if (!layerId) return canvas;
  try {
    const alpha = await calculateSelection(
      {
        mapping: true,
        alpha: alphaOf(canvas),
        width: doc.width,
        height: doc.height,
        targetWidth: source.width,
        targetHeight: source.height,
        layers: doc.layers,
        layerId,
      },
      signal,
    );
    if (!alpha.some((v) => v)) throw Error("当前选区未覆盖此图层，请重新选择");
    return alphaCanvas(alpha, source.width, source.height);
  } finally {
    canvas.width = canvas.height = 1;
  }
}
