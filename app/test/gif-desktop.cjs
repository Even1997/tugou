// Isolated desktop: real GIF codec, renderer, IPC, resources and exports. Only file pickers are automated.
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
app.setAppPath(path.resolve('.'));
const out=path.resolve('test-results/gif');fs.mkdirSync(out,{recursive:true});const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-')));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,theme:'light',autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[]};let ended=false,output=path.join(out,'result.gif'),inputs=[];
const finish=code=>{if(ended)return;ended=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1)},180000);
dialog.showSaveDialog=async()=>({canceled:false,filePath:output});dialog.showOpenDialog=async()=>({canceled:false,filePaths:inputs});dialog.showErrorBox=(title,message)=>{report.failure=title+message;finish(1)};
require('esbuild').buildSync({stdin:{contents:'import {Compositor} from "./renderer/composite.js";window.GifQA=Compositor;',resolveDir:path.resolve('.'),loader:'js'},bundle:true,platform:'browser',format:'iife',outfile:path.join(out,'engine.js')});
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message)});w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name)};
 const wait=async s=>{for(let i=0;i<400;i++){if(await js(s))return;await sleep(40)}throw Error('timeout '+s)};
 const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable '+${JSON.stringify(label)});b.click()})()`);await sleep(120)};
 const number=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="${label}"]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'${value}');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(60);await js(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await sleep(100)};
 const select=async(label,text)=>{await js(`document.querySelector('[aria-label="${label}"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await sleep(100);await js(`(()=>{const e=[...document.querySelectorAll('.ant-select-item-option')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!e)throw Error('missing option');e.click()})()`);await sleep(150)};
 const screenshot=async name=>{w.showInactive();await sleep(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG())};
 let id;
 const load=async workspace=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:${JSON.stringify(workspace)}}))`);const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;await wait(`!!document.querySelector('.studio-header')`);await sleep(200)};
 const saved=async()=>{await js(`(()=>{const e=document.querySelector('.studio-header [aria-label="保存"]');if(!e.disabled)e.click()})()`);await wait(`document.querySelector('.statusbar [role=status]').textContent==='已保存'`);return (await js(`tugou.open(${JSON.stringify(id)})`)).document};
 try{
  await wait(`!!document.querySelector('.studio-header')`);w.setSize(1380,950);
  const red=await sharp({create:{width:80,height:60,channels:4,background:'red'}}).png().toBuffer(),blue=await sharp({create:{width:80,height:60,channels:4,background:'blue'}}).png().toBuffer();
  const redAsset=await js(`tugou.storeRaster(new Uint8Array(${JSON.stringify([...red])}),'红色')`),blueAsset=await js(`tugou.storeRaster(new Uint8Array(${JSON.stringify([...blue])}),'蓝色')`);
  const largeAssets=[];
  for(const [name,width,height] of [['方图',1254,1254],['竖图',800,1600],['横图',1800,600]]){
   const bytes=await sharp({create:{width,height,channels:4,background:'#729ee8'}}).png().toBuffer();
   largeAssets.push(await js(`tugou.storeRaster(new Uint8Array(${JSON.stringify([...bytes])}),${JSON.stringify(name)})`));
  }
  id=await js(`(async()=>{const p=await tugou.create('GIF 验收');await tugou.save(p.id,{...p.document,assets:${JSON.stringify([redAsset,blueAsset,...largeAssets])}},p.revision);return p.id})()`);
  await load('tools');check('default tool is AI extend',await js(`document.querySelector('.tools-settings-heading h2').textContent==='AI 扩图'`));await click('素材处理');
  check('removed tools are absent from category',await js(`!document.querySelector('[data-tool="extract"]')&&!document.querySelector('[data-tool="patch"]')&&!!document.querySelector('[data-tool="crop"]')`));
  for(const label of ['框选提取','选区替换','AI 局部修改']){
   await js(`(()=>{const e=document.querySelector('[aria-label="搜索工具"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(label)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);
   check(label+' is absent from search',await js(`document.querySelector('.tools-options').textContent.includes('没有匹配的工具')`));
  }
  await click('动图');await wait(`!!document.querySelector('.gif-maker')`);check('GIF maker appears in tools',true);
  for(const title of ['添加 红色','添加 蓝色']){await js(`document.querySelector('[title="${title}"]').click()`);await sleep(80)}
  check('two source images become frames',await js(`document.querySelectorAll('.gif-frame-list li').length===2`));
  await click('暂停预览');
  for(const name of ['方图','竖图','横图'])await js(`document.querySelector('[title="添加 ${name}"]').click()`);
  const previewFits=()=>js(`(()=>{const p=document.querySelector('.gif-preview').getBoundingClientRect(),i=document.querySelector('.gif-preview img').getBoundingClientRect(),c=document.querySelector('.gif-playback')?.getBoundingClientRect(),f=document.querySelector('.gif-frame-list').getBoundingClientRect();return i.width>0&&i.height>0&&i.left>=p.left&&i.right<=p.right+1&&i.top>=p.top&&i.bottom<=p.bottom+1&&(!c||c.top>=p.bottom)&&f.top>=(c?.bottom||p.bottom)})()`);
  for(const [width,height] of [[1280,800],[960,720]]){
   w.setSize(width,height);await sleep(200);
   for(const name of ['方图','竖图','横图']){
    await click(`前移第 ${await js(`([...document.querySelectorAll('.gif-frame-name')].findIndex(e=>e.textContent.includes('${name}')))+1`)} 帧`);
    while(!await js(`document.querySelector('.gif-frame-name').textContent.includes('${name}')`)){
     const index=await js(`([...document.querySelectorAll('.gif-frame-name')].findIndex(e=>e.textContent.includes('${name}')))+1`);await click(`前移第 ${index} 帧`);
    }
    await wait(`document.querySelector('.gif-preview img')?.complete`);
    check(`${name} preview stays inside frame with controls below at ${width}x${height}`,await previewFits());
   }
  }
  await screenshot('maker-large-preview');
  for(let i=0;i<24;i++){await js(`document.querySelector('[title="添加 方图"]').click()`);await sleep(10);}
  check('long frame list cannot shrink preview into controls',await previewFits());
  await wait(`document.querySelectorAll('.gif-frame-list li').length===29`);
  await js(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await js(`document.querySelector('.gif-frame-list li:last-child').scrollIntoView({block:'nearest',behavior:'instant'})`);
  await wait(`(()=>{const r=document.querySelector('.gif-frame-list li:last-child').getBoundingClientRect(),p=document.querySelector('.gif-main').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom+1})()`);
  check('last frame remains reachable by scrolling',await js(`(()=>{const r=document.querySelector('.gif-frame-list li:last-child').getBoundingClientRect(),p=document.querySelector('.gif-main').getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom+1})()`));
  while(await js(`document.querySelectorAll('.gif-frame-list li').length>2`)){
   const index=await js(`[...document.querySelectorAll('.gif-frame-name')].findIndex(e=>/方图|竖图|横图/.test(e.textContent))+1`);await click(`移除第 ${index} 帧`);
  }
  w.setSize(1380,950);await click('播放预览');
  await click('前移第 2 帧');check('frame ordering updates',await js(`document.querySelector('.gif-frame-name').textContent.includes('蓝色')`));await click('后移第 1 帧');
  await number('第 2 帧时长（毫秒）',250);await click('生成 GIF');await wait(`document.querySelector('.gif-settings [role=status]')?.textContent.includes('已生成')`);
  const doc=await saved(),gif=doc.assets.find(a=>a.gif);check('maker saves GIF asset with actual delays',gif.gif.frames===2&&gif.gif.delays[0]===100&&gif.gif.delays[1]===250);
  check('generated animation remains contained',await previewFits());
  check('resource endpoint serves animated GIF',await js(`(async()=>{const r=await fetch('tugou-media://resource/${gif.resource}');return r.headers.get('Content-Type')==='image/gif'&&(await r.arrayBuffer()).byteLength===${gif.bytes}})()`));
  await screenshot('maker-light');await click('保存 GIF');check('tool exports original animation',fs.existsSync(output)&&(await sharp(output,{animated:true}).metadata()).pages===2);
  // Drag a real filesystem File into the empty composition using Chromium's native file input data.
  inputs=[output];await load('layers');await wait(`!!document.querySelector('.composite-empty')`);
  w.webContents.debugger.attach('1.3');await js(`{const e=document.createElement('input');e.type='file';e.id='qa-file';e.hidden=true;document.body.append(e)}`);
  const root=await w.webContents.debugger.sendCommand('DOM.getDocument'),node=await w.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#qa-file'});
  await w.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:node.nodeId,files:inputs});
  await js(`{const dt=new DataTransfer();dt.items.add(document.querySelector('#qa-file').files[0]);document.querySelector('.composite-empty').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));document.querySelector('#qa-file').remove()}`);w.webContents.debugger.detach();
  await wait(`!!document.querySelector('.layer-inspector-toggle')`);if(await js(`!document.querySelector('.layer-property-sidebar')`))await js(`document.querySelector('.layer-inspector-toggle').click()`);await wait(`!!document.querySelector('.gif-timeline')`);check('dropping GIF on empty composition creates artboard and animated layer',true);
  await click('暂停动画');let composite=await saved();const board=require('../core/artboards.cjs').boards(composite)[0],local=require('../core/artboards.cjs').extract(composite,board.id);
  check('imported GIF retains dimensions',board.width===80&&board.height===60&&local.layers.some(l=>l.kind==='image'));
  await js(fs.readFileSync(path.join(out,'engine.js'),'utf8'));
  const colors=await js(`(async()=>{const e=new GifQA(),c=document.createElement('canvas'),d=${JSON.stringify(local)},result=[];try{for(const time of [0,100,350]){await e.render(d,c,{time});result.push([...c.getContext('2d').getImageData(40,30,1,1).data]);}return result;}finally{e.dispose()}})()`);
  check('compositor selects red then blue and loops deterministically',colors[0][0]>240&&colors[0][2]<10&&colors[1][2]>240&&colors[2][0]>240);
  // Add a static opaque overlay; it must appear in every exported frame.
  const overlay=require('../core/layers.cjs').createLayer('shape',{parentId:board.id,shape:'rect',color:'#00ff00',width:10,height:10,x:0,y:0});
  await js(`(async()=>{const p=await tugou.open(${JSON.stringify(id)});await tugou.save(p.id,{...p.document,layers:[...p.document.layers,${JSON.stringify(overlay)}]},p.revision)})()`);await load('layers');await wait(`!!document.querySelector('.layer-inspector-toggle')`);await js(`document.querySelector('.layer-inspector-toggle').click()`);await wait(`!!document.querySelector('.gif-timeline')`);await click('暂停动画');
  await click('导出图片');await wait(`!!document.querySelector('.gif-export-preview')`);check('frame selection uses a slider',await js(`document.querySelector('[aria-label="预览 / PNG 导出帧"]').type==='range'`));await number('预览 / PNG 导出帧',1);await js(`document.querySelector('[aria-label="预览 / PNG 导出帧"]').focus()`);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Right'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Right'});await wait(`(()=>{const c=document.querySelector('.gif-export-preview');return c.getContext('2d').getImageData(40,30,1,1).data[2]>240})()`);check('slider updates composited preview pixels',true);output=path.join(out,'frame-2.png');await click('保存 PNG');await wait(`!document.querySelector('.gif-export-preview')`);
  const pixel=await sharp(output).ensureAlpha().raw().toBuffer();check('selected PNG frame is blue with static overlay',pixel[(30*80+40)*4+2]>240&&pixel[1]>240);
  await click('导出图片');await select('导出格式','GIF 动图 · 帧范围');output=path.join(out,'composition.gif');await screenshot('export-light');await click('保存 GIF');await wait(`!document.querySelector('.gif-export-preview')`);
  const meta=await sharp(output,{animated:true}).metadata(),raw=await sharp(output,{animated:true}).ensureAlpha().raw().toBuffer();check('composition GIF retains size and delays',meta.width===80&&meta.pageHeight===60&&meta.pages===2&&meta.delay[1]===250);check('static overlay appears in both GIF frames',raw[1]>240&&raw[80*60*4+1]>240);
  await click('导出图片');await select('导出格式','GIF 动图 · 帧范围');await number('开始帧',2);output=path.join(out,'range.gif');await click('保存 GIF');await wait(`!document.querySelector('.gif-export-preview')`);const range=await sharp(output).ensureAlpha().raw().toBuffer();check('selected GIF range exports only requested blue frame',(await sharp(output).metadata()).pages===1&&range[(30*80+40)*4+2]>240);
  await click('导出图片');await click('取消');check('cancel closes export without changes',!await js(`!!document.querySelector('.gif-export-preview')`));
  await click('切换深色主题');w.setSize(960,760);await screenshot('composition-dark');await click('导出图片');await select('导出格式','GIF 动图 · 帧范围');await screenshot('export-dark-narrow');check('export sliders and footer fit narrow window',await js(`(()=>{const r=document.querySelector('.ant-modal').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&document.querySelector('.ant-modal-body').scrollWidth<=document.querySelector('.ant-modal-body').clientWidth})()`));await click('取消');await load('tools');await click('动图');await screenshot('maker-dark-narrow');check('maker columns fit narrow window',await js(`document.querySelector('.gif-maker').scrollWidth<=document.querySelector('.gif-maker').clientWidth`));check('compact composition has no horizontal overflow',await js('document.documentElement.scrollWidth<=innerWidth'));
  check('no renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);try{await screenshot('failure')}catch{}finish(1)}
 });});require(process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):'../desktop-main.cjs');
