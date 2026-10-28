const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=require('./qa-paths.cjs').path("local-final"),source=JSON.parse(fs.readFileSync(path.join(base,'complex.json')));
process.env.TUGOU_DATA_DIR=source.profile;delete process.env.TUGOU_BUILD_DIR;
const report={profile:source.profile,checks:[],errors:[]},output=path.join(base,'complex-packaged.png'),cancelledOutput=path.join(base,'complex-cancelled.png');
const finish=code=>{fs.writeFileSync(path.join(base,'complex-packaged-ui.json'),JSON.stringify(report,null,2));app.exit(code)};
setTimeout(()=>{report.failure='timeout';finish(1)},180000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),check=(s,v)=>{assert.ok(v,s);report.checks.push(s)};
    const wait=async s=>{for(let i=0;i<1800;i++){if(await js(`Boolean(${s})`))return;await delay(50)}throw Error('timeout '+s)};
    const click=label=>js(`{const e=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw Error('missing '+${JSON.stringify(label)});e.click()}`);
    try{
      await js('console.error("packaged-export-sentinel")');check('console capture verified',report.errors.includes('packaged-export-sentinel'));report.errors=[];
      await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(source.id)},workspace:'layers'}))`);
      const ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;
      await wait('document.querySelector(".layer-stage canvas")');
      await js(`{const e=[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='透明导出').querySelector('input');if(!e.checked)e.click()}`);await delay(80);
      dialog.showSaveDialog=async()=>({canceled:false,filePath:cancelledOutput});
      check('cancel target is absent before test',!fs.existsSync(cancelledOutput));
      await click('导出 PNG');
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.startsWith("取消导出 "))');
      const at=Date.now();await js('[...document.querySelectorAll("button")].find(b=>b.textContent.startsWith("取消导出 ")).click()');
      await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="导出 PNG"&&!b.disabled)');report.cancelMs=Date.now()-at;
      check('top toolbar cancellation writes no partial PNG',!fs.existsSync(cancelledOutput));
      dialog.showSaveDialog=async()=>({canceled:false,filePath:output});
      await js('window.beats=0;window.maxGap=0;window.lastBeat=performance.now();window.beatTimer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-lastBeat);lastBeat=now;beats++},25)');
      const start=Date.now();await click('导出 PNG');await wait('document.querySelector(".layer-editor>.message")?.textContent.includes("已导出")');report.exportMs=Date.now()-start;
      report.heartbeat=await js('(()=>{clearInterval(beatTimer);return {beats,maxGap}})()');
      report.sha256=crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex');
      check('packaged UI export exactly matches original 100MP reference',report.sha256===source.result.resource.split('.')[0]);
      check('export yields between tiles',report.heartbeat.beats>10&&report.heartbeat.maxGap<2000);
      await w.capturePage();await delay(50);fs.writeFileSync(path.join(base,'complex-packaged-ui.png'),(await w.capturePage()).toPNG());
      check('no renderer errors',!report.errors.length);check('test window stays hidden',!w.isVisible());finish(0);
    }catch(e){report.failure=e.stack;finish(1)}
  });
});
require(require('./qa-paths.cjs').path("lean-package/win-unpacked/resources/app.asar/desktop-main.cjs"));
