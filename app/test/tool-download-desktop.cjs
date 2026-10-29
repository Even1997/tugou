// Isolated UI lifecycle test; the installer transport is simulated, never user data.
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/tool-download');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'desktop-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
let behavior='wait',starts=0,dialogCalls=0,transport,finished=false;const installed=new Set(),jobs=[];
dialog.showOpenDialog=async()=>{dialogCalls++;return {canceled:true,filePaths:[]};};
const {LocalAIService}=require('../core/local-ai.cjs'),{RuntimeInstaller}=require('../core/runtime-install.cjs');
LocalAIService.prototype.status=async function(){return {configured:installed.size>0,models:installed.has('upscale')?['general','anime','illustration']:[],cutout:installed.has('cutout'),cutoutModels:installed.has('cutout')?['u2netp','birefnet']:[],provider:'CPUExecutionProvider',folder:path.join(profile,'components'),downloadFolder:path.join(profile,'components','tugou-components')};};
RuntimeInstaller.prototype.execute=async function(job,signal,id){
 starts++;jobs.push(job);const t=this.tasks.tasks.find(t=>t.id===id);t.progress=42;t.message='下载组件 · 42%';await this.tasks.persist();
 if(behavior==='wait')await new Promise(r=>signal.addEventListener('abort',r,{once:true}));
 signal.throwIfAborted();
 if(behavior==='fail')throw Object.assign(Error('fixture'),{safeMessage:'下载失败，请手动继续'});
 await new Promise(r=>setTimeout(r,250));if(job.cutout)installed.add('cutout');if(job.upscale)installed.add('upscale');t.progress=100;t.message='组件已安装并启用';
};
const report={checks:[],errors:[]};const check=(s,v)=>{assert.ok(v,s);report.checks.push(s);console.log('PASS '+s);};
const finish=code=>{if(finished)return;finished=true;report.installerStarts=starts;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async s=>{for(let i=0;i<200;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
 const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable '+${JSON.stringify(label)});b.click()})()`);await delay(150);};
 const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
 try{
  await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
  transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
  const client=new Client({name:'download-qa',version:'1'});await client.connect(transport);
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
  const state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision});
  await state();await call('list_commands',{domain:'tools'});await run('project.create',{name:'工具下载检查'});await run('ui.navigate',{workspace:'tools'});await click('AI 超分辨率');
  await wait(`!!document.querySelector('[aria-label="工具在云端"]')`);await delay(1000);
  check('opening tools shows cloud marker and makes no download',starts===0&&dialogCalls===0);await capture('cloud');
  check('missing component cannot process',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始处理').disabled`));
  await click('主体抠图');await click('AI 超分辨率');await click('刷新状态');await delay(1000);
  check('selection and refresh never download',starts===0);
  await click('下载工具');await wait(`!!document.querySelector('[aria-label="工具下载进度"]')`);
  check('explicit download selects only upscale in default private folder',starts===1&&jobs[0].upscale&&!jobs[0].cutout&&jobs[0].root===path.join(profile,'components','tugou-components')&&dialogCalls===0);
  await wait(`document.querySelector('[aria-label="工具下载进度"]')?.getAttribute('aria-valuenow')==='42'`);
  check('circular progress reports phase percentage',await js(`document.querySelector('[aria-label="工具下载进度"]').getAttribute('aria-valuenow')==='42'`));await capture('progress');
  await click('主体抠图');check('other running component blocks parallel download',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='下载工具').disabled`));
  await click('AI 超分辨率');await click('取消下载');await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='继续下载')`);
  await click('素材');await run('ui.navigate',{workspace:'tools'});await click('AI 超分辨率');await delay(1300);
  check('cancelled download remains paused after navigation',starts===1);await capture('paused');
  behavior='fail';await click('继续下载');await wait(`document.querySelector('.tool-download')?.textContent.includes('下载失败')`);await delay(1000);
  check('failure never retries automatically',starts===2&&!installed.size);
  behavior='ok';await click('继续下载');await wait(`!!document.querySelector('[aria-label="工具已下载"]')`);
  check('completion removes cloud marker and enables offline state',starts===3&&await js(`!document.querySelector('[aria-label="工具在云端"]')&&document.querySelector('.tool-download').textContent.includes('离线可用')`));await capture('installed');
  await click('主体抠图');await wait(`!!document.querySelector('[aria-label="工具在云端"]')`);
  check('installing upscale does not mark cutout as installed',await js(`document.querySelector('.tool-download').textContent.includes('494.2 MB')`));
  await click('下载工具');await wait(`!!document.querySelector('[aria-label="工具已下载"]')`);
  check('cutout is downloaded separately without requesting upscale',starts===4&&jobs.at(-1).cutout&&!jobs.at(-1).upscale);
  await click('AI 超分辨率');await wait(`!!document.querySelector('[aria-label="工具已下载"]')`);check('both installed tools retain offline state',installed.size===2);
  w.setSize(960,720);await click('切换浅色主题');await delay(250);await capture('light');
  check('download panel fits narrow light theme',await js(`(()=>{const e=document.querySelector('.tool-download'),r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.left>=0&&r.right<=innerWidth})()`));
  check('no renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
