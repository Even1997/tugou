const {app,dialog,clipboard}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {runProcess}=require('../core/local-process.cjs');
const out=path.resolve(process.env.TUGOU_FONT_TEST_OUTPUT||'test-results/font-workspace');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;
if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;else process.env.TUGOU_BUILD_DIR=path.resolve('test-results/font-workspace-build');
process.env.TUGOU_FONT_RUNTIME='F:/婚礼请柬/tugou-components/font-runtime';
const report={checks:[],errors:[],profile},check=(label,value)=>{assert.ok(value,label);report.checks.push(label);fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify(report,null,2));};
let inputFile,cancelImport=false,cancelExport=false,done=false;
dialog.showOpenDialog=async(_window,options)=>{check('native import only accepts image formats',options.filters[0].extensions.every(x=>['png','jpg','jpeg','webp'].includes(x)));return {canceled:cancelImport,filePaths:inputFile?[inputFile]:[]};};
dialog.showSaveDialog=async(_window,options)=>({canceled:cancelExport,filePath:path.join(out,options.defaultPath)});
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failure:report.failure,out}));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},600000);
app.on('browser-window-created',(_,window)=>{
 window.show=()=>{};window.focus=()=>{};window.webContents.setBackgroundThrottling(false);
 window.webContents.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);});
 window.webContents.once('did-finish-load',async()=>{
 const js=code=>{fs.writeFileSync(path.join(out,'last-step.txt'),code);return Promise.race([window.webContents.executeJavaScript(code,true),new Promise((_,reject)=>setTimeout(()=>reject(Error('UI evaluation timeout: '+code)),15000))]);};
 const wait=async code=>{for(let i=0;i<1600;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,250));}throw Error('wait timeout: '+code+'\n'+await js('document.body.innerText'));};
 const click=async text=>{await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`);await new Promise(r=>setTimeout(r,120));};
 const input=(label,value)=>js(`(()=>{const el=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const command=(name,args={})=>js(`window.tugou.fontCommand(${JSON.stringify('font.'+name)},${JSON.stringify(args)})`);
 const capture=async name=>{window.showInactive();await new Promise(r=>setTimeout(r,400));fs.writeFileSync(path.join(out,name+'.png'),(await window.webContents.capturePage()).toPNG());window.hide();};
 try{
  await wait(`!!document.querySelector('.workspace-rail button[aria-label="字体"]')`);await js(`document.querySelector('.workspace-rail button[aria-label="字体"]').click()`);
  await click('新建字体');await input('字体名称','春日来信');await click('创建字体');await wait(`document.querySelector('.font-character-grid')?.children.length===256`);
  let list=(await command('project.list')).projects,p=list.find(p=>p.name==='春日来信');report.projectId=p.id;
  check('create Chinese-named independent font without a canvas project',count(p.characters)===3849&&p.covered==='');
  check('character grid is bounded to 256 DOM cells',await js(`document.querySelector('.font-character-grid').children.length===256`));await capture('library');
  await click('查看本批提示词');await click('复制提示词');check('copied prompt has exact first batch in stable row order',clipboard.readText().includes([...p.characters].slice(0,16).join(' '))&&clipboard.readText().includes('16 列×16 行'));
  await input('搜索字符或编号','春');check('search jumps to containing batch without reordering',await js(`document.querySelector('.font-character-grid [data-match="true"]')?.textContent==='春'`));await input('搜索字符或编号','');
  // Return to first page through the existing shared dropdown.
  await js(`document.querySelector('.font-library .ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('[data-option-value="0"]')`);await js(`document.querySelector('[data-option-value="0"]').click()`);
  cancelImport=true;await click('导入本批图集');await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='导入本批图集'&&!b.disabled)`);
  p=await command('project.get',{projectId:p.id});check('cancel import leaves font empty',p.atlases.length===0);const plan=p.jobs.findLast(j=>j.operation==='plan');
  const planDir=path.join(profile,'workspace/fonts',p.id,'jobs',plan.id);check('common repertoire yields 16 fixed 256-cell batches',JSON.parse(fs.readFileSync(path.join(planDir,'plan.json'))).pages.length===16);
  const python=path.join(process.env.TUGOU_FONT_RUNTIME,'Scripts/python.exe');
  await runProcess(python,[path.resolve('test/font-grid-fixture.py'),path.join(planDir,'plan.json'),'C:/Windows/Fonts/msyh.ttc',out],{timeout:60000});
  inputFile=path.join(out,'grid-0.png');cancelImport=false;await click('导入本批图集');await wait(`!!document.querySelector('.font-atlas-preview img')`);await capture('import');
  await js(`document.querySelector('.font-side .ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('[data-option-value="grid"]')`);await js(`document.querySelector('[data-option-value="grid"]').click()`);
  await click('校正本批');await wait(`!!document.querySelector('.font-progress')`);await capture('processing');await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='应用本批字形'&&!b.disabled)`);
  await wait(`!!document.querySelector('.font-artifact img')`);await capture('correction');await click('应用本批字形');p=await command('project.get',{projectId:p.id});check('first batch applied without claiming full coverage',count(p.covered)===256);
  await click('编译字体预览');await wait(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='生成精修预览'&&!b.disabled)`);await click('生成精修预览');await wait(`!!document.querySelector('.font-progress')`);await wait(`!document.querySelector('.font-progress')`);await wait(`!!document.querySelector('.font-artifact img')`);await capture('refined');
  p=await command('project.get',{projectId:p.id});const refined=p.jobs.findLast(j=>j.operation==='refine');const result=await command('job.get',{projectId:p.id,id:refined.id});check('partial-font refinement only processes covered glyphs',result.task.status==='completed'&&result.result.report.glyphCount===256&&result.result.report.woff2RoundTrip);
  await click('导出字体');cancelExport=true;await click('导出 TTF');check('cancel export writes no file',!fs.existsSync(path.join(out,'春日来信.ttf')));cancelExport=false;await click('导出 TTF');await click('导出 WOFF2');check('native export writes both font formats',fs.statSync(path.join(out,'春日来信.ttf')).size>1000&&fs.statSync(path.join(out,'春日来信.woff2')).size>1000);
  await js(`document.querySelector('.ant-modal-close').click()`);await click('← 我的字体');await click('新建字体');await input('字体名称','第二套字体');await click('创建字体');await wait(`document.querySelector('.font-character-grid')?.children.length===256`);let other=(await command('project.list')).projects.find(v=>v.name==='第二套字体');check('new font has separate library and zero imported coverage',other.id!==p.id&&!other.current&&other.covered==='');
  await click('校正与导出');check('other font cannot see first font previews',!(await js(`!!document.querySelector('.font-artifact img')`)));await assert.rejects(()=>command('job.get',{projectId:other.id,id:refined.id}));check('cross-font job access rejected',true);
  await click('← 我的字体');await capture('projects');await js(`Array.from(document.querySelectorAll('.font-project-card')).find(b=>b.textContent.includes('春日来信')).click()`);await wait(`document.querySelector('.font-title')?.textContent.includes('256')`);
  // Apply another batch through shared service and verify merging + no metadata loss on restart.
  const write=async(name,args)=>{const current=await command('project.get',{projectId:p.id});return command(name,{projectId:p.id,fontRevision:current.fontRevision,requestId:randomUUID(),...args});};
  const waitJob=async r=>{for(let i=0;i<1200;i++){const j=await command('job.get',{projectId:p.id,id:r.jobId});if(!['queued','running'].includes(j.task.status)){assert.equal(j.task.status,'completed',JSON.stringify(j.failure||j.result?.report?.errors||j.task));return j;}await new Promise(r=>setTimeout(r,250));}throw Error('job timeout');};
  inputFile=path.join(out,'grid-1.png');p=await command('project.get',{projectId:p.id});const imported=await js(`window.tugou.fontImport(${JSON.stringify({projectId:p.id,fontRevision:p.fontRevision,requestId:randomUUID(),planId:plan.id,page:1})})`);
  const next=await write('atlas.process',{atlasIds:[imported.atlas.id],background:'light',normalization:{},merge:true});await waitJob(next);await write('revision.apply',{candidateId:next.jobId});p=await command('project.get',{projectId:p.id});check('second batch merges with first rather than replacing it',count(p.covered)===512&&new Set(p.covered).size===512);
  const merged=await waitJob(await write('build',{mode:'draft'}));check('merged font roundtrips 512 mapped glyphs and reports missing repertoire',merged.result.report.glyphCount===512&&merged.result.report.missing.length===3337&&merged.result.report.cmapRoundTrip);
  const {TaskQueue}=require('../core/tasks.cjs'),{FontService}=require('../core/font-service.cjs');const restoredTasks=new TaskQueue(path.join(profile,'workspace'));await restoredTasks.init();const restored=new FontService(path.join(profile,'workspace'),restoredTasks),loaded=await restored.load(p.id);check('font and applied source survive service restart',loaded.current===p.current&&loaded.covered===p.covered&&(await restored.current(loaded)).result.report.glyphs.length===512);
  check('other project remains untouched after merging',!(await command('project.get',{projectId:other.id})).current);
  await js(`window.tugou.window('reload')`);await new Promise(r=>window.webContents.once('did-finish-load',r));await wait(`!!document.querySelector('.workspace-rail button[aria-label="字体"]')`);await js(`document.querySelector('.workspace-rail button[aria-label="字体"]').click()`);await wait(`Array.from(document.querySelectorAll('.font-project-card')).some(b=>b.textContent.includes('512'))`);check('reloaded frontend displays persisted fonts',true);
  for(const width of [940,1380]){window.setSize(width,900);await new Promise(r=>setTimeout(r,300));check('no horizontal page overflow at '+width,await js(`document.documentElement.scrollWidth<=innerWidth`));}
  check('no renderer console errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;await capture('failure').catch(()=>{});finish(1);}
 });
});
function count(s){return [...s].length;}
require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
