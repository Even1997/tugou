const { cloudSettings } = require('./cloud-settings.cjs');
const { semanticItems } = require('./semantic-plan.cjs');

// Read the same purpose route (including the legacy active connection) as ConnectionStore.
function cloudToolReadiness(manager, settings, source, mask, purpose = 'image') {
  if (!manager) return { ready: false, reason: '正在读取模型配置…' };
  const connection = manager.connections.find(c => c.id === (manager.routes[purpose] || manager.activeId));
  const model = connection?.[purpose === 'analysis' ? 'analysisModel' : 'model'];
  if (!connection?.baseUrl || !connection.hasKey || !model)
    return { ready: false, reason: `请先配置${purpose === 'analysis' ? '视觉分析' : '图片生成'}模型、地址和 Key` };
  if (!source) return { ready: false, reason: '请选择来源图片' };
  try {
    if (purpose !== 'analysis') {
      if (settings.operation === 'cloudSplit') semanticItems(settings.instruction);
      else cloudSettings(settings, source);
      if (settings.operation === 'cloudEdit' && settings.maskMode === 'asset') {
        if (!mask) throw Error('请涂画修改区域或选择蒙版素材');
        if (mask.width !== source.width || mask.height !== source.height) throw Error('蒙版必须与原图尺寸一致');
      }
    }
    return { ready: true, reason: `${model} · 已配置`, model };
  } catch (e) { return { ready: false, reason: e.message }; }
}
module.exports = { cloudToolReadiness };
