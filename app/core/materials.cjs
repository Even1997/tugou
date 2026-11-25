const { matrix, point, inherited } = require("./layers.cjs");
const names = new Intl.Collator("zh-CN", { numeric: true });
function materialSource(asset) {
  return asset.toolResult || asset.layerSnapshot
    ? "processed"
    : asset.generation || asset.recipeId
      ? "generated"
      : "imported";
}
function materialWorkspaces(document) {
  const canvasIds = new Set();
  const layerIds = new Set();
  const pptIds = new Set();
  const addCanvasNodes = (nodes) => {
    for (const n of nodes || []) {
      const d = n?.data;
      if (!d) continue;
      if (d.assetId) canvasIds.add(d.assetId);
      if (d.outputAssetId) canvasIds.add(d.outputAssetId);
      if (Array.isArray(d.outputAssetIds)) for (const id of d.outputAssetIds) if (id) canvasIds.add(id);
      if (d.localEdit?.assetId) canvasIds.add(d.localEdit.assetId);
      if (d.localEdit?.maskId) canvasIds.add(d.localEdit.maskId);
    }
  };
  const addLayers = (list) => {
    for (const l of list || []) {
      if (!l) continue;
      if (l.assetId) layerIds.add(l.assetId);
      if (l.bitmap?.id) layerIds.add(l.bitmap.id);
      if (l.mask?.bitmap?.id) layerIds.add(l.mask.bitmap.id);
    }
  };
  addCanvasNodes(document?.tugouCanvas?.nodes);
  for (const p of document?.pages?.canvas?.items || []) {
    if (!p?.ref && p?.content?.tugouCanvas?.nodes) addCanvasNodes(p.content.tugouCanvas.nodes);
  }
  addLayers(document?.layers);
  for (const p of document?.pages?.layers?.items || []) {
    if (!p?.ref && p?.content?.layers) addLayers(p.content.layers);
  }
  for (const deck of document?.presentations || []) {
    for (const slide of deck?.slides || []) {
      for (const el of slide?.elements || []) {
        if (el?.assetId) pptIds.add(el.assetId);
      }
    }
  }
  const map = new Map();
  for (const a of document?.assets || []) {
    if (!a?.id) continue;
    const list = [];
    if (canvasIds.has(a.id) || a.generation || a.recipeId) list.push("canvas");
    if (layerIds.has(a.id) || a.layerSnapshot) list.push("layers");
    if (pptIds.has(a.id)) list.push("ppt");
    map.set(a.id, list);
  }
  return map;
}
function filterMaterials(
  assets,
  { query = "", source = "all", workspace = "all", workspaces, shape = "all", sort = "newest", minRating = 0, rating } = {},
) {
  const text = query.trim().toLocaleLowerCase();
  return assets
    .map((asset, index) => ({ asset, index }))
    .filter(
      ({ asset: a }) => {
        const stars = Number.isInteger(a.rating) ? a.rating : 0;
        const scopes = workspaces?.get(a.id) || [];
        return (
          String(a.name || "")
            .toLocaleLowerCase()
            .includes(text) &&
          (rating !== undefined ? stars === rating : stars >= (minRating || 0)) &&
          (workspace === "all" || !workspaces
            ? true
            : workspace === "unused"
              ? scopes.length === 0
              : scopes.includes(workspace)) &&
          (source === "all" || materialSource(a) === source) &&
          (shape === "all" ||
            (shape === "portrait"
              ? a.height > a.width
              : shape === "landscape"
                ? a.width > a.height
                : a.width > 0 && a.width === a.height))
        );
      },
    )
    .sort((a, b) =>
      sort === "rating"
        ? (b.asset.rating || 0) - (a.asset.rating || 0) || b.index - a.index
        : sort === "name"
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
module.exports = { materialSource, materialWorkspaces, filterMaterials, replaceLayerAsset };
