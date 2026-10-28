const angleDefaults = Object.freeze({
  horizontalAngle: 0,
  pitchAngle: 9,
  cameraDistance: 4.8,
  wideAngle: false,
});
function angleRequest(document, nodeId, assetId, value) {
  const node = document.tugouCanvas?.nodes.find(
    (n) => n.id === nodeId,
  );
  const asset = document.assets.find((a) => a.id === assetId);
  if (!asset || asset.kind&&asset.kind!=='image' || (node?.data.assetId||node?.data.outputAssetId) !== assetId)
    throw new Error("源图片已改变，请重新打开多角度");
  const p = Object.fromEntries(
    Object.keys(angleDefaults).map((key) => [
      key,
      value?.[key] ?? angleDefaults[key],
    ]),
  );
  if (
    !Number.isInteger(p.horizontalAngle) ||
    Math.abs(p.horizontalAngle) > 60 ||
    !Number.isInteger(p.pitchAngle) ||
    Math.abs(p.pitchAngle) > 45 ||
    !Number.isFinite(p.cameraDistance) ||
    p.cameraDistance < 1 ||
    p.cameraDistance > 10 ||
    typeof p.wideAngle !== "boolean"
  )
    throw new Error("镜头参数超出范围");
  const direction =
    p.horizontalAngle === 0
      ? "正面"
      : `${p.horizontalAngle > 0 ? "右侧" : "左侧"} ${Math.abs(p.horizontalAngle)}°`;
  const elevation =
    p.pitchAngle === 0
      ? "平视"
      : `${p.pitchAngle > 0 ? "俯视" : "仰视"} ${Math.abs(p.pitchAngle)}°`;
  return {
    params: p,
    label: `${asset.name || "图片"} · 多角度`,
    compiled: {
      prompt: `请根据附带原图，重新绘制同一主体在另一相机视角下的图像。保留主体身份、服饰、材质、色彩和原有画风，根据新视角合理重建可见结构与遮挡，不要把原图简单拉伸、旋转或透视扭曲。目标相机：${direction}，${elevation}；距离档位 ${p.cameraDistance.toFixed(1)} / 10（1 为近景，10 为远景）；${p.wideAngle ? "广角镜头" : "标准镜头"}。输出一张完整图片，不添加标注或拼接其他视图。`,
      size: "auto",
      references: [{ assetId, role: "多角度主体原图" }],
    },
  };
}
function resizeAssetNode(node, rect) {
  if (
    !['asset','text','module','recipe',...require('./workflow-nodes.cjs').types].includes(node.type) ||
    ![rect.width, rect.height, rect.x, rect.y].every(Number.isFinite) ||
    rect.width < 160 ||
    rect.height < 140 ||
    rect.width > 10000 ||
    rect.height > 10000
  )
    throw new Error(
      `节点显示尺寸超出范围 (${rect.width}, ${rect.height}, ${rect.x}, ${rect.y})`,
    );
  const { measured, resizing, dragging, ...rest } = node;
  return {
    ...rest,
    width: rect.width,
    height: rect.height,
    position: { ...node.position, x: rect.x, y: rect.y },
    style: { ...node.style, width: rect.width, height: rect.height },
  };
}
module.exports = { angleDefaults, angleRequest, resizeAssetNode };
