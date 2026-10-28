const {app,webContents}=require('electron'), fs=require('node:fs'), path=require('node:path'), os=require('node:os'), assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../test-results'), restart=process.argv.includes('--restart');
const prior=restart?JSON.parse(fs.readFileSync(path.join(out,'raster-shutdown-desktop.json'))):null;
const profile=prior?.profile||fs.mkdtempSync(path.join(os.tmpdir(),'tugou-raster-shutdown-'));
process.env.TUGOU_DATA_DIR=profile;
process.env.TUGOU_BUILD_DIR=path.join(out,'local-tools-build');
const report={profile,checks:[],errors:[]};
const finish=code=>{fs.writeFileSync(path.join(out,restart?'raster-shutdown-restart.json':'raster-shutdown-desktop.json'),JSON.stringify(report,null,2));app.exit(code)};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name)};
setTimeout(()=>{report.failure='timeout';finish(1)},120000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true), delay=ms=>new Promise(r=>setTimeout(r,ms));
    const tasks=()=>js('tugou.tasks()');
    try{
      await js('console.error("shutdown-sentinel")');
      check('console capture verified',report.errors.includes('shutdown-sentinel'));report.errors=[];
      if(restart){
        report.id=prior.id;
        let list=await tasks();
        check('interrupted batch persists',list.length===1&&list[0].id===prior.taskId&&list[0].status==='interrupted');
        check('no automatic retry after restart',!webContents.getAllWebContents().some(c=>c.getURL().endsWith('/tool-host.html')));
        check('partial outputs are not published',(await js(`tugou.results(${JSON.stringify(prior.id)})`)).length===0);
        const saved=await js(`tugou.open(${JSON.stringify(prior.id)})`);
        check('original project and unknown fields retained',saved.document.assets.length===2&&saved.document.shutdownFuture.keep);
        await js(`tugou.save(${JSON.stringify(prior.id)},{...${JSON.stringify(saved.document)},assets:[]},${saved.revision})`);
        const retry=await js(`tugou.retryImageTool(${JSON.stringify(prior.taskId)})`);
        let completed;
        for(let i=0;i<1600;i++){completed=(await tasks()).find(t=>t.id===retry.id);if(['failed','completed','cancelled'].includes(completed.status))break;await delay(20)}
        check('manual retry succeeds after originals removed from project',completed.status==='completed'&&completed.context.retriedFrom===prior.taskId);
        const results=await js(`tugou.results(${JSON.stringify(prior.id)})`);
        check('only complete retried batch published',results.length===1&&results[0].assets.length===2&&results[0].assets.every(a=>a.toolResult.strength===63));
        await js(fs.readFileSync(path.join(out,'geometry-engine-qa.js'),'utf8')+';void 0;');
        const samples=await js(`Promise.all(${JSON.stringify(results[0].assets)}.map(a=>geometryQA.sample(a)))`);
        check('retried bytes preserve transparent pixels',samples.every(s=>s.values[0][3]===0)&&samples[0].values[2].join()!=='64,128,192,255');
        await delay(50);
        check('retry computation host released',!webContents.getAllWebContents().some(c=>c.getURL().endsWith('/tool-host.html')));
        check('no runtime errors',report.errors.length===0);check('QA window hidden',!w.isVisible());finish(0);
      }else{
        const record=await js('tugou.create("中断任务验收")');report.id=record.id;
        await js(fs.readFileSync(path.join(out,'geometry-engine-qa.js'),'utf8')+';void 0;');
        const assets=await js(`(async()=>{const a=[];for(const col of ['#4080c0','#c08040'])a.push(await compositionQA.asset(col,4096,4096,(ctx,c)=>{ctx.fillStyle=col;ctx.fillRect(0,0,c.width,c.height);ctx.clearRect(0,0,64,64)}));return a})()`);
        const doc={...record.document,assets,shutdownFuture:{keep:true}};
        await js(`tugou.save(${JSON.stringify(record.id)},${JSON.stringify(doc)},${record.revision})`);
        const folder=path.join(profile,'workspace/resources'),before=new Set(fs.readdirSync(folder));
        const task=await js(`tugou.startRasterTool(${JSON.stringify(record.id)},${JSON.stringify(doc)},${JSON.stringify(assets.map(a=>a.id))},{operation:'enhance',strength:63})`);report.taskId=task.id;
        let staged=false;
        for(let i=0;i<1600;i++){if(fs.readdirSync(folder).some(n=>!before.has(n)&&n.endsWith('.png'))){staged=true;break}await delay(10)}
        check('normal close begins after a partial output is staged',staged&&(await tasks()).find(t=>t.id===task.id).status==='running');
        check('QA window hidden before close',!w.isVisible());
        w.once('closed',()=>{
          try{
            const list=JSON.parse(fs.readFileSync(path.join(profile,'workspace/tasks.json')));
            check('normal desktop close records interrupted task',list.find(t=>t.id===task.id).status==='interrupted');
            check('normal close leaves no complete result journal',!fs.existsSync(path.join(profile,'workspace/results',task.id+'.json')));
            check('normal close destroys computation hosts',!webContents.getAllWebContents().some(c=>c.getURL().endsWith('/tool-host.html')));
            check('no runtime errors during shutdown',report.errors.length===0);finish(0);
          }catch(e){report.failure=e.stack;finish(1)}
        });
        w.close();
      }
    }catch(e){report.failure=e.stack;finish(1)}
  });
});
require('../desktop-main.cjs');
