const {localToolReadiness}=require('./local-readiness.cjs');
function subjectReadiness(status,size,available,platform=process.platform){
  if(!status.configured||!status.cutout)return {ready:false,reason:(status.message?status.message+'；':'主体模型未就绪；')+'请到工具页配置本地 AI 组件'};
  const {width,height}=size||{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>100000000)return {ready:false,reason:'请选择尺寸有效的图片'};
  const pixels=width*height,minimum=512*1024**2+pixels*16;
  if(available<minimum)return {ready:false,reason:'可用内存不足，请关闭占用内存的应用后刷新'};
  if(platform==='win32'){
    if(!status.memory)return {ready:false,reason:'无法确认主体识别的内存状态，请刷新检查'};
  }
  const precise=localToolReadiness(status,{operation:'cutout',model:'birefnet'},size);
  if(precise.ready)return {...precise,model:'birefnet',provider:status.provider};
  if(status.cutoutModels?.includes('u2netp')){
    const light=localToolReadiness(status,{operation:'cutout',model:'u2netp'},size);
    return {...light,model:'u2netp',provider:'CPUExecutionProvider'};
  }
  return precise;
}
module.exports={subjectReadiness};
