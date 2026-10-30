// Shared by the renderer, MCP and all Images API requests. Rules describe the
// official model; an OpenAI-compatible supplier still needs its own verification.
const source='https://developers.openai.com/api/docs/guides/image-generation#size-and-quality-options';
const resolutions=['1k','2k','4k'];
const presets={
  '1:1':['1024x1024','2048x2048','2880x2880'],
  '2:3':['1024x1536','1376x2064','2336x3504'],
  '3:2':['1536x1024','2064x1376','3504x2336'],
  '3:4':['768x1024','1536x2048','2448x3264'],
  '4:3':['1024x768','2048x1536','3264x2448'],
  '4:5':['1024x1280','1600x2000','2560x3200'],
  '5:4':['1280x1024','2000x1600','3200x2560'],
  '9:16':['720x1280','1152x2048','2160x3840'],
  '16:9':['1280x720','2048x1152','3840x2160'],
};
const labels={auto:'自动',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高',standard:'标准',hd:'高清'};
function imageCapabilities(model=''){
  const id=model.trim().toLowerCase().split('/').at(-1);
  const modern=/^gpt-image-2(?:\.5-(?:sunburst|flare))?(?:-\d{4}-\d{2}-\d{2})?$/.test(id);
  const legacy=/^gpt-image-1(?:\.5|-mini)?(?:-\d{4}-\d{2}-\d{2})?$/.test(id);
  const latest=modern&&id.startsWith('gpt-image-2.5-');
  const known=modern||legacy;
  return {model,known,protocol:'images',qualityValues:known?['auto','low','medium','high',...(latest?['xhigh','max']:[])]:Object.keys(labels),
    presets:legacy?{'1:1':['1024x1024'],'2:3':['1024x1536'],'3:2':['1536x1024']}:presets,resolutions:legacy?['1k']:resolutions,custom:!legacy,
    limits:modern?{step:16,maxEdge:3840,minPixels:655360,maxPixels:8294400,maxRatio:3}:null,
    source:known?source:null,notice:known?'按官方模型规则校验，供应商兼容性仍需验证':'模型能力未验证，参数将按原值提交，请以供应商文档为准'};
}
function imageSettingsError(model,{size='auto',quality='auto'}={}){
  const p=imageCapabilities(model);
  if(quality==='')quality='auto';
  if(typeof quality!=='string'||quality.length>512)return '质量参数无效';
  if(p.known&&!p.qualityValues.includes(quality))return `当前模型不支持质量「${labels[quality]||quality}」，请选择${p.qualityValues.map(q=>labels[q]).join('、')}`;
  if(size==='auto')return '';
  if(!p.custom&&!Object.values(p.presets).some(s=>s.includes(size)))return '当前模型仅支持 1024 × 1024、1024 × 1536、1536 × 1024';
  if(typeof size!=='string'||!/^\d{1,5}x\d{1,5}$/.test(size))return '尺寸请填写宽x高或 auto';
  const [w,h]=size.split('x').map(Number),pixels=w*h;
  if(w<1||h<1||pixels>100000000)return '图片尺寸需为正整数且在一亿像素以内';
  if(p.limits){
    const l=p.limits;
    if(w%l.step||h%l.step)return '当前模型的宽度和高度均须为 16 的倍数';
    if(Math.max(w,h)>l.maxEdge)return '当前模型单边不能超过 3840 px';
    if(pixels<l.minPixels||pixels>l.maxPixels)return '当前模型总像素须在 655,360–8,294,400 之间';
    if(Math.max(w/h,h/w)>l.maxRatio)return '当前模型宽高比须在 1:3–3:1 之间';
  }
  return '';
}
function validateImageSettings(model,settings){const error=imageSettingsError(model,settings);if(error)throw Object.assign(Error(error),{safeMessage:error});}
function ratioOf(value){
  if(!value||value==='auto')return 'auto';
  if(!/^\d+x\d+$/.test(value))return 'custom';
  const [w,h]=value.split('x').map(Number);if(w<1||h<1)return 'custom';
  return Object.keys(presets).find(r=>{const [rw,rh]=r.split(':').map(Number);return w*rh===h*rw;})||'custom';
}
function resolutionOf(value,model){
  if(!value||value==='auto')return 'auto';
  const list=imageCapabilities(model).presets[ratioOf(value)]||[],index=list.indexOf(value);
  return resolutions[index]||'custom';
}
function sizeFor(ratio,resolution,model){return imageCapabilities(model).presets[ratio]?.[resolutions.indexOf(resolution)];}
function imageResultWarning(size,width,height){
  if(!size||size==='auto'||!width||!height||size===`${width}x${height}`)return '';
  return `尺寸不符：请求 ${size.replace('x',' × ')}，实际 ${width} × ${height}；已保留原图`;
}
module.exports={imageCapabilities,imageSettingsError,validateImageSettings,ratioOf,resolutionOf,sizeFor,imageResultWarning,qualityLabels:labels};
