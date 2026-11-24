// Builds two QA-only packages and exercises NSIS upgrade against a loopback feed.
// Distinct appId, isolated profile, no shortcuts, no publishing, no production config override.
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const appRoot=path.resolve(__dirname,'..'),out=path.join(appRoot,'test-results','installer-shutdown','settings-update'),installed=path.join(out,'installed-v2');
const assert=require('node:assert/strict'),{setTimeout:delay}=require('node:timers/promises');
async function run(command,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:appRoot,windowsHide:true,stdio:'inherit',...options});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error(`Process failed ${code}`)));});}
(async()=>{
 await fs.mkdir(out,{recursive:true});
 try{await fs.rename(path.join(out,'installed-report.json'),path.join(out,`installed-report-${Date.now()}.json`));}catch(e){if(e.code!=='ENOENT')throw e;}
 const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname).slice(1);if(!/^[\w. -]+$/.test(name))throw Error('name');const file=path.join(out,'new',name),bytes=await fs.readFile(file);res.writeHead(200,{'Content-Length':bytes.length});for(let i=0;i<bytes.length;i+=1024*1024){res.write(bytes.subarray(i,i+1024*1024));await new Promise(r=>setTimeout(r,18));}res.end();}catch{res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const feed=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const [folder,version] of [['old','0.8.1'],['new','0.8.2']]){
   const config=path.join(out,folder+'.cjs');
   await fs.writeFile(config,`const base=require(${JSON.stringify(path.join(appRoot,'electron-builder.cjs'))});module.exports={...base,appId:'app.tugou.settings.qa.shutdown',productName:'Tugou Settings QA',executableName:'TugouSettingsQA',directories:{output:${JSON.stringify(path.join(out,folder))}},files:[...base.files,'test/settings-installed-main.cjs'],extraMetadata:{version:${JSON.stringify(version)},main:'test/settings-installed-main.cjs'},publish:[{provider:'generic',url:${JSON.stringify(feed)}}],nsis:{...base.nsis,createDesktopShortcut:false,createStartMenuShortcut:false,runAfterFinish:false}};`);
   await run(process.execPath,['node_modules/electron-builder/out/cli/cli.js','--config',config,'--win','--x64','--publish','never']);
  }
  const old=path.join(out,'old','tugou-0.8.1-win-x64.exe');
  const args=['/S','/currentuser',`/D=${installed}`],binary=path.join(installed,'TugouSettingsQA.exe');
  await run(old,args);
  const holdEnv={...process.env};delete holdEnv.ELECTRON_RUN_AS_NODE;
  const reportFile=path.join(out,'installer-window.json');
  await fs.writeFile(reportFile,'pending');
  const preview=spawn(path.join(out,'old','win-unpacked','TugouSettingsQA.exe'),['--qa-hold'],{env:holdEnv,stdio:'ignore'});
  const held=spawn(binary,['--qa-hold'],{env:holdEnv,stdio:'ignore'});
  try{
    await delay(1000);
    await assert.rejects(run(old,args),/Process failed 2/);
    process.kill(held.pid,0);
  }finally{
    if(held.exitCode===null){held.kill();await new Promise(resolve=>held.once('exit',resolve));}
  }
  const window=spawn(binary,['--qa-graceful'],{env:{...holdEnv,TUGOU_CLOSE_QA_FILE:reportFile},stdio:'ignore'});
  const mcp=spawn(binary,[path.join(installed,'resources','app.asar','core','mcp.cjs'),'--session',path.join(out,'offline-session.json')],
    {env:{...holdEnv,ELECTRON_RUN_AS_NODE:'1'},stdio:['pipe','ignore','ignore']});
  try{
    for(let i=0;i<100&&(await fs.readFile(reportFile,'utf8'))!=='ready';i++)await delay(50);
    assert.equal(await fs.readFile(reportFile,'utf8'),'ready');
    process.kill(mcp.pid,0);
    await run(old,args);
    assert.equal(await fs.readFile(reportFile,'utf8'),'saved');
    assert.notEqual(mcp.exitCode,null);
    process.kill(preview.pid,0);
    await fs.writeFile(path.join(out,'installer-guard.json'),JSON.stringify({headlessAppProtected:true,windowSavedBeforeShutdown:true,orphanMcpClosed:true,previewPreserved:true}));
  }finally{
    for(const process of [preview,window,mcp])if(process.exitCode===null)process.kill();
  }
  const env={...process.env,TUGOU_DATA_DIR:path.join(out,'profile'),TUGOU_UPDATE_QA_OUTPUT:out};delete env.ELECTRON_RUN_AS_NODE;delete env.TUGOU_BUILD_DIR;
  const child=spawn(path.join(installed,'TugouSettingsQA.exe'),[],{cwd:installed,windowsHide:true,env,stdio:'ignore'});child.on('error',e=>console.error(e));
  let report;for(let i=0;i<240;i++){await new Promise(r=>setTimeout(r,1000));try{report=JSON.parse(await fs.readFile(path.join(out,'installed-report.json'),'utf8'));if(report.failure)throw Error(report.failure);if(report.complete)break;}catch(e){if(e.code!=='ENOENT')throw e;}}
  if(!report?.complete)throw Error('Installed upgrade did not complete');console.log(JSON.stringify(report,null,2));
 }finally{server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
