// Isolated real Electron UI; never opens the user's profile or calls a provider.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/empty-composition');fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const {bridge}=require('../core/mcp.cjs'),report={checks:[],errors:[]};let done=false;
function finish(code){if(done)return;done=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));app.exit(code);}setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});w.webContents.once('did-finish-load',async()=>{try{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
 const wait=async s=>{for(let i=0;i<150;i++){if(await js(s))return;await delay(50);}throw Error('timeout '+s);};
 const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});
 const click=async(label,selector='button')=>{await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('missing '+${JSON.stringify(label)});b.click()})()`);await delay(80);};
 const input=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(80);};

 await wait(`!!document.querySelector('.studio-header')`);await run('project.create',{name:'空白合成验收'});await run('workspace.show',{workspace:'layers'});await wait(`!!document.querySelector('.composite-empty')`);
 check('layer navigation and editor title use distinct descriptive names',await js(`document.querySelector('.workspace-rail [aria-current=page]').textContent==='图层'&&document.querySelector('.workspace-title').textContent==='图层编辑器'`));
 check('new layer page and empty state use editor terminology',await js(`document.querySelector('.page-tabs').textContent.includes('图层页 1')&&!!document.querySelector('[aria-label="新建图层页"]')&&document.querySelector('.composite-empty').textContent.includes('开始编辑')`));
 const state=()=>call('get_state'),count=async()=>(await state()).counts.artboards;
 check('new project has zero artboards',await count()===0);
 check('empty workspace renders no canvas or board inspector',await js(`!document.querySelector('.layer-stage')&&!document.querySelector('.board-properties')`));
 await click('新建画板');await wait(`!!document.querySelector('.board-size-panel')`);await click('取消','.board-dialog-actions button');check('cancel leaves document clean and empty',await count()===0&&!(await state()).dirty);
 await run('project.save');const projectId=(await state()).projectId;
 await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(projectId)},workspace:'layers'}))`);w.webContents.reload();await wait(`!!document.querySelector('.composite-empty')`);
 check('save and reload keep empty composition',await count()===0);
 for(const theme of ['light','dark']){w.setSize(940,680);await js(`if(document.documentElement.dataset.theme!=='${theme}')document.querySelector('.rail-bottom button:last-child').click()`);await delay(150);w.showInactive();await delay(100);fs.writeFileSync(path.join(out,theme+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();check(theme+' empty workspace fits narrow window',await js(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.composite-empty').getBoundingClientRect().bottom<=innerHeight`));}
 await click('新建画板');await input('画板宽度',800);await input('画板高度',600);await click('创建画板');await wait(`!!document.querySelector('.layer-stage')`);
 check('explicit create makes exactly one board',await count()===1);
 await click('撤销');await wait(`!!document.querySelector('.composite-empty')`);check('undo returns to empty',await count()===0);
 await click('重做');await wait(`!!document.querySelector('.layer-stage')`);check('redo restores board',await count()===1);
 await run('project.save');const record=await js(`tugou.open(${JSON.stringify(projectId)})`);check('created board persists with chosen dimensions',record.document.layers[0].width===800&&record.document.layers[0].height===600);
 await run('page.create',{kind:'layers',name:'空白合成 2'});await wait(`!!document.querySelector('.composite-empty')`);check('new composition page is also empty',await count()===0);
 await click('撤销');await wait(`!!document.querySelector('.layer-stage')`);check('returning to previous page retains existing board',await count()===1);
 check('no renderer errors',report.errors.length===0);finish(0);
 }catch(error){report.failure=error.stack;console.error(error);finish(1);}});});require(process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):'../desktop-main.cjs');
