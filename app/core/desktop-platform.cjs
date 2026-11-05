const path=require('node:path');
function windowChrome(platform){
  return platform==='darwin'?{titleBarStyle:'hidden',trafficLightPosition:{x:16,y:20}}:{frame:false};
}
function initialWindowBounds(area){
  const width=Math.min(1280,area.width-48),height=Math.min(800,area.height-48);
  return {width,height,x:area.x+Math.floor((area.width-width)/2),y:area.y+Math.floor((area.height-height)/2),minWidth:Math.min(940,width),minHeight:Math.min(640,height)};
}
function installedForUpdates({packaged,platform,executable,home,exists}){
  if(!packaged)return false;
  if(platform==='darwin')return ['/Applications',path.posix.join(home,'Applications')].some(root=>executable.startsWith(root+'/')&&/\.app\/Contents\/MacOS\/[^/]+$/.test(executable));
  return platform==='win32'&&exists(path.win32.join(path.win32.dirname(executable),`Uninstall ${path.win32.basename(executable,'.exe')}.exe`));
}
module.exports={windowChrome,initialWindowBounds,installedForUpdates};
