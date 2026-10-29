const sharp=require('sharp');
const {fail}=require('./automation-commands.cjs');
async function captureUi(window,ui,args,attempt=0){
  if(window.isDestroyed())fail('SESSION_OFFLINE','应用窗口已关闭');
  if(window.isMinimized()||!window.isVisible())fail('WINDOW_NOT_VISIBLE','窗口已最小化或隐藏，请先恢复窗口；截图不会主动抢焦点');
  const before=await ui('ui.prepareCapture',args);
  const image=await window.webContents.capturePage(undefined,{stayHidden:true}),buffer=image.toPNG();
  if(image.isEmpty())fail('UI_NOT_READY','窗口暂时没有可截图的内容');
  const after=await ui('ui.inspect',{});
  if(before.revision!==after.revision||before.viewRevision!==after.viewRevision||JSON.stringify(before.redactedRegions)!==JSON.stringify(after.redactedRegions)){if(attempt<2)return captureUi(window,ui,args,attempt+1);fail('UI_CHANGED','界面持续变化，未返回过时截图，请稍后重试');}
  const meta=await sharp(buffer,{limitInputPixels:64000000}).metadata(),scaleX=meta.width/before.viewport.width,scaleY=meta.height/before.viewport.height;
  const pixel=r=>({left:Math.max(0,Math.floor(r.x*scaleX)),top:Math.max(0,Math.floor(r.y*scaleY)),width:Math.max(1,Math.ceil((r.x+r.width)*scaleX)-Math.floor(r.x*scaleX)),height:Math.max(1,Math.ceil((r.y+r.height)*scaleY)-Math.floor(r.y*scaleY))});
  const clamp=r=>({...r,width:Math.min(r.width,meta.width-r.left),height:Math.min(r.height,meta.height-r.top)});
  const masks=before.redactedRegions.map(pixel).map(clamp).filter(r=>r.width>0&&r.height>0);
  let bytes=buffer;
  if(masks.length)bytes=await sharp(buffer).composite(await Promise.all(masks.map(async r=>({left:r.left,top:r.top,input:await sharp({create:{width:r.width,height:r.height,channels:4,background:'#252830'}}).png().toBuffer()})))).png().toBuffer();
  const result=await sharp(bytes).extract(clamp(pixel(before.rect))).resize({width:args.maxSize||1440,height:args.maxSize||1440,fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
  return {mimeType:'image/png',data:result.data.toString('base64'),width:result.info.width,height:result.info.height,revision:before.revision,viewRevision:before.viewRevision,projectId:before.projectId,workspace:before.workspace,capturedAt:new Date().toISOString(),region:before.region,rect:before.rect,viewport:before.viewport,
    activePages:before.activePages,readiness:before.readiness,coverage:{...before.coverage,scrollAreas:before.scrollAreas,canvas:before.canvas,dialogs:before.dialogs,redactedRegions:masks.length},note:'仅当前可见应用内容；滚动区域请分段检查。原生系统对话框、屏幕外及折叠内容不在图中。'};
}
module.exports={captureUi};
