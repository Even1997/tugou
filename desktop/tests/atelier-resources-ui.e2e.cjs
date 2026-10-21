const { app, BrowserWindow } = require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const sharp=require('../../web/node_modules/sharp');
const base=process.env.STUDIO_TEST_URL;if(!['http://127.0.0.1:3437','http://127.0.0.1:3439'].includes(base))throw Error('Isolated QA required');
const evidence=path.resolve(__dirname,'../../docs/studio-evidence'),step=label=>fs.writeFileSync(path.join(evidence,'atelier-resources-ui-progress.json'),JSON.stringify({at:new Date().toISOString(),label}));
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-resources-ui-')));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Request':'1'},body:JSON.stringify({action,payload})});if(!r.ok)throw Error(await r.text());return r.json()};
app.whenReady().then(async()=>{
    const deadline=setTimeout(()=>{step('timeout');app.exit(1)},360000);
    try {
        const location=(await request('list')).location;assert.ok(location.includes('atelier-qa'));
        step('prepare 500 resources');
        const original=await sharp(path.resolve(__dirname,'../../web/public/studio-demo/03-couple.png')).resize(512,768).webp({quality:85}).toBuffer();
        const id='atelier-resources-'+Date.now(),createdAt=new Date().toISOString(),assets=[];let first,sourceBytes=0;
        if(process.env.STUDIO_RESOURCE_FIXTURE){
            const fixture=await request('open',{id:process.env.STUDIO_RESOURCE_FIXTURE,lazy:true});assets.push(...fixture.assets);
            for(const asset of assets){const file=path.join(location,'resources',path.basename(asset.dataUrl));sourceBytes+=fs.statSync(file).size;if(!first)first=fs.readFileSync(file)}
        }else for(let i=0;i<500;i++){
            const bytes=await sharp(original).withExif({IFD0:{ImageDescription:`Resource performance fixture ${i}`}}).webp({quality:85}).toBuffer();
            if(!i)first=bytes;sourceBytes+=bytes.length;
            const stored=await request('resource-store',{dataUrl:'data:image/webp;base64,'+bytes.toString('base64')});
            assets.push({id:'asset-'+i,name:'人物素材 '+String(i+1).padStart(3,'0'),dataUrl:stored.dataUrl,width:512,height:768,hasAlpha:true,createdAt});
        }
        const project={format:'canvas-studio',version:5,id,name:'500素材按需加载验收',width:1024,height:1536,background:'transparent',updatedAt:createdAt,modules:[],recipes:[],layers:[],jobs:[],assets};
        await request('save',project);const start=performance.now(),lazy=await request('open',{id,lazy:true}),openMs=performance.now()-start;
        const eagerResponseBytes=Buffer.byteLength(JSON.stringify(await request('open',{id})));
        assert.equal(lazy.assets.length,500);assert.equal(new Set(lazy.assets.map(a=>a.dataUrl)).size,500);assert.ok(!JSON.stringify(lazy).includes('base64,'));
        const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}),run=code=>win.webContents.executeJavaScript(code,true);
        const requests=[];win.webContents.session.webRequest.onCompleted({urls:[base+'/api/studio/resource/*']},details=>requests.push(details.url));
        const until=async(fn,label)=>{step(label);for(let i=0;i<600;i++){if(await fn())return;await wait(100)}throw Error('Timeout: '+label)};
        await win.loadURL(base+'/studio');await until(()=>run(`document.body.innerText.includes('500素材按需加载验收')`),'load');
        await run(`[...document.querySelectorAll('nav button')].find(e=>e.textContent.includes('素材库')).click()`);
        await until(()=>run(`document.querySelectorAll('.asset-preview img').length===500&&document.querySelector('.asset-preview img').naturalWidth>0`),'first thumbnail');
        await wait(1500);
        const initialRequests=[...new Set(requests)];assert.ok(initialRequests.length<150,`All resources eagerly loaded: ${initialRequests.length}`);assert.ok(initialRequests.every(url=>url.endsWith('?thumbnail=1')));
        assert.ok(await run(`[...document.querySelectorAll('.asset-preview img')].filter(i=>i.complete&&i.naturalWidth).every(i=>i.naturalWidth<=384&&i.naturalHeight<=384)`));
        await run(`document.querySelector('.asset-card:last-child').scrollIntoView()`);
        await until(()=>run(`document.querySelector('.asset-card:last-child img').naturalWidth>0`),'scroll last thumbnail');
        const memory=app.getAppMetrics().find(metric=>metric.pid===win.webContents.getOSProcessId())?.memory;assert.ok(memory);
        await run(`document.querySelector('.asset-card:first-child').scrollIntoView();document.querySelector('.asset-card:first-child .asset-buttons button').click()`);
        await until(async()=>(await request('open',{id,lazy:true})).layers.length===1,'add full image layer');
        await until(()=>Promise.resolve(requests.some(url=>url.endsWith(assets[0].dataUrl))),'full resolution loaded for editor');
        const exported=await request('export',{dataUrl:assets[0].dataUrl,name:'resource-byte-check'});assert.deepEqual(fs.readFileSync(exported.path),first);
        const saved=await request('open',{id,lazy:true}),portable=await request('export-project',saved),portableData=JSON.parse(fs.readFileSync(portable.path,'utf8'));
        assert.equal(portableData.assets.length,500);assert.ok(portableData.assets.every(a=>a.dataUrl.startsWith('data:image/webp;base64,')));
        assert.deepEqual(Buffer.from(portableData.assets[0].dataUrl.split(',')[1],'base64'),first);
        const job=await request('tool-submit',{id:'resource-resize-'+Date.now(),projectId:id,sourceId:assets[0].id,name:'URL原图工具',tool:'resize',options:{width:256,height:384},dataUrl:assets[0].dataUrl});
        await until(async()=>{const j=(await request('tool-list',{projectId:id})).find(j=>j.id===job.id);if(j?.status==='failed')throw Error(j.error);return j?.status==='completed'},'tool reads original URL');
        const result=await request('tool-result',{projectId:id,id:job.id}),meta=await sharp(Buffer.from(result.dataUrl.split(',')[1],'base64')).metadata();assert.deepEqual([meta.width,meta.height],[256,384]);
        await win.reload();await until(()=>run(`document.body.innerText.includes('500素材按需加载验收')`),'restart');
        await run(`[...document.querySelectorAll('nav button')].find(e=>e.textContent.includes('素材库')).click()`);await until(()=>run(`document.querySelector('nav button[aria-current="page"]')?.textContent.includes('素材库')&&document.querySelector('.asset-preview img')?.naturalWidth>0`),'cached restart thumbnails');
        await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);fs.writeFileSync(path.join(evidence,'atelier-resources-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
        const navigation=await run(`[...document.querySelectorAll('nav button')].map(e=>({text:e.textContent,selected:e.getAttribute('aria-current'),background:getComputedStyle(e).backgroundColor,inline:e.getAttribute('style')}))`);
        const record={at:new Date().toISOString(),assets:500,uniqueResources:500,sourceBytes,eagerResponseBytes,lazyResponseBytes:Buffer.byteLength(JSON.stringify(lazy)),lazyOpenMs:Math.round(openMs),initialThumbnailRequests:initialRequests.length,rendererMemoryKiB:memory,navigation,originalExportExact:true,portableExport:true,toolReadsFullImage:true,restart:true};
        fs.writeFileSync(path.join(evidence,'atelier-resources-ui-results.json'),JSON.stringify(record,null,2));clearTimeout(deadline);step('passed');app.exit(0);
    }catch(e){step(String(e.stack||e));app.exit(1)}
});
