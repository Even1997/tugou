// Isolated real renderer checks; local AI availability is simulated. Raster processing is real.
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/tools-upload');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'desktop-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
let starts=0,dialogCalls=0,transport,finished=false;
let pickerFiles=[],pickerOptions;dialog.showOpenDialog=async(_window,options)=>{dialogCalls++;pickerOptions=options;return {canceled:pickerFiles.length===0,filePaths:pickerFiles};};
const {LocalAIService}=require('../core/local-ai.cjs'),{RuntimeInstaller}=require('../core/runtime-install.cjs');
LocalAIService.prototype.status=async function(){return {configured:false,models:[],cutout:false,cutoutModels:[],downloadFolder:path.join(profile,'components','tugou-components')};};
RuntimeInstaller.prototype.execute=async function(){starts++;throw Error('UI browsing must not install components');};
const report={checks:[],errors:[]};const check=(s,v)=>{assert.ok(v,s);report.checks.push(s);console.log('PASS '+s);};
const finish=code=>{if(finished)return;finished=true;report.installerStarts=starts;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async s=>{for(let i=0;i<200;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
 const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable '+${JSON.stringify(label)});b.scrollIntoView({block:'nearest'});b.click()})()`);await delay(150);};
 const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
 try{
  await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
  transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
  const client=new Client({name:'download-qa',version:'1'});await client.connect(transport);
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
  const state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision});
  await state();await call('list_commands',{domain:'tools'});await run('project.create',{name:'工具本地上传检查'});await run('ui.navigate',{workspace:'tools'});
  const before=await state();await click('上传图片');
  check('cancel picker leaves project unchanged',(await state()).revision===before.revision&&(await state()).counts.assets===0);
  check('picker accepts images and supports multiple files',pickerOptions.properties.includes('multiSelections')&&pickerOptions.filters[0].extensions.join(',')==='png,jpg,jpeg,webp');
  const input=path.resolve('test-results/local-ai-fixtures/white.png'),bytes=fs.readFileSync(input),second=path.join(out,'second.png'),bad=path.join(out,'corrupt.png');fs.writeFileSync(second,bytes);fs.writeFileSync(bad,'not an image');
  pickerFiles=[input,bad];await click('上传图片');await wait(`!!document.querySelector('.message[role="status"]')`);
  check('corrupt member reports an error and imports no partial batch',(await state()).counts.assets===0&&await js(`!!document.querySelector('.message[role="status"]').textContent.trim()&&!document.querySelector('img[alt="处理原图"]')`));
  pickerFiles=[input,second];await click('上传图片');await wait(`!!document.querySelector('img[alt="处理原图"]')`);
  check('multiple local files are added to shared assets',(await state()).counts.assets===2);
  check('first uploaded file selected and geometry initialized',await js(`document.querySelector('.tools-settings-heading').textContent.includes('512 × 768')&&document.querySelector('.tool-output-size').textContent.includes('1024 × 1536')&&document.querySelector('.message').textContent.includes('已导入 2 张')`));
  await capture('uploaded');
  const selected=await js(`document.querySelector('[aria-label="处理来源"]').closest('.studio-select').dataset.value`),rev=(await state()).revision;
  pickerFiles=[];await click('上传图片');check('cancel keeps existing source and project',(await state()).revision===rev&&selected===await js(`document.querySelector('[aria-label="处理来源"]').closest('.studio-select').dataset.value`));
  await click('批量处理');check('uploads are available for batch selection',await js(`document.querySelector('.ant-modal-body')?.textContent.includes('second')`));await click('关闭批量处理');
  await click('开始处理');await wait(`!!document.querySelector('img[alt="处理结果"]')`);check('uploaded image can be processed',(await state()).counts.assets===3);
  check('source file remains unchanged',fs.readFileSync(input).equals(bytes));
  await click('保存');await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='保存'&&b.disabled)`);
  const project=(await state()).projectId;check('uploaded assets and result persist',await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>r.document.assets.length===3)`));
  w.setSize(960,720);await click('切换浅色主题');await delay(150);await capture('narrow');
  check('toolbar fits narrow window',await js(`(()=>{const p=document.querySelector('.image-tools-toolbar');return p.scrollWidth<=p.clientWidth+1})()`));
  check('no automatic download or renderer errors',starts===0&&report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
