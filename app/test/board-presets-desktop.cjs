// Isolated real Electron UI; never opens the user's profile or calls a provider.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/board-presets');fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const {bridge}=require('../core/mcp.cjs'),report={checks:[],errors:[]};let done=false;
function finish(code){if(done)return;done=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));app.exit(code);}setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});w.webContents.once('did-finish-load',async()=>{try{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
 const wait=async s=>{for(let i=0;i<150;i++){if(await js(s))return;await delay(50);}throw Error('timeout '+s);};
 const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});
 const click=async(label,selector='button')=>{await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('missing '+${JSON.stringify(label)});b.click()})()`);await delay(80);};
 const input=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(80);};
 const dimensions=()=>js(`['画板宽度','画板高度'].map(s=>+document.querySelector('[aria-label="'+s+'"]').value)`);
 const boards=async()=>(await call('query_objects',{kind:'artboard'})).objects;
 const open=async()=>{await click('尺寸预设','.board-size-trigger');await wait(`!!document.querySelector('.board-size-panel')`);};
 await wait(`!!document.querySelector('.studio-header')`);await run('project.create',{name:'画板预设验收'});await run('artboard.create',{name:'画板 1',width:1000,height:1400});await run('workspace.show',{workspace:'layers'});await wait(`!!document.querySelector('.layer-stage')`);await click('画板','.composition-primary-tools button');await open();
 const initial=await boards();check('opening presets preserves current dimensions',JSON.stringify(await dimensions())===JSON.stringify([initial[0].width,initial[0].height]));
 const selectUnit=async unit=>{
   await js("document.querySelector('[aria-label=尺寸单位]').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}))");
   await wait(`!!document.querySelector('[data-option-value="${unit}"]')`);
   await js(`document.querySelector('[data-option-value="${unit}"]').click()`);await delay(90);
 };
 await selectUnit('cm');await input('画板宽度',14);await input('画板高度',20);
 await selectUnit('px');assert.deepEqual(await dimensions(),[1654,2362]);await selectUnit('mm');assert.deepEqual(await dimensions(),[140,200]);
 await input('画板分辨率',150);check('unit switching preserves physical size and PPI recalculates pixels',await js("document.querySelector('.board-size-panel output').textContent==='827 × 1181 px'"));
 const {boardPresetGroups}=await import('data:text/javascript;base64,'+fs.readFileSync(path.resolve('renderer/board-presets.js')).toString('base64'));
 for(const [group,presets] of Object.entries(boardPresetGroups)){
   await click(group,'.board-preset-categories button');check(group+' category count',await js(`document.querySelectorAll('.board-size-presets button').length===${presets.length}`));
   for(const [name,width,height,,print] of presets){await click(name,'.board-size-presets button');assert.deepEqual(await dimensions(),[print?.width??width,print?.height??height]);}
 }
 check('all 41 presets populate exact width and height',true);
 await input('搜索画板预设','A4');check('name search spans categories',await js(`document.querySelectorAll('.board-size-presets button').length===1&&document.querySelector('.board-size-presets button').textContent.includes('A4')`));
 await input('搜索画板预设','2480 × 3508');check('dimension search accepts spaces and multiplication sign',await js(`document.querySelectorAll('.board-size-presets button').length===1`));
 await click('A4 · 210 × 297 mm','.board-size-presets button');await click('取消','.board-dialog-actions button');check('cancel does not resize board',JSON.stringify(await boards())===JSON.stringify(initial));
 await open();await click('印刷','.board-preset-categories button');await click('A4 · 210 × 297 mm','.board-size-presets button');await click('应用尺寸');check('A4 applies pixel dimensions',(await boards())[0].width===2480&&(await boards())[0].height===3508);
 await click('撤销');check('undo restores previous dimensions',(await boards())[0].width===initial[0].width);await click('重做');
 await click('新建画板');await click('网页','.board-preset-categories button');await click('网页 · 2K','.board-size-presets button');await click('创建画板');check('create uses preset and preserves existing board',(await boards()).length===2&&(await boards())[1].width===2560&&(await boards())[0].width===2480);
 await open();await input('搜索画板预设','not-a-preset');check('empty search retains custom inputs',await js(`!!document.querySelector('.board-presets-empty')&&!!document.querySelector('[aria-label="画板宽度"]')`));await input('画板宽度',1234);await input('画板高度',987);await click('应用尺寸');check('custom dimensions still apply',(await boards())[1].width===1234&&(await boards())[1].height===987);
 await run('project.save');await js('location.reload()');await wait(`!!document.querySelector('.layer-stage')`);check('save and reload preserve sizes',(await boards())[0].width===2480&&(await boards())[0].printSize?.height===297&&(await boards())[1].width===1234);
 await open();await click('印刷','.board-preset-categories button');
 for(const theme of ['dark','light']){
   w.setSize(940,800);await js(`if(document.documentElement.dataset.theme!=='${theme}')document.querySelector('.rail-bottom button:last-child').click()`);await delay(150);
   if(!await js(`!!document.querySelector('.board-size-panel')`)){await open();await click('印刷','.board-preset-categories button');}
   await wait(`document.querySelector('.board-size-panel').getBoundingClientRect().bottom<=innerHeight`);
   w.showInactive();await delay(100);fs.writeFileSync(path.join(out,theme+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();
   report[theme]=await js(`(()=>{const e=document.querySelector('.board-size-panel'),list=e.querySelector('.board-size-presets');return {panel:e.getBoundingClientRect().toJSON(),footer:e.querySelector('footer').getBoundingClientRect().toJSON(),list:[list.scrollHeight,list.clientHeight],width:[e.scrollWidth,e.clientWidth],viewport:[innerWidth,innerHeight]}})()`);
   check(theme+' compact panel fits with scrollable presets and visible footer',await js(`(()=>{const e=document.querySelector('.board-size-panel'),r=e.getBoundingClientRect(),list=e.querySelector('.board-size-presets'),f=e.querySelector('footer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&list.scrollHeight>list.clientHeight&&f.bottom<=r.bottom&&e.scrollWidth<=e.clientWidth})()`));
 }
 w.setSize(940,640);await wait(`document.querySelector('.board-size-panel').getBoundingClientRect().bottom<=innerHeight`);
 check('short window retains visible size fields and apply button',await js(`(()=>{const e=document.querySelector('.board-size-panel'),r=e.getBoundingClientRect(),f=e.querySelector('footer').getBoundingClientRect();return e.scrollHeight<=e.clientHeight+1&&f.bottom<=innerHeight&&f.top>=r.top})()`));
 await js(`document.querySelector('[aria-label="搜索画板预设"]').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await delay(100);
 check('Escape closes panel without applying changes',!await js(`!!document.querySelector('.board-size-panel')`)&&(await boards())[1].width===1234);
 w.setSize(1400,900);w.show();w.focus();
 await click('钢笔','.composition-primary-tools button');
 const pos=await js("(()=>{const s=document.querySelector('.layer-stage').getBoundingClientRect(),r=document.querySelector('[data-board-label] > rect[stroke=\\\"var(--accent)\\\"]').getBoundingClientRect();return {x:Math.round(Math.max(s.left,r.left)+15),y:Math.round(Math.max(s.top,r.top)+15)};})()");
 const mouse=(type,x,y)=>w.webContents.sendInputEvent({type,x,y,...(type==='mouseMove'?{modifiers:['leftButtonDown']}:{button:'left',clickCount:1})});
 const draw=async(x,y,dx=0,dy=0)=>{mouse('mouseDown',x,y);if(dx||dy)mouse('mouseMove',x+dx,y+dy);mouse('mouseUp',x+dx,y+dy);await delay(90);};
 await draw(pos.x,pos.y);await draw(pos.x+65,pos.y+12,12,5);await draw(pos.x+20,pos.y+60);await draw(pos.x,pos.y);
 const paths=async()=>(await call('query_objects',{kind:'layer'})).objects.filter(l=>l.shape==='path');
 const read=async id=>(await call('get_object',{kind:'layer',id})).object;
 const curve=(await paths())[0];assert.ok(curve);const before=await read(curve.id);
 check('pen closes a three-anchor path and keeps its dragged Bezier handles',before.paths[0].closed&&before.paths[0].nodes.length===3&&before.paths[0].nodes[1].out);
 const handle=await js(`(()=>{const r=document.querySelector('[data-handle=\"vector:0:1:anchor\"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
 await draw(handle.x,handle.y,-12,8);
 const moved=await read(curve.id);check('dragging an anchor changes the path',moved.paths[0].nodes[1].x!==before.paths[0].nodes[1].x);
 await click('撤销');check('one undo restores the entire anchor gesture',JSON.stringify((await read(curve.id)).paths)===JSON.stringify(before.paths));
 const root=(await call('get_state')).filesRoot,file='trace-source.png';
 fs.writeFileSync(path.join(root,file),await require('sharp')({create:{width:24,height:24,channels:4,background:'#111111'}}).png().toBuffer());
 const asset=(await run('asset.import',{path:file})).ids[0],image=(await run('layer.create',{artboardId:(await boards())[1].id,kind:'image',properties:{assetId:asset,width:32,height:32}})).id;
 await wait(`!!document.querySelector('[data-tree-id="${image}"]')`);
 await js(`document.querySelector('[data-tree-id="${image}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:150}))`);
 await click('图片矢量化…','li');await wait("!!document.querySelector('[aria-label=黑白描摹预览] path')");
 await click('创建路径图层');check('the preview adds a vector and keeps the source image',(await paths()).length===2&&(await read(image)).kind==='image');
 const svgTarget=path.join(profile,'pen.svg'),dialog=require('electron').dialog,originalSaveDialog=dialog.showSaveDialog;
 dialog.showSaveDialog=async()=>({filePath:svgTarget,canceled:false});
 try{
   await js(`document.querySelector('[data-tree-id="${curve.id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:180,clientY:150}))`);
   await click('导出 SVG','li');
   for(let i=0;i<100&&!fs.existsSync(svgTarget);i++)await delay(30);
   check('context menu writes a real SVG through the desktop export dialog',fs.readFileSync(svgTarget,'utf8').includes('<path '));
 }finally{dialog.showSaveDialog=originalSaveDialog;}
 await run('project.save');await js('location.reload()');await wait("!!document.querySelector('.layer-stage')");
 check('paths and Bezier handles survive save and reload',JSON.stringify((await read(curve.id)).paths)===JSON.stringify(before.paths)&&(await paths()).length===2);
 check('no renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);finish(1);}});});
require(path.resolve('desktop-main.cjs'));
