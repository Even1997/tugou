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
  check('intelligent tools are first and selected by default',await js(`document.querySelector('.tools-categories button').textContent.trim()==='智能工具'&&document.querySelector('.tools-categories [aria-pressed=true]').textContent.trim()==='智能工具'&&document.querySelector('.tools-settings-heading h2').textContent==='AI 局部修改'`));
  check('tool navigation is above assets, preview and settings',await js(`(()=>{const t=document.querySelector('.tools-navigation').getBoundingClientRect(),a=document.querySelector('.tools-materials').getBoundingClientRect(),p=document.querySelector('.image-tools-body').getBoundingClientRect(),s=document.querySelector('.tools-settings').getBoundingClientRect();return t.bottom<=a.top+1&&t.bottom<=p.top&&t.bottom<=s.top+1&&a.right<=p.left+1&&p.right<=s.left+1})()`));
  check('empty state is centered across preview',await js(`(()=>{const a=document.querySelector('.image-comparison').getBoundingClientRect(),b=document.querySelector('.image-comparison>.empty').getBoundingClientRect();return Math.abs(a.x+a.width/2-b.x-b.width/2)<2})()`));await capture('empty');
  const project=(await state()).projectId,png=fs.readFileSync(path.join(__dirname,'../test-results/local-ai-fixtures/white.png'));
  const asset=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'样张')`);
  const assets=[asset,...Array.from({length:79},(_,i)=>({...asset,id:'material-'+i,name:'素材'+String(i+1).padStart(3,'0')}))];
  await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:${JSON.stringify(assets)}},r.revision))`);await run('project.open',{id:project});await run('ui.navigate',{workspace:'tools'});
  const select=async(label,value)=>{await js(`document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await delay(120);await js(`(()=>{const e=[...document.querySelectorAll('[data-option-value]')].find(e=>e.dataset.optionValue===${JSON.stringify(value)});if(!e)throw Error('no option');e.click()})()`);await delay(100);};
  const chooseAsset=async id=>{await js(`(()=>{const e=document.querySelector('.tools-material-list [data-asset-id="'+${JSON.stringify(id)}+'"]');e.scrollIntoView({block:'nearest'});e.click()})()`);await delay(150);};
  const setSearch=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="'+${JSON.stringify(label)}+'"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(120);};
  await chooseAsset(assets.at(-1).id);check('long material list selects a scrolled thumbnail',await js(`document.querySelector('.tools-material-list').dataset.value===${JSON.stringify(assets.at(-1).id)}&&document.querySelector('.tools-material-list').scrollTop>0`));
  await setSearch('搜索素材','素材079');check('material search filters thumbnails without changing source',await js(`document.querySelectorAll('.tools-material-item').length===1&&document.querySelector('.tools-material-item').dataset.assetId===${JSON.stringify(assets.at(-1).id)}`));await setSearch('搜索素材','没有的素材');check('empty material search preserves selected source',await js(`!document.querySelector('.tools-material-item')&&document.querySelector('.tools-material-list').dataset.value===${JSON.stringify(assets.at(-1).id)}`));await setSearch('搜索素材','');await chooseAsset(asset.id);
  const labels=[],categories={};for(const category of ['智能工具','基础处理','图像合成']){await click(category);for(const label of await js(`[...document.querySelectorAll('.tools-options button')].map(b=>b.textContent.trim())`)){labels.push(label);categories[label]=category;}}
  const chooseTool=async label=>{await click(categories[label]);await click(label);};
  check('all 20 tools present',labels.length===20);
  check('toolbar has no duplicate tool or source selector',await js(`!document.querySelector('[aria-label="处理方式"]')&&!document.querySelector('.image-tools-toolbar [aria-label="处理来源"]')&&!!document.querySelector('.tools-material-list')&&!!document.querySelector('[aria-label="预览方式"]')`));
  await setSearch('搜索工具','超分');check('tool search works across categories',await js(`document.querySelectorAll('.tools-options button').length===1&&document.querySelector('.tools-options button').textContent.trim()==='AI 超分辨率'`));await click('AI 超分辨率');check('choosing search result activates its category and clears search',await js(`document.querySelector('.tools-categories [aria-pressed=true]').textContent.trim()==='智能工具'&&document.querySelector('[aria-label="搜索工具"]').value===''`));
  const beforeKeys=(await state()).revision;
  w.webContents.debugger.attach('1.3');const enter=async()=>{await w.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});await w.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await delay(150);};
  await js(`document.querySelector('.tools-categories button').focus()`);await enter();check('category buttons support keyboard activation',await js(`document.querySelector('.tools-settings-heading h2').textContent==='AI 局部修改'`));
  await setSearch('搜索工具','分辨率');check('search results keep intelligent tools first',await js(`document.querySelector('.tools-options button').dataset.tool==='upscale'`));await js(`document.querySelector('.tools-options [data-tool="resize"]').focus()`);await enter();report.keyboard={before:beforeKeys,after:(await state()).revision,title:await js(`document.querySelector('.tools-settings-heading h2').textContent`)};check('tool search results support keyboard activation without editing the project',report.keyboard.after===beforeKeys&&report.keyboard.title==='分辨率调整');
  w.setSize(960,720);await click('画布');const canvasAsset=(await run('canvas.create',{type:'asset',sourceId:asset.id,position:{x:0,y:0}})).id;await run('ui.navigate',{workspace:'canvas',nodeId:canvasAsset});await click('图片工具');await click('全部图像工具');await wait(`!!document.querySelector('.image-processing-dialog .image-tools')`);
  check('opening a specified tool preserves its source and operation in the dialog',await js(`document.querySelector('.image-processing-dialog .tools-options [aria-pressed=true]').dataset.tool==='resize'&&document.querySelector('.image-processing-dialog .tools-categories [aria-pressed=true]').textContent.trim()==='基础处理'&&document.querySelector('.image-processing-dialog .tools-material-list').dataset.value===${JSON.stringify(asset.id)}`));
  check('dialog layout fits a narrow native window',await js(`(()=>{const t=document.querySelector('.image-processing-dialog .tools-navigation'),b=document.querySelector('.image-processing-dialog .tools-submit').getBoundingClientRect(),p=document.querySelector('.image-processing-dialog .image-tools-body').getBoundingClientRect();return t.scrollWidth<=t.clientWidth+1&&b.left>=0&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1&&p.height>100})()`));await capture('dialog-narrow');await js(`document.querySelector('.image-processing-dialog .ant-modal-close').click()`);await run('ui.navigate',{workspace:'tools'});
  for(const theme of ['dark','light']){
   if(theme==='light')await click('切换浅色主题');
   for(const size of [[1380,900],[960,720]]){
    w.setSize(...size);await delay(150);
    for(const label of labels){
     await chooseTool(label);
     const layout=await js(`(()=>{const p=document.querySelector('.tools-setting-fields'),b=document.querySelector('.tools-submit').getBoundingClientRect(),s=document.querySelector('.tools-settings').getBoundingClientRect(),m=document.querySelector('.tools-materials').getBoundingClientRect(),u=document.querySelector('.tools-materials-heading .ant-btn').getBoundingClientRect(),t=document.querySelector('.tools-navigation'),controls=[...p.querySelectorAll('fieldset >label>.studio-select')];return {overflow:p.scrollWidth>p.clientWidth+1||t.scrollWidth>t.clientWidth+1||u.right>m.right-2,visible:b.bottom<=innerHeight&&b.left>=0&&s.right<=innerWidth,widths:controls.map(e=>e.getBoundingClientRect().width),unlabelled:[...p.querySelectorAll('fieldset>button[aria-expanded]')].some(e=>!e.textContent.trim()),title:document.querySelector('.tools-settings-heading h2').textContent}})()`);
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
  await chooseTool('分辨率调整');
  check('switching tools resets parameter scroll',await js(`document.querySelector('.tools-setting-fields').scrollTop===0`));
  check('mode precedes scale and output size is correct',await js(`(()=>{const p=document.querySelector('.tools-setting-fields');return p.querySelector('label').textContent.includes('方式')&&p.querySelector('.tool-output-size').textContent.includes('1024 × 1536')})()`));
  await click('尺寸说明');check('labelled help opens',await js(`!![...document.querySelectorAll('.tool-popover')].find(e=>e.textContent.includes('插值缩放'))`));
  await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);await delay(100);
  await select('尺寸方式','size');
  check('width height and ratio controls remain accessible',await js(`!!document.querySelector('[aria-label="输出宽度"]')&&!!document.querySelector('[aria-label="输出高度"]')&&!!document.querySelector('[aria-label="锁定原图比例"]')`));
  await capture('custom-size');await click('开始处理');await wait(`!!document.querySelector('img[alt="处理结果"]')`);
  check('real raster processing creates a result', (await state()).counts.assets===assets.length+1);await capture('result');
  await chooseAsset(assets.at(-1).id);check('selecting a new material resets comparison to its original',await js(`!!document.querySelector('img[alt="处理原图"]')&&!document.querySelector('.comparison-stage')`));await js(`document.querySelector('.processing-history summary').click();document.querySelector('.processing-history .processing-item').click()`);await delay(150);check('history restores source, parameters and side-by-side comparison',await js(`!!document.querySelector('.comparison-stage')&&document.querySelector('.tools-material-list').dataset.value===${JSON.stringify(asset.id)}&&document.querySelector('.tools-settings-heading h2').textContent==='分辨率调整'`));
  check('no renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
