// Isolated renderer + real MCP/native processing. Download timing is simulated;
// cleanup-native.cjs separately verifies actual download, installation and pixels.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/cleanup'),profile=fs.mkdtempSync(path.join(out,'desktop-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const {CleanupTools}=require('../core/cleanup-tools.cjs');
const realRuntime=CleanupTools.prototype.runtime,enabled=new Set();let behavior='wait',starts=0,transport,finished=false;
CleanupTools.prototype.runtime=async function(op){if(!enabled.has(op))throw Error('not installed');const runtime=Object.create(this);runtime.directory=path.join(out,'profile','components','cleanup-tools');return realRuntime.call(runtime,op);};
CleanupTools.prototype.install=async function(tasks,operation){starts++;const task=await tasks.start('下载'+operation,async(signal,id)=>{const t=tasks.tasks.find(t=>t.id===id);t.progress=42;t.message='下载组件 · 42%';if(behavior==='wait')await new Promise(r=>signal.addEventListener('abort',r,{once:true}));signal.throwIfAborted();if(behavior==='fail')throw Object.assign(Error('fixture'),{safeMessage:'下载失败，请手动继续'});enabled.add(operation);t.progress=100;},{kind:'runtime-install',cleanup:operation,components:[operation]});return{id:task.id};};
const report={checks:[],errors:[]};const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
require('electron').dialog.showErrorBox=(title,message)=>{report.failure=title+': '+message;console.error(report.failure);finish(1);};
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async s=>{for(let i=0;i<400;i++){if(await js(s))return;await delay(75);}throw Error('Timeout '+s);};
 const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable '+${JSON.stringify(label)});b.scrollIntoView({block:'nearest'});b.click()})()`);await delay(150);};
 const capture=async name=>{w.showInactive();await delay(200);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
 try{
  await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
  transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
  const client=new Client({name:'cleanup-qa',version:'1'});await client.connect(transport);
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
  const state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision});
  await state();await call('list_commands',{domain:'image'});await run('project.create',{name:'清理工具实际检查'});
  fs.copyFileSync(path.join(out,'fixture.png'),path.join(profile,'automation','fixture.png'));
  const imported=await run('asset.import',{path:'fixture.png'}),id=imported.ids[0];
  await run('ui.navigate',{workspace:'tools'});await click('可见水印修复');
  await wait(`!!document.querySelector('[aria-label="工具在云端"]')`);await delay(1000);
  check('opening watermark does not download',starts===0);check('missing tool blocks processing',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始处理').disabled`));await capture('watermark-cloud');
  await click('下载工具');await wait(`document.querySelector('[aria-label="工具下载进度"]')?.getAttribute('aria-valuenow')==='42'`);await capture('cleanup-progress');
  await click('取消下载');await wait(`[...document.querySelectorAll('button')].some(b=>b.textContent==='继续下载')`);await delay(1000);check('cancel never auto-resumes',starts===1);
  behavior='fail';await click('继续下载');await wait(`document.querySelector('.tool-download').textContent.includes('下载失败')`);check('failed install remains manual',starts===2);
  behavior='ok';await click('继续下载');await wait(`!!document.querySelector('[aria-label="工具已下载"]')`);check('successful install removes cloud icon',!await js(`!!document.querySelector('[aria-label="工具在云端"]')`));
  await click('基础处理');await click('元数据清理');await wait(`!!document.querySelector('[aria-label="工具在云端"]')`);check('metadata has separate download',!enabled.has('metadata'));await click('下载工具');await wait(`!!document.querySelector('[aria-label="工具已下载"]')`);
  await click('查看原图元数据');await wait(`!!document.querySelector('.cleanup-fields')`);check('inspection lists real metadata',await js(`document.querySelector('.cleanup-fields').textContent.includes('GPS')`));await capture('metadata-before');
  const inspection=await run('image.metadata',{id});check('MCP metadata read uses live asset',inspection.fields.some(x=>x.key.includes('GPS')));
  await click('开始处理');await wait(`!!document.querySelector('.cleanup-report')`);check('metadata display fields are not reported as residuals',await js(`document.querySelector('.cleanup-report').textContent.includes('剩余 0 项')`));check('UI processing produces comparison',await js(`!!document.querySelector('.comparison-viewer')`));await capture('metadata-after');
  const task=await run('image.process',{ids:[id],requestId:'cleanup-watermark',settings:{operation:'watermark',mode:'region',left:15,top:15,width:30,height:20,radius:6}});
  await run('task.wait',{id:task.taskId,timeoutMs:20000});const done=await run('task.get',{id:task.taskId});check('MCP region repair completes: '+done.message,done.status==='completed');
  const replay=await run('image.process',{ids:[id],requestId:'cleanup-watermark',settings:{operation:'watermark',mode:'region',left:15,top:15,width:30,height:20,radius:6}});check('MCP request does not duplicate processing',replay.replayed&&replay.taskId===task.taskId);
  await click('智能工具');await click('可见水印修复');
  await js(`document.querySelector('[aria-label="水印修复方式"]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await delay(200);
  await js(`(()=>{const e=[...document.querySelectorAll('.ant-select-item-option')].find(e=>e.textContent==='涂画区域');if(!e)throw Error('missing mask option');e.click()})()`);await click('涂画修复区域');await wait(`document.querySelector('.mask-paint-stage canvas')?.dataset.ready==='true'`);
  check('local brush explains local repair',await js(`document.querySelector('.cloud-mask-editor').textContent.includes('本机修复')`));await capture('watermark-brush');
  const bounds=await js(`(()=>{const r=document.querySelector('.mask-paint-stage canvas').getBoundingClientRect();return{x:Math.round(r.x+r.width*.5),y:Math.round(r.y+r.height*.5)}})()`);
  w.showInactive();w.webContents.sendInputEvent({type:'mouseDown',...bounds,button:'left',clickCount:1});w.webContents.sendInputEvent({type:'mouseMove',x:bounds.x+15,y:bounds.y+20});w.webContents.sendInputEvent({type:'mouseUp',x:bounds.x+15,y:bounds.y+20,button:'left',clickCount:1});await delay(200);await click('应用修改区域');await wait(`!document.querySelector('.cloud-mask-editor')`);check('brush applies a real stored mask',await js(`document.querySelector('.cleanup-controls').textContent.includes('修复区域已保存')`));
  const beforePaint=(await state()).counts.assets;await click('开始处理');await wait(`document.querySelectorAll('.tools-material-item').length>${beforePaint}&&[...document.querySelectorAll('.tools-submit button')].some(b=>b.textContent==='开始处理'&&!b.disabled)`);await wait(`document.querySelector('.cleanup-report')?.textContent.includes('已按选区修复')`);check('painted region processes and returns report',true);await capture('watermark-result');
  w.setSize(960,720);await click('切换浅色主题');await delay(200);await capture('cleanup-narrow');
  check('controls fit narrow window',await js(`(()=>{const e=document.querySelector('.cleanup-controls'),r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.left>=0&&r.right<=innerWidth})()`));
  check('no renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);try{await capture('cleanup-failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
