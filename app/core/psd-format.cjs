// Shared budgets are checked before raster allocation, in both processes.
const MAX_PIXELS=32*1024*1024, MAX_BYTES=128*1024*1024, MAX_LAYERS=128;
const blends={normal:'source-over',multiply:'multiply',screen:'screen',overlay:'overlay',darken:'darken',lighten:'lighten','color dodge':'color-dodge','color burn':'color-burn','hard light':'hard-light','soft light':'soft-light',difference:'difference',exclusion:'exclusion',hue:'hue',saturation:'saturation',color:'color',luminosity:'luminosity'};
function dimensions(width,height){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>30000||height>30000||width*height>MAX_PIXELS)throw Error('PSD 单边最多 30000 像素，画板及解码图层合计最多 3200 万像素');
}
function header(bytes){
  if(bytes.length<26||bytes.length>MAX_BYTES||bytes.toString('ascii',0,4)!=='8BPS'||bytes.readUInt16BE(4)!==1)throw Error('请选择有效的 PSD 文件（最多 128 MiB），暂不支持 PSB');
  if(bytes.readUInt16BE(22)!==8||bytes.readUInt16BE(24)!==3)throw Error('目前支持 8 位 RGB PSD，请先在 Photoshop 中转换色彩模式和位深');
  const width=bytes.readUInt32BE(18),height=bytes.readUInt32BE(14);dimensions(width,height);return {width,height};
}
module.exports={MAX_PIXELS,MAX_BYTES,MAX_LAYERS,blends,dimensions,header};
