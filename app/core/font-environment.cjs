const fs=require('node:fs/promises'),path=require('node:path');
const {safePath}=require('./storage.cjs');
function setupHint(platform=process.platform){return platform==='darwin'?'请运行 node scripts/setup-font-runtime.cjs 配置字体环境':'请运行 scripts/setup-font-runtime.ps1 或 node scripts/setup-font-runtime.cjs 配置字体环境';}
async function fontEnvironment(location,platform=process.platform,arch=process.arch){
  const runtime=JSON.parse(await fs.readFile(await safePath(location,'runtime.json'),'utf8'));
  if((runtime.platform&&runtime.platform!==platform)||(runtime.arch&&runtime.arch!==arch))throw Error('字体环境与当前系统或芯片不匹配，请在本机重新配置');
  for(const key of ['python','potrace'])if(typeof runtime[key]!=='string'||!runtime[key]||path.isAbsolute(runtime[key]))throw Error('字体环境路径无效');
  // A POSIX venv's Python executable is normally a symlink. Only that final,
  // user-selected executable may resolve outside the environment; data paths may not.
  const directory=await safePath(location,path.dirname(runtime.python)),python=path.join(directory,path.basename(runtime.python));
  const potrace=await safePath(location,runtime.potrace);
  for(const file of [python,potrace]){
    if(!(await fs.stat(file)).isFile())throw Error('字体环境缺少可执行文件');
    await fs.access(file,platform==='win32'?fs.constants.F_OK:fs.constants.X_OK);
  }
  return {ready:true,python,potrace,versions:runtime.versions};
}
module.exports={fontEnvironment,setupHint};
