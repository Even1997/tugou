// Real renderer + settings IPC + DMG download controller, isolated profile.
// Windows can exercise the Mac update UI; shell.openPath is recorded, not executed.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
const out=path.resolve('test-results/mac-dmg-update'),profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={platform:process.platform,mode:'Mac DMG UI and controller; native mount not exercised',checks:[],errors:[]},opened=[];
const bytes=Buffer.alloc(384*1024,42),digest=createHash('sha256').update(bytes).digest('hex');
const release={tag_name:'v0.8.3',draft:false,prerelease:false,body:'Fixture release notes',assets:[{name:'tugou-0.8.3-mac-arm64.dmg',browser_download_url:'https://github.com/Even1997/tugou/releases/download/v0.8.3/tugou-0.8.3-mac-arm64.dmg',digest:'sha256:'+digest,size:bytes.length}]};
let done=false,server;
function finish(code){if(done)return;done=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));server?.close();app.exit(code);}
function check(name,value){assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);}
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
const settings=require('../core/settings-desktop.cjs'),register=settings.registerSettings;
require('../core/desktop-platform.cjs').installedForUpdates=()=>true;
settings.registerSettings=options=>register({...options,updater:new (require('../core/mac-dmg-updater.cjs').MacDmgUpdater)({profile,version:'0.8.2',arch:'arm64',fetchRelease:async()=>({ok:true,json:async()=>release}),openPath:async file=>{opened.push(file);return '';}}),handle:(name,handler)=>options.handle(name,async(action,payload)=>{const value=await handler(action,payload);return name==='settings'&&action==='get'?{...value,platform:'darwin',arch:'arm64'}:value;})});
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  w.webContents.once('did-finish-load',async()=>{try{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async s=>{for(let i=0;i<160;i++){if(await js(s))return;await delay(50);}throw Error('timeout '+s);};
    const click=s=>js(`document.querySelector(${JSON.stringify(s)}).click()`);
    const button=text=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
    const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
    await wait(`!!document.querySelector('.rail-bottom [aria-label="设置"]')`);await click('.rail-bottom [aria-label="设置"]');await wait(`!!document.querySelector('[data-settings-tab="updates"]')`);await click('[data-settings-tab="updates"]');
    await wait(`!document.querySelector('.settings-version button').disabled`);await button('检查更新');await wait(`document.body.textContent.includes('下载 DMG')`);
    check('real settings IPC selects the DMG update mode',(await js(`window.tugou.update('status')`)).installMode==='dmg');
    check('available state exposes DMG download and manual replacement instructions',await js(`document.body.textContent.includes('安装由你手动完成')&&!document.body.textContent.includes('重启并安装')`));
    await wait(`!!document.querySelector('.update-prompt')`);await js(`Array.from(document.querySelectorAll('.update-prompt button')).find(b=>b.textContent==='稍后提醒').click()`);await wait(`!document.querySelector('.update-prompt')`);
    await button('下载 DMG');await wait(`!!document.querySelector('progress')&&document.querySelector('progress').value>0`);await capture('downloading');check('streamed download renders actual progress',true);
    await wait(`document.body.textContent.includes('安装包已下载')`);check('verified download never opens or quits automatically',opened.length===0);
    await wait(`!!document.querySelector('.update-prompt')`);await js(`Array.from(document.querySelectorAll('.update-prompt button')).find(b=>b.textContent==='稍后提醒').click()`);await wait(`!document.querySelector('.update-prompt')`);
    await button('打开安装包');await wait(`!document.querySelector('.settings-update-status button').disabled`);
    check('open button uses verified DMG and keeps app running',opened.length===1&&fs.readFileSync(opened[0]).equals(bytes)&&!w.isDestroyed());
    check('manual replacement explicitly preserves save and quit decision',await js(`document.body.textContent.includes('先保存并退出土狗')&&!document.querySelector('.ant-modal')`));
    check('old install action cannot invoke automatic replacement',await js(`window.tugou.update('install').then(()=>false,()=>true)`));
    await capture('ready-dark');
    for(const language of ['en','zh-TW','ja','ko','zh-CN']){
      await click('[data-settings-tab="general"]');await js(`document.querySelector('.settings-row-control .ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('[data-option-value="${language}"]')`);await click(`[data-option-value="${language}"]`);await wait(`document.documentElement.lang==='${language}'`);await click('[data-settings-tab="updates"]');
      w.setSize(940,640);await delay(100);check(language+' narrow UI has translated open action and no overflow',await js(`document.documentElement.scrollWidth<=innerWidth&&!document.querySelector('.settings-update-status').textContent.includes('dmgInstallHint')&&document.querySelector('.settings-update-status button').getBoundingClientRect().right<=innerWidth`));
      await capture('ready-'+language);
    }
    await click('[data-settings-tab="appearance"]');await button('浅色');await wait(`document.documentElement.dataset.theme==='light'`);await click('[data-settings-tab="updates"]');await capture('ready-light');
    check('light theme retains readable update controls',await js(`!!document.querySelector('.settings-update-status button')`));
    check('zero renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);finish(1);}});
});
server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Length':bytes.length});let offset=0;const timer=setInterval(()=>{res.write(bytes.subarray(offset,offset+32768));offset+=32768;if(offset>=bytes.length){clearInterval(timer);res.end();}},70);res.once('close',()=>clearInterval(timer));});
server.listen(0,'127.0.0.1',()=>{const realFetch=global.fetch;global.fetch=(url,options)=>realFetch(`http://127.0.0.1:${server.address().port}/asset`,options);require('../desktop-main.cjs');});
