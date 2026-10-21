const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const sharp = require('../../web/node_modules/sharp');
const base = process.env.STUDIO_TEST_URL;
if (!['http://127.0.0.1:3437','http://127.0.0.1:3439'].includes(base)) throw Error('Isolated QA required');
const evidence = path.resolve(__dirname,'../../docs/studio-evidence');
const step = label => fs.writeFileSync(path.join(evidence,'atelier-regions-ui-progress.json'),JSON.stringify({at:new Date().toISOString(),label}));
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-regions-ui-')));
app.disableHardwareAcceleration(); app.on('window-all-closed',()=>{});
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
const request = async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Request':'1'},body:JSON.stringify({action,payload})});if(!r.ok)throw Error(await r.text());return r.json()};
app.whenReady().then(async()=>{
    const deadline=setTimeout(()=>{step('timeout');app.exit(1)},180000);
    try {
        assert.ok((await request('list')).location.includes('atelier-qa'));
        const dataUrl='data:image/png;base64,'+(await sharp(path.resolve(__dirname,'../../web/public/studio-demo/03-couple.png')).resize(128,192).png().toBuffer()).toString('base64');
        const secondary='data:image/png;base64,'+(await sharp({create:{width:32,height:32,channels:4,background:'#7799bb'}}).png().toBuffer()).toString('base64');
        const id='atelier-regions-'+Date.now(), createdAt=new Date().toISOString();
        const sourceLayer={id:'source-layer',kind:'image',name:'来源',assetId:'source',x:100,y:40,width:256,height:384,rotation:12,opacity:.8,visible:true,locked:false,flipX:true,flipY:false,blend:'source-over'};
        await request('save',{format:'canvas-studio',version:5,id,name:'选区工具验收',width:1024,height:1536,background:'transparent',updatedAt:createdAt,modules:[],recipes:[],jobs:[],layers:[sourceLayer],assets:[{id:'source',name:'人物',dataUrl,width:128,height:192,hasAlpha:true,createdAt},{id:'replacement',name:'蓝色材质',dataUrl:secondary,width:32,height:32,hasAlpha:true,createdAt}]});
        const win=new BrowserWindow({width:1440,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
        const run=code=>win.webContents.executeJavaScript(code,true);
        const until=async(fn,label)=>{step(label);for(let i=0;i<300;i++){if(await fn())return;await wait(150)}throw Error('Timeout: '+label)};
        const button=async text=>run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
        const choose=async(label,option)=>{
            await run(`(()=>{const root=document.querySelector('[aria-label="${label}"]').closest('.ant-select'),trigger=root.querySelector('.ant-select-content')||root;trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));trigger.click()})()`);
            await until(async()=>{
                const found=await run(`(()=>{const popup=document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');if([...popup?.querySelectorAll('.ant-select-item-option')||[]].some(e=>e.textContent.trim()===${JSON.stringify(option)}))return true;popup?.querySelector('.ant-select-dropdown-list-holder')?.scrollBy(0,100);return false})()`);
                if(!found) fs.writeFileSync(path.join(evidence,'atelier-regions-options.json'),JSON.stringify(await run(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')].map(e=>({text:e.innerText,scroll:[...e.querySelectorAll('div')].filter(e=>e.scrollHeight>e.clientHeight).map(e=>({cls:e.className,height:e.clientHeight,scroll:e.scrollHeight,overflow:getComputedStyle(e).overflowY}))}))`)));
                return found;
            },'option '+option);
            const point=await run(`(()=>{const r=[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].find(e=>e.textContent.trim()===${JSON.stringify(option)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
            win.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...point,button:'left',clickCount:1});
            win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
            await run(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));document.activeElement?.blur()`);
            await until(()=>run(`![...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')].some(e=>e.getBoundingClientRect().height>0&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).opacity!=='0')`),'close options');
        };
        const enter=async(label,value)=>{
            await run(`document.querySelector('[aria-label="${label}"]').focus()`);
            win.webContents.sendInputEvent({type:'keyDown',keyCode:'A',modifiers:['control']});win.webContents.sendInputEvent({type:'keyUp',keyCode:'A',modifiers:['control']});
            await win.webContents.insertText(String(value));win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
        };
        const process=async tool=>{
            await run(`document.querySelector('[aria-label="图片工具"] button.ant-btn-primary').click()`);
            await until(async()=>{const j=(await request('tool-list',{projectId:id})).find(j=>j.tool===tool);if(j?.status==='failed')throw Error(j.error);return j?.status==='completed'},tool+' result');
            return (await request('tool-list',{projectId:id})).find(j=>j.tool===tool);
        };
        await win.loadURL(base+'/studio');await until(()=>run(`document.body.innerText.includes('选区工具验收')`),'load');await button('图片工具');
        await choose('图片处理工具','框选提取');
        const points=await run(`(()=>{const svg=document.querySelector('[aria-label="图片框选区域"]'), m=svg.getScreenCTM(); return [[20,30],[80,120]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(m);return{x:Math.round(p.x),y:Math.round(p.y)}})})()`);
        win.webContents.sendInputEvent({type:'mouseDown',...points[0],button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseMove',...points[1],button:'left'});win.webContents.sendInputEvent({type:'mouseUp',...points[1],button:'left',clickCount:1});
        await until(()=>run(`Number(document.querySelector('[aria-label="工具宽度"]').value)<128`),'drag selection');
        // Enter exact bounds after exercising pointer selection.
        for(const [label,value] of [['左边',20],['顶部',30],['宽度',60],['高度',90]]) await enter('工具'+label,value);
        const extracted=await process('extract');assert.equal(extracted.width,128);assert.equal(extracted.height,192);assert.deepEqual(extracted.options,{width:60,height:90,left:20,top:30,feather:0});
        await until(()=>run(`[...document.querySelectorAll('[aria-label="工具任务"] button')].some(e=>e.textContent.trim()==='查看结果')`),'preview ready');await button('查看结果');
        await until(()=>run(`!!document.querySelector('img[alt="处理后"]')`),'preview');await button('对齐加入图层');
        await until(async()=>(await request('open',{id})).layers.length===2,'aligned save');
        let project=await request('open',{id});
        for(const key of ['x','y','width','height','rotation','opacity','flipX','flipY','blend'])assert.equal(project.layers[1][key],sourceLayer[key]);
        assert.equal(project.assets[0].dataUrl,dataUrl);assert.equal(project.assets[2].sourceAssetId,'source');
        await run(`document.querySelector('button[aria-label^="撤销"]').click()`);await until(async()=>(await request('open',{id})).layers.length===1,'undo aligned import');
        await run(`document.querySelector('button[aria-label^="重做"]').click()`);await until(async()=>(await request('open',{id})).layers.length===2,'redo aligned import');
        await choose('图片处理工具','选区替换');await choose('替换素材','蓝色材质');const patched=await process('patch');assert.equal(patched.secondarySourceId,'replacement');
        const encoded=(await request('tool-result',{id:patched.id,projectId:id})).dataUrl.split(',')[1];
        const output=await sharp(Buffer.from(encoded,'base64')).raw().toBuffer(),input=await sharp(Buffer.from(dataUrl.split(',')[1],'base64')).raw().toBuffer();
        for(let y=0;y<192;y++)for(let x=0;x<128;x++){if(x>=20&&x<80&&y>=30&&y<120)continue;const i=(y*128+x)*4;assert.deepEqual(output.subarray(i,i+4),input.subarray(i,i+4))}
        await choose('图片处理工具','选区材质');await process('texture');
        await choose('图片处理工具','透明扩边');for(const [label,value] of [['宽度',160],['高度',224],['左边',16],['顶部',16]])await enter('工具'+label,value);
        const extended=await process('extend');assert.equal(extended.width,160);assert.equal(extended.height,224);
        await choose('图片处理工具','框选提取');await enter('工具宽度',60);await enter('工具高度',90);
        await until(()=>run(`![...document.querySelectorAll('[aria-label="工具任务"] button')].some(e=>e.textContent.trim()==='取消')&&!document.querySelector('[aria-label="图片工具"] button.ant-btn-primary').disabled`),'UI settled');
        await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);
        fs.writeFileSync(path.join(evidence,'atelier-regions-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
        await win.reload();await until(()=>run(`document.body.innerText.includes('选区工具验收')`),'reload');project=await request('open',{id});assert.equal(project.layers.length,2);assert.equal(project.assets.length,3);
        const result={at:new Date().toISOString(),dragSelection:true,exactBounds:true,outsidePixelsUnchanged:true,alignedTransform:true,undoRedo:true,secondarySnapshot:true,texture:true,transparentExtend:[160,224],restart:true};
        fs.writeFileSync(path.join(evidence,'atelier-regions-ui-results.json'),JSON.stringify(result,null,2));clearTimeout(deadline);step('passed');app.exit(0);
    }catch(e){step(String(e.stack||e));console.error(e);app.exit(1)}
});
