export const materialMime = "application/x-tugou";
export function dragMaterial(event, projectId, assetId) {
  event.dataTransfer.setData(
    materialMime,
    JSON.stringify({ projectId, type: "asset", id: assetId }),
  );
  event.dataTransfer.effectAllowed = "copy";
}
export function readMaterialDrop(event, projectId, document) {
  const data = JSON.parse(event.dataTransfer.getData(materialMime));
  if (data.type !== "asset" || data.projectId !== projectId)
    throw Error("请从当前工程的素材库拖入图片");
  const asset = document.assets.find((a) => a.id === data.id);
  if (!asset) throw Error("素材已移除，请重新选择");
  return asset;
}
