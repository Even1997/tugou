// Builds two QA-only packages and exercises NSIS upgrade against a loopback feed.
// Distinct appId, isolated profile, no shortcuts, no publishing, no production config override.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const appRoot=path.resolve(__dirname,'..'),out=path.join(appRoot,'test-results','settings-update'),installed=path.join(out,'installed-v2');
async function run(command,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:appRoot,windowsHide:true,stdio:'inherit',...options});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Process failed ${code}`)));});}
(async()=>{
 await fs.mkdir(out,{recursive:true});
 try{await fs.rename(path.join(out,'installed-report.json'),path.join(out,`installed-report-${Date.now()}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
 const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);if(!/^[\w. -]+$/.test(name))throw Error('name');const file=path.join(out,'new',name),bytes=await fs.readFile(file);res.writeHead(200,{'Content-Length':bytes.length});for(let i=0;i<bytes.length;i+=1024*1024){res.write(bytes.subarray(i,i+1024*1024));await new Promise(r=>setTimeout(r,18));}res.end();}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const feed=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const [folder,version] of [['old','0.8.1'],['new','0.8.2']]){
   const config=path.join(out,folder+'.cjs');
   await fs.writeFile(config,`const base=require(${JSON.stringify(path.join(appRoot,'electron-builder.cjs'))});module.exports={...base,appId:'app.tugou.settings.qa.v2',productName:'Tugou Settings QA',executableName:'TugouSettingsQA',directories:{output:${JSON.stringify(path.join(out,folder))}},files:[...base.files,'test/settings-installed-main.cjs'],extraMetadata:{version:${JSON.stringify(version)},main:'test/settings-installed-main.cjs'},publish:[{provider:'generic',url:${JSON.stringify(feed)}}],nsis:{...base.nsis,createDesktopShortcut:false,createStartMenuShortcut:false,runAfterFinish:false}};`);
   await run(process.execPath,['node_modules/electron-builder/out/cli/cli.js','--config',config,'--win','--x64','--publish','never']);
  }
  const old=path.join(out,'old','tugou-0.8.1-win-x64.exe');
  const holdEnv={...process.env};delete holdEnv.ELECTRON_RUN_AS_NODE;
  const held=spawn(path.join(out,'old','win-unpacked','TugouSettingsQA.exe'),['--qa-hold'],{windowsHide:true,env:holdEnv,stdio:'ignore'});await new Promise(r=>setTimeout(r,1000));
  let refused=false;try{await run(old,['/S','/currentuser',`/D=${installed}`]);}catch(e){if(e.message==='Process failed 2')refused=true;else throw e;}
  process.kill(held.pid,0);await fs.writeFile(path.join(out,'installer-guard.json'),JSON.stringify({refused,heldProcessSurvived:true}));held.kill();await new Promise(r=>held.once('exit',r));if(!refused)throw Error('Installer did not protect running app');
  await run(old,['/S','/currentuser',`/D=${installed}`]);
  const env={...process.env,TUGOU_DATA_DIR:path.join(out,'profile'),TUGOU_UPDATE_QA_OUTPUT:out};delete env.ELECTRON_RUN_AS_NODE;delete env.TUGOU_BUILD_DIR;
  const child=spawn(path.join(installed,'TugouSettingsQA.exe'),[],{cwd:installed,windowsHide:true,env,stdio:'ignore'});child.on('error',e=>console.error(e));
  let report;for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,1000));try{report=JSON.parse(await fs.readFile(path.join(out,'installed-report.json'),'utf8'));if(report.failure)throw Error(report.failure);if(report.complete)break;}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(!report?.complete)throw Error('Installed upgrade did not complete');console.log(JSON.stringify(report,null,2));
 }finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
