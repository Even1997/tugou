const { matrix, point, inherited } = require("./layers.cjs");
const names = new Intl.Collator("zh-CN", { numeric: true });
function materialSource(asset) {
  return asset.toolResult || asset.layerSnapshot
    ? "processed"
    : asset.generation || asset.recipeId
      ? "generated"
      : "imported";
}
function filterMaterials(
  assets,
  { query = "", source = "all", shape = "all", sort = "newest" } = {},
) {
  const text = query.trim().toLocaleLowerCase();
  return assets
    .map((asset, index) => ({ asset, index }))
    .filter(
      ({ asset: a }) =>
        String(a.name || "")
          .toLocaleLowerCase()
          .includes(text) &&
        (source === "all" || materialSource(a) === source) &&
        (shape === "all" ||
          (shape === "portrait"
            ? a.height > a.width
            : shape === "landscape"
              ? a.width > a.height
              : a.width > 0 && a.width === a.height)),
    )
    .sort((a, b) =>
      sort === "name"
        ? names.compare(String(a.asset.name || ""),String(b.asset.name || "")) || a.index - b.index
        : sort === "pixels"
          ? (b.asset.width || 0) * (b.asset.height || 0) -
              (a.asset.width || 0) * (a.asset.height || 0) || b.index - a.index
          : sort === "oldest"
            ? a.index - b.index
            : b.index - a.index,
    )
    .map((x) => x.asset);
}
function replaceLayerAsset(document, layerId, expectedAssetId, asset) {
  const layer = document.layers.find(
    (l) => l.id === layerId && l.kind === "image",
  );
  if (!layer || layer.assetId !== expectedAssetId)
    throw Error("图层图片已变化，请重新选择");
  if (inherited(document.layers, layer, "locked"))
    throw Error("请先解锁图层或所属分组");
  if (
    !asset?.id ||
    !Number.isFinite(asset.width) ||
    !Number.isFinite(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0
  )
    throw Error("替换图片尺寸无效");
  const existing = document.assets.find((a) => a.id === asset.id);
  if (
    existing &&
    (existing.resource !== asset.resource || existing.dataUrl !== asset.dataUrl)
  )
    throw Error("素材编号已被使用");
  if (asset.id === layer.assetId && !layer.bitmap) return document;
  const { bitmap, ...next } = layer;
  next.assetId = asset.id;
  next.height = (layer.width * asset.height) / asset.width;
  const q = layer.warp || [0, 0, 1, 0, 1, 1, 0, 1],
    cx = (q[0] + q[2] + q[4] + q[6]) / 4,
    cy = (q[1] + q[3] + q[5] + q[7]) / 4;
  const before = point(matrix(layer), layer.width * cx, layer.height * cy),
    after = point(matrix(next), next.width * cx, next.height * cy);
  next.x += before.x - after.x;
  next.y += before.y - after.y;
  const assets = [...document.assets];
  if (bitmap && !assets.some((a) => a.id === bitmap.id))
    assets.push({
      ...bitmap,
      name: bitmap.name || layer.name + " · 替换前",
      layerSnapshot: { layerId: layer.id, sourceId: layer.assetId },
    });
  if (!existing) assets.push(asset);
  return {
    ...document,
    assets,
    layers: document.layers.map((l) => (l.id === layerId ? next : l)),
  };
}
module.exports = { materialSource, filterMaterials, replaceLayerAsset };
