const cleanupNames = { watermark: '可见水印修复', metadata: '元数据清理' };
const cleanupDefaults = {
  watermark: { mode: 'auto', maskId: '', radius: 6, left: 0, top: 0, width: 128, height: 128 },
  metadata: { preserveDisplay: true },
};
function validateCleanup(settings, size) {
  if (!cleanupNames[settings?.operation]) throw Error('请选择有效的清理工具');
  if (settings.operation === 'watermark') {
    if (!['auto', 'mask', 'region'].includes(settings.mode) || !Number.isInteger(settings.radius) || settings.radius < 1 || settings.radius > 20)
      throw Error('水印修复参数无效');
    if (settings.mode === 'mask' && (typeof settings.maskId !== 'string' || !settings.maskId || settings.maskId.length > 256))
      throw Error('请先涂画需要修复的区域');
    if (settings.mode==='region' && (![settings.left,settings.top,settings.width,settings.height].every(Number.isInteger) || settings.left<0 || settings.top<0 || settings.width<1 || settings.height<1 || settings.left+settings.width>size.width || settings.top+settings.height>size.height)) throw Error('框选区域超出原图范围');
    if (size.width * size.height > 24000000) throw Error('水印修复暂支持 2400 万像素以内的图片');
  } else if (settings.preserveDisplay !== true) throw Error('元数据清理须保留色彩配置和显示方向');
}
module.exports = { cleanupNames, cleanupDefaults, validateCleanup };
