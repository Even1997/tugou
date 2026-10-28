const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/font-workspace'),evidence=JSON.parse(fs.readFileSync(path.join(out,'acceptance.json')));
process.env.TUGOU_DATA_DIR=evidence.profile;if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;else process.env.TUGOU_BUILD_DIR=path.resolve('test-results/font-workspace-build');process.env.TUGOU_FONT_RUNTIME='F:/婚礼请柬/tugou-components/font-runtime';
const report={checks:[],errors:[]};let done=false;
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'visual.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(code);};setTimeout(()=>finish(1),90000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message)});w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
 const wait=async s=>{for(let i=0;i<120;i++){if(await js(s))return;await delay(100);}throw Error(s);};
 const click=async label=>{await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);await delay(300);};
 const capture=async name=>{w.showInactive();await delay(350);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
 try{
 await wait(`!!document.querySelector('[aria-label="字体"]')`);if(await js(`document.documentElement.dataset.theme==='light'`))await js(`document.querySelector('[aria-label="切换深色主题"]').click()`);await js(`document.querySelector('[aria-label="字体"]').click()`);await wait(`document.querySelectorAll('.font-project-card').length>2`);
 await capture('projects-final');await js(`Array.from(document.querySelectorAll('.font-project-card')).find(b=>b.textContent.includes('春日来信')).click()`);await wait(`!!document.querySelector('.font-character-grid')`);
 for(const [width,height,zoom] of [[1380,900,1],[940,640,1],[1380,900,1.25]]){
   w.setSize(width,height);w.webContents.setZoomFactor(zoom);await delay(400);
   check(`no horizontal overflow ${width}x${height} at ${zoom}`,await js(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.font-workspace').scrollWidth<=document.querySelector('.font-workspace').clientWidth`));
   check('sidebar import remains reachable',await js(`(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='导入本批图集');b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;})()`));
   await capture(`library-${width}-${zoom}`);
 }
 w.setSize(1380,900);w.webContents.setZoomFactor(1);await delay(250);
 report.grid=await js(`(()=>{const g=document.querySelector('.font-character-grid'),b=g.lastElementChild;return {scroll:g.scrollHeight,client:g.clientHeight,rect:g.getBoundingClientRect().toJSON(),last:b.getBoundingClientRect().toJSON(),style:getComputedStyle(g).gridTemplateRows,buttonStyle:getComputedStyle(b).lineHeight}})()`);check('all 256 cells visible at design size',await js(`(()=>{const g=document.querySelector('.font-character-grid');return g.scrollHeight<=g.clientHeight+1&&g.children.length===256;})()`));await capture('library-final');await click('字母');check('letter filter jumps to a matching batch',await js(`Array.from(document.querySelectorAll('.font-character-grid [data-match="true"]')).some(b=>b.textContent==='A')`));await click('全部');
 await click('导入图集');await wait(`!!document.querySelector('.font-atlas-preview img')`);await capture('import-final');
 await click('校正与导出');await wait(`!!document.querySelector('.font-artifact img')`);await capture('preview-final');
 await click('导出字体');check('export states exact completed and missing counts',await js(`document.querySelector('.font-export').textContent.includes('512 字可导出 · 3337 字未生成')`));await capture('export-final');await js(`document.querySelector('.ant-modal-close').click()`);await delay(300);
 await click('← 我的字体');await click('新建字体');check('empty name cannot be submitted',await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='创建字体').disabled`));await capture('create-final');await js(`document.querySelector('.ant-modal-close').click()`);await delay(300);
 await js(`document.querySelector('.workspace-rail [aria-label="切换浅色主题"]').click()`);await capture('projects-light');check('light theme applied',await js(`document.documentElement.dataset.theme==='light'`));
 check('no console errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;await capture('visual-failure');finish(1);}
 });});require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
