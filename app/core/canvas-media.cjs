function replaceCanvasAsset(document, nodeId, expectedAssetId, asset) {
  const graph = document.tugouCanvas;
  const node = graph?.nodes.find((n) => n.id === nodeId);
  const key=node?.type==='asset'?'assetId':'outputAssetId';
  if (!node || node.data[key] !== expectedAssetId)
    throw Error("节点图片已变化，请重新选择");
  if (!asset?.id||asset.kind&&asset.kind!=='image') throw Error("请选择替换图片");
  const existing = document.assets.find((a) => a.id === asset.id);
  if (
    existing &&
    (existing.resource !== asset.resource || existing.dataUrl !== asset.dataUrl)
  )
    throw Error("素材编号已被使用，请重新导入");
  if (asset.id === expectedAssetId) return document;
  return {
    ...document,
    assets: existing ? document.assets : [...document.assets, asset],
    tugouCanvas: {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === nodeId
          ? {
              ...n,
              data: {
                ...n.data,
                [key]: asset.id,
                ...(key==='outputAssetId'?{outputAssetIds:[...new Set([...(n.data.outputAssetIds||[]),asset.id])]}:{}),
                ...(n.data.legacy
                  ? {
                      legacyPromptAssetId:
                        n.data.legacyPromptAssetId ?? expectedAssetId,
                    }
                  : {}),
              },
            }
          : n,
      ),
    },
  };
}
module.exports = { replaceCanvasAsset };
