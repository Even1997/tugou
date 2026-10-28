const {app,webContents}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../test-results'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'tugou-raster-large-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'local-tools-build');
const report={profile,checks:[],errors:[]},peaks=new Map();
const finish=code=>{report.memory=[...peaks.values()];fs.writeFileSync(path.join(out,'raster-large-desktop.json'),JSON.stringify(report,null,2));app.exit(code)};
setTimeout(()=>{report.failure='timeout';finish(1)},180000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(name,value)=>{assert.ok(value,name);report.checks.push(name)};
    const timer=setInterval(()=>{for(const p of app.getAppMetrics())if((peaks.get(p.pid)?.peakKiB||0)<p.memory.peakWorkingSetSize)peaks.set(p.pid,{type:p.type,pid:p.pid,peakKiB:p.memory.peakWorkingSetSize})},100);
    try{
      await js('console.error("raster-large-sentinel")');check('all contents console capture verified',report.errors.includes('raster-large-sentinel'));report.errors=[];
      await js(fs.readFileSync(path.join(out,'geometry-engine-qa.js'),'utf8')+';void 0;');
      const asset=await js(`compositionQA.asset('一亿像素后台任务',10000,10000,(ctx,c)=>{ctx.fillStyle='#4080c0';ctx.fillRect(0,0,c.width,c.height);ctx.clearRect(0,0,64,64)})`);
      const record=await js('tugou.create("后台大图验收")');
      await js(`tugou.save(${JSON.stringify(record.id)},{...${JSON.stringify(record.document)},assets:[${JSON.stringify(asset)}]},${record.revision})`);
      await js('window.qaBeats=0;window.qaGap=0;window.qaLast=performance.now();window.qaTimer=setInterval(()=>{const t=performance.now();qaGap=Math.max(qaGap,t-qaLast);qaLast=t;qaBeats++},25)');
      const started=Date.now();
      const task=await js(`(async()=>{const r=await tugou.open(${JSON.stringify(record.id)});return tugou.startRasterTool(r.id,r.document,[${JSON.stringify(asset.id)}],{operation:'enhance',strength:100})})()`);
      let done;
      for(let i=0;i<4000;i++){done=(await js('tugou.tasks()')).find(t=>t.id===task.id);if(['completed','failed','cancelled'].includes(done.status))break;await delay(20)}
      report.durationMs=Date.now()-started;report.task=done;
      report.heartbeat=await js('(()=>{clearInterval(qaTimer);return {beats:qaBeats,maxGap:qaGap}})()');
      check('100MP queued processing completes',done.status==='completed');
      const result=(await js(`tugou.results(${JSON.stringify(record.id)})`))[0].assets[0];
      check('full 100MP output and frozen history retained',result.width===10000&&result.height===10000&&result.toolResult.source.resource===asset.resource);
      await delay(100);check('large compute host released before result inspection',!webContents.getAllWebContents().some(c=>c.getURL().endsWith('/tool-host.html')));
      report.samples=await js(`geometryQA.sample(${JSON.stringify(result)})`);
      check('large output alpha and changed color match',report.samples.values.every((p,i)=>{
        const [x,y]=report.samples.points[i];
        return p.join()===(x<64&&y<64?'0,0,0,0':'56,129,203,255');
      }));
      check('editor heartbeat remains responsive',report.heartbeat.beats>0&&report.heartbeat.maxGap<2000);
      check('no runtime errors',report.errors.length===0);check('QA window hidden',!w.isVisible());clearInterval(timer);finish(0);
    }catch(e){report.failure=e.stack;clearInterval(timer);finish(1)}
  });
});
require('../desktop-main.cjs');
