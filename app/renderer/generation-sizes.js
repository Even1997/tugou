import {imageCapabilities,ratioOf} from '../core/image-settings.cjs';
export {ratioOf};
export const imageRatios=Object.entries(imageCapabilities().presets);
export function sizeOptions(value){
  const sizes=imageRatios.find(([ratio])=>ratio===ratioOf(value))?.[1]||[];
  return sizes.includes(value)?sizes:[...sizes,value||'auto'];
}
export function sizeDescription(value){
  const ratio=ratioOf(value);
  if(ratio==='auto')return '自动尺寸';
  const [w,h]=value.split('x').map(Number);
  return `${ratio==='custom'?'自定义':ratio} · ${w===h?'方图':w<h?'竖图':'横图'}`;
}
