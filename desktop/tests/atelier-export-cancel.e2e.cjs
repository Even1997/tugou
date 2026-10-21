const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),sharp=require('../../web/node_modules/sharp');
const base=process.env.STUDIO_TEST_URL,root=path.resolve(__dirname,'../..'),evidence=path.join(root,'docs/studio-evidence/atelier-export-cancel.json');
if(base!=='http://127.0.0.1:3439')throw Error('Isolated production QA required');
const wait=ms=>new Promise(r=>setTimeout(r,ms)),post=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({action,payload})});assert.equal(r.status,200,await r.clone().text());return r.json()};
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-export-cancel-')));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1300,height:960,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}),errors=[];
 const run=code=>win.webContents.executeJavaScript(code,true),click=label=>run(`[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}).click()`);
 const until=async(fn,label)=>{for(let i=0;i<600;i++){if(await fn())return;await wait(100)}throw Error('Timeout '+label)};
 win.webContents.on('console-message',({level,message})=>{if(level==='error'||level===3)errors.push(message)});
 const deadline=setTimeout(()=>{fs.writeFileSync(evidence,JSON.stringify({passed:false,error:'timeout'}));app.exit(1)},180000);
 try{
  const location=(await post('list')).location;assert.ok(location.includes('atelier-qa'));const folder=path.join(location,'exports'),initial=new Set(fs.readdirSync(folder));
  const project={...await post('open',{id:'complex-export-qa'}),id:'export-cancel-qa',name:'取消导出验收',updatedAt:new Date().toISOString()};await post('save',project);
  await win.loadURL(base+'/studio');await until(()=>run('document.body.innerText.includes("取消导出验收")'),'ready');await click('图层合成');await until(()=>run('!!document.querySelector(".editor-stage canvas")'),'editor');
  const partial=()=>fs.readdirSync(folder).find(n=>!initial.has(n)&&n.startsWith('.partial-'));
  await click('导出画面');await until(async()=>{const f=partial();return f&&fs.readdirSync(path.join(folder,f)).length>=2},'two strips');
  assert.ok(await run('document.querySelector("[aria-label=导出格式]").disabled'));await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);fs.writeFileSync(path.join(root,'docs/studio-evidence/atelier-export-cancel.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  const started=Date.now();await click('取消导出');await until(async()=>!partial()&&!await run('!!document.querySelector("[aria-label=取消导出]")'),'cancelled');const cancelMs=Date.now()-started;
  assert.equal(fs.readdirSync(folder).filter(n=>!initial.has(n)).length,0);
  await click('导出画面');await until(async()=>!!partial(),'restart export');win.setSize(960,680);await wait(500);assert.ok(await run('(()=>{const r=document.querySelector("[aria-label=取消导出]").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'));await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);fs.writeFileSync(path.join(root,'docs/studio-evidence/atelier-export-cancel-960.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());await click('提示词工作台');await until(async()=>!partial(),'unmount cancel');assert.equal(fs.readdirSync(folder).filter(n=>!initial.has(n)).length,0);
  project.width=64;project.height=64;project.assets=[];project.layers=[{id:'base',kind:'shape',name:'色块',shape:'rect',color:'#123456',x:0,y:0,width:64,height:64,rotation:0,opacity:1,visible:true,locked:false,flipX:false,flipY:false,blend:'source-over'}];await post('save',project);await win.reload();await until(()=>run('document.body.innerText.includes("取消导出验收")'),'reopen');await click('图层合成');await until(()=>run('!!document.querySelector(".editor-stage canvas")'),'small editor');await click('导出画面');
  let name;await until(async()=>{name=fs.readdirSync(folder).find(n=>!initial.has(n)&&n.endsWith('.png'));return !!name},'success after cancel');assert.deepEqual([...(await sharp(path.join(folder,name)).extract({left:0,top:0,width:1,height:1}).ensureAlpha().raw().toBuffer())],[18,52,86,255]);
  assert.equal(errors.length,0,errors.join('\n'));clearTimeout(deadline);fs.writeFileSync(evidence,JSON.stringify({at:new Date().toISOString(),passed:true,cancelMs,checks:['top toolbar cancel during real 100MP export','no partial or finished file after cancellation','leaving workspace cancels','format locked during export','successful export after cancel, exact RGBA'],errors},null,2));app.exit(0);
 }catch(error){clearTimeout(deadline);fs.writeFileSync(evidence,JSON.stringify({at:new Date().toISOString(),passed:false,error:error.stack,errors},null,2));app.exit(1)}
});
