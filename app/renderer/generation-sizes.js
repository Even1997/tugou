export const imageRatios=[
  ['1:1',['1024x1024','2048x2048','4096x4096']],
  ['2:3',['1024x1536','2048x3072']],
  ['3:2',['1536x1024','3072x2048']],
  ['3:4',['768x1024','1536x2048','3072x4096']],
  ['4:3',['1024x768','2048x1536','4096x3072']],
  ['4:5',['1024x1280','2048x2560','3072x3840']],
  ['5:4',['1280x1024','2560x2048','3840x3072']],
  ['9:16',['720x1280','1080x1920','1440x2560','2160x3840']],
  ['16:9',['1280x720','1920x1080','2560x1440','3840x2160']],
];
export function ratioOf(value){
  if(!value||value==='auto')return 'auto';
  if(!/^\d+x\d+$/.test(value))return 'custom';
  const [w,h]=value.split('x').map(Number);
  if(w<1||h<1)return 'custom';
  return imageRatios.find(([ratio])=>{const [rw,rh]=ratio.split(':').map(Number);return w*rh===h*rw;})?.[0]||'custom';
}
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
