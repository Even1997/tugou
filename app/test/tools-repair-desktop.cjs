const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/tools-repair'),profile=fs.mkdtempSync(path.join(out,'desktop-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
let componentFolder=JSON.parse(fs.readFileSync(path.join(out,'native-report.json'))).runtime.folder;
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[componentFolder]});
const report={checks:[],errors:[]};let transport,finished=false;
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<1200;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable: '+${JSON.stringify(label)});b.click()})()`);await delay(120);};
  const capture=async name=>{w.showInactive();await delay(250);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'tools-repair-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(80);return r;};
   await state();await call('list_commands',{domain:'image'});await call('list_commands',{domain:'tools'});
   await run('project.create',{name:'图像工具隔离验收'});const project=(await state()).projectId;
   const png=fs.readFileSync(path.join(__dirname,'../test-results/local-ai-fixtures/white.png'));
   const asset=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'透明边缘检查')`);
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:[${JSON.stringify(asset)}]},r.revision))`);await run('project.open',{id:project});
   await run('ui.navigate',{workspace:'tools'});await click('AI 超分辨率');
   await wait(`document.querySelector('.local-tool-status')?.textContent.includes('请选择')||document.querySelector('.local-tool-status')?.textContent.includes('请先')`);
   check('missing runtime blocks processing before submission',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始处理').disabled`));
   check('MCP reports same missing runtime',(await run('tools.status')).configured===false);
   await click("管理本地组件");
   check('upscale-only defaults avoid Python download',await js(`document.querySelector('[aria-label="组件安装"]').textContent.includes('无需 Python')`));
   await click('使用已安装的组件');await wait(`document.querySelector('.ant-modal-body')?.textContent.includes('组件已安装')`);await click('关闭本地组件');
   await wait(`![...document.querySelectorAll('button')].find(b=>b.textContent==='开始处理').disabled`);
   const status=await run('tools.status');check('MCP and UI agree on independently installed upscale',status.models.length===3&&!status.cutout);
   await capture('ready');await click('开始处理');
   await wait(`!!document.querySelector('[aria-label="图像处理进度"]')`);check('native task exposes visible progress',true);
   await wait(`document.querySelectorAll('.processing-item').length===1`);
   const result=(await call('query_objects',{kind:'asset',limit:100})).objects;
   check('UI processing imports one result and preserves source',result.length===2);
   check('completed result switches automatically to comparison',await js(`!!document.querySelector('.image-comparison.view-compare')`));await capture('comparison');
   await click('主体抠图');await wait(`document.querySelector('.local-tool-status')?.textContent.includes('抠图运行环境')`);
   check('missing cutout remains blocked while upscale works',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始处理').disabled`));
   await click('素材');
   const task=await run('image.process',{ids:[asset.id],settings:{operation:'upscale',model:'anime',scale:2},requestId:'qa-upscale-'+Date.now()});
   const done=await run('task.wait',{id:task.taskId,timeoutMs:30000});check('MCP invokes the same native upscale pipeline',done.status==='completed'||done.task?.status==='completed');
   await run('ui.navigate',{workspace:'tools'});componentFolder='D:/CanvasStudioRuntime';await click('主体抠图');await click("管理本地组件");await click('使用已安装的组件');await wait(`document.querySelector('.ant-modal-body')?.textContent.includes('主体抠图：可用')`);await click('关闭本地组件');
   let expectedAssets=3;const cutout=await run('tools.status');
   if(cutout.readiness.cutout.resourceLimited){
    await wait(`document.querySelector('.local-tool-status')?.textContent.includes('内存不足')`);
    check('real low-memory condition blocks UI before task submission',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始处理').disabled`));
    await click('素材');let rejected=false;try{await run('image.process',{ids:[asset.id],settings:{operation:'cutout'},requestId:'low-memory-'+Date.now()});}catch(e){rejected=/内存不足/.test(e.message);}check('MCP rejects the same low-memory cutout before queueing',rejected);
    report.cutoutLimit=cutout.readiness.cutout.reason;await run('ui.navigate',{workspace:'tools'});
   }else{await click('开始处理');await wait(`document.querySelectorAll('.processing-item').length===3`);check('real BiRefNet cutout completes and imports result',true);expectedAssets=4;}

   await capture('result');await click('素材');await run('project.save');await run('project.open',{id:project});
   check('save/reopen retains source and all completed outputs',(await call('query_objects',{kind:'asset',limit:100})).objects.length===expectedAssets);
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
