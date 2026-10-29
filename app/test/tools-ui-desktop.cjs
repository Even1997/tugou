// Isolated real renderer checks; local AI availability is simulated. Raster processing is real.
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/tools-ui');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'desktop-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
let starts=0,dialogCalls=0,transport,finished=false;
dialog.showOpenDialog=async()=>{dialogCalls++;return {canceled:true,filePaths:[]};};
const {LocalAIService}=require('../core/local-ai.cjs'),{RuntimeInstaller}=require('../core/runtime-install.cjs');
LocalAIService.prototype.status=async function(){return {configured:false,models:[],cutout:false,cutoutModels:[],downloadFolder:path.join(profile,'components','tugou-components')};};
RuntimeInstaller.prototype.execute=async function(){starts++;throw Error('UI browsing must not install components');};
const report={checks:[],errors:[]};const check=(s,v)=>{assert.ok(v,s);report.checks.push(s);console.log('PASS '+s);};
const finish=code=>{if(finished)return;finished=true;report.installerStarts=starts;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
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
  await state();await call('list_commands',{domain:'tools'});await run('project.create',{name:'工具界面检查'});await run('ui.navigate',{workspace:'tools'});
  check('empty state is centered across preview',await js(`(()=>{const a=document.querySelector('.image-comparison').getBoundingClientRect(),b=document.querySelector('.image-comparison>.empty').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<2})()`));await capture('empty');
  const project=(await state()).projectId,png=fs.readFileSync(path.join(__dirname,'../test-results/local-ai-fixtures/white.png'));
  const asset=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'样张')`);
  await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:[${JSON.stringify(asset)}]},r.revision))`);await run('project.open',{id:project});await run('ui.navigate',{workspace:'tools'});
  const select=async(label,value)=>{await js(`document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await delay(120);await js(`(()=>{const e=[...document.querySelectorAll('[data-option-value]')].find(e=>e.dataset.optionValue===${JSON.stringify(value)});if(!e)throw Error('no option');e.click()})()`);await delay(100);};
  await select('处理来源',asset.id);
  const labels=await js(`[...document.querySelectorAll('.tools-navigation section>button')].map(b=>b.textContent.trim())`);
  check('all 20 tools present',labels.length===20);
  check('toolbar has no duplicate tool selector',await js(`!document.querySelector('[aria-label="处理方式"]')&&!!document.querySelector('[aria-label="处理来源"]')&&!!document.querySelector('[aria-label="预览方式"]')`));
  for(const theme of ['dark','light']){
   if(theme==='light')await click('切换浅色主题');
   for(const size of [[1380,900],[960,720]]){
    w.setSize(...size);await delay(150);
    for(const label of labels){
     await click(label);
     const layout=await js(`(()=>{const p=document.querySelector('.tools-setting-fields'),b=document.querySelector('.tools-submit').getBoundingClientRect(),s=document.querySelector('.tools-settings').getBoundingClientRect(),controls=[...p.querySelectorAll('fieldset >label>.studio-select')];return {overflow:p.scrollWidth>p.clientWidth+1,visible:b.bottom<=innerHeight&&b.left>=0&&s.right<=innerWidth,widths:controls.map(e=>e.getBoundingClientRect().width),unlabelled:[...p.querySelectorAll('fieldset>button[aria-expanded]')].some(e=>!e.textContent.trim()),title:document.querySelector('.tools-settings-heading h2').textContent}})()`);
     if(layout.overflow||!layout.visible||layout.unlabelled)console.log(JSON.stringify(layout));
     check(theme+' '+size[0]+' '+label+' layout',!layout.overflow&&layout.visible&&!layout.unlabelled&&layout.title===label&&layout.widths.every(v=>Math.abs(v-(layout.widths[0]||v))<2));
     if(theme==='light'&&size[0]===960){
      const help=await js(`[...document.querySelectorAll('.tools-setting-fields fieldset>button[aria-expanded]')].map(e=>e.getAttribute('aria-label'))`);
      for(const name of help){await click(name);await delay(100);check(label+' / '+name+' popup fits viewport',await js(`(()=>{const p=[...document.querySelectorAll('.ant-popover:not(.ant-popover-hidden)')].at(-1);if(!p)return false;const r=p.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1&&p.scrollWidth<=p.clientWidth+1})()`));await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);await delay(100);}
     }
     if(size[0]===1380&&['分辨率调整','AI 超分辨率','AI 局部修改','透明边缘'].includes(label))await capture(theme+'-'+labels.indexOf(label));
     if(size[0]===960&&label==='主体抠图')await capture(theme+'-narrow');
    }
   }
  }
  check('browsing all tools does not download',starts===0&&dialogCalls===0);
  await click('分辨率调整');
  check('switching tools resets parameter scroll',await js(`document.querySelector('.tools-setting-fields').scrollTop===0`));
  check('mode precedes scale and output size is correct',await js(`(()=>{const p=document.querySelector('.tools-setting-fields');return p.querySelector('label').textContent.includes('方式')&&p.querySelector('.tool-output-size').textContent.includes('1024 × 1536')})()`));
  await click('尺寸说明');check('labelled help opens',await js(`!![...document.querySelectorAll('.tool-popover')].find(e=>e.textContent.includes('插值缩放'))`));
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);await delay(100);
  await select('尺寸方式','size');
  check('width height and ratio controls remain accessible',await js(`!!document.querySelector('[aria-label="输出宽度"]')&&!!document.querySelector('[aria-label="输出高度"]')&&!!document.querySelector('[aria-label="锁定原图比例"]')`));
  await capture('custom-size');await click('开始处理');await wait(`!!document.querySelector('img[alt="处理结果"]')`);
  check('real raster processing creates a result', (await state()).counts.assets===2);await capture('result');
  check('no renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
