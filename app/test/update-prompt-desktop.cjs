// Real renderer/IPC, isolated profile; updater fixtures never download or install a release.
const {app,shell}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createHash}=require('node:crypto');
const blockedStyleHashes=['body{display:none}','position:fixed'].map(text=>createHash('sha256').update(text).digest('base64'));
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const source=process.env.TUGOU_TEST_APP?path.resolve(path.dirname(process.env.TUGOU_TEST_APP)):path.resolve(__dirname,'..');
const out=path.resolve('test-results/update-prompt');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=process.env.TUGOU_TEST_APP?path.join(source,'dist'):path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require(path.join(source,'core/preference-values.cjs')).defaults,autoCheck:true,notifyTasks:false,language:'zh-CN'}));
const report={checks:[],errors:[],blockedStyles:[],note:'Windows native renderer and both update modes; updater is a fixture'},updater=new EventEmitter();
let controller,transport,finished=false,checks=0,installs=0,opened=0,finishDownload,version='0.8.8',downloadError=false;
const attack='<script>window.updateNotesExecuted=true</script><img src="https://invalid.example/track" onerror="window.updateNotesExecuted=true"><svg onload="window.updateNotesExecuted=true"></svg><iframe src="file:///C:/Windows/win.ini"></iframe><style>body{display:none}</style><a href="javascript:window.updateNotesExecuted=true">危险链接</a><a href="https://evil.example/">站外链接</a><p onclick="window.updateNotesExecuted=true" style="position:fixed">正常文字</p>';
const htmlNotes='<h1>土狗更新</h1><p>新增多画布与合成，改善 MCP 和字体下载。</p><h2>下载与更新</h2><table><thead><tr><th>平台</th><th>安装包</th></tr></thead><tbody><tr><td>Windows</td><td>EXE</td></tr></tbody></table><ul><li>保留未保存内容</li></ul><a href="https://github.com/Even1997/tugou/releases">发布详情</a>'+attack+'<p>更新详情：编辑与保存保护。</p>'.repeat(32);
const markdownNotes='# 土狗更新\n\n## 下载与更新\n\n| 平台 | 安装包 |\n| --- | --- |\n| Mac | DMG |\n\n- 保留未保存内容\n- **同步对比**\n\n[发布详情](https://github.com/Even1997/tugou/releases)\n\n'+attack;
let notes=htmlNotes;const externalLinks=[];shell.openExternal=async url=>{externalLinks.push(url);};
updater.checkForUpdates=async()=>{checks++;updater.emit('checking-for-update');updater.emit('update-available',{version,releaseNotes:notes});};
updater.downloadUpdate=async()=>{if(downloadError)throw Error('fixture network failure');await new Promise(resolve=>{finishDownload=()=>{updater.emit('update-downloaded',{version});resolve();};updater.emit('download-progress',{percent:42,total:100,transferred:42});});};
updater.quitAndInstall=()=>{installs++;};updater.openInstaller=async()=>{opened++;};
require(path.join(source,'core/desktop-platform.cjs')).installedForUpdates=()=>true;
if(process.platform==='darwin')require(path.join(source,'core/mac-dmg-updater.cjs')).MacDmgUpdater=class{constructor(){return updater;}};
const settings=require(path.join(source,'core/settings-desktop.cjs')),register=settings.registerSettings;
settings.registerSettings=async options=>{const result=await register({...options,updater});controller=result.updates;return result;};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
 w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level!=='error')return;if(e.message.startsWith('Applying inline style violates')&&blockedStyleHashes.some(hash=>e.message.includes(hash)))report.blockedStyles.push(e.message);else report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<400;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const click=async(selector,text)=>{const point=await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':`e.textContent===${JSON.stringify(text)}`});if(!e)throw Error('Missing button');const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()`);w.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});w.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});await delay(100);};
  const popup=()=>wait(`!!document.querySelector('.update-prompt')`),dismiss=async()=>{await click('.update-prompt button','稍后提醒');await wait(`!document.querySelector('.update-prompt')`);};
  const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.execPath,args:[path.join(source,'core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
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
   check('global popup includes version and release notes',await js(`document.querySelector('.update-prompt').textContent.includes('0.8.8')&&document.querySelector('.update-prompt .release-notes').textContent.includes('新增多画布')`));
   check('HTML release notes render headings lists and tables',await js(`document.querySelector('.update-prompt .release-notes h1')?.textContent==='土狗更新'&&document.querySelector('.update-prompt .release-notes th')?.textContent==='平台'&&!!document.querySelector('.update-prompt .release-notes li')`));
   check('untrusted HTML scripts resources styles handlers and URLs are removed',await js(`!window.updateNotesExecuted&&!document.querySelector('.release-notes script,.release-notes img,.release-notes svg,.release-notes iframe,.release-notes style,.release-notes [onclick],.release-notes [onerror],.release-notes [style]')&&[...document.querySelectorAll('.release-notes a[href]')].every(a=>a.getAttribute('href').startsWith('https://github.com/Even1997/tugou/'))`));
   const pageUrl=w.webContents.getURL();await js(`document.querySelector('.update-prompt .release-notes a[href]').click()`);await delay(100);
   check('release link opens trusted GitHub page without navigating application',externalLinks.at(-1)==='https://github.com/Even1997/tugou/releases'&&w.webContents.getURL()===pageUrl);
   for(const url of ['javascript:alert(1)','file:///C:/Windows/win.ini','data:text/html,bad','http://github.com/Even1997/tugou','https://evil.example/','https://github.com/Even1997/tugou.evil','https://github.com/Even1997/tugou/../../other','https://user@github.com/Even1997/tugou',null,{}]){
    check('main process rejects unsafe release URL '+JSON.stringify(url),await js(`window.tugou.settings('releaseLink',${JSON.stringify(url)}).then(()=>false,()=>true)`));
   }
   check('long release notes scroll within dialog',await js(`(()=>{const e=document.querySelector('.update-prompt .release-notes');return e.scrollHeight>e.clientHeight})()`));await capture('available-dark');
   await dismiss();const after=await state();check('popup leaves project revision, dirty state and undo unchanged',before.revision===after.revision&&before.dirty===after.dirty&&JSON.stringify(before.history)===JSON.stringify(after.history));
   updater.emit('update-available',{version,releaseNotes:notes});await delay(1800);check('same version is suppressed after Later',await js(`!document.querySelector('.update-prompt')`));
   check('Later persists a 24-hour reminder',await js(`(()=>{const r=JSON.parse(localStorage.getItem('tugou.update-reminder'));return r.version==='0.8.8'&&r.available>Date.now()+86300000})()`));
   await click('.rail-bottom [aria-label="设置"]');await wait(`!!document.querySelector('.settings-search input')`);await click('[data-settings-tab="updates"]');await click('.settings-notes summary');
   check('settings page shares formatted HTML release notes',await js(`!!document.querySelector('.settings-notes .release-notes table')&&!document.querySelector('.settings-notes pre')`));
   controller.set({notes:markdownNotes});await wait(`document.querySelector('.settings-notes .release-notes strong')?.textContent==='同步对比'`);
   check('Mac Markdown renders semantic headings lists and table',await js(`!!document.querySelector('.settings-notes .release-notes h2')&&document.querySelector('.settings-notes .release-notes td')?.textContent==='Mac'&&document.querySelectorAll('.settings-notes .release-notes li').length===2`));await capture('settings-markdown-dark');
   controller.set({notes:'纯文本说明\n保留换行 & < 5 > 3'});await wait(`document.querySelector('.settings-notes .release-notes')?.textContent.includes('纯文本说明')`);
   check('plain text line breaks and punctuation remain readable',await js(`document.querySelector('.settings-notes .release-notes').textContent.includes('保留换行 & < 5 > 3')&&!!document.querySelector('.settings-notes .release-notes br')`));
   controller.set({notes:htmlNotes});await wait(`!!document.querySelector('.settings-notes .release-notes h1')`);await capture('settings-html-dark');await click('[data-settings-tab="general"]');await js(`document.querySelector('.settings-search input').focus()`);
   version='0.8.9';updater.emit('update-available',{version,releaseNotes:notes});await delay(1800);check('focused text input defers a newer version',await js(`!document.querySelector('.update-prompt')&&document.activeElement===document.querySelector('.settings-search input')`));
   await js(`document.activeElement.blur();document.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,buttons:1}));`);await delay(1800);check('pointer drag also defers popup',await js(`!document.querySelector('.update-prompt')`));await js(`document.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);await popup();await dismiss();
   await click('[data-settings-tab="updates"]');await click('.settings-version button');await popup();check('explicit manual check reopens a dismissed version',checks===2);
   downloadError=true;await click('.update-prompt button','下载更新');await wait(`!!document.querySelector('.update-prompt [role="alert"]')`);check('download failure remains visible with a retry action',await js(`!![...document.querySelectorAll('.update-prompt button')].find(b=>b.textContent==='检查更新')`));
   downloadError=false;await click('.update-prompt button','检查更新');await wait(`!![...document.querySelectorAll('.update-prompt button')].find(b=>b.textContent==='下载更新')`);await click('.update-prompt button','下载更新');await wait(`document.querySelector('.update-prompt progress')?.value===42`);await capture('download-progress');check('popup uses actual updater progress',true);
   await click('.update-prompt button','后台下载');await wait(`!document.querySelector('.update-prompt')`);finishDownload();await popup();check('finished background download prompts once without installing',installs===0);
   await click('.update-prompt button','重启并安装');check('Windows requires explicit installation confirmation',await js(`document.querySelector('.update-prompt').textContent.includes('安装更新并重新启动？')`));await click('.update-prompt button','重启并安装');await wait(`!!document.querySelector('.update-prompt [role="alert"]')`);check('unsaved project blocks installation',installs===0&&controller.state.blocked==='unsaved');await dismiss();
   notes=markdownNotes;controller.set({status:'idle',version:null,blocked:null,installMode:'dmg'});version='0.8.10';await controller.check({autoDownload:false});await popup();check('Mac popup renders Markdown safely',await js(`!!document.querySelector('.update-prompt .release-notes table')&&!document.querySelector('.update-prompt script')&&!window.updateNotesExecuted`));check('Mac popup offers DMG download instead of Windows install',await js(`document.querySelector('.update-prompt').textContent.includes('下载 DMG')&&!document.querySelector('.update-prompt').textContent.includes('重启并安装')`));
   await click('.update-prompt button','下载 DMG');await wait(`!!document.querySelector('.update-prompt progress')`);finishDownload();await wait(`!![...document.querySelectorAll('.update-prompt button')].find(b=>b.textContent==='打开安装包')`);await click('.update-prompt button','打开安装包');check('Mac opens installer only after click without quitting',opened===1&&installs===0&&!w.isDestroyed());await capture('mac-ready');await dismiss();
   await click('[role="switch"][aria-label="自动下载更新"]');controller.set({status:'idle',version:null});version='0.8.11';await click('.settings-version button');await popup();
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
   check('no unexpected renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require(path.join(source,'desktop-main.cjs'));
