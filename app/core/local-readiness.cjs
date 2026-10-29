const cutoutModels = require('../runtime/cutout-models.json');
function localToolReadiness(status, settings, size) {
  if (!status) return { ready: false, reason: "正在检查本地组件…" };
  if (!status.configured) return { ready: false, reason: status.message || "请先安装本地组件" };
  if (settings.operation === 'cutout') {
    if (!status.cutout) return { ready: false, reason: status.cutoutReason || "请安装主体抠图组件" };
    const key = settings.model || 'birefnet', profile = cutoutModels[key];
    if (!profile) return { ready: false, reason: '抠图模型无效' };
    if (status.cutoutModels && !status.cutoutModels.includes(key))
      return { ready: false, reason: `请安装${profile.name}模型` };
    const buffers = (size?.width || 0) * (size?.height || 0) * 20;
    if (status.memory && (status.memory.available < profile.availableGiB * 1024 ** 3 + buffers || status.memory.commitAvailable < profile.commitGiB * 1024 ** 3 + buffers))
      return { ready: false, reason: key === 'birefnet' ? "精细抠图可用内存不足，可改选轻量主体模型" : '轻量抠图可用内存不足，请关闭占用内存的应用后刷新', resourceLimited: true };
    return { ready: true, reason: `${profile.name} · 已就绪` };
  }
  return status.models?.includes(settings.model)
    ? { ready: true, reason: "超分组件已就绪 · 使用本机显卡" }
    : { ready: false, reason: "超分组件或所选模型缺失，请安装超分组件" };
}
module.exports = { localToolReadiness };
