const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve(__dirname,'../test-results'),restart=process.argv.includes('--restart'),prior=restart?JSON.parse(fs.readFileSync(path.join(out,'installer-desktop.json'))):null;
const base=require('./qa-paths.cjs').path("installer-ui");fs.mkdirSync(base,{recursive:true});const profile=prior?.profile||fs.mkdtempSync(path.join(base,'profile-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'local-tools-build');
const report={profile,checks:[],errors:[],fixture:'installer execution and runtime status; real preload/IPC/TaskQueue/renderer'};let calls=0,release;
const {RuntimeInstaller}=require('../core/runtime-install.cjs'),{LocalAIService}=require('../core/local-ai.cjs');
RuntimeInstaller.prototype.execute=async function(job,signal,id){calls++;const task=this.tasks.tasks.find(t=>t.id===id);task.progress=35;task.message='下载组件 · 35%';await this.tasks.persist();await new Promise(r=>{release=r;signal.addEventListener('abort',r,{once:true})});signal.throwIfAborted();fs.writeFileSync(path.join(this.root,'ui-installed.json'),JSON.stringify(job));task.progress=100;task.message='组件已安装并启用';await this.tasks.persist();};
LocalAIService.prototype.status=async function(){return fs.existsSync(path.join(this.root,'ui-installed.json'))?{configured:true,folder:'D:/测试组件',cutout:true,models:['general','illustration','anime'],provider:'CPUExecutionProvider'}:{configured:false,message:'尚未安装本地组件'};};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[base]});
const end=code=>{fs.writeFileSync(path.join(out,restart?'installer-restart.json':'installer-desktop.json'),JSON.stringify(report,null,2));app.exit(code)};
setTimeout(()=>{report.failure='timeout';end(1)},90000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(name,v)=>{assert.ok(v,name);report.checks.push(name)};
  const wait=async(s)=>{for(let i=0;i<600;i++){if(await js(`Boolean(${s})`))return;await delay(30)}throw Error('timeout '+s)};
  const click=async(label)=>{await js(`{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing/enabled '+${JSON.stringify(label)});b.click()}`);await delay(100)};
  try{
    await js('console.error("installer-sentinel")');check('console capture verified',report.errors.includes('installer-sentinel'));report.errors=[];
    report.id=prior?.id||await js('(async()=>{const r=await tugou.create("组件安装验收");await tugou.save(r.id,{...r.document,unknownInstallerField:{keep:true}},r.revision);return r.id})()');
    await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`);const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;await wait('document.querySelector(".image-tools")');
    await js(`{const e=document.querySelector('select[aria-label="处理方式"]');e.value='upscale';e.dispatchEvent(new Event('change',{bubbles:true}))}`);await delay(120);await click("管理本地组件");await wait('document.body.textContent.includes("尚未安装本地组件")||document.body.textContent.includes("D:/测试组件")');
    if(restart){
      check('installed status restores on restart',await js('document.body.textContent.includes("D:/测试组件")'));
      check('restart never resumes installation automatically',calls===0);
      check('cancelled and completed tasks persist',(await js('tugou.tasks()')).map(t=>t.status).join(',')==='cancelled,completed');
    }else{
      check('install and reuse actions visible',await js('document.body.textContent.includes("选择位置并安装")&&document.body.textContent.includes("使用已安装的组件")'));
      await click('选择位置并安装');await wait('document.querySelector("progress[aria-label=组件安装进度]")?.value===35');check('progress delivered through task journal',true);
      check('provider and existing-folder selection disabled while installing',await js('document.querySelector("select[aria-label=抠图计算设备]").disabled&&[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="使用已安装的组件").disabled'));
      await click('取消安装');await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="继续安装")');check('cancelled installer leaves runtime inactive',!fs.existsSync(path.join(profile,'workspace/ui-installed.json')));
      await click('关闭本地组件');await click('任务');await click('继续安装');await wait('document.body.textContent.includes("安装中")');check('retry available from unified task panel',calls===2);release();await wait('document.body.textContent.includes("已安装")');check('installer is not mislabeled as image result',true);await click('关闭任务');
      await click("管理本地组件");await wait('document.body.textContent.includes("D:/测试组件")');check('completed installation refreshes runtime',true);
    }
    w.setSize(960,720);await delay(250);await w.capturePage();await delay(100);fs.writeFileSync(path.join(out,restart?'installer-restored-960.png':'installer-960.png'),(await w.capturePage()).toPNG());
    check('dialog controls fit narrow desktop',await js('[...document.querySelectorAll("[role=dialog] button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})'));
    check('unknown project data preserved',(await js(`tugou.open(${JSON.stringify(report.id)})`)).document.unknownInstallerField.keep);
    check('no renderer errors',report.errors.length===0);check('test window remains hidden',!w.isVisible());end(0);
  }catch(e){report.failure=e.stack;report.text=await js('document.body.innerText');end(1)}
});});require('../desktop-main.cjs');
