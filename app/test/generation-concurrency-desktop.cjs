// Isolated native app + local held HTTP responses; never uses user data or paid APIs.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const source=process.env.TUGOU_TEST_APP?path.resolve(path.dirname(process.env.TUGOU_TEST_APP)):path.resolve(__dirname,'..');
const {bridge}=require(path.join(source,'core/mcp.cjs'));
const out=path.resolve('test-results/generation-concurrency');fs.mkdirSync(out,{recursive:true});
const reopening=process.argv.includes('--reopen');
const profile=reopening?JSON.parse(fs.readFileSync(path.join(out,'desktop.json'),'utf8')).profile:fs.realpathSync(fs.mkdtempSync(path.join(out,'desktop-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR||=process.env.TUGOU_TEST_APP?path.join(source,'dist'):path.join(out,'ui');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
if(!reopening)fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require(path.join(source,'core/preference-values.cjs')).defaults,autoCheck:false,notifyTasks:false}));
const report={profile,checks:[],errors:[],resizeNotifications:[],requests:[],peak:0},requests=[];let ended=false,active=0,pngs;
const server=http.createServer(async(req,res)=>{try{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=JSON.parse(Buffer.concat(chunks));
 const entry={res,body,index:requests.length,wire:Number(req.headers['x-fixture-call'])};requests.push(entry);report.requests.push({path:req.url,n:body.n,receivedAt:Date.now(),wire:entry.wire});
 active++;report.peak=Math.max(report.peak,active);res.once('close',()=>active--);
}catch(e){report.fixtureError=e.stack;res.statusCode=500;res.end('{}');}});
const release=(index,status=200)=>{const r=requests[index];report.requests[index].releasedAt=Date.now();r.res.statusCode=status;r.res.end(status===200?JSON.stringify({data:[{b64_json:pngs[r.wire].toString('base64')}]}):'private-fixture-error');};
const finish=code=>{if(ended)return;ended=true;fs.writeFileSync(path.join(out,reopening?'desktop-reopen.json':'desktop.json'),JSON.stringify(report,null,2));server.closeAllConnections();server.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},100000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.setIgnoreMouseEvents(true);w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')(e.message==='ResizeObserver loop completed with undelivered notifications.'?report.resizeNotifications:report.errors).push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(predicate,label)=>{for(let i=0;i<200;i++){if(report.errors.length)throw Error(report.errors.join('\n'));if(await predicate())return;await sleep(50);}throw Error('Timeout '+label);};
  const check=(label,value)=>{assert.ok(value,label);report.checks.push(label);console.log('PASS '+label);};
  const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args,{reconnectTimeoutMs:0,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const run=async(command,args={})=>{await js('document.activeElement?.blur()');const r=await call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});await sleep(80);return r;};
  const node=async id=>(await call('get_object',{kind:'canvasNode',id})).object;
  const click=async(label,scope='document')=>{w.showInactive();const p=await js(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!e||e.disabled)throw Error('Missing enabled '+${JSON.stringify(label)});const r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);for(const type of ['mouseDown','mouseUp'])w.webContents.sendInputEvent({type,button:'left',clickCount:1,...p});await sleep(120);};
  const capture=async name=>{w.showInactive();await sleep(180);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
  try{
   w.setSize(1440,960);await wait(()=>js('!!document.querySelector(".workspace-rail")'),'app ready');await new Promise(r=>server.listen(0,'127.0.0.1',r));
   const fetch=global.fetch;let wire=0;global.fetch=(url,options)=>fetch(url,String(url).startsWith(`http://127.0.0.1:${server.address().port}/v1/images/`)?{...options,headers:{...options.headers,'x-fixture-call':String(wire++)}}:options);
   pngs=await Promise.all(Array.from({length:24},(_,i)=>require('sharp')({create:{width:160+16*i,height:128,channels:4,background:['#8aade6','#dcb47b','#99bda3','#bba8db'][i%4]}}).png().toBuffer()));
   await js(`tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'local-fixture-only',model:'custom-image'})`);await js('window.dispatchEvent(new Event("tugou-connection-changed"))');
   if(reopening){
    await run('ui.navigate',{settingsTab:'models'});await wait(()=>js(`!!document.querySelector('[aria-label="图片生成并发数"]')`),'restored setting');
    check('full process restart restores thirty-two in the UI and saved preferences',(await js('tugou.settings("get")')).preferences.imageConcurrency===32&&await js(`document.querySelector('[aria-label="图片生成并发数"]').closest('.studio-select').dataset.value==='32'`));
    const jobs=[];for(let i=0;i<3;i++){const id=(await run('canvas.create',{type:'config',position:{x:i*450,y:3000},properties:{name:'重启并发 '+i,prompt:'重启后验证上限',size:'auto',count:15}})).id;jobs.push(await run('generation.start',{nodeId:id,requestId:'restart-limit-'+id}));}
    await wait(()=>requests.length===32,'restored thirty-two HTTP slots');await sleep(150);check('restored runtime admits thirty-two requests and queues the remaining thirteen',requests.length===32&&active===32&&report.peak===32);
    for(const job of jobs.reverse())await run('task.cancel',{id:job.taskId});await wait(()=>active===0,'all requests aborted');await sleep(150);check('cancelling the desk with queued requests first prevents extra submissions and retains existing assets',requests.length===32&&(await call('query_objects',{kind:'asset'})).total===15);await capture('settings-concurrency-reopened');finish(0);return;
   }
   const choose=async(selector,value)=>{await js(`document.querySelector(${JSON.stringify(selector)}).closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(()=>js(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-option-value="${value}"]')`),'option '+value);await js(`document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-option-value="${value}"]').closest('.ant-select-item-option').click()`);await sleep(150);};
   const concurrency=async value=>{await run('ui.navigate',{settingsTab:'models'});await wait(()=>js(`!!document.querySelector('[aria-label="图片生成并发数"]')`),'concurrency control');await choose('[aria-label="图片生成并发数"]',value);await wait(async()=>(await js('tugou.settings("get")')).preferences.imageConcurrency===value,'saved concurrency');};
   await run('ui.navigate',{settingsTab:'models'});await wait(()=>js(`!!document.querySelector('[aria-label="图片生成并发数"]')`),'default control');
   check('settings default to eight with all thirty-two choices',await js(`document.querySelector('[aria-label="图片生成并发数"]').closest('.studio-select').dataset.value==='8'&&document.querySelector('[aria-label="图片生成并发数"]').closest('.studio-select').dataset.optionCount==='32'`));
   await capture('settings-concurrency-dark');await concurrency(32);check('dropdown persists upper bound as a number',JSON.parse(fs.readFileSync(path.join(profile,'preferences.json'))).imageConcurrency===32);
   for(const [language,label] of [['en','Concurrent image requests'],['zh-TW','圖片生成並行數'],['ja','画像生成の同時リクエスト数'],['ko','동시 이미지 생성 요청 수'],['zh-CN','图片生成并发数']]){
    await run('ui.navigate',{settingsTab:'general'});await choose('.settings-row-control .ant-select',language);await wait(()=>js(`document.documentElement.lang===${JSON.stringify(language)}`),'language');await run('ui.navigate',{settingsTab:'models'});check('localized concurrency setting '+language,await js(`!!document.querySelector('[aria-label="${label}"]')`));
   }
   await run('ui.navigate',{settingsTab:'appearance'});await click('浅色');await wait(()=>js('document.documentElement.dataset.theme==="light"'),'light theme');await run('ui.navigate',{settingsTab:'models'});w.setSize(1024,768);await capture('settings-concurrency-light-small');
   check('small light window keeps the complete setting inside its content area',await js(`(()=>{const e=document.querySelector('[aria-label="图片生成并发数"]').closest('.studio-select'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`));w.setSize(1440,960);
   await concurrency(4);
   await run('project.create',{name:'并发生图实际验收'});const project=(await call('get_state')).projectId;
   const desk=(await run('canvas.create',{type:'config',position:{x:0,y:0},properties:{name:'四张同时生成',prompt:'四张独立图片',size:'auto',count:4}})).id;
   const text=(await run('canvas.create',{type:'text',position:{x:-400,y:0},properties:{text:'未保存内容保留：并发测试'}})).id;
   await run('ui.navigate',{nodeId:desk});const before=await call('get_state');
   await click('开始生成',`document.querySelector('[data-id="${desk}"]')`);
   await wait(()=>requests.length===4,'four requests received before release');
   await run('ui.navigate',{overview:true});
   await wait(()=>js('document.querySelectorAll(".generation-output-placeholder").length===4'),'four placeholders');
   const first=(await run('task.list'))[0],ids=(await call('query_objects',{kind:'canvasNode',limit:100})).objects.filter(n=>n.type==='asset').map(n=>n.id);
   check('native generation button sends four independent n=1 POSTs before any response',requests.length===4&&report.peak===4&&requests.every(r=>r.body.n===1)&&report.requests.every(r=>!r.releasedAt));
   check('UI and MCP agree on the running task, four result placeholders and four edges',first.status==='running'&&first.context.count===4&&ids.length===4&&(await call('query_objects',{kind:'edge'})).total===4);
   const positions=await Promise.all(ids.map(async id=>({id,position:(await node(id)).position})));
   await run('ui.navigate',{overview:true});await capture('four-in-flight');for(const i of [2,0,3,1])release(i);
   await wait(async()=>((await node(desk)).data.outputAssetIds||[]).length===4,'four merged results');
   const assetIds=(await node(desk)).data.outputAssetIds,assets=await Promise.all(assetIds.map(async id=>(await call('get_object',{kind:'asset',id})).object));
   check('out-of-order responses retain four ordered, separate results',assets.map(a=>a.width).join(',')==='160,176,192,208'&&new Set(assetIds).size===4);
   check('completion fills the original placeholder IDs without moving nodes or losing edges',(await Promise.all(positions.map(async p=>{const n=await node(p.id);return !!n.data.assetId&&JSON.stringify(n.position)===JSON.stringify(p.position);}))).every(Boolean)&&(await call('query_objects',{kind:'edge'})).total===4);
   const after=await call('get_state');check('generation preserves unsaved text and the undo history',(await node(text)).data.text==='未保存内容保留：并发测试'&&after.dirty&&after.history.undo===before.history.undo);await capture('four-results');
   const a=(await run('canvas.create',{type:'config',position:{x:-500,y:700},properties:{name:'MCP 并发',prompt:'MCP 独立任务',size:'auto'}})).id;
   const b=(await run('canvas.create',{type:'config',position:{x:-500,y:1400},properties:{name:'按钮并发',prompt:'按钮独立任务',size:'auto'}})).id;
   const job=await run('generation.start',{nodeId:a,requestId:'concurrent-mcp'}),again=await run('generation.start',{nodeId:a,requestId:'concurrent-mcp'});
   await run('ui.navigate',{nodeId:b});await run('canvas.viewport',{x:550,y:-1350,zoom:1});
   await wait(()=>js(`!!document.querySelector('[data-id="${b}"] .desk-run')`),'second desk visible');await click('开始生成',`document.querySelector('[data-id="${b}"]')`);await wait(()=>requests.length===6,'MCP and UI overlap');
   check('MCP submission and another desk button run simultaneously without duplicate requestId charges',job.taskId===again.taskId&&again.replayed&&report.requests.slice(4).every(r=>!r.releasedAt)&&(await run('task.list')).filter(t=>t.status==='running').length===2);
   await run('task.cancel',{id:job.taskId});release(5);await wait(async()=>!!(await node(b)).data.outputAssetId,'other desk completes');
   check('cancelling one desk leaves the other desk result intact',(await run('task.get',{id:job.taskId})).status==='cancelled'&&!(await node(a)).data.outputAssetId&&(await call('query_objects',{kind:'asset'})).total===5);
   await run('canvas.update',{id:desk,properties:{count:3}});const partial=await run('generation.start',{nodeId:desk,requestId:'partial-images'});await wait(()=>requests.length===9,'three partial requests overlap');
   release(8);release(6);release(7,429);await wait(async()=>(await run('task.get',{id:partial.taskId})).status==='completed','partial completion');
   await wait(async()=>((await node(desk)).data.outputAssetIds||[]).length===2,'two partial results');
   check('partial failure keeps paid successes with no automatic retry or orphan placeholders',requests.length===9&&(await call('query_objects',{kind:'asset'})).total===7&&(await run('task.get',{id:partial.taskId})).message.includes('已生成 2/3 张，1 张失败'));
   await click('任务');await wait(()=>js('document.body.textContent.includes("已生成 2/3 张，1 张失败")'),'partial warning visible');check('task panel visibly reports partial failure without leaking provider response',!await js('document.body.textContent.includes("private-fixture-error")'));await capture('partial-warning');await click('关闭任务','document.querySelector(".task-dialog")');
   await run('history.undo');check('undo remains usable after concurrent results',(await node(desk)).data.count===4&&(await call('query_objects',{kind:'asset'})).total===7);await run('history.redo');
   await run('project.save');await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(project)},workspace:'canvas'}))`);
   const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;await wait(()=>js('!!document.querySelector(".react-flow__pane")'),'reload canvas');
   check('save and reopen preserve all seven results, result links and edited text',(await call('query_objects',{kind:'asset'})).total===7&&(await node(desk)).data.outputAssetIds.length===2&&(await node(b)).data.outputAssetId&&(await node(text)).data.text==='未保存内容保留：并发测试');
   check('native renderer reports no unexpected errors or extra provider requests',report.errors.length===0&&!report.fixtureError&&requests.length===9&&report.peak===4);
   await concurrency(2);const live=(await run('canvas.create',{type:'config',position:{x:0,y:2200},properties:{name:'动态八路',prompt:'动态并发',size:'auto',count:8}})).id;
   const liveJob=await run('generation.start',{nodeId:live,requestId:'live-concurrency'});await wait(()=>requests.length===11,'two live requests');await concurrency(8);await wait(()=>requests.length===17,'eight live requests after UI change');
   check('saving eight in the UI immediately admits queued MCP image requests',active===8&&report.peak===8&&requests.slice(9).every(r=>r.body.n===1&&!r.res.writableEnded));await capture('settings-eight-live');
   await concurrency(1);for(let i=9;i<17;i++)release(i);await wait(async()=>(await run('task.get',{id:liveJob.taskId})).status==='completed','eight requests finish after lowering');
   check('lowering to one does not cancel the eight already-issued requests',(await run('task.get',{id:liveJob.taskId})).status==='completed'&&requests.length===17);
   await concurrency(32);await run('project.save');await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(project)},workspace:'settings'}))`);
   const reopened=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await reopened;await wait(()=>js('!!document.querySelector(".workspace-rail")'),'reopen');await run('ui.navigate',{settingsTab:'models'});
   check('concurrency survives reopening with all generated assets retained',await js(`document.querySelector('[aria-label="图片生成并发数"]').closest('.studio-select').dataset.value==='32'`)&&(await call('query_objects',{kind:'asset'})).total===15);
   check('settings and live concurrency complete without renderer errors',report.errors.length===0&&!report.fixtureError);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('desktop-failure');}catch{}finish(1);}
 });
});require(path.join(source,'desktop-main.cjs'));
