const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=require('./qa-paths.cjs').path("local-final"),native=JSON.parse(fs.readFileSync(path.join(base,'cutout-native.json'))),id=native.tasks[0].context.projectId;
assert.ok(!native.failure&&!native.blocked);process.env.TUGOU_DATA_DIR=native.profile;delete process.env.TUGOU_BUILD_DIR;
const report={profile:native.profile,checks:[],errors:[]};
const finish=code=>{fs.writeFileSync(path.join(base,'cutout-packaged-ui.json'),JSON.stringify(report,null,2));app.exit(code)};
setTimeout(()=>{report.failure='timeout';finish(1)},90000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),check=(s,v)=>{assert.ok(v,s);report.checks.push(s)};
    const wait=async s=>{for(let i=0;i<900;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await delay(50)}throw Error('timeout '+s)};
    const click=async label=>{await js(`{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!e||e.disabled)throw Error('missing '+${JSON.stringify(label)});e.click()}`);await delay(80)};
    const save=async()=>{if(await js('[...document.querySelectorAll("button")].some(e=>e.getAttribute("aria-label")==="保存"&&!e.disabled)'))await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return js(`tugou.open(${JSON.stringify(id)})`)};
    try{
      await js('console.error("cutout-ui-sentinel")');check('console capture verified',report.errors.includes('cutout-ui-sentinel'));report.errors=[];
      await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:'tools'}))`);
      let ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;
      await wait('document.querySelectorAll(".processing-item").length===3');
      let r=await save();check('completed native batches enter material library once',r.document.assets.length===6&&r.document.futureCutout.keep);
      await js(`[...document.querySelectorAll('.processing-item')].find(e=>e.textContent.includes('pattern ·')).click()`);await delay(150);
      await wait('document.querySelector("img[alt=处理结果]")?.naturalWidth===512');
      check('native output preview uses exact result resource',await js(`document.querySelector('img[alt="处理结果"]').src.endsWith(${JSON.stringify(native.outputs[1].resource)})`));
      await w.capturePage();await delay(60);fs.writeFileSync(path.join(base,'cutout-packaged-ui.png'),(await w.capturePage()).toPNG());
      await click('本组加入画面');r=await save();check('both cutouts enter layer composition',r.document.layers.length===2&&r.document.layers.every(l=>native.outputs.slice(0,2).some(a=>a.id===l.assetId)));
      await click('撤销');check('batch layer insertion undoes together',(await save()).document.layers.length===0);
      await click('重做');check('batch layer insertion redoes together',(await save()).document.layers.length===2);
      await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:'tools'}))`);
      ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;await wait('document.querySelectorAll(".processing-item").length===3');
      r=await save();check('reopen preserves receipt, original assets and inserted layers',r.document.assets.length===6&&r.document.layers.length===2&&native.outputs.every(a=>r.document.assets.some(b=>b.resource===a.resource)));
      check('restart sends no inference',JSON.stringify((await js('tugou.tasks()')).map(t=>[t.id,t.status]))===JSON.stringify(native.tasks.map(t=>[t.id,t.status])));
      check('no renderer errors',!report.errors.length);check('window stays hidden',!w.isVisible());finish(0);
    }catch(e){report.failure=e.stack;finish(1)}
  });
});
require(require('./qa-paths.cjs').path("lean-package/win-unpacked/resources/app.asar/desktop-main.cjs"));
