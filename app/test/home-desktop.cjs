// Isolated profile; real copy IPC/config/stdio, clipboard sink kept in memory to preserve the user's clipboard.
const {app,clipboard,screen}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/home');fs.mkdirSync(out,{recursive:true});const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');delete process.env.TUGOU_DEV_PREVIEW;if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;
// Electron uses the test script directory as appPath; match the real main.cjs launch for generated connection paths.
app.getAppPath=()=>process.env.TUGOU_TEST_APP?path.dirname(process.env.TUGOU_TEST_APP):path.resolve('.');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const {TaskQueue}=require(process.env.TUGOU_TEST_APP?path.join(path.dirname(process.env.TUGOU_TEST_APP),'core/tasks.cjs'):'../core/tasks.cjs'),init=TaskQueue.prototype.init;let queue,transport,release,ended=false;
TaskQueue.prototype.init=async function(){await init.call(this);queue=this;};
const report={profile,checks:[],errors:[]};let copiedText='';clipboard.writeText=value=>{copiedText=value;};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
const finish=async code=>{if(ended)return;ended=true;release?.();await transport?.close();fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';void finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.setIgnoreMouseEvents(true);w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.startsWith('ResizeObserver loop'))report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=code=>w.webContents.executeJavaScript(code,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await sleep(50);}throw Error('Timeout '+code);};
  const click=async selector=>{await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('Control unavailable');e.click()})()`);await sleep(120);};
  const button=async label=>{await js(`(()=>{const e=[...document.querySelectorAll('.home-workspace button,.home-guide button')].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw Error('Missing '+${JSON.stringify(label)});e.click()})()`);await sleep(150);};
  const capture=async name=>{w.showInactive();await sleep(300);fs.writeFileSync(path.join(out,name+'.png'),(await w.capturePage()).toPNG());w.hide();};
  const stat=label=>js(`document.querySelector('[aria-label="${label}数量"]').textContent`);
  const select=async value=>{await js(`document.querySelector('[aria-label="配置格式"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-option-value="${value}"]')`);await click(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) [data-option-value="${value}"]`);};
  try{
   await wait(`!!document.querySelector('.home-workspace')&&document.querySelector('[aria-label="本机工程数量"]').textContent==='0'`);
   const bounds=w.getBounds(),area=screen.getDisplayMatching(bounds).workArea,expected=require('../core/desktop-platform.cjs').initialWindowBounds(area);report.startupBounds=bounds;
   check('native startup window uses compact size centered within the work area',['x','y','width','height'].every(key=>bounds[key]===expected[key]));
   check('fresh launch opens home without a project',await js(`document.querySelector('.workspace-rail [aria-current="page"]').getAttribute('aria-label')==='首页'`));
   check('navigation uses distinct semantic icons for all seven workspaces',await js(`JSON.stringify([...document.querySelectorAll('.workspace-rail>button .studio-icon')].map(e=>e.dataset.icon))===JSON.stringify(['home','prompts','canvas','layers','tools','assets','fonts'])`));
   check('shared icons use rounded strokes and preserve labelled button targets',await js(`(()=>{const icons=[...document.querySelectorAll('.studio-icon svg')],buttons=[...document.querySelectorAll('button.icon-button')];return icons.length>15&&icons.every(e=>e.getAttribute('stroke-linecap')==='round'&&e.getAttribute('stroke-linejoin')==='round'&&e.getAttribute('fill')==='none')&&buttons.every(e=>e.getAttribute('aria-label')&&e.getBoundingClientRect().width>=24)})()`));
   check('empty statistics distinguish no project from zero tasks',await stat('工程素材')==='—'&&await stat('已完成任务')==='0'&&await stat('进行中任务')==='0');
   await wait(`document.querySelector('.home-mcp-status').textContent==='本地服务未启用'`);check('home does not enable MCP automatically',!(await js(`tugou.settings('mcpStatus')`)).enabled);
   await capture('empty-dark');await button('MCP 连接');await button('启用 MCP');await wait(`document.querySelector('.home-mcp-status').textContent==='本地服务已启用'`);
   check('enable service shows service state without claiming a client is connected',await js(`document.querySelector('.home-mcp').textContent.includes('客户端是否连通需在第 3 步验证')`));
   await click('.home-config>summary');await wait(`document.querySelector('.settings-config-code').textContent.includes('mcpServers')`);
   const info=await js(`tugou.settings('mcpConnection')`);
   for(const format of ['json','vscode','codex']){if(format!=='json')await select(format);await click('.settings-config-toolbar button');await wait(`document.querySelector('.settings-config-toolbar button').textContent.includes('已复制')`);check(format+' copied config matches local executable and profile',copiedText===info.formats[format]);}
   transport=new StdioClientTransport({command:info.command,args:info.args,env:{...process.env,...info.env},stderr:'pipe'});const client=new Client({name:'home-acceptance',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{await js('document.activeElement?.blur()');const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await sleep(100);return r;};
   check('copied stdio config connects and read-only verification works',(await state()).projectId===null&&(await call('list_commands',{domain:'canvas'})).total>0);
   await button('复制验证指令');check('verification prompt copies read-only instructions',copiedText.includes('get_state')&&copiedText.includes('暂不修改工程或生成图片'));
   clipboard.writeText=()=>{throw Error('复制失败测试');};await button('复制验证指令');await wait(`document.querySelector('.home-error')?.textContent.includes('复制失败测试')`);check('copy failures are visible and retryable',true);clipboard.writeText=value=>{copiedText=value;};await button('复制验证指令');await wait(`!document.querySelector('.home-error')`);
   await capture('config-dark');await click('[aria-label="关闭MCP 连接引导"]');
   await button('新建工程');await wait(`!!document.querySelector('.canvas-workspace')`);const project=(await state()).projectId;
   check('create from home enters canvas',(await state()).workspace==='canvas'&&!!project);
   await run('canvas.create',{type:'text',position:{x:0,y:0},properties:{text:'保留未保存编辑'}});const before=await state();
   await run('ui.navigate',{workspace:'home'});check('home navigation preserves unsaved edits and history',(await state()).revision===before.revision&&(await state()).dirty&&JSON.stringify((await state()).history)===JSON.stringify(before.history));
   await button('进入画布');check('continue returns to same live project',(await state()).projectId===project&&(await state()).counts.nodes===1);await run('project.save');
   const other=await js(`tugou.create('另一个工程')`),image=await js(`tugou.storeRaster(${JSON.stringify([...await require('sharp')({create:{width:4,height:4,channels:4,background:'#639ab7'}}).png().toBuffer()])},'统计图片')`);
   await js(`tugou.save(${JSON.stringify(other.id)},{...${JSON.stringify(other.document)},assets:[${JSON.stringify(image)}]},${other.revision})`);
   await run('project.open',{id:other.id});await run('ui.navigate',{workspace:'home'});await wait(`document.querySelector('[aria-label="本机工程数量"]').textContent==='2'`);
   check('statistics use all readable projects and current project assets',await stat('工程素材')==='1'&&await js(`document.querySelectorAll('.home-recent button').length===2`));
   const complete=await queue.start('已完成测试任务',async()=>{});await complete.completion;const failed=await queue.start('失败测试任务',async()=>{throw Error('test')});await failed.completion;
   let started;const running=new Promise(resolve=>{started=resolve;});
   const active=await queue.start('进行中的测试任务',()=>new Promise(resolve=>{release=resolve;started();}));await running;
   await wait(`document.querySelector('[aria-label="已完成任务数量"]').textContent==='1'&&document.querySelector('[aria-label="进行中任务数量"]').textContent==='1'`);check('task statistics distinguish failed completed and running tasks',true);
   release();await active.completion;await wait(`document.querySelector('[aria-label="已完成任务数量"]').textContent==='2'&&document.querySelector('[aria-label="进行中任务数量"]').textContent==='0'`);check('task statistics update after completion without navigation',true);
   await capture('populated-dark');await click('.rail-bottom [aria-label="切换浅色主题"]');await capture('populated-light');w.setSize(960,760);await sleep(300);await capture('light-narrow');
   check('narrow home has no horizontal overflow',await js(`(()=>{const e=document.querySelector('.home-workspace');return e.scrollWidth<=e.clientWidth+1})()`));
   await button('MCP 连接');check('MCP shortcut opens a separate guide without expanding the home',await js(`!!document.querySelector('.home-guide')&&!document.querySelector('.home-content .home-steps')`));
   await click('.home-config>summary');await js(`document.querySelector('.home-config').scrollIntoView({block:'start'})`);await capture('config-light');
   check('expanded configuration stays within the narrow dialog',await js(`(()=>{const e=document.querySelector('.home-guide .ant-modal-body'),r=document.querySelector('.home-guide .ant-modal-container').getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.bottom<=innerHeight})()`));
   const inspected=await run('ui.inspect');check('MCP inspection redacts connection paths',!JSON.stringify(inspected).includes(profile)&&inspected.redactedRegions.length>0);
   w.webContents.setZoomFactor(1.25);await sleep(200);check('125 percent zoom keeps home content within the window',await js(`(()=>{const e=document.querySelector('.home-workspace');return e.scrollWidth<=e.clientWidth+1})()`));check('settings and theme remain visible after adding home at 125 percent zoom',await js(`[...document.querySelectorAll('.rail-bottom button')].every(e=>{const r=e.getBoundingClientRect();return r.top>=56&&r.bottom<=innerHeight})`));await capture('zoom-light');w.webContents.setZoomFactor(1);
   await click('[aria-label="关闭MCP 连接引导"]');await js(`document.querySelector('.home-workspace').scrollTop=0`);
   await click('.home-recent button:last-child');await wait(`!!document.querySelector('.canvas-workspace')`);check('recent project opens the selected saved document',(await state()).projectId===project);
   await js(`tugou.window('reload')`);await wait(`!!document.querySelector('.home-workspace')&&document.querySelector('.home-current h3')?.textContent==='未命名创作'`);check('reload restores the project while opening home',(await state()).workspace==='home'&&(await state()).projectId===project);
   await run('ui.navigate',{workspace:'home'});await button('任务记录');await wait(`!!document.querySelector('[role="dialog"]')`);check('home task entry opens task panel',true);
   await click('[aria-label="关闭任务"]');
   await js(`(async()=>{for(let i=1;i<=48;i++)await tugou.create('工程验收 '+String(i).padStart(2,'0'));})()`);
   await js(`tugou.window('reload')`);await wait(`document.querySelector('[aria-label="本机工程数量"]')?.textContent==='50'`);w.setSize(1280,800);await sleep(200);
   check('fifty projects render only six cards per page',await js(`document.querySelectorAll('.home-recent button').length===6&&document.querySelector('[aria-label="工程分页"]').textContent==='1 / 9'`));
   check('top modules align at both edges',await js(`(()=>{const a=document.querySelector('.home-current').getBoundingClientRect(),b=document.querySelector('.home-mcp-card').getBoundingClientRect();return a.top===b.top&&a.bottom===b.bottom})()`));
   check('six project cards and pagination fit the default window',await js(`document.querySelector('.home-project-footer').getBoundingClientRect().bottom<=document.querySelector('.home-workspace').getBoundingClientRect().bottom`));
   await capture('projects-50-light');
   const seen=new Set(),heights=[];
   for(let page=1;page<=9;page++){
    for(const name of await js(`[...document.querySelectorAll('.home-recent button')].map(e=>e.title)`))seen.add(name);
    heights.push(await js(`document.querySelector('.home-recent-section').getBoundingClientRect().height`));
    if(page<9)await click('[aria-label="下一页工程"]');
   }
   check('all fifty projects can be reached by pagination',seen.size===50&&await js(`document.querySelector('[aria-label="下一页工程"]').disabled`));
   check('project module height stays fixed including the last page',Math.max(...heights)-Math.min(...heights)<1);
   const search=async value=>{await js(`(()=>{const e=document.querySelector('input[aria-label="搜索工程名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(150);};
   await search('工程验收 23');check('search covers all pages and resets pagination',await js(`document.querySelectorAll('.home-recent button').length===1&&document.querySelector('.home-recent strong').textContent==='工程验收 23'&&document.querySelector('[aria-label="工程分页"]').textContent==='1 / 1'`));
   await search('没有这个工程');check('no search match is explained',await js(`document.querySelector('.home-empty').textContent.includes('没有匹配')`));
   await search('');check('clearing search restores page one',await js(`document.querySelectorAll('.home-recent button').length===6&&document.querySelector('[aria-label="上一页工程"]').disabled`));
   w.setSize(960,760);w.webContents.setZoomFactor(1.25);await sleep(150);check('paginated project grid fits at 125 percent',await js(`(()=>{const e=document.querySelector('.home-workspace');return e.scrollWidth<=e.clientWidth+1&&[...document.querySelectorAll('.home-recent button')].every(e=>e.scrollWidth<=e.clientWidth+1)})()`));await capture('projects-50-zoom');
   w.webContents.setZoomFactor(1);w.setSize(1280,800);await click('[aria-label="切换深色主题"]');await capture('projects-50-dark');
   await search('工程验收 23');await click('.home-recent button');await wait(`!!document.querySelector('.canvas-workspace')`);check('search result opens the selected project',(await state()).projectName==='工程验收 23'||await js(`document.querySelector('.project-menu').textContent.includes('工程验收 23')`));
   for(const [workspace,index] of [['canvas',3],['layers',4],['tools',5],['assets',6],['prompts',2],['fonts',7]]){
    await click(`.workspace-rail>button:nth-child(${index})`);await sleep(200);
    check(workspace+' preserves rounded icons and accessible controls',await js(`(()=>{const icons=[...document.querySelectorAll('.studio-icon svg')],buttons=[...document.querySelectorAll('button.icon-button')];return icons.length>10&&icons.every(e=>e.getAttribute('stroke-linecap')==='round'&&e.getAttribute('stroke-linejoin')==='round')&&buttons.every(e=>!!e.getAttribute('aria-label'))})()`));
    if(workspace==='tools'){
     await js(`[...document.querySelectorAll('.tools-categories button')].find(e=>e.textContent==='素材处理').click()`);await sleep(100);
     check('material processing replaces the ambiguous composition category',await js(`document.querySelector('.tools-options').getAttribute('aria-label')==='素材处理'&&document.querySelector('.tools-settings-heading>span').textContent==='素材处理'&&document.querySelectorAll('.tools-options button').length===6`));
    }
    if(['layers','tools'].includes(workspace))await capture('icons-'+workspace);
   }
   check('zero renderer errors',report.errors.length===0);await finish(0);
  }catch(e){report.failure=e.stack;console.error(e);await capture('failure');await finish(1);}
 });
});
require(process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):'../desktop-main.cjs');
