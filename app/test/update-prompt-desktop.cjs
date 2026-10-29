// Real renderer/IPC, isolated profile; updater fixtures never download or install a release.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/update-prompt');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:true,notifyTasks:false,language:'zh-CN'}));
const report={checks:[],errors:[],note:'Windows native renderer and both update modes; updater is a fixture'},updater=new EventEmitter();
let controller,transport,finished=false,checks=0,installs=0,opened=0,finishDownload,version='0.8.5',downloadError=false;
const notes='新增多画布与合成，改善 MCP 和字体下载。\n<script>window.updateNotesExecuted=true</script>\n'+('更新详情：编辑与保存保护。\n'.repeat(32));
updater.checkForUpdates=async()=>{checks++;updater.emit('checking-for-update');updater.emit('update-available',{version,releaseNotes:notes});};
updater.downloadUpdate=async()=>{if(downloadError)throw Error('fixture network failure');await new Promise(resolve=>{finishDownload=()=>{updater.emit('update-downloaded',{version});resolve();};updater.emit('download-progress',{percent:42,total:100,transferred:42});});};
updater.quitAndInstall=()=>{installs++;};updater.openInstaller=async()=>{opened++;};
require('../core/desktop-platform.cjs').installedForUpdates=()=>true;
const settings=require('../core/settings-desktop.cjs'),register=settings.registerSettings;
settings.registerSettings=async options=>{const result=await register({...options,updater});controller=result.updates;return result;};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
 w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<400;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const click=async(selector,text)=>{const point=await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':`e.textContent===${JSON.stringify(text)}`});if(!e)throw Error('Missing button');const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);w.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});w.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await delay(100);};
  const popup=()=>wait(`!!document.querySelector('.update-prompt')`),dismiss=async()=>{await click('.update-prompt button','稍后提醒');await wait(`!document.querySelector('.update-prompt')`);};
  const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'update-prompt-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const result=await client.callTool({name,arguments:args});if(result.isError)throw Error(result.content[0].text);return result.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision});
   await run('project.create',{name:'更新弹窗隔离验收'});await run('canvas.create',{type:'text',position:{x:30,y:40},properties:{text:'保留未保存内容'}});
   await run('page.activate',{kind:'canvas',id:'canvas-main'});
   const before=await state();check('fixture contains unsaved edits and history',before.dirty&&before.history.undo>0);
   await click('[aria-label="新建画布"]');await wait(`!!document.querySelector('[aria-label="画布名称"]')`);
   await js(`(()=>{const e=document.querySelector('[aria-label="画布名称"]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'尚未确认的名称');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
   await wait(`window.tugou.update('status').then(s=>s.status==='available')`);await delay(1800);
   check('startup automatic check runs without opening Settings',checks===1);
   check('update waits for existing modal and preserves draft',await js(`!document.querySelector('.update-prompt')&&document.querySelector('[aria-label="画布名称"]').value==='尚未确认的名称'`));
   await click('[role="dialog"] button','取消');await popup();
   check('global popup includes version and release notes',await js(`document.querySelector('.update-prompt').textContent.includes('0.8.5')&&document.querySelector('.update-prompt pre').textContent.includes('新增多画布')`));
   check('release HTML is displayed as inert text',await js(`!window.updateNotesExecuted&&!document.querySelector('.update-prompt script')&&document.querySelector('.update-prompt pre').textContent.includes('<script>')`));
   check('long release notes scroll within dialog',await js(`(()=>{const e=document.querySelector('.update-prompt pre');return e.scrollHeight>e.clientHeight})()`));await capture('available-dark');
   await dismiss();const after=await state();check('popup leaves project revision, dirty state and undo unchanged',before.revision===after.revision&&before.dirty===after.dirty&&JSON.stringify(before.history)===JSON.stringify(after.history));
   updater.emit('update-available',{version,releaseNotes:notes});await delay(1800);check('same version is suppressed after Later',await js(`!document.querySelector('.update-prompt')`));
   check('Later persists a 24-hour reminder',await js(`(()=>{const r=JSON.parse(localStorage.getItem('tugou.update-reminder'));return r.version==='0.8.5'&&r.available>Date.now()+86300000})()`));
   await click('.rail-bottom [aria-label="设置"]');await wait(`!!document.querySelector('.settings-search input')`);await js(`document.querySelector('.settings-search input').focus()`);
   version='0.8.6';updater.emit('update-available',{version,releaseNotes:notes});await delay(1800);check('focused text input defers a newer version',await js(`!document.querySelector('.update-prompt')&&document.activeElement===document.querySelector('.settings-search input')`));
   await js(`document.activeElement.blur();document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,buttons:1}));`);await delay(1800);check('pointer drag also defers popup',await js(`!document.querySelector('.update-prompt')`));await js(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);await popup();await dismiss();
   await click('[data-settings-tab="updates"]');await click('.settings-version button');await popup();check('explicit manual check reopens a dismissed version',checks===2);
   downloadError=true;await click('.update-prompt button','下载更新');await wait(`!!document.querySelector('.update-prompt [role="alert"]')`);check('download failure remains visible with a retry action',await js(`!![...document.querySelectorAll('.update-prompt button')].find(b=>b.textContent==='检查更新')`));
   downloadError=false;await click('.update-prompt button','检查更新');await wait(`!![...document.querySelectorAll('.update-prompt button')].find(b=>b.textContent==='下载更新')`);await click('.update-prompt button','下载更新');await wait(`document.querySelector('.update-prompt progress')?.value===42`);await capture('download-progress');check('popup uses actual updater progress',true);
   await click('.update-prompt button','后台下载');await wait(`!document.querySelector('.update-prompt')`);finishDownload();await popup();check('finished background download prompts once without installing',installs===0);
   await click('.update-prompt button','重启并安装');check('Windows requires explicit installation confirmation',await js(`document.querySelector('.update-prompt').textContent.includes('安装更新并重新启动？')`));await click('.update-prompt button','重启并安装');await wait(`!!document.querySelector('.update-prompt [role="alert"]')`);check('unsaved project blocks installation',installs===0&&controller.state.blocked==='unsaved');await dismiss();
   controller.set({status:'idle',version:null,blocked:null,installMode:'dmg'});version='0.8.7';await controller.check({autoDownload:false});await popup();check('Mac popup offers DMG download instead of Windows install',await js(`document.querySelector('.update-prompt').textContent.includes('下载 DMG')&&!document.querySelector('.update-prompt').textContent.includes('重启并安装')`));
   await click('.update-prompt button','下载 DMG');await wait(`!!document.querySelector('.update-prompt progress')`);finishDownload();await wait(`!![...document.querySelectorAll('.update-prompt button')].find(b=>b.textContent==='打开安装包')`);await click('.update-prompt button','打开安装包');check('Mac opens installer only after click without quitting',opened===1&&installs===0&&!w.isDestroyed());await capture('mac-ready');await dismiss();
   await click('[role="switch"][aria-label="自动下载更新"]');controller.set({status:'idle',version:null});version='0.8.8';await click('.settings-version button');await popup();
   check('opt-in automatic download displays live progress',await js(`document.querySelector('.update-prompt progress')?.value===42`));finishDownload();await wait(`!![...document.querySelectorAll('.update-prompt button')].find(b=>b.textContent==='打开安装包')`);await dismiss();await delay(1800);
   check('late manual check response does not reopen a dismissed ready popup',await js(`!document.querySelector('.update-prompt')`));await click('[role="switch"][aria-label="自动下载更新"]');
   await click('[data-settings-tab="general"]');
   for(const language of ['en','zh-TW','ja','ko','zh-CN']){
    await js(`document.querySelector('.settings-row-control .ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('[data-option-value="${language}"]')`);await click(`[data-option-value="${language}"]`);await wait(`document.documentElement.lang==='${language}'`);
    version='0.8.'+(8+report.checks.length);controller.set({status:'available',version,notes,blocked:null});await popup();w.setSize(940,640);await delay(100);
    check(language+' dialog stays translated and inside narrow viewport',await js(`(()=>{const e=document.querySelector('.update-prompt'),r=e.getBoundingClientRect(),b=e.querySelector('.dialog-footer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&b.bottom<=innerHeight&&!e.textContent.includes('updateFoundTitle')})()`));await capture('narrow-'+language);await click('.update-prompt .ant-modal-close');await wait(`!document.querySelector('.update-prompt')`);
   }
   await click('[data-settings-tab="appearance"]');await click('button','浅色');await wait(`document.documentElement.dataset.theme==='light'`);version='0.9.1';controller.set({status:'available',version,notes});await popup();await capture('available-light');await dismiss();
   controller.set({status:'latest',version:null});await delay(1800);check('latest version never opens a popup',await js(`!document.querySelector('.update-prompt')`));
   controller.set({status:'available',version:'0.9.2',supported:false});await delay(1800);check('unsupported portable build does not offer installation',await js(`!document.querySelector('.update-prompt')`));
   await run('project.save');controller.set({status:'available',version:'0.9.1',supported:true});w.webContents.reload();await delay(400);await wait(`!!document.querySelector('.workspace-rail')`);await delay(1800);check('reminder survives renderer reload',await js(`!document.querySelector('.update-prompt')`));
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
