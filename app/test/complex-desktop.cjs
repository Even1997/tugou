const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const base=require('./qa-paths.cjs').path("local-final"),restart=process.argv.includes('--restart'),probe=process.argv.includes('--probe'),sources=process.argv.includes('--sources'),tag=sources?'complex-sources':'complex';
fs.mkdirSync(base,{recursive:true});const prior=restart?JSON.parse(fs.readFileSync(path.join(base,tag+'.json'))):null;
const profile=prior?.profile||fs.mkdtempSync(path.join(base,'complex-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=require('./qa-paths.cjs').path("shared-build");
const report={profile,checks:[],errors:[]};let timer;
function finish(code){clearInterval(timer);fs.writeFileSync(path.join(base,probe?'clipping-probe.json':tag+(restart?'-restart':'')+'.json'),JSON.stringify(report,null,2));app.exit(code)}
setTimeout(()=>{report.failure='timeout';finish(1)},600000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),check=(s,v)=>{assert.ok(v,s);report.checks.push(s)};
    const wait=async(s)=>{for(let i=0;i<800;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await delay(25)}throw Error('timeout '+s)};
    const inject=()=>js(fs.readFileSync(path.join(base,'complex-engine.js'),'utf8')+';void 0;');
    try {
      await js('console.error("complex-sentinel")');check('console capture verified',report.errors.includes('complex-sentinel'));report.errors=[];
      await inject();report.clipping=await js('complexQA.clipping()');
      check('independent clipping chains never duplicate adjacent alpha',report.clipping.every(p=>p[3]===128)&&report.clipping[0].join()==='0,255,255,128'&&report.clipping[1].join()==='255,255,0,128');
      if(probe){finish(0);return}
      report.id=prior?.id||(await js('tugou.create("复杂工程压力验收")')).id;
      if(!restart)report.fixture=await js(`complexQA.fixture(${JSON.stringify(report.id)})`);
      if(sources&&!restart){report.sources=await js(`complexQA.largeSources(${JSON.stringify(report.id)})`);check('eight distinct 4MP original resources',report.sources.count===8&&report.sources.unique===8&&report.sources.totalPixels===33554432)}
      await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'layers'}))`);
      const ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;await wait('document.querySelector(".layer-stage canvas")');await inject();
      const r=await js(`tugou.open(${JSON.stringify(report.id)})`);
      check('100MP 58-layer grouped project restores intact',r.document.width===10000&&r.document.height===10000&&r.document.layers.length===58&&r.document.futureComplex.keep===42);
      await js('window.beats=0;window.maxGap=0;window.lastBeat=performance.now();window.beatTimer=setInterval(()=>{let now=performance.now();maxGap=Math.max(maxGap,now-lastBeat);lastBeat=now;beats++},25)');
      const peaks=new Map();timer=setInterval(()=>{for(const p of app.getAppMetrics())peaks.set(p.pid,{type:p.type,peakKiB:Math.max(peaks.get(p.pid)?.peakKiB||0,p.memory.peakWorkingSetSize)})},150);
      if(!restart){
        const result=await js(`complexQA.export(${JSON.stringify(report.id)})`);report.result=result.result;report.elapsedMs=result.elapsedMs;report.tiles=result.tiles;
        const filename=path.join(profile,'workspace/resources',result.result.resource);check('complete 100MP PNG has 100 tile passes',(await sharp(filename).metadata()).width===10000&&result.tiles===100);
        for(const crop of result.crops){const actual=await sharp(filename).extract({left:crop.x,top:crop.y,width:128,height:128}).ensureAlpha().raw().toBuffer(),expected=await sharp(Buffer.from(crop.bytes)).ensureAlpha().raw().toBuffer();let max=0,different=0;for(let i=0;i<actual.length;i++){const d=Math.abs(actual[i]-expected[i]);max=Math.max(max,d);if(d>2)different++}report['crop-'+crop.x+'-'+crop.y]={max,different};check('export crop matches independent viewport at '+crop.x+','+crop.y,different===0)}
        const far=await sharp(filename).extract({left:9950,top:9950,width:1,height:1}).raw().toBuffer();check('far corner preserves exact vector color',far.join()==='18,52,86,255');
        report.cancel=await js(`complexQA.cancel(${JSON.stringify(report.id)})`);check('100MP export cancellation stops after two tiles',report.cancel.cancelled&&report.cancel.progress===.02);
      } else {report.result=prior.result;check('saved export decodes after restart',(await sharp(path.join(profile,'workspace/resources',prior.result.resource)).metadata()).height===10000);}
      report.heartbeat=await js('(()=>{clearInterval(beatTimer);return {beats,maxGap}})()');report.memory=[...peaks.values()];
      if(!restart)check('export yields to UI between tiles',report.heartbeat.beats>10&&report.heartbeat.maxGap<2000);
      await w.capturePage();fs.writeFileSync(path.join(base,restart?'complex-restart.png':'complex.png'),(await w.capturePage()).toPNG());
      check('no renderer errors',report.errors.length===0);check('test window stays hidden',!w.isVisible());finish(0);
    }catch(e){report.failure=e.stack;finish(1)}
  });
});
require('../desktop-main.cjs');
