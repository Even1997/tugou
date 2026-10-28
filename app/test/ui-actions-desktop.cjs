const {app,dialog,nativeImage}=require('electron');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
if(!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR))throw new Error('Isolated profile required');
const out=path.resolve(__dirname,'../test-results'),report={checks:[],errors:[]},timer=setTimeout(()=>app.exit(1),90000);
app.on('browser-window-created',(_e,window)=>{
 window.show=()=>{};window.focus=()=>{};
 window.webContents.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);});
 window.webContents.once('did-finish-load',async()=>{
  const js=code=>window.webContents.executeJavaScript(code,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async code=>{for(let i=0;i<150;i++){if(await js(code))return;await delay(40);}throw new Error('Timeout: '+code);};
  const click=async(label,selector='button')=>{await wait(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})`);await js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);await delay(80);};
  const select=(label,value)=>js(`{const e=document.querySelector('select[aria-label=${label}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`);
  const fill=(label,value)=>js(`{const e=document.querySelector('input[aria-label=${label}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`);
  const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
  try {
   await wait('document.querySelector(".studio-header")');
   const fixture=path.join(out,'tools-source.png');await fs.writeFile(fixture,nativeImage.createFromBitmap(Buffer.from([0,0,255,255,255,0,0,128]),{width:2,height:1}).toPNG());
   dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixture]});
   await click('新建工程');await wait('document.querySelector(".prompt-workbench")');
   const id=await js('document.querySelector("select[aria-label=当前工程]").value');
   await click('素材库','nav button');await click('导入图片','.library-toolbar button');await wait('document.querySelectorAll(".asset-card").length===1');
   check('library import preserves image dimensions and transparency',await js('document.querySelector(".asset-caption").textContent.includes("2 × 1")'));
   await click('图像工具','nav button');await click('开始处理');await wait('document.querySelector(".message[role=status]")?.textContent==="已加入素材库"');
   check('resize produces full-size result and persistent history',await js('document.querySelectorAll(".processing-item").length===1&&document.querySelector(".image-comparison").textContent.includes("4 × 2")'));
   await select('处理方式','mirror');await click('开始处理');await wait('document.querySelectorAll(".processing-item").length===2');
   const mirrored=await js(`(async()=>{const i=new Image();i.crossOrigin='anonymous';i.src=document.querySelector('img[alt=处理结果]').src;await i.decode();const c=document.createElement('canvas');c.width=i.naturalWidth;c.height=i.naturalHeight;const x=c.getContext('2d');x.drawImage(i,0,0);return Array.from(x.getImageData(0,0,2,1).data);})()`);
   assert.deepEqual(mirrored,[0,0,255,128,255,0,0,255]);check('mirror preserves alpha and reverses exact source pixels',true);
   await select('处理方式','extend');await fill('扩边像素','-1');await click('开始处理');await wait('document.querySelector(".message[role=status]")?.textContent.includes("0 到 5000")');check('invalid extension does not publish a result',await js('document.querySelectorAll(".processing-item").length===2'));await fill('扩边像素','2');await click('开始处理');await wait('document.querySelectorAll(".processing-item").length===3');
   check('transparent extension keeps requested output size',await js('document.querySelector(".image-comparison").textContent.includes("6 × 5")'));
   const exportPath=path.join(out,'tools-export.png');dialog.showSaveDialog=async()=>({canceled:false,filePath:exportPath});await click('导出结果');await wait('document.querySelector(".message[role=status]")?.textContent==="已导出 PNG"');assert.deepEqual(nativeImage.createFromPath(exportPath).getSize(),{width:6,height:5});check('tool result exports valid original-size PNG',true);
   await select('处理方式','rotate');await click('开始处理');await wait('document.querySelectorAll(".processing-item").length===4');check('quarter turn swaps original width and height',await js('document.querySelector(".image-comparison").textContent.includes("1 × 2")'));
   await click('加入画面','.image-tools-footer button');await wait('document.querySelector(".layer-editor")');check('processed result joins editable layer scene',await js('document.querySelectorAll(".layer-name").length===1'));
   await click('更多操作');await click('重命名工程');await fill('新工程名称','界面交互验收');await click('保存名称');
   await click('保存','.toolbar-end button');await wait('document.querySelector(".statusbar").textContent.includes("已保存")');
   const saved=await js(`window.tugou.open(${JSON.stringify(id)})`);check('rename and tool history persist without replacing originals',saved.document.name==='界面交互验收'&&saved.document.assets.length===5&&saved.document.assets[0].width===2&&saved.document.assets.filter(a=>a.toolResult).length===4);
   await click('无限画布','nav button');await click('文字','#canvas-actions button');await wait('document.querySelectorAll(".react-flow__node").length===1');
   await js("document.querySelector('.canvas-palette .palette-item').click()");await click('复制','#canvas-actions button');check('copy enables paste immediately',await js('!Array.from(document.querySelectorAll("#canvas-actions button")).find(b=>b.textContent.trim()==="粘贴").disabled'));
   await click('粘贴','#canvas-actions button');await wait('document.querySelectorAll(".react-flow__node").length===2');check('paste creates a distinct node',true);
   await click('撤销');await wait('document.querySelectorAll(".react-flow__node").length===1');check('pasted nodes participate in undo',true);
   await click('素材库','nav button');await click('预览 tools-source');await fill('素材名称','像素原图');await click('关闭素材详情');await wait('document.querySelector(".asset-caption").textContent.includes("像素原图")');check('material preview rename updates shared library',true);
   await click('保存','.toolbar-end button');await wait('document.querySelector(".statusbar").textContent.includes("已保存")');
   check('no renderer errors',report.errors.length===0);check('test stays hidden',!window.isVisible());report.projectId=id;await fs.writeFile(path.join(out,'ui-actions-desktop.json'),JSON.stringify(report,null,2));clearTimeout(timer);await js('window.tugou.window("close")');
  }catch(e){report.failure=e.stack;await fs.writeFile(path.join(out,'ui-actions-desktop.json'),JSON.stringify(report,null,2));await fs.writeFile(path.join(out,'ui-actions-failure.png'),(await window.webContents.capturePage(undefined,{stayHidden:true})).toPNG());clearTimeout(timer);app.exit(1);}
 });
});
require('../main.cjs');
