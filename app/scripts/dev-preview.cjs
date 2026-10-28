const fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),profile=process.env.TUGOU_DATA_DIR||path.join(root,'preview-data'),output=path.join(root,'.dev-preview','ui');
async function read(name){try{return JSON.parse(await fs.readFile(path.join(profile,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const alive=pid=>{if(!Number.isInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}};
async function launch(){const env={...process.env,TUGOU_DATA_DIR:profile,TUGOU_BUILD_DIR:output,TUGOU_DEV_PREVIEW:'1'};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(require('electron'),[path.join(root,'main.cjs'),'--mcp-enable'],{cwd:root,env,detached:true,windowsHide:true,stdio:'ignore'});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();return child.pid;}
async function start(){
  await fs.mkdir(path.dirname(output),{recursive:true});
  const marker=await read('dev-preview-running.json'),session=await read('mcp-session.json');
  if(alive(marker?.pid)){await launch();return;}
  if(alive(session?.pid))throw Error('请先保存并关闭当前旧版窗口，再首次启动开发预览。');
  const lock=path.join(root,'.dev-preview','launch.lock');let handle;
  try{
    try{const pid=Number(await fs.readFile(lock,'utf8'));if(Number.isInteger(pid)&&pid>0&&!alive(pid))await fs.unlink(lock);}catch(e){if(e.code!=='ENOENT')throw e;}
    handle=await fs.open(lock,'wx');await handle.writeFile(String(process.pid));
    await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(root,'build.cjs')],{cwd:root,windowsHide:true,env:{...process.env,TUGOU_BUILD_DIR:output},stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',data=>{error=(error+data).slice(-2000);});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(error||'界面构建失败')));});
    const pid=await launch();
    for(let i=0;i<150;i++){if((await read('dev-preview-running.json'))?.pid===pid)return;if(!alive(pid))throw Error('开发预览已退出，请检查启动环境。');await new Promise(r=>setTimeout(r,100));}
    throw Error('开发预览启动超时，请查看已打开的窗口。');
  }finally{if(handle){await handle.close();await fs.unlink(lock).catch(()=>{});}}
}
start().catch(async error=>{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(path.join(root,'.dev-preview','startup-error.txt'),String(error.stack));console.error(error.message);process.exitCode=1;});
