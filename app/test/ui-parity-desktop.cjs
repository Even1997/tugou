const {app}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
if(!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR))throw new Error('Isolated profile required');
const out=path.resolve(__dirname,'../test-results'),report={checks:[],errors:[]},timer=setTimeout(()=>app.exit(1),120000);
app.on('browser-window-created',(_e,window)=>{
 window.webContents.on('console-message',(_e,d)=>{if(d.level==='error')report.errors.push(d.message);});
 window.webContents.once('did-finish-load',async()=>{
  const js=code=>window.webContents.executeJavaScript(code,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await delay(50);}throw new Error('Timeout: '+code);};
  const click=async(label,selector='button')=>{await js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);await delay(150);};
  const capture=async name=>{await delay(200);await fs.writeFile(path.join(out,`parity-${name}.png`),(await window.webContents.capturePage()).toPNG());};
  const check=(label,value)=>{assert.ok(value,label);report.checks.push(label);};
  try{
   await wait('document.querySelector(".studio-header")');
   await js("window.qaErrors=[];window.addEventListener('error',e=>window.qaErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.qaErrors.push(String(e.reason)))");
   if(await js('document.documentElement.dataset.theme==="light"'))await click('切换深色主题');
   const list=await js('window.tugou.list()');let record;for(const p of list){const r=await js(`window.tugou.open(${JSON.stringify(p.id)})`);if(r.document.assets.length===4){record=r;break;}}assert.ok(record);
   window.setSize(1280,900);
   await js(`{const e=document.querySelector('select[aria-label=当前工程]');e.value=${JSON.stringify(record.id)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
   await wait('document.querySelector(".prompt-workbench")');
   check('workbench restores simultaneous module editor and recipe sidebar',await js('!!document.querySelector(".module-list")&&!!document.querySelector(".module-editor")&&!!document.querySelector(".recipe-sidebar")'));
   check('shared Ant Design buttons are mounted across the shell and workbench',await js('document.querySelectorAll(".ant-btn").length>20'));
   check('single compact title navigation row',await js('document.querySelector(".studio-header").getBoundingClientRect().height<=64'));
   await capture('workbench-dark');
   await click('素材库','nav button');await wait('Array.from(document.querySelectorAll(".asset-image img")).every(i=>i.complete&&i.naturalWidth>0)');
   check('material library retains every original image',await js('document.querySelectorAll(".asset-image img").length===4'));
   await capture('materials-dark');
   await click('图层合成','nav button');await wait('document.querySelector(".layer-editor")');await delay(600);await capture('layers-dark');
   await click('图像工具','nav button');await capture('tools-dark');
   await click('无限画布','nav button');await wait('document.querySelector(".react-flow")');await capture('canvas-dark');
   await click('切换浅色主题');await wait('document.documentElement.dataset.theme==="light"');
   check('canvas inherits shared light theme',await js('!!document.querySelector(".react-flow.light")'));
   for(const [label,name] of [['无限画布','canvas'],['图层合成','layers'],['素材库','materials'],['图像工具','tools'],['提示词工作台','workbench']]){await click(label,'nav button');await capture(name+'-light');}
   await click('模型连接','.toolbar-end button');await wait('document.querySelector(".ant-modal input[type=password]")');
   check('connection dialog uses shared component library and does not expose saved secret',await js('document.querySelector(".ant-modal input[type=password]").value===""'));
   await capture('connection-light');await click('关闭模型连接');
   await click('任务','.statusbar button');await wait('document.querySelector(".task-dialog")');await capture('tasks-light');await click('关闭任务');
   window.setSize(960,720);await delay(200);
   for(const label of ['提示词工作台','无限画布','图层合成','图像工具','素材库']){await click(label,'nav button');check(label+' at 960px stays inside viewport',await js('document.documentElement.scrollWidth<=innerWidth'));window.webContents.setZoomFactor(1.25);await delay(120);check(label+' at 125% stays inside viewport',await js('document.documentElement.scrollWidth<=innerWidth'));window.webContents.setZoomFactor(1);}
   await click('提示词工作台','nav button');check('960px document does not overflow',await js('document.documentElement.scrollWidth<=innerWidth'));
   await capture('workbench-960');
   window.webContents.setZoomFactor(1.25);await delay(150);check('125% content zoom remains within window',await js('document.documentElement.scrollWidth<=innerWidth'));await capture('workbench-125');window.webContents.setZoomFactor(1);
   const after=await js(`window.tugou.open(${JSON.stringify(record.id)})`);assert.deepEqual(after.document,record.document);check('UI navigation and themes do not mutate existing document',true);
   report.rendererMemory=app.getAppMetrics().filter(m=>m.type==='Tab').map(m=>m.memory);report.navigation=await js('performance.getEntriesByType("navigation").map(n=>({loadMs:n.duration,domReadyMs:n.domContentLoadedEventEnd}))');
   report.runtimeErrors=await js('window.qaErrors');check('no renderer or CSP errors',report.errors.length===0&&report.runtimeErrors.length===0);
   await fs.writeFile(path.join(out,'ui-parity-desktop.json'),JSON.stringify(report,null,2));clearTimeout(timer);await js('window.tugou.window("close")');
  }catch(e){report.failure=e.stack;report.runtimeErrors=await js('window.qaErrors');await fs.writeFile(path.join(out,'ui-parity-desktop.json'),JSON.stringify(report,null,2));await capture('failure');clearTimeout(timer);app.exit(1);}
 });
});
require('../main.cjs');
