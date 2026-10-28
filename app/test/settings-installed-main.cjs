// Included only in the isolated update QA packages, never in a release build.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(process.argv.includes('--qa-hold')){setInterval(()=>{},1000);}else{
const out=path.resolve(path.dirname(process.execPath),'..');
if(path.basename(out)!=='settings-update'||!out.includes('test-results'))throw Error('Isolated QA directory required');
process.env.TUGOU_DATA_DIR=path.join(out,'profile');
const file=path.join(out,'installed-report.json');let report={checks:[],errors:[]};try{report=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
require('electron').dialog.showErrorBox=(title,detail)=>{report.failure=title+': '+detail;fs.writeFileSync(file,JSON.stringify(report,null,2));app.exit(1);};
process.on('uncaughtException',error=>{report.failure=error.stack;fs.writeFileSync(file,JSON.stringify(report,null,2));app.exit(1);});
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);fs.writeFileSync(file,JSON.stringify(report,null,2));};
const timeout=setTimeout(()=>{report.failure='installed test timeout';fs.writeFileSync(file,JSON.stringify(report,null,2));app.exit(1);},120000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{const js=code=>w.webContents.executeJavaScript(code,true),delay=ms=>new Promise(r=>setTimeout(r,ms));const wait=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await delay(100);}throw Error('wait timeout '+code);};const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
 try{
 await wait(`!!document.querySelector('.rail-bottom [aria-label="设置"]')`);
 const connect=async()=>{const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');const transport=new StdioClientTransport({command:process.execPath,args:[path.join(app.getAppPath(),'core','mcp.cjs'),'--session',path.join(process.env.TUGOU_DATA_DIR,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});const client=new Client({name:'installed-upgrade-qa',version:'1.0'});await client.connect(transport);return {client,transport};};
 if(app.getVersion()==='0.8.2'){
   const preferences=await js(`window.tugou.settings('get')`),restored=await js(`window.tugou.settings('lastProject')`);
   check('new executable really starts at version 0.8.2',preferences.version==='0.8.2');check('installed update retains project and preferences',restored?.document.name==='升级保留工程'&&preferences.preferences.sounds===true);
   check('installed update preserves original resources',fs.readFileSync(path.join(process.env.TUGOU_DATA_DIR,'workspace','resources','upgrade-sentinel.txt'),'utf8')==='KEEP');
   const {client}=await connect();const state=await client.callTool({name:'get_state',arguments:{}});check('MCP reconnects to upgraded application',!state.isError&&JSON.parse(state.content[0].text).capabilities.commands===135);await client.close();
   await js(`document.querySelector('.rail-bottom [aria-label="设置"]').click()`);await wait(`!!document.querySelector('[data-settings-tab="updates"]')`);await js(`document.querySelector('[data-settings-tab="updates"]').click()`);await delay(300);await capture('installed-after');report.complete=true;fs.writeFileSync(file,JSON.stringify(report,null,2));clearTimeout(timeout);app.exit(0);return;
 }
 check('old installed version is 0.8.1',app.getVersion()==='0.8.1');check('updater detects real installed NSIS build',(await js(`window.tugou.update('status')`)).supported===true);
 await js(`window.tugou.settings('mcpEnable',true)`);const bridge=await connect();bridge.client.onclose=()=>check('MCP bridge releases old executable before install',true);
 await js(`(async()=>{await window.tugou.settings('save',{sounds:true,autoCheck:false});const p=await window.tugou.create('升级保留工程');await window.tugou.open(p.id);})()`);fs.writeFileSync(path.join(process.env.TUGOU_DATA_DIR,'workspace','resources','upgrade-sentinel.txt'),'KEEP');
 await js(`document.querySelector('.rail-bottom [aria-label="设置"]').click()`);await wait(`!!document.querySelector('[data-settings-tab="updates"]')`);await js(`document.querySelector('[data-settings-tab="updates"]').click()`);
 const available=await js(`window.tugou.update('check')`);check('real electron-updater reads newer release metadata',available.status==='available'&&available.version==='0.8.2');await delay(800);await capture('installed-available');
 const download=js(`window.tugou.update('download')`);await delay(1000);await capture('installed-downloading');const ready=await download;check('real NSIS package downloaded and SHA512 verified',ready.status==='ready');await delay(800);await capture('installed-ready');
 await js(`window.tugou.dirty(true)`);const blocked=await js(`window.tugou.update('install')`);check('unsaved project blocks installation in real app',blocked.status==='ready'&&blocked.blocked==='unsaved');await delay(800);await capture('installed-blocked');await js(`window.tugou.dirty(false)`);
 check('installer only starts after explicit request',true);await js(`window.tugou.update('install')`);
 }catch(e){report.failure=e.stack;fs.writeFileSync(file,JSON.stringify(report,null,2));clearTimeout(timeout);app.exit(1);}
 });
});
require('../desktop-main.cjs');
}
