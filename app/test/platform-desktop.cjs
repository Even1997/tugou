// No drive letters or real user files: run on Windows and macOS with Electron.
const {app, safeStorage} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const profile = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tugou-platform-qa-'));
process.env.TUGOU_DATA_DIR = profile;
const output = path.resolve(__dirname, '../test-results');
fs.mkdirSync(output, {recursive:true});
const report = {platform:process.platform, arch:process.arch, profile, checks:[], errors:[]};
const finish = code => {fs.writeFileSync(path.join(output, `platform-${process.platform}.json`), JSON.stringify(report,null,2)); app.exit(code);};
const timeout = setTimeout(()=>{report.failure='Desktop test timed out';finish(1);},45000);
app.on('browser-window-created',(_event,window)=>{
  window.webContents.on('console-message',(_event,d)=>{if(d.level==='error')report.errors.push(d.message);});
  window.webContents.once('did-finish-load',async()=>{
    const js=code=>window.webContents.executeJavaScript(code,true);
    const wait=async code=>{for(let i=0;i<100;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,50));}throw new Error('Timeout: '+code);};
    const click=label=>js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);
    const check=(label,value)=>{assert.ok(value,label);report.checks.push(label);};
    const command=async name=>{await js('document.activeElement?.blur()');window.webContents.send('tugou:command',name);await new Promise(r=>setTimeout(r,80));};
    try {
      await wait('document.querySelector(".studio-header")');
      check('platform bridge does not expose Node',await js(`window.tugou.platform===${JSON.stringify(process.platform)}&&typeof require==='undefined'&&typeof process==='undefined'`));
      await click('新建工程');await wait('document.querySelector(".prompt-workbench")');
      const id=await js('document.querySelector("[aria-label=当前工程]").closest(".studio-select").dataset.value');
      for(const [label,selector] of [['无限画布','.canvas-workspace'],['图层合成','.layer-editor'],['图像工具','.image-tools'],['素材库','.asset-library'],['提示词工作台','.prompt-workbench']]){
        await click(label);await wait(`document.querySelector(${JSON.stringify(selector)})`);check(`${label} opens`,true);
      }
      await click('无限画布');await click('文字');await wait('document.querySelectorAll(".react-flow__node").length===1');
      await command('selectAll');await command('copy');await command('paste');await wait('document.querySelectorAll(".react-flow__node").length===2');check('native menu commands select, copy and paste canvas nodes',true);
      await command('undo');await wait('document.querySelectorAll(".react-flow__node").length===1');
      await command('redo');await wait('document.querySelectorAll(".react-flow__node").length===2');check('native undo and redo use document history',true);
      await command('selectAll');await command('cut');await wait('document.querySelectorAll(".react-flow__node").length===0');await command('paste');await wait('document.querySelectorAll(".react-flow__node").length===2');check('cut and paste retain canvas content',true);
      await click('保存');await wait('document.querySelector(".statusbar").textContent.includes("已保存")');
      check('canvas persists in the same project format', (await js(`window.tugou.open(${JSON.stringify(id)})`)).document.tugouCanvas.nodes.length===2);
      check('system credential encryption is available',safeStorage.isEncryptionAvailable());
      const settings=await js("window.tugou.saveConnection({baseUrl:'https://example.com/v1',model:'qa',apiKey:'platform-qa-secret'})");
      check('credentials never return to the renderer',settings.hasKey&&!settings.apiKey);
      check('credentials are encrypted on disk',!fs.readFileSync(path.join(profile,'workspace','connection.enc')).includes(Buffer.from('platform-qa-secret')));
      await click('模型连接');await wait('document.querySelector("input[type=password]")');
      await js('document.querySelector("input[type=password]").focus()');
      window.webContents.insertText('native-input');
      window.webContents.send('tugou:command','selectAll');await new Promise(r=>setTimeout(r,80));
      check('native menu selects text instead of canvas nodes',await js('document.activeElement.selectionEnd-document.activeElement.selectionStart===12'));
      await click('取消');
      if(process.platform==='darwin'){
        window.close();check('Mac window close preserves the application',!window.isDestroyed()&&!window.isVisible());
        app.emit('activate');check('Mac activation restores the existing window',window.isVisible());
      }
      check('no renderer errors',report.errors.length===0);
      await fs.promises.writeFile(path.join(output,`platform-${process.platform}.png`),(await window.webContents.capturePage()).toPNG());
      clearTimeout(timeout);finish(0);
    }catch(error){report.failure=error.stack;clearTimeout(timeout);finish(1);}
  });
});
require('../main.cjs');
