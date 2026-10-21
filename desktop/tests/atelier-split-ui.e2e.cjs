const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),sharp=require('../../web/node_modules/sharp');
const base=process.env.STUDIO_TEST_URL;if(!['http://127.0.0.1:3437','http://127.0.0.1:3439'].includes(base))throw Error('Isolated QA required');
const evidence=path.resolve(__dirname,'../../docs/studio-evidence'),step=label=>fs.writeFileSync(path.join(evidence,'atelier-split-ui-progress.json'),JSON.stringify({at:new Date().toISOString(),label}));
const wait=ms=>new Promise(r=>setTimeout(r,ms));app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-split-ui-')));app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const request=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Request':'1'},body:JSON.stringify({action,payload})});if(!r.ok)throw Error(await r.text());return r.json()};
app.whenReady().then(async()=>{
 const deadline=setTimeout(()=>{step('timeout');app.exit(1)},240000);
 try{
  step('prepare');
  assert.ok((await request('list')).location.includes('atelier-qa'));
  const couple=await sharp(path.resolve(__dirname,'../../web/public/studio-demo/03-couple.png')).resize({height:400}).png().toBuffer(),flowers=await sharp(path.resolve(__dirname,'../../web/public/studio-demo/04-flowers.png')).resize({width:180}).png().toBuffer();
  const original=await sharp({create:{width:800,height:600,channels:4,background:'#00000000'}}).composite([{input:couple,left:30,top:100},{input:flowers,left:580,top:120}]).png().toBuffer();
  const dataUrl='data:image/png;base64,'+original.toString('base64'),id='atelier-split-'+Date.now(),updatedAt=new Date().toISOString();
  const layer={id:'source-layer',name:'来源图层',kind:'image',assetId:'source',x:40,y:60,width:640,height:480,rotation:17,opacity:.7,visible:true,locked:false,flipX:true,flipY:false,blend:'source-over'};
  await request('save',{format:'canvas-studio',version:5,id,name:'自动拆分与网格验收',width:1024,height:1536,background:'transparent',updatedAt,modules:[],recipes:[],jobs:[],layers:[layer],assets:[{id:'source',name:'人物与花簇',dataUrl,width:800,height:600,hasAlpha:true,createdAt:updatedAt}]});
  const win=new BrowserWindow({width:1500,height:1000,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}}),run=code=>win.webContents.executeJavaScript(code,true);
  const until=async(fn,label)=>{step(label);for(let i=0;i<500;i++){if(await fn())return;await wait(100)}throw Error('Timeout '+label)};
  const click=text=>run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
  const choose=async(label,option)=>{
   await run(`(()=>{const root=document.querySelector('[aria-label="${label}"]').closest('.ant-select'),el=root.querySelector('.ant-select-content')||root;el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));el.click()})()`);
   await until(()=>run(`(()=>{const p=document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');if([...p?.querySelectorAll('.ant-select-item-option')||[]].some(e=>e.textContent.trim()===${JSON.stringify(option)}))return true;p?.querySelector('.ant-select-dropdown-list-holder')?.scrollBy(0,120);return false})()`),'choose '+option);
   await run(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].find(e=>e.textContent.trim()===${JSON.stringify(option)}).click();document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.body.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));document.activeElement?.blur()`);
  };
  const completed=async mode=>{await until(async()=>{const j=(await request('tool-list',{projectId:id})).find(j=>j.tool==='split'&&j.options.splitMode===mode);if(j?.status==='failed')throw Error(j.error);return j?.status==='completed'},'complete '+mode);return(await request('tool-list',{projectId:id})).find(j=>j.tool==='split'&&j.options.splitMode===mode)};
  await win.loadURL(base+'/studio');await until(()=>run(`document.body.innerText.includes('自动拆分与网格验收')`),'load');await click('图片工具');await choose('图片处理工具','素材拆分');await click('开始处理');const job=await completed('alpha');
  assert.ok(job.outputs.length>=2&&job.outputs.length<=64);await until(()=>run(`[...document.querySelectorAll('[aria-label="工具任务"] button')].some(e=>e.textContent.trim()==='查看结果')`),'view');await click('查看结果');await until(()=>run(`!!document.querySelector('[aria-label="拆分结果"]')&&!document.querySelector('[aria-label="拆分结果"]').disabled`),'parts');
  await choose('拆分结果',`2/${job.outputs.length} · ${job.outputs[1].name}`);await until(()=>run(`!document.querySelector('[aria-label="拆分结果"]').disabled`),'second part loaded');await click('存入素材库');await until(async()=>(await request('open',{id,lazy:true})).assets.length===2,'single collect');
  assert.equal((await request('open',{id,lazy:true})).assets[1].toolOutputIndex,1);
  await click('全部对齐入层');await until(async()=>(await request('open',{id,lazy:true})).layers.length===job.outputs.length+1,'all aligned');
  const saved=await request('open',{id,lazy:true});assert.equal(saved.assets.length,job.outputs.length+1);assert.equal(saved.layers[0].visible,false);
  saved.layers.slice(1).forEach(l=>{for(const key of ['x','y','width','height','rotation','opacity','flipX'])assert.equal(l[key],layer[key])});
  const source=await sharp(original).ensureAlpha().raw().toBuffer(),merged=Buffer.alloc(source.length),owners=new Uint8Array(800*600);
  for(const asset of saved.assets.slice(1)){
   const pixels=await sharp(Buffer.from(await(await fetch(base+asset.dataUrl)).arrayBuffer())).ensureAlpha().raw().toBuffer();
   for(let i=0;i<owners.length;i++)if(pixels[i*4+3]){assert.equal(owners[i]++,0);pixels.copy(merged,i*4,i*4,i*4+4)}
  }
  for(let i=0;i<owners.length;i++)if(source[i*4+3])assert.deepEqual(merged.subarray(i*4,i*4+4),source.subarray(i*4,i*4+4));else assert.equal(merged[i*4+3],0);
  await run(`document.querySelector('button[aria-label^="撤销"]').click()`);await until(async()=>(await request('open',{id,lazy:true})).layers.length===1,'undo all');assert.equal((await request('open',{id,lazy:true})).layers[0].visible,true);
  await run(`document.querySelector('button[aria-label^="重做"]').click()`);await until(async()=>(await request('open',{id,lazy:true})).layers.length===job.outputs.length+1,'redo all');
  await choose('拆分方式','网格拆分');await click('开始处理');const grid=await completed('grid');assert.equal(grid.outputs.length,4);
  await win.reload();await until(()=>run(`document.body.innerText.includes('自动拆分与网格验收')`),'reload');await click('图片工具');await until(()=>run(`[...document.querySelectorAll('[aria-label="工具任务"] button')].some(e=>e.textContent.trim()==='查看结果')`),'history');await click('查看结果');await until(()=>run(`!!document.querySelector('[aria-label="拆分结果"]')`),'restored parts');
  assert.ok(await run(`document.querySelector('[aria-label="拆分方式"]').closest('.ant-select').textContent.includes('网格拆分')`));
  await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);fs.writeFileSync(path.join(evidence,'atelier-split-ui.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  fs.writeFileSync(path.join(evidence,'atelier-split-ui-results.json'),JSON.stringify({at:new Date().toISOString(),parts:job.outputs.length,grid:4,visiblePixelsRecomposeExactly:true,alphaPreserved:true,partialThenAllDeduplicated:true,alignedTransform:true,sourceHidden:true,undoRedo:true,restart:true},null,2));clearTimeout(deadline);step('passed');app.exit(0);
 }catch(e){step(String(e.stack||e));app.exit(1)}
});
