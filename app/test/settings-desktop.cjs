// Isolated Electron UI acceptance. Never loads the user's profile.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/settings'),report={checks:[],errors:[]};fs.mkdirSync(out,{recursive:true});
const reopen=process.argv.includes('--reopen'),previous=reopen?JSON.parse(fs.readFileSync(path.join(out,'desktop.json'),'utf8')):null;
if(previous)report.checks.push(...previous.checks);
const profile=previous?.profile||fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;
const main=process.env.TUGOU_SETTINGS_QA_PACKAGE?path.join(path.resolve(process.env.TUGOU_SETTINGS_QA_PACKAGE),'resources/app.asar/desktop-main.cjs'):path.resolve('desktop-main.cjs');
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
let done=false;function finish(code){if(done)return;done=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));app.exit(code);}
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{const js=code=>w.webContents.executeJavaScript(code,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let i=0;i<120;i++){if(await js(code))return;await delay(80);}throw Error('Timeout '+code);};
 const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
 const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
 try{
 if(reopen){await wait(`document.documentElement.lang==='en'&&document.documentElement.dataset.theme==='light'&&document.body.textContent.includes('设置恢复验收')`);check('full process restart restores language, theme and last project',true);check('MCP automatically reconnects after restart',!!JSON.parse(fs.readFileSync(path.join(profile,'mcp-session.json'),'utf8')).port);report.profile=profile;finish(0);return;}
 await wait(`!!document.querySelector('.rail-bottom [aria-label="设置"]')`);await click('.rail-bottom [aria-label="设置"]');await wait(`!!document.querySelector('[data-settings-tab="general"]')`);
 check('settings opens without a project and preserves global rail',await js(`document.querySelectorAll('[data-settings-tab]').length===7&&document.querySelectorAll('.workspace-rail > button').length===6`));
 await wait(`!document.querySelector('[aria-label="显示语言"]').disabled`);
 check('initial settings loaded',await js(`document.documentElement.lang==='zh-CN'`));
 check('normal launch disables development preview',await js(`!document.querySelector('.dev-preview-notice')`)&&!(await js(`window.tugou.devPreview('status')`)).enabled);
 check('normal launch rejects hot update mutations',await js(`window.tugou.devPreview('apply',{version:1}).then(()=>false,()=>true)`));
 await js(`(()=>{const el=document.querySelector('.settings-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'更新');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(`document.querySelectorAll('[data-settings-tab]').length===1`);check('settings search filters by translated content',await js(`!!document.querySelector('[data-settings-tab="updates"]')`));
 await js(`(()=>{const el=document.querySelector('.settings-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait(`document.querySelectorAll('[data-settings-tab]').length===7`);
 await capture('general-dark');
 await js(`document.querySelector('[role=switch][aria-label="任务完成通知"]').focus()`);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await wait(`document.querySelector('[role=switch][aria-label="任务完成通知"]').getAttribute('aria-checked')==='false'`);check('keyboard Space toggles focused setting',true);
 check('toggle persists in profile',JSON.parse(fs.readFileSync(path.join(profile,'preferences.json'),'utf8')).notifyTasks===false);
 for(const [language,label] of [['en','Display language'],['zh-TW','顯示語言'],['ja','表示言語'],['ko','표시 언어'],['zh-CN','显示语言']]){
  await js(`document.querySelector('.settings-row-control .ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('[data-option-value="${language}"]')`);await click(`[data-option-value="${language}"]`);await wait(`document.documentElement.lang==='${language}'`);
  check(language+' live localization without reload',await js(`!!document.querySelector('[aria-label=${JSON.stringify(label)}]')&&document.querySelectorAll('[data-settings-tab]').length===7`));
  check(language+' no horizontal overflow',await js(`document.documentElement.scrollWidth<=innerWidth`));await capture('general-'+language);
  if(language==='en'){w.setSize(940,640);await delay(160);check('English narrow window keeps close button visible',await js(`document.querySelector('.window-controls').getBoundingClientRect().right<=innerWidth`));await capture('general-en-narrow');w.setSize(1380,900);await delay(120);}
 }
 await click('[data-settings-tab="appearance"]');await click('button[aria-label="浅色"]');await wait(`document.documentElement.dataset.theme==='light'`);await capture('appearance-light');
 await click('button[aria-label="跟随系统"]');check('system theme persisted',(await js(`window.tugou.settings('get')`)).preferences.theme==='system');
 await click('button[aria-label="深色"]');await wait(`document.documentElement.dataset.theme==='dark'`);
 await click('[data-settings-tab="storage"]');await wait(`document.querySelector('.settings-storage-summary strong').textContent!=='—'`);
 const sentinel=path.join(profile,'workspace','resources','keep-original.bin');fs.writeFileSync(sentinel,'original-do-not-delete');
 await js(`Array.from(document.querySelectorAll('.settings-row-control button')).find(b=>b.textContent==='清理缓存').click()`);await wait(`document.body.textContent.includes('清理浏览器缓存？')`);await js(`Array.from(document.querySelectorAll('.ant-modal button')).find(b=>b.textContent==='清理缓存').click()`);await wait(`document.body.textContent.includes('缓存已清理')`);check('clear cache preserves original resource',fs.readFileSync(sentinel,'utf8')==='original-do-not-delete');await capture('storage');
 await click('[data-settings-tab="models"]');await wait(`document.body.textContent.includes('管理供应商与模型')`);check('model settings expose only image analysis and text defaults',await js(`document.querySelectorAll('.settings-model-select').length===3&&['图片生成','视觉分析','文本'].every(label=>document.body.textContent.includes(label))`));await capture('models');
 await click('[data-settings-tab="mcp"]');await wait(`!document.querySelector('[role=switch]').disabled`);await click('[role=switch]');await wait(`document.querySelector('[role=switch]').getAttribute('aria-checked')==='true'`);
 check('MCP enable creates live descriptor',fs.existsSync(path.join(profile,'mcp-session.json')));const first=JSON.parse(fs.readFileSync(path.join(profile,'mcp-session.json'),'utf8'));
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(path.dirname(main),'core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});const client=new Client({name:'settings-qa',version:'1.0'});await client.connect(transport);const response=await client.callTool({name:'get_state',arguments:{}});check('MCP SDK connects with all existing commands',!response.isError&&JSON.parse(response.content[0].text).capabilities.commands===136);await client.close();
 const config=await js(`window.tugou.settings('mcpConfig')`);check('copied config uses local executable and no session secret',config.includes('ELECTRON_RUN_AS_NODE')&&!config.includes(first.token));
 await click('[role=switch]');await wait(`document.querySelector('[role=switch]').getAttribute('aria-checked')==='false'`);check('MCP disabled persists',JSON.parse(fs.readFileSync(path.join(profile,'mcp-enabled.json'),'utf8')).enabled===false);
 await click('[role=switch]');await wait(`document.querySelector('[role=switch]').getAttribute('aria-checked')==='true'`);check('MCP re-enable rotates session credential',JSON.parse(fs.readFileSync(path.join(profile,'mcp-session.json'),'utf8')).token!==first.token);await capture('mcp');
 await click('[data-settings-tab="shortcuts"]');check('shortcuts match editor command model',await js(`document.body.textContent.includes('Ctrl + J')&&document.body.textContent.includes('Ctrl + D')`));await capture('shortcuts');
 await click('[data-settings-tab="updates"]');await wait(`document.body.textContent.includes('当前为预览 / 便携版')`);check('portable update prevents unsupported installation',await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='检查更新').disabled&&!document.body.textContent.includes('重启并安装')`));await capture('updates-portable');
 w.setSize(940,640);await delay(180);check('940px settings page has no page overflow',await js(`document.documentElement.scrollWidth<=innerWidth`));await capture('updates-narrow');
 const restart=await js(`(async()=>{const p=await window.tugou.create('设置恢复验收');await window.tugou.open(p.id);return p.id;})()`);check('last project is persisted',(await js(`window.tugou.settings('lastProject')`)).id===restart);
 check('invalid preference and unsafe update action rejected',await js(`Promise.all([window.tugou.settings('save',{feedUrl:'https://evil.invalid'}).then(()=>false,()=>true),window.tugou.update('run-exe').then(()=>false,()=>true)]).then(v=>v.every(Boolean))`));
 check('zero renderer errors',report.errors.length===0);await js(`window.tugou.settings('save',{language:'en',theme:'light'})`);report.profile=profile;finish(0);
 }catch(e){report.failure=e.stack;console.error(e);finish(1);}});
});
require(main);
