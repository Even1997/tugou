// Isolated source UI: simulated failures only, no vendor requests or user documents.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
process.env.ESBUILD_WORKER_THREADS='0';
const out=path.resolve(__dirname,'../test-results/help-recovery');fs.mkdirSync(out,{recursive:true});app.setPath('userData',fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'tugou-help-')));
const report={checks:[],errors:[]};let w;
const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);};
const wait=async s=>{for(let i=0;i<150;i++){if(await js(s))return;await delay(40);}throw Error('timeout: '+s);};
const click=async(label)=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button '+${JSON.stringify(label)});b.focus();b.click()})()`);await delay(100);};
const input=async value=>{await js(`(()=>{const e=document.querySelector('[aria-label="搜索帮助"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(100);};
const shot=async name=>{await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(out,name+'.png'),(await w.capturePage()).toPNG());};
const task=async(context,status='failed')=>{await js(`qa.calls=[];qa.mode='ok';qa.refreshMode='ok';qa.tasks([{id:'one',label:'恢复操作验证',status:${JSON.stringify(status)},context:${JSON.stringify(context)}}])`);await js('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await wait('!!document.querySelector(".task-row")');};
app.whenReady().then(async()=>{
 w=new BrowserWindow({width:1060,height:780,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,cb)=>cb({cancel:true}));
 try{
  await w.loadFile(path.resolve(__dirname,'../renderer/index.html'));await js(`require(${JSON.stringify(path.join(__dirname,'help-recovery-renderer.cjs'))})`);w.showInactive();
  await wait('!!document.querySelector("#help-entry")');await click('帮助');await wait('!!document.querySelector(".help-topics")');
  check('all eight independent help topics available',await js('document.querySelectorAll(".help-topics button").length===8'));
  await input('磁盘');check('search includes article content and keywords',await js('document.querySelectorAll(".help-topics button").length===1'));
  await click('保存失败后如何恢复');check('opening an article moves keyboard focus to its heading',await js('document.activeElement.matches(".help-article h2")'));check('search result opens recovery instructions',await js('document.querySelector(".help-article").textContent.includes("当前编辑仍在窗口中")'));
  await click('返回搜索结果');check('return restores search focus',await js('document.activeElement.getAttribute("aria-label")=="搜索帮助"'));check('return preserves search query',await js('document.querySelector("[aria-label=搜索帮助]").value==="磁盘"'));
  await input('not-a-topic');check('empty results explain how to recover',await js('document.body.textContent.includes("没有找到相关帮助")'));
  await input('');await shot('help-light');
  await js('qa.theme("dark")');w.setSize(700,650);await delay(200);await shot('help-dark-700');
  check('help fits narrow window without horizontal overflow',await js('(()=>{const b=document.querySelector(".ant-drawer-body");return b.scrollWidth===b.clientWidth&&b.getBoundingClientRect().right<=innerWidth})()'));
  w.focus();await js('document.querySelector("[aria-label=搜索帮助]").focus()');w.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await wait('!document.querySelector(".ant-drawer-open")');await delay(400);check('Escape closes help and restores trigger focus',await js('document.activeElement.id==="help-entry"'));
  await click('帮助');await input('任务');await click('任务失败、取消与重试');await click('查看任务记录');await wait('!!document.querySelector(".task-dialog")');check('help jumps to task records',await js('qa.openedTasks&&!document.querySelector(".ant-drawer-open")'));
  await js('qa.tasks(null)');await delay(150);w.setSize(1060,780);await js('qa.theme("light")');
  await task({kind:'cloud-tool',projectId:'p'});await js('qa.mode="pending"');
  await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="重新请求模型");b.click();b.click()})()');await delay(100);
  check('synchronous duplicate retry submits once and shows pending',await js('qa.calls.length===1&&document.querySelector(".task-actions button").disabled&&document.body.textContent.includes("正在提交")'));
  await js('qa.release()');await wait('!document.querySelector(".task-actions button").disabled');
  check('cloud retry shows visible fee information',await js('document.body.textContent.includes("可能再次计费")'));
  await js('qa.mode="fail"');await click('重新请求模型');check('action failure gives specific error and unlocks retry',await js('document.querySelector(".task-error").textContent.includes("模拟服务连接失败")&&!document.querySelector(".task-actions button").disabled'));
  await js('qa.mode="ok"');await click('重新请求模型');check('successful retry clears obsolete error',await js('!document.querySelector(".task-error")'));
  await js('qa.refreshMode="fail";qa.calls=[]');await click('重新请求模型');
  check('submitted operation plus refresh failure is distinguished and locked',await js('document.querySelector(".task-error").textContent.includes("操作已提交")&&document.querySelector(".task-actions button").disabled'));
  await click('刷新记录');check('failed refresh does not resubmit request or unlock actions',await js('qa.calls.filter(c=>c[0]==="retryCloudTool").length===1&&document.querySelector(".task-actions button").disabled&&document.querySelector(".task-error").textContent.includes("操作已提交")'));
  await js('qa.refreshMode="ok"');await click('刷新记录');check('successful explicit refresh restores actions and clears error',await js('!document.querySelector(".task-error")&&!document.querySelector(".task-actions button").disabled'));
  for(const [context,status,label,method,arg] of [
   [{kind:'workflow'},'interrupted','按原参数重试','retryWorkflow','one'],
   [{kind:'runtime-install'},'cancelled','继续安装','retryRuntimeInstall','one'],
   [{kind:'local-tool',engine:'raster'},'failed','按原参数重试','retryImageTool','one'],
   [{kind:'cloud-tool',batchId:'batch'},'running','取消整个批次','cancelCloudBatch','batch'],
   [{kind:'analysis'},'queued','取消任务','cancelTask','one'],
  ]){await task(context,status);await click(label);check(label+' invokes correct recovery API',await js(`qa.calls[0][0]===${JSON.stringify(method)}&&qa.calls[0][1]===${JSON.stringify(arg)}`));}
  await task({kind:'analysis',projectId:'p'},'running');check('long running task without progress has truthful status',await js('document.body.textContent.includes("完成时间取决于")'));
  await js('qa.mode="pending"');await click('取消任务');check('cancel locks actions while pending',await js('document.querySelector(".task-actions button").disabled'));await js('qa.release()');await wait('!document.querySelector(".task-actions button").disabled');
  await task({kind:'analysis',projectId:'p'});await click('打开工程');check('unsupported retry retains project recovery entry',await js('qa.opens.includes("p")&&document.querySelectorAll(".task-actions button").length===1'));
  await js('qa.tasks([{id:"long",label:"很长的任务名称".repeat(40),status:"failed",context:{kind:"cloud-tool",projectId:"p"},message:"错误原因与恢复线索".repeat(60)}])');await delay(150);
  check('long errors use expandable details',await js('!!document.querySelector(".task-message-details")'));await js('document.querySelector(".task-message-details").open=true');await shot('tasks-light');
  await js('qa.theme("dark")');w.setSize(700,650);await delay(200);await shot('tasks-dark-700');
  check('long errors and actions fit narrow task dialog',await js('(()=>{const b=document.querySelector(".task-list");return b.scrollWidth===b.clientWidth})()'));
  check('no renderer errors',report.errors.length===0);
 }catch(e){report.failure=e.stack;console.error(e);await shot('failure').catch(()=>{});}
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(report.failure?1:0);
});
setTimeout(()=>app.exit(1),60000);
