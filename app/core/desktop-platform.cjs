const path=require('node:path');
function windowChrome(platform){
  return platform==='darwin'?{titleBarStyle:'hidden',trafficLightPosition:{x:16,y:20}}:{frame:false};
}
function installedForUpdates({packaged,platform,executable,home,exists}){
  if(!packaged)return false;
  if(platform==='darwin')return ['/Applications',path.posix.join(home,'Applications')].some(root=>executable.startsWith(root+'/')&&/\.app\/Contents\/MacOS\/[^/]+$/.test(executable));
  return platform==='win32'&&exists(path.win32.join(path.win32.dirname(executable),`Uninstall ${path.win32.basename(executable,'.exe')}.exe`));
}
module.exports={windowChrome,installedForUpdates};
