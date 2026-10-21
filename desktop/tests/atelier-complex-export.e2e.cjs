// Production UI, isolated data, normal GPU path. No model requests.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{execFile}=require('node:child_process');
const sharp=require('../../web/node_modules/sharp');
const base=process.env.STUDIO_TEST_URL,serverPid=Number(process.env.STUDIO_QA_SERVER_PID),root=path.resolve(__dirname,'../..');
if(base!=='http://127.0.0.1:3439'||!Number.isInteger(serverPid)||serverPid<1)throw Error('Explicit isolated production QA required');
const rounds=Number(process.env.STUDIO_EXPORT_ROUNDS||2),settleMs=Number(process.env.STUDIO_EXPORT_SETTLE_MS||5000);
if(!Number.isInteger(rounds)||rounds<2||rounds>10||settleMs<5000||settleMs>60000)throw Error('Invalid bounded benchmark');
const evidence=path.join(root,'docs/studio-evidence/'+(rounds>2?'atelier-export-endurance':'atelier-complex-export')+'.json');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),post=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({action,payload})});assert.equal(r.status,200,await r.clone().text());return r.json()};
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-complex-')));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}),errors=[],samples=[],exports=[];
 const run=code=>win.webContents.executeJavaScript(code,true),click=label=>run(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}).click()`);
 const until=async(fn,label)=>{for(let i=0;i<2400;i++){if(await fn())return;await wait(100);}throw Error('Timeout '+label)};
 win.webContents.on('console-message',({level,message})=>{if(level==='error'||level===3)errors.push(message)});
 let active=true,phase='setup',sampler;
 try{
  const data=await post('list');assert.ok(data.location.includes('atelier-qa'));const folder=path.join(data.location,'exports');fs.mkdirSync(folder,{recursive:true});
  const assets=[];for(const [id,file]of [['portrait','portrait-a-cutout.png'],['cat','samples/chelsea.png']]){const b=fs.readFileSync(path.join('D:/CanvasStudioQuality',file)),m=await sharp(b).metadata();assets.push({id,name:id,dataUrl:'data:image/png;base64,'+b.toString('base64'),width:m.width,height:m.height,hasAlpha:!!m.hasAlpha,createdAt:new Date().toISOString()})}
  const common={x:0,y:0,width:10000,height:10000,rotation:0,opacity:1,visible:true,locked:false,flipX:false,flipY:false,blend:'source-over'};
  const layers=[{...common,id:'paper',kind:'shape',name:'底色',shape:'rect',color:'#f4f0e7'},{...common,id:'g1',kind:'group',name:'照片组',width:10000,height:10000},{...common,id:'g2',parentId:'g1',kind:'group',name:'嵌套组',width:10000,height:10000}];
  for(let i=0;i<12;i++){const x=500+i%4*2350,y=1200+Math.floor(i/4)*2700;layers.push({...common,id:'frame-'+i,parentId:'g2',kind:'shape',name:'底框 '+i,shape:'ellipse',x,y,width:2000,height:2300,color:i%2?'#c9d7e3':'#dce5ce',effects:[{kind:'shadow',enabled:true,color:'#273649',opacity:.3,values:{distance:24,angle:90,blur:16}}]});layers.push({...common,id:'image-'+i,parentId:'g2',kind:'image',name:'素材 '+i,assetId:i%2?'cat':'portrait',x:x+100,y:y+100,width:1800,height:2100,rotation:i%3*4-4,flipX:!!(i%2),mask:{x:0,y:0,width:1,height:1,feather:12,paths:[{operation:'add',points:[.03,.03,.97,.03,.97,.97,.03,.97]},{operation:'subtract',points:[.4,.35,.6,.35,.6,.55,.4,.55]}]}})}
  layers.push({...common,id:'title',kind:'text',name:'标题',x:500,y:300,width:9000,height:600,text:'图构 · 大画幅合成验收',fontSize:360,fontFamily:'Microsoft YaHei',color:'#334638',align:'center',lineHeight:1.3,letterSpacing:8});
  layers.push({...common,id:'adjust',kind:'adjustment',name:'曝光',adjustment:{kind:'exposure',values:{exposure:.2,offset:0,gamma:1}}});
  const p={format:'canvas-studio',version:5,id:'complex-export-qa',name:'100MP 复杂工程验收',updatedAt:new Date().toISOString(),width:10000,height:10000,background:'transparent',assets,modules:[],recipes:[],jobs:[],layers};
  await post('save',p);assert.deepEqual((await post('open',{id:p.id})).layers,layers);
  await win.loadURL(base+'/studio');await until(()=>run('document.body.innerText.includes("100MP 复杂工程验收")'),'open');await click('图层合成');await until(()=>run('!!document.querySelector(".editor-stage canvas")'),'stage');await wait(2000);
  sampler=(async()=>{while(active){const started=Date.now(),samplePhase=phase;const metrics=app.getAppMetrics();const server=await new Promise(resolve=>execFile('powershell.exe',['-NoProfile','-Command',`Get-Process -Id ${serverPid} | Select-Object WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`],{windowsHide:true},(e,out)=>resolve(e?null:JSON.parse(out))));let heartbeatMs=null;try{const t=Date.now();await run('1');heartbeatMs=Date.now()-t}catch{}samples.push({at:started,phase:samplePhase,processes:metrics.map(p=>({pid:p.pid,type:p.type,privateMiB:Math.round((p.memory.privateBytes||0)/1024)})),electronPrivateMiB:Math.round(metrics.reduce((n,p)=>n+(p.memory.privateBytes||0),0)/1024),electronWorkingMiB:Math.round(metrics.reduce((n,p)=>n+p.memory.workingSetSize,0)/1024),serverPrivateMiB:server&&Math.round(server.PrivateMemorySize64/1048576),serverWorkingMiB:server&&Math.round(server.WorkingSet64/1048576),heartbeatMs});await wait(Math.max(50,1000-(Date.now()-started)))}})();
  phase='baseline';await wait(4000);
  for(let pass=0;pass<rounds;pass++){
   phase='export-'+(pass+1);const before=new Set(fs.readdirSync(folder)),start=Date.now();await click('导出画面');let name;
   await until(async()=>{name=fs.readdirSync(folder).find(n=>!before.has(n)&&n.startsWith(p.name+'-')&&n.endsWith('.png'));return !!name},'export '+pass);
   const file=path.join(folder,name),elapsedMs=Date.now()-start,header=Buffer.alloc(24),fd=fs.openSync(file,'r');try{fs.readSync(fd,header,0,24,0)}finally{fs.closeSync(fd)}const dimensions=[header.readUInt32BE(16),header.readUInt32BE(20)];assert.deepEqual(dimensions,[10000,10000]);
   exports.push({file,elapsedMs,dimensions});
   fs.writeFileSync(evidence+'.progress',JSON.stringify({at:new Date().toISOString(),completed:exports.length,rounds,elapsedMs}));
   phase='idle-after-'+(pass+1);await wait(settleMs);
   if(!pass){await win.reload();await until(()=>run('document.body.innerText.includes("100MP 复杂工程验收")'),'reopen');if(!await run('!!document.querySelector(".editor-stage canvas")'))await click('图层合成');await wait(2000);assert.deepEqual((await post('open',{id:p.id})).layers,layers)}
  }
  active=false;await sampler;
  // Verification decoding runs outside the memory sample window, so test-only buffers cannot mimic editor leaks.
  for(const entry of exports){const digest=createHash('sha256');for await(const chunk of sharp(entry.file).ensureAlpha().raw())digest.update(chunk);entry.pixelHash=digest.digest('hex');assert.equal(entry.pixelHash,exports[0].pixelHash)}
  const pixel=await sharp(exports[0].file).extract({left:10,top:10,width:1,height:1}).ensureAlpha().raw().toBuffer();assert.equal(pixel[3],255);assert.ok(pixel[0]>240&&pixel[2]>220);
  await sharp(exports[0].file).resize(1200,1200).png().toFile(path.join(root,'docs/studio-evidence/atelier-complex-export.png'));
  await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(600);fs.writeFileSync(path.join(root,'docs/studio-evidence/atelier-complex-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  assert.equal(errors.length,0,errors.join('\n'));
  const result={at:new Date().toISOString(),passed:true,rounds,settleMs,sampledMs:samples.at(-1).at-samples[0].at,layers:layers.length,assets:assets.length,exports,samples,errors,gpuFeatures:app.getGPUFeatureStatus(),memoryScope:'Sum of all test Electron app processes and standalone Next server PID '+serverPid+'; private memory. Working sets can double-count shared pages. External Go API and unrelated user processes excluded. Full image verification runs after sampling.',limits:'Bounded repeated exports with one reload; not an unlimited-duration leak proof or a 500-unique-large-image test. No API model requests.'};
  fs.writeFileSync(evidence,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,layers:layers.length,exports,peakPrivateMiB:Math.max(...samples.map(s=>s.electronPrivateMiB+s.serverPrivateMiB)),maxHeartbeatMs:Math.max(...samples.map(s=>s.heartbeatMs))}));app.exit(0);
 }catch(error){active=false;fs.writeFileSync(evidence,JSON.stringify({at:new Date().toISOString(),passed:false,error:error.stack,exports,samples,errors},null,2));console.error(error);app.exit(1)}
});
