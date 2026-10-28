const fs=require('node:fs'),path=require('node:path'),{ipcMain,nativeImage}=require('electron'),L=require('../core/layers.cjs');
module.exports=async({w,js,delay,check,wait,click,set,shot,save,load,report,base})=>{
  await js(fs.readFileSync(path.join(base,'baseline.js'),'utf8'));report.baseline=await js('paintBudgetBench()');
  await js(fs.readFileSync(path.join(base,'optimized.js'),'utf8'));await js(fs.readFileSync(path.join(base,'extra.js'),'utf8'));
  report.optimized=await js('(async()=>{const encoder=makeRasterEncoder();try{return await paintBudgetBench(encoder)}finally{encoder.dispose()}})()');
  check('eight 4MP strokes keep exact baseline output pixels',report.baseline.pixelHash===report.optimized.pixelHash);
  report.alpha=await js('encoderAlphaQA()');check('worker PNG matches baseline across 256 alpha levels',report.alpha.pngMatchesBaseline);check('cached bitmap matches saved PNG across 256 alpha levels',report.alpha.cachedMatchesSaved);
  report.cache=await js('cacheBudgetQA()');check('decoded image cache respects budget, reloads evicted images and releases entries',report.cache.bytes<=524288&&report.cache.count<=2&&report.cache.evictions===4&&report.cache.reloaded&&report.cache.released);
  const bitmap=await js(`(async()=>{const c=document.createElement('canvas');c.width=c.height=2048;const ctx=c.getContext('2d');ctx.fillStyle='#315cf5';ctx.fillRect(0,0,2048,2048);const blob=await new Promise(r=>c.toBlob(r));return tugou.storeRaster(new Uint8Array(await blob.arrayBuffer()),'连续笔画底图')})()`);
  const layers=[L.createLayer('group',{id:'board',artboard:true,name:'画板 1',width:600,height:600,background:'#fff'}),L.createLayer('image',{id:'image',name:'性能图片',parentId:'board',x:80,y:80,width:400,height:400,bitmap})];
  report.id=await js(`(async()=>{const r=await tugou.create('连续绘画与 AI 状态验收');await tugou.save(r.id,{...r.document,width:600,height:600,layers:${JSON.stringify(layers)}},r.revision);return r.id})()`);await load();await click('选择 性能图片');await click('画笔','.composition-primary-tools button');await set('笔刷大小',80);await set('画笔颜色','#ff0000');await set('硬度',100);
  const coords=await js(`Array.from({length:8},(_,i)=>{const p=new DOMPoint(200,120+i*35).matrixTransform(document.querySelector('.layer-overlay>g').getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)}})`);
  for(const point of coords){w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await delay(8);}
  await wait('!document.body.innerText.includes("正在保存笔触")');await delay(200);let doc=await save();
  const colors=await js(`(async()=>{const img=new Image();img.crossOrigin='anonymous';img.src='tugou-media://original/'+${JSON.stringify(doc.layers[1].bitmap.resource)};await img.decode();const c=document.createElement('canvas');c.width=c.height=2048;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return Array.from({length:8},(_,i)=>[...ctx.getImageData(614,Math.round((40+i*35)*2048/400),1,1).data])})()`);
  check('rapid successive pointer strokes all reach image pixels',colors.every(p=>p[0]===255&&p[1]===0&&p[2]===0));await shot('continuous-strokes');
  for(let i=0;i<8;i++)await click('撤销');check('each queued stroke has its own undo step',(await save()).layers[1].bitmap.resource===bitmap.resource);
  for(let i=0;i<8;i++)await click('重做');check('redo restores all queued strokes',(await save()).layers[1].bitmap.resource===doc.layers[1].bitmap.resource);await load();await click('选择 性能图片');check('queued strokes survive reopening',(await save()).layers[1].bitmap.resource===doc.layers[1].bitmap.resource);
  await click('画笔','.composition-primary-tools button');await set('笔刷大小',80);await set('画笔颜色','#ff0000');
  const nextPoint=await js(`(()=>{const p=new DOMPoint(300,200).matrixTransform(document.querySelector('.layer-overlay>g').getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)}})()`);
  for(let i=0;i<2;i++){w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...nextPoint});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...nextPoint});await delay(8);}
  await click('编辑 性能图片 的蒙版');await delay(800);
  const cancelled=await save();check('switching target cancels pending strokes without painting image or mask',cancelled.layers[1].bitmap.resource===doc.layers[1].bitmap.resource&&!cancelled.layers[1].mask.bitmap);
  await click('选择 性能图片');
  await click('选区','.composition-primary-tools button');await wait('document.querySelector(".subject-status")&&!document.querySelector(".subject-status").textContent.includes("正在检查")');
  check('missing AI model is explained before clicking',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='AI 选择主体').disabled&&document.querySelector('.subject-status').textContent.length>0`));await shot('ai-unavailable');
  ipcMain.removeHandler('tugou:subjectStatus');let available={ready:false,reason:'主体识别内存不足，请关闭占用内存的应用后刷新'};ipcMain.handle('tugou:subjectStatus',()=>({ok:true,value:available}));await click('刷新 AI 状态');
  check('memory restriction is visible before inference',await js(`document.querySelector('.subject-status').textContent.includes('内存不足')&&[...document.querySelectorAll('button')].find(b=>b.textContent==='AI 选择主体').disabled`));
  w.setSize(1100,800);await delay(300);
  check('AI status and actions stay inside narrow toolbar',await js(`(()=>{const row=document.querySelector('.layer-parameter-row').getBoundingClientRect(),bar=document.querySelector('.composition-breadcrumb').getBoundingClientRect();return row.bottom<=bar.top+1&&[...document.querySelectorAll('.selection-actions button,.subject-status')].every(e=>{const r=e.getBoundingClientRect();return r.bottom<=row.bottom&&r.right<=row.right})})()`));await shot('ai-narrow');w.setSize(1440,960);await delay(300);
  available={ready:true,reason:'本地主体模型已就绪'};await click('刷新 AI 状态');check('refresh enables ready model',await js(`![...document.querySelectorAll('button')].find(b=>b.textContent==='AI 选择主体').disabled`));
  ipcMain.removeHandler('tugou:selectSubject');let finish;ipcMain.handle('tugou:selectSubject',()=>new Promise(r=>{finish=r;w.webContents.send('tugou:subject-progress','加载主体模型')}));await click('AI 选择主体');await wait('document.querySelector(".subject-status").textContent==="加载主体模型"');
  check('actual stage channel updates AI status',true);finish({ok:true,value:bitmap});await wait('document.body.innerText.includes("已选中主体")');check('completed AI fixture produces a selection',!!(await save()).layers[0].selection);await shot('ai-ready');
};
