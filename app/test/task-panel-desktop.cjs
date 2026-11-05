// Isolated profile; retry IPC is intercepted so UI acceptance cannot submit paid requests or install models.
const {app,ipcMain}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/task-panel');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.resolve('test-results/home/ui');delete process.env.TUGOU_DEV_PREVIEW;if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,theme:'light',autoCheck:false,notifyTasks:false}));
const {TaskQueue}=require(process.env.TUGOU_TEST_APP?path.join(path.dirname(process.env.TUGOU_TEST_APP),'core/tasks.cjs'):'../core/tasks.cjs'),init=TaskQueue.prototype.init;let queue,ended=false;
TaskQueue.prototype.init=async function(){await init.call(this);queue=this;};
const report={profile,checks:[],errors:[],calls:[]},handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,listener)=>handle(channel,['retryWorkflow','retryImageTool','retryCloudTool','retryRuntimeInstall','cancelCloudBatch','cloudReview'].some(name=>channel===`tugou:${name}`)?async(_,id)=>{
 report.calls.push([channel,id]);return channel==='tugou:cloudReview'||id==='error'?{ok:false,error:'验收测试：请重试'}:{ok:true,value:null};
}:listener);
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(ended)return;ended=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.setIgnoreMouseEvents(true);w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=code=>w.webContents.executeJavaScript(code,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await sleep(40);}throw Error('Timeout '+code);};
  const click=async selector=>{await js(`document.querySelector(${JSON.stringify(selector)}).click()`);await sleep(100);};
  const action=async(id,label)=>{await js(`(()=>{const b=[...document.querySelectorAll('[data-task-id="${id}"] button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Unavailable action');b.click()})()`);await sleep(100);};
  const filter=async index=>{await click(`.task-filters button:nth-child(${index})`);};
  const capture=async name=>{w.showInactive();await sleep(250);fs.writeFileSync(path.join(out,name+'.png'),(await w.capturePage()).toPNG());w.hide();};
  const fits=()=>js(`(()=>{const d=document.querySelector('.task-dialog .ant-modal-container'),l=document.querySelector('.task-list'),r=d.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&r.right<=innerWidth&&l.scrollWidth<=l.clientWidth+1&&[...document.querySelectorAll('.task-row')].every(e=>e.scrollWidth<=e.clientWidth+1)})()`);
  try{
   await wait(`!!document.querySelector('.home-workspace')`);await click('[aria-label="任务"]');await wait(`!!document.querySelector('.task-list')`);
   check('empty tasks explain where records come from',await js(`document.querySelector('.task-list').textContent.includes('暂无任务')`));
   const project=await js(`tugou.create('任务界面验收工程')`);
   const task=(id,label,status,context={},message='')=>({id,label,status,context,createdAt:'2026-11-05T06:35:00.000Z',message});
   queue.tasks=[...Array.from({length:25},(_,i)=>task('done'+i,'生成台 · '+(i+1),'completed',{projectId:project.id,model:'gpt-image',requestedSize:'1024 × 1536'},'已完成 1 张图片')),
    task('workflow','生成台 · 图片生成','failed',{kind:'workflow'},'请求失败，请检查连接后重试'),
    task('local','AI 超分辨率','interrupted',{kind:'local-tool',engine:'local-ai'},'上次本地处理已中断'),
    task('runtime','本地工具安装','cancelled',{kind:'runtime-install'}),
    task('cloud','云端图像处理','review',{kind:'cloud-tool',hasRaw:true},'返回图片尺寸不同，请确认原始图'),
    task('batch','批量图像处理','queued',{kind:'cloud-tool',batchId:'batch-1',batchCount:2,batchIndex:0}),
    task('error','重试失败反馈','failed',{kind:'workflow'}),
    task('long','很长的任务名称用于验证截断和状态布局'.repeat(8),'completed',{projectId:project.id,model:'gpt-image',requestedSize:'2880 × 2880'},'尺寸不符：请求 2880 × 2880，实际 1254 × 1254；已保留原始图。'.repeat(4))];
   queue.tasks.at(-1).imageTimings=[{queued:0,sent:100,headers:1200,body:1600,ready:1700,saved:2000}];
   const active=await queue.start('主体抠图',signal=>new Promise(resolve=>signal.addEventListener('abort',resolve)),{kind:'local-tool',projectId:project.id});
   queue.tasks.find(t=>t.id===active.id).progress=48;await queue.persist();
   await wait(`document.querySelectorAll('.task-row').length===33`);
   check('all records remain available and newest appears first',await js(`document.querySelector('.task-row').dataset.taskId===${JSON.stringify(active.id)}`));
   check('status filters expose counts and selected state',await js(`document.querySelector('.task-filters button[aria-pressed=true]').textContent==='全部33'`));
   check('long warnings are collapsed and labelled',await js(`!document.querySelector('.task-message-details').open&&document.querySelector('.task-message-details summary').title.length>80`));
   check('wide list has no horizontal overflow and aligned actions',await fits()&&await js(`new Set([...document.querySelectorAll('.task-actions')].map(e=>Math.round(e.getBoundingClientRect().right))).size===1`));
   await capture('tasks-light');
   await filter(2);check('active filter shows only queued and running',await js(`document.querySelectorAll('.task-row').length===2&&[...document.querySelectorAll('.task-row')].every(e=>['queued','running'].includes(e.dataset.status))`));
   await action('batch','取消整个批次');check('batch cancellation preserves batch ID',report.calls.some(([c,id])=>c==='tugou:cancelCloudBatch'&&id==='batch-1'));
   await action(active.id,'取消任务');await active.completion;await wait(`document.querySelectorAll('.task-row').length===1`);check('real task cancellation refreshes filtered list',queue.tasks.find(t=>t.id===active.id).status==='cancelled');
   await filter(3);check('attention filter includes failed interrupted and review',await js(`document.querySelectorAll('.task-row').length===4`));
   for(const [id,label,method] of [['workflow','按原参数重试','retryWorkflow'],['local','按原参数重试','retryImageTool'],['cloud','重新请求模型','retryCloudTool']]){await action(id,label);check(method+' receives the original task ID',report.calls.some(([c,t])=>c===`tugou:${method}`&&t===id));}
   await action('error','按原参数重试');await wait(`document.querySelector('.task-error')?.textContent.includes('验收测试')`);check('retry errors remain visible',true);
   await action('cloud','查看原始图');await wait(`!!document.querySelector('[aria-label="关闭模型原始返回"]')`);check('original image action opens review with original ID',report.calls.some(([c,id])=>c==='tugou:cloudReview'&&id==='cloud'));await click('[aria-label="关闭模型原始返回"]');
   await filter(1);await action('runtime','继续安装');check('installation retry remains available on cancelled tasks',report.calls.some(([c,id])=>c==='tugou:retryRuntimeInstall'&&id==='runtime'));
   await filter(4);check('completed filter excludes unsuccessful tasks',await js(`document.querySelectorAll('.task-row').length===26&&[...document.querySelectorAll('.task-row')].every(e=>e.dataset.status==='completed')`));
   await click('.task-message-details>summary');check('long message expands to full text',await js(`document.querySelector('.task-message-details').open&&document.querySelector('.task-message-details p').textContent.length>80`));
   await js(`document.querySelector('.task-timings>summary').focus()`);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});await wait(`document.querySelector('.task-timings').open`);check('timing details work by keyboard',await js(`document.querySelector('.task-timings').textContent.includes('保存图片 0.3 秒')`));
   w.setSize(960,760);w.webContents.setZoomFactor(1.25);await sleep(150);check('125 percent narrow window fits expanded details and actions',await fits());await capture('tasks-zoom-light');
   await click('[aria-label="切换深色主题"]');await wait(`document.documentElement.dataset.theme==='dark'`);check('dark theme retains bounded details',await fits());await capture('tasks-zoom-dark');
   w.webContents.setZoomFactor(1);w.setSize(1380,900);await click('.task-message-details>summary');await click('.task-timings>summary');await filter(1);await capture('tasks-dark');
   await action('long','打开工程');await wait(`!document.querySelector('.task-dialog')&&!!document.querySelector('.canvas-workspace')`);check('open project closes panel and loads the saved project',await js(`document.querySelector('.project-menu').textContent.includes('任务界面验收工程')`));
   queue.tasks=queue.tasks.filter(t=>t.status==='completed');await queue.persist();await click('[aria-label="任务"]');await filter(3);check('empty filter offers switching categories',await js(`document.querySelector('.task-list').textContent.includes('暂无此类任务')`));
   await filter(1);queue.tasks=Array.from({length:1000},(_,i)=>task('bulk'+i,'生成台 · '+(i+1),'completed',{projectId:project.id}));const start=Date.now();await queue.persist();await wait(`document.querySelectorAll('.task-row').length===1000`);report.thousandRowsMs=Date.now()-start;check('1000 retained tasks render within two seconds',report.thousandRowsMs<2000);
   await filter(2);check('filter remains responsive with 1000 retained tasks',await js(`document.querySelectorAll('.task-row').length===0`));
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);await capture('failure');finish(1);}
 });
});
require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
