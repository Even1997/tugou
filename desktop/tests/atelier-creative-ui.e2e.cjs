const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const sharp=require('../../web/node_modules/sharp');
const base=process.env.STUDIO_TEST_URL;if(!['http://127.0.0.1:3437','http://127.0.0.1:3439'].includes(base))throw Error('Isolated QA required');
const evidence=path.resolve(__dirname,'../../docs/studio-evidence');
const step=label=>fs.writeFileSync(path.join(evidence,'atelier-creative-ui-progress.json'),JSON.stringify({at:new Date().toISOString(),label}));
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-creative-ui-')));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Request':'1'},body:JSON.stringify({action,payload})});if(!r.ok)throw Error(await r.text());return r.json()};
app.whenReady().then(async()=>{
    const deadline=setTimeout(()=>{step('timeout');app.exit(1)},240000);
    try {
        assert.ok((await request('list')).location.includes('atelier-qa'));
        const original=fs.readFileSync(path.resolve(__dirname,'../../web/public/studio-demo/03-couple.png')),meta=await sharp(original).metadata(),dataUrl='data:image/png;base64,'+original.toString('base64');
        const id='atelier-creative-'+Date.now(),createdAt=new Date().toISOString();
        await request('save',{format:'canvas-studio',version:5,id,name:'打光图案任务验收',width:1024,height:1536,background:'transparent',updatedAt:createdAt,modules:[],recipes:[],layers:[],jobs:[],assets:[{id:'source',name:'C版人物',dataUrl,width:meta.width,height:meta.height,hasAlpha:true,createdAt}]});
        const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}),run=code=>win.webContents.executeJavaScript(code,true);
        const until=async(fn,label)=>{step(label);for(let i=0;i<400;i++){if(await fn())return;await wait(100)}throw Error('Timeout: '+label)};
        const click=text=>run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
        const choose=async(label,option)=>{
            await run(`(()=>{const root=document.querySelector('[aria-label="${label}"]').closest('.ant-select'),trigger=root.querySelector('.ant-select-content')||root;trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));trigger.click()})()`);
            await until(()=>run(`(()=>{const popup=document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');if([...popup?.querySelectorAll('.ant-select-item-option')||[]].some(e=>e.textContent.trim()===${JSON.stringify(option)}))return true;popup?.querySelector('.ant-select-dropdown-list-holder')?.scrollBy(0,100);return false})()`),'choose '+option);
            await run(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].find(e=>e.textContent.trim()===${JSON.stringify(option)}).click()`);
            await run(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));document.activeElement?.blur()`);
        };
        const enter=async(label,value)=>{await run(`document.querySelector('[aria-label="${label}"]').focus()`);win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});await win.webContents.insertText(String(value));win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'})};
        const start=()=>run(`document.querySelector('[aria-label="图片工具"] button.ant-btn-primary').click()`);
        const completed=async tool=>{await until(async()=>{const j=(await request('tool-list',{projectId:id})).find(j=>j.tool===tool);if(j?.status==='failed')throw Error(j.error);return j?.status==='completed'},tool+' complete');return(await request('tool-list',{projectId:id})).find(j=>j.tool===tool)};
        const openTasks=async()=>{await run(`document.querySelector('footer button').click()`);await until(()=>run(`!!document.querySelector('dialog[open] [aria-label="统一任务记录"]')`),'task overview')};
        const view=async label=>{await until(()=>run(`[...document.querySelectorAll('dialog[open] [aria-label="工具任务"]>div')].some(e=>e.textContent.includes(${JSON.stringify(label)})&&[...e.querySelectorAll('button')].some(b=>b.textContent.trim()==='查看结果'))`),'task result '+label);await run(`(()=>{const row=[...document.querySelectorAll('dialog[open] [aria-label="工具任务"]>div')].find(e=>e.textContent.includes(${JSON.stringify(label)}));[...row.querySelectorAll('button')].find(b=>b.textContent.trim()==='查看结果').click()})()`);await until(()=>run(`!!document.querySelector('img[alt="处理后"]')&&!document.querySelector('dialog[open]')`),'result opens')};
        await win.loadURL(base+'/studio');await until(()=>run(`document.body.innerText.includes('打光图案任务验收')`),'load');await click('图片工具');await until(()=>run(`!document.querySelector('[aria-label="图片工具"] button.ant-btn-primary').disabled`),'local runtime');
        await choose('放大倍率','4 倍');await start();await until(()=>run(`[...document.querySelectorAll('[aria-label="工具任务"] button')].some(e=>e.textContent.trim()==='取消')`),'cancel available');await click('取消');await until(async()=>(await request('tool-list',{projectId:id})).some(j=>j.status==='cancelled'),'cancelled');
        await choose('图片处理工具','参数打光');await choose('光照类型','径向光');await start();const light=await completed('relight');
        await run(`[...document.querySelectorAll('nav button')].find(e=>e.textContent.includes('素材库')).click()`);await openTasks();assert.ok(await run(`document.querySelector('[aria-label="统一任务记录"]').textContent.includes('配方生成')`));await view('参数打光');
        await click('存入素材库');await until(async()=>(await request('open',{id})).assets.length===2,'collect light');
        const lightImage=Buffer.from((await request('tool-result',{id:light.id,projectId:id})).dataUrl.split(',')[1],'base64');
        assert.deepEqual(await sharp(lightImage).ensureAlpha().extractChannel('alpha').raw().toBuffer(),await sharp(original).ensureAlpha().extractChannel('alpha').raw().toBuffer());
        await choose('图片处理工具','图案排列');await choose('排列方式','镜像排列');await enter('工具宽度',512);await enter('工具高度',512);await click('更多参数');await enter('单元缩放',.1);await enter('透明间距',8);await click('更多参数');await start();const pattern=await completed('pattern');assert.equal(pattern.width,512);assert.equal(pattern.options.pattern,'mirror');
        await openTasks();await view('图案排列');await click('存入素材库');await until(async()=>(await request('open',{id})).assets.length===3,'collect pattern');
        // Reopen a previous result after viewing another, even though its ID is unchanged.
        await openTasks();await view('参数打光');assert.ok(await run(`document.querySelector('[aria-label="图片处理工具"]').closest('.ant-select').textContent.includes('参数打光')`));
        await openTasks();await view('图案排列');await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(700);fs.writeFileSync(path.join(evidence,'atelier-creative-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
        await win.reload();await until(()=>run(`document.body.innerText.includes('打光图案任务验收')`),'reload');await openTasks();await until(()=>run(`document.querySelector('[aria-label="统一任务记录"]').textContent.includes('已取消')`),'history restored');
        await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);fs.writeFileSync(path.join(evidence,'atelier-tasks-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
        const saved=await request('open',{id});assert.equal(saved.assets[0].dataUrl,dataUrl);assert.equal(saved.assets.length,3);
        await run(`document.querySelector('button[aria-label="关闭弹窗"]').click()`);await click('打光图案任务验收');await until(()=>run(`!!document.querySelector('dialog[open] .project-list')`),'projects');await click('空白工程');await openTasks();await until(()=>run(`document.querySelector('[aria-label="统一任务记录"]').textContent.includes('本地处理 · 0')`),'project isolation');assert.ok(!(await run(`document.querySelector('[aria-label="统一任务记录"]').textContent`)).includes('C版人物'));
        const result={at:new Date().toISOString(),realGpuCancellation:true,lightAlphaPreserved:true,pattern:[512,512],sharedTaskOverview:true,reopenDifferentResults:true,originalPreserved:true,restart:true,projectIsolation:true};fs.writeFileSync(path.join(evidence,'atelier-creative-ui-results.json'),JSON.stringify(result,null,2));clearTimeout(deadline);step('passed');app.exit(0);
    }catch(e){step(String(e.stack||e));console.error(e);app.exit(1)}
});
