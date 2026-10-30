// Isolated real renderer checks; local AI availability is simulated. Raster processing is real.
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/comparison-view');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'desktop-'))),main=path.resolve(process.env.TUGOU_TEST_APP||'desktop-main.cjs'),source=path.dirname(main);app.setAppPath(source);process.env.TUGOU_DATA_DIR=profile;if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;else process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
let starts=0,dialogCalls=0,transport,finished=false;
let pickerFiles=[],pickerOptions;dialog.showOpenDialog=async(_window,options)=>{dialogCalls++;pickerOptions=options;return {canceled:pickerFiles.length===0,filePaths:pickerFiles};};
const {LocalAIService}=require(path.join(source,'core/local-ai.cjs')),{RuntimeInstaller}=require(path.join(source,'core/runtime-install.cjs'));
LocalAIService.prototype.status=async function(){return {configured:false,models:[],cutout:false,cutoutModels:[],downloadFolder:path.join(profile,'components','tugou-components')};};
RuntimeInstaller.prototype.execute=async function(){starts++;throw Error('UI browsing must not install components');};
const report={checks:[],errors:[]};const check=(s,v)=>{assert.ok(v,s);report.checks.push(s);console.log('PASS '+s);};
const finish=code=>{if(finished)return;finished=true;report.installerStarts=starts;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{
 w.setIgnoreMouseEvents(true);w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
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
  await click('基础处理');await click('分辨率调整');
  const before=await state();await click('上传图片');
  check('cancel picker leaves project unchanged',(await state()).revision===before.revision&&(await state()).counts.assets===0);
  check('picker accepts images and supports multiple files',pickerOptions.properties.includes('multiSelections')&&pickerOptions.filters[0].extensions.join(',')==='png,jpg,jpeg,webp');
  const input=path.join(out,'source.png'),second=path.join(out,'second.png'),bad=path.join(out,'corrupt.png');
  const bytes=await require('sharp')(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="768"><rect width="512" height="768" fill="#f4e8d8"/><path d="M32 96H480V672H32Z M256 96V672 M32 384H480" fill="none" stroke="#293e62" stroke-width="8"/><circle cx="160" cy="250" r="60" fill="#d67b54"/><path d="M300 440L440 630H180Z" fill="#607d60"/></svg>')).png().toBuffer();
  fs.writeFileSync(input,bytes);fs.writeFileSync(second,bytes);fs.writeFileSync(bad,'not an image');
  pickerFiles=[input,bad];await click('上传图片');await wait(`!!document.querySelector('.message[role="status"]')`);
  check('corrupt member reports an error and imports no partial batch',(await state()).counts.assets===0&&await js(`!!document.querySelector('.message[role="status"]').textContent.trim()&&!document.querySelector('img[alt="处理原图"]')`));
  pickerFiles=[input,second];await click('上传图片');await wait(`!!document.querySelector('img[alt="处理原图"]')`);
  check('multiple local files are added to shared assets',(await state()).counts.assets===2);
  check('first uploaded file selected and geometry initialized',await js(`document.querySelector('.tools-settings-heading').textContent.includes('512 × 768')&&document.querySelector('.tool-output-size').textContent.includes('1024 × 1536')&&document.querySelector('.message').textContent.includes('已导入 2 张')`));
  await capture('uploaded');
  const selected=await js(`document.querySelector('.tools-material-list').dataset.value`),rev=(await state()).revision;
  pickerFiles=[];await click('上传图片');check('cancel keeps existing source and project',(await state()).revision===rev&&selected===await js(`document.querySelector('.tools-material-list').dataset.value`));
  await click('批量处理');check('uploads are available for batch selection',await js(`document.querySelector('.ant-modal-body')?.textContent.includes('second')`));await click('关闭批量处理');
  await click('开始处理');await wait(`!!document.querySelector('img[alt="处理结果"]')`);check('uploaded image can be processed',(await state()).counts.assets===3);

  const select=async value=>{await js(`document.querySelector('[aria-label="预览方式"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await delay(120);await js(`(()=>{const e=[...document.querySelectorAll('[data-option-value]')].find(e=>e.dataset.optionValue===${JSON.stringify(value)});if(!e)throw Error('no option');e.click()})()`);await delay(100);};
  const synced=()=>js(`(()=>{const p=[...document.querySelectorAll('.comparison-pane')];if(p.length!==2)return false;const a=p.map(e=>{const r=e.getBoundingClientRect(),i=e.querySelector('img').getBoundingClientRect();return {x:i.x-r.x,y:i.y-r.y,w:i.width,h:i.height}});return Math.abs(a[0].x-a[1].x)<1.1&&Math.abs(a[0].y-a[1].y)<1.1&&Math.abs(a[0].w-a[1].w)<1.1&&Math.abs(a[0].h-a[1].h)<1.1})()`);
  const transform=()=>js(`document.querySelector('.comparison-world').style.transform`);
  check('result defaults to parallel registered comparison',await synced());await capture('parallel');
  await click('100%');check('100 percent uses source pixel geometry',await js(`Math.abs(document.querySelector('.comparison-world img').getBoundingClientRect().width-512)<1`));
  const rect=await js(`(()=>{const r=document.querySelector('.comparison-pane').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  w.showInactive();await delay(150);const beforePan=await transform();
  w.webContents.sendInputEvent({type:'mouseMove',...rect});await delay(50);w.webContents.sendInputEvent({type:'mouseDown',...rect,button:'left',clickCount:1});await delay(80);w.webContents.sendInputEvent({type:'mouseMove',x:rect.x+40,y:rect.y+25,button:'left',modifiers:['leftbuttondown']});await delay(80);w.webContents.sendInputEvent({type:'mouseUp',x:rect.x+40,y:rect.y+25,button:'left',clickCount:1});await delay(120);
  check('pointer drag updates both panes together',await synced()&&beforePan!==await transform());const beforeWheel=await transform();
  w.webContents.sendInputEvent({type:'mouseWheel',...rect,deltaX:0,deltaY:100});await delay(150);
  check('wheel zoom affects both panes',await synced()&&beforeWheel!==await transform());
  const center=()=>js(`(()=>{const p=document.querySelector('.comparison-pane'),m=new DOMMatrix(getComputedStyle(p.querySelector('.comparison-world')).transform);return {x:(p.clientWidth/2-m.e)/m.a,y:(p.clientHeight/2-m.f)/m.d}})()`),anchor=await center();
  const sameCenter=async()=>{const c=await center();return Math.abs(c.x-anchor.x)<1&&Math.abs(c.y-anchor.y)<1;};
  const percent=await js(`document.querySelector('[aria-label="对比缩放比例"]').textContent`);await select('swipe');
  check('swipe preserves viewed position',await sameCenter());
  check('swipe preserves zoom and shares one transform',await js(`document.querySelector('[aria-label="对比缩放比例"]').textContent===${JSON.stringify(percent)}&&new Set([...document.querySelectorAll('.comparison-world')].map(e=>e.style.transform)).size===1`));
  await js(`document.querySelector('[role="slider"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))`);check('divider supports keyboard',await js(`document.querySelector('[role="slider"]').getAttribute('aria-valuenow')==='52'`));
  const stage=await js(`(()=>{const r=document.querySelector('.comparison-stage').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`),start={x:Math.round(stage.x+stage.width*.52),y:Math.round(stage.y+stage.height/2)};
  w.webContents.sendInputEvent({type:'mouseMove',...start});await delay(80);
  w.webContents.sendInputEvent({type:'mouseDown',...start,button:'left',clickCount:1});await delay(80);w.webContents.sendInputEvent({type:'mouseMove',x:Math.round(stage.x+stage.width*.7),y:start.y,button:'left',modifiers:['leftbuttondown']});await delay(80);w.webContents.sendInputEvent({type:'mouseUp',x:Math.round(stage.x+stage.width*.7),y:start.y,button:'left',clickCount:1});await delay(120);
  check('divider pointer drag changes reveal without changing zoom',await js(`Math.abs(Number(document.querySelector('[role="slider"]').getAttribute('aria-valuenow'))-70)<=1&&document.querySelector('[aria-label="对比缩放比例"]').textContent===${JSON.stringify(percent)}`));await capture('swipe');
  for(const mode of ['original','result','compare']){await select(mode);check(mode+' preserves viewed position',await sameCenter());check(mode+' preserves scale',await js(`document.querySelector('[aria-label="对比缩放比例"]').textContent===${JSON.stringify(percent)}`));}
  check('return to parallel keeps panes registered',await synced());await click('适应窗口');
  check('fit contains whole images',await js(`(()=>{const p=document.querySelector('.comparison-pane').getBoundingClientRect(),i=document.querySelector('.comparison-world img').getBoundingClientRect();return i.left>=p.left&&i.right<=p.right&&i.top>=p.top&&i.bottom<=p.bottom})()`));
  w.setSize(960,720);await click('切换浅色主题');await delay(150);await click('适应窗口');await capture('narrow-parallel');
  check('narrow layout and synchronized positioning',await synced()&&await js(`(()=>{const r=document.querySelector('.comparison-controls').getBoundingClientRect();return r.right<=innerWidth&&r.bottom<=innerHeight})()`));
  await select('swipe');await capture('narrow-swipe');
  check('no automatic download or renderer errors',starts===0&&report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require(main);
