// Real Electron and IPC on the host; --mac-ui simulates ONLY the renderer platform.
// Run this same script natively on macOS to verify AppKit and traffic-light behavior.
const electron=require('electron'),{app,clipboard,safeStorage}=electron,fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const simulated=process.argv.includes('--mac-ui'),platform=simulated?'darwin':process.platform;
const out=path.resolve('test-results/mac-parity'),label=simulated?'mac-ui-simulation':process.platform;
fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
if(simulated){
  const preload=path.join(profile,'preload.cjs');fs.writeFileSync(preload,fs.readFileSync(path.resolve('preload.cjs'),'utf8').replace('platform:process.platform',"platform:'darwin'"));
  const Module=require('node:module'),load=Module._load;
  class TestWindow extends electron.BrowserWindow{constructor(options){super({...options,webPreferences:{...options.webPreferences,preload}});}}
  const proxy=new Proxy(electron,{get:(target,key)=>key==='BrowserWindow'?TestWindow:target[key]});
  Module._load=function(name,...args){return name==='electron'?proxy:load.call(this,name,...args);};
}
const {bridge}=require('../core/mcp.cjs'),report={host:process.platform,renderer:platform,simulated,checks:[],errors:[]};let done=false;
let oldClipboard;
function finish(code){if(done)return;done=true;if(oldClipboard!==undefined)clipboard.writeText(oldClipboard);fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(report,null,2));app.exit(code);}
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
function check(name,value){assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);}
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});w.webContents.once('did-finish-load',async()=>{try{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<160;i++){if(await js(s))return;await delay(50);}throw Error('timeout '+s);};
  const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});
  const click=async(label,scope='document')=>{await js(`(()=>{const b=[...${scope}.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing '+${JSON.stringify(label)});b.click()})()`);await delay(120);};
  const command=async(name,blur=true)=>{if(blur)await js('document.activeElement?.blur()');w.webContents.send('tugou:command',name);await delay(160);};
  await wait(`!!document.querySelector('.studio-header')`);
  oldClipboard=clipboard.readText();
  check('isolated context, correct platform bridge',await js(`window.tugou.platform===${JSON.stringify(platform)}&&typeof require==='undefined'&&typeof process==='undefined'`));
  await run('project.create',{name:'双端 中文路径验收'});await run('workspace.show',{workspace:'canvas'});
  for(const theme of ['light','dark'])for(const width of [1380,940]){
    w.setSize(width,800);await js(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('.rail-bottom button:last-child').click()`);await delay(180);
    check(`${theme} ${width} controls match platform`,await js(`!!document.querySelector('.window-controls')===${platform!=='darwin'}`));
    check(`${theme} ${width} header does not overflow`,await js(`(()=>{const h=document.querySelector('.studio-header');return h.scrollWidth<=h.clientWidth})()`));
    check(`${theme} ${width} brand clears native controls`,await js(`document.querySelector('.brand').getBoundingClientRect().left>=${platform==='darwin'?88:0}`));
    if(width===1380){w.showInactive();await delay(100);fs.writeFileSync(path.join(out,label+'-'+theme+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();}
  }
  await run('canvas.create',{type:'text',position:{x:0,y:0},properties:{text:'双端内容'}});await wait(`document.querySelectorAll('.react-flow__node').length===1`);
  await command('selectAll');await command('copy');await command('paste');await wait(`document.querySelectorAll('.react-flow__node').length===2`);check('native menu select copy paste canvas',true);
  await command('undo');await wait(`document.querySelectorAll('.react-flow__node').length===1`);await command('redo');await wait(`document.querySelectorAll('.react-flow__node').length===2`);check('menu undo redo preserve document history',true);
  await command('selectAll');await command('cut');await wait(`document.querySelectorAll('.react-flow__node').length===0`);await command('paste');await wait(`document.querySelectorAll('.react-flow__node').length===2`);check('cut paste retains both nodes',true);
  const before=await call('get_state');check('edits tracked as unsaved',before.dirty);
  await click('模型连接');await wait(`!!document.querySelector('.connection-dialog')`);await click('＋ 添加供应商');await wait(`!!document.querySelector('#supplier-name')`);
  await js(`document.querySelector('#supplier-name').focus()`);await command('selectAll',false);
  check('native selectAll works inside modal input',await js(`document.activeElement.selectionEnd-document.activeElement.selectionStart===document.activeElement.value.length`));
  clipboard.writeText('Mac Win 中文');await command('paste',false);await wait(`document.querySelector('#supplier-name').value==='Mac Win 中文'`);check('native paste edits modal input',true);
  await command('selectAll',false);await command('copy',false);check('native copy reads modal input',clipboard.readText()==='Mac Win 中文');
  await command('cut',false);await wait(`document.querySelector('#supplier-name').value===''`);check('native cut works inside modal',true);
  await js(`document.querySelector('.connection-dialog button').focus()`);await command('paste',false);check('modal blocks underlying canvas paste',(await call('get_state')).counts.nodes===before.counts.nodes);
  await click('取消',`document.querySelector('.connection-dialog')`);await wait(`!document.querySelector('.connection-dialog')`);check('cancelled modal preserves unsaved project',(await call('get_state')).dirty);
  const board=await run('artboard.create',{name:'字体画板',width:800,height:600});const text=await run('layer.create',{artboardId:board.id,kind:'text',properties:{text:'春日来信 Abc',fontSize:48}});
  const object=(await call('get_object',{kind:'layer',id:text.id})).object;check('new text uses bundled cross-platform face',object.fontFamily==='Source Han Sans SC');
  await run('workspace.show',{workspace:'layers',layerIds:[text.id]});await wait(`!!document.querySelector('.layer-editor')`);
  const fonts=await js(`window.tugou.fontCommand('font.library',{})`);report.localFonts=fonts.system.length;check('host local fonts and builtins load without warning',fonts.system.length>0&&fonts.builtin.length>0&&!fonts.warning);
  await wait(`document.fonts.size>0`);check('bundled text font loads for rendering',await js(`Array.from(document.fonts).some(f=>f.status==='loaded')`));
  await run('project.save');const saved=await call('get_state');await js('location.reload()');await wait(`!!document.querySelector('.studio-header')`);
  check('reload preserves saved project and layer counts',(await call('get_state')).counts.layers===saved.counts.layers&&!(await call('get_state')).dirty);
  check('system credential encryption available',safeStorage.isEncryptionAvailable());
  check('updater quit event registered',electron.autoUpdater.listenerCount('before-quit-for-update')>0);check('no renderer errors',report.errors.length===0);finish(0);
}catch(e){report.failure=e.stack;console.error(e);finish(1);}});});
require(path.resolve('desktop-main.cjs'));
