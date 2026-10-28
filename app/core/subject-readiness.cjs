function subjectReadiness(status,size,available,platform=process.platform){
  if(!status.configured||!status.cutout)return {ready:false,reason:(status.message?status.message+'；':'主体模型未就绪；')+'请到工具页配置本地 AI 组件'};
  const {width,height}=size||{};
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>100000000)return {ready:false,reason:'请选择尺寸有效的图片'};
  const pixels=width*height,minimum=512*1024**2+pixels*16;
  if(available<minimum)return {ready:false,reason:'可用内存不足，请关闭占用内存的应用后刷新'};
  if(platform==='win32'){
    if(!status.memory)return {ready:false,reason:'无法确认主体识别的内存状态，请刷新检查'};
    if(status.memory.available<2*1024**3+pixels*20||status.memory.commitAvailable<14*1024**3+pixels*20)return {ready:false,reason:'主体识别内存不足，请关闭占用内存的应用后刷新'};
  }
  return {ready:true,reason:'本地主体模型已就绪',provider:status.provider};
}
module.exports={subjectReadiness};
