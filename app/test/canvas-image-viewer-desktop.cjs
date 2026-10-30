// Isolated renderer and real input events. No user profile, network model or paid request.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {bridge}=require('../core/mcp.cjs');
const out=path.resolve('test-results/canvas-image-viewer');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[]};let finished=false;
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
  w.setIgnoreMouseEvents(true);w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async s=>{for(let i=0;i<200;i++){if(await js(s))return;await delay(50);}throw Error('timeout '+s);};
    const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable '+${JSON.stringify(label)});b.click()})()`);await delay(250);};
    const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args,{reconnectTimeoutMs:0});if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
    const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(120);return r;};
    const key=async(keyCode,modifiers=[])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(200);};
    const capture=async name=>{w.showInactive();await delay(180);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
    const imageRect=()=>js(`(()=>{const r=document.querySelector('.canvas-image-viewer .ant-image-preview-img').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})()`);
    const fitted=()=>js(`(()=>{const r=document.querySelector('.canvas-image-viewer .ant-image-preview-img').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight-60})()`);
    try{
      await wait(`!!document.querySelector('.workspace-rail')`);
      await run('project.create',{name:'图片查看器验收'});const project=(await state()).projectId;
      const svg=(width,height)=>Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="20" y="20" width="${width-40}" height="${height-40}" rx="48" fill="#d9e4d4"/><circle cx="${width/2}" cy="${height/3}" r="${Math.min(width,height)/5}" fill="#e7ac7b"/><path d="M40 ${height*.82}L${width/2} ${height*.4}L${width-40} ${height*.82}Z" fill="#577a68"/><path d="M${width/2} 40V${height-40}M40 ${height/2}H${width-40}" stroke="#293e62" stroke-width="7"/></svg>`);
      const sharp=require('sharp'),assets=[];
      for(const [name,width,height] of [['竖图',1115,1410],['横图',2200,700],['导入图片',280,280]]){
        const bytes=await sharp(svg(width,height)).png().toBuffer();
        assets.push(await js(`window.tugou.storeRaster(${JSON.stringify([...bytes])},${JSON.stringify(name)})`));
      }
      assets[0].prompt='原始生成提示词：保留人物与透明背景。\n第二行完整内容。';assets[0].model='fixture-image';
      assets[1].toolResult={operation:'resize',source:assets[0]};
      await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:${JSON.stringify(assets)}},r.revision))`);await run('project.open',{id:project});
      const ids=[];for(let i=0;i<assets.length;i++)ids.push((await run('canvas.create',{type:'asset',sourceId:assets[i].id,position:{x:30+i*400,y:20}})).id);
      await run('ui.navigate',{workspace:'canvas',nodeId:ids[0]});
      await wait(`document.querySelector('[aria-label="图片生成提示词"]')?.value===${JSON.stringify(assets[0].prompt)}`);
      check('name, immutable prompt and model are in node inspector',await js(`document.querySelector('.canvas-inspector [aria-label="图片名称"]').value==='竖图'&&document.querySelector('.canvas-inspector').textContent.includes('fixture-image')&&document.querySelector('[aria-label="图片生成提示词"]').readOnly`));
      await run('project.save');const before=await state(),beforeView=await js(`document.querySelector('.react-flow__viewport').style.transform`);
      const doubleClick=async id=>{
        const p=await js(`(()=>{const r=document.querySelector('[data-id="${id}"] .node-media-preview').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
        w.showInactive();await delay(120);w.webContents.sendInputEvent({type:'mouseDown',...p,button:'left',clickCount:2});w.webContents.sendInputEvent({type:'mouseUp',...p,button:'left',clickCount:2});
        await wait(`!!document.querySelector('.canvas-image-viewer .ant-image-preview-img')?.naturalWidth`);await delay(250);
      };
      await doubleClick(ids[0]);
      check('double click opens only the original image, no metadata form or dialog card',await js(`document.querySelector('.canvas-image-viewer .ant-image-preview-img').src.startsWith('tugou-media://original/')&&!document.querySelector('.canvas-image-viewer input,.canvas-image-viewer textarea,.ant-modal')`));
      check('image has no border, background, rounded corners or shadow',await js(`(()=>{const s=getComputedStyle(document.querySelector('.canvas-image-viewer .ant-image-preview-img'));return s.borderTopWidth==='0px'&&s.borderRadius==='0px'&&s.boxShadow==='none'&&s.backgroundColor==='rgba(0, 0, 0, 0)'})()`));
      check('portrait initially fits completely',await fitted());await capture('portrait-dark');
      const initial=await imageRect();await click('放大图片');check('zoom button enlarges image',(await imageRect()).width>initial.width);
      await click('100%');check('100 percent shows original pixels',Math.abs((await imageRect()).width-1115)<1&&await js(`document.querySelector('[aria-label="图片缩放比例"]').textContent==='100%'`));
      const transform=()=>js(`document.querySelector('.canvas-image-viewer .ant-image-preview-img').style.transform`);
      const beforeDrag=await transform(),point={x:Math.round(w.getSize()[0]/2),y:Math.round(w.getSize()[1]/2)};
      w.webContents.sendInputEvent({type:'mouseDown',...point,button:'left',clickCount:1});await delay(80);w.webContents.sendInputEvent({type:'mouseMove',x:point.x+80,y:point.y+45,button:'left',modifiers:['leftbuttondown']});await delay(80);w.webContents.sendInputEvent({type:'mouseUp',x:point.x+80,y:point.y+45,button:'left',clickCount:1});await delay(250);
      check('drag pans the enlarged image',beforeDrag!==await transform());
      const beforeWheel=(await imageRect()).width;w.webContents.sendInputEvent({type:'mouseWheel',...point,deltaX:0,deltaY:100});await delay(250);check('wheel zoom changes displayed size',Math.abs((await imageRect()).width-beforeWheel)>1);
      await key('0');check('keyboard fit resets size and pan',await fitted());await key('1');check('keyboard original pixel view works',Math.abs((await imageRect()).width-1115)<1);
      await key('Tab');check('keyboard focus remains in viewer',await js(`!!document.activeElement.closest('.canvas-image-viewer')`));
      await key('Escape');await wait(`!document.querySelector('.canvas-image-viewer')`);
      const after=await state();check('viewing preserves project revision, dirty state and undo history',after.revision===before.revision&&after.dirty===before.dirty&&JSON.stringify(after.history)===JSON.stringify(before.history));check('viewing preserves canvas viewport',beforeView===await js(`document.querySelector('.react-flow__viewport').style.transform`));
      await doubleClick(ids[0]);check('reopen resets to fit',await fitted());await click('关闭图片查看器');await wait(`!document.querySelector('.canvas-image-viewer')`);
      await js(`(()=>{const e=document.querySelector('[aria-label="图片名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'修改后的名称');e.dispatchEvent(new Event('input',{bubbles:true}));e.blur();})()`);await wait(`document.querySelector('[data-id="${ids[0]}"] .node-caption strong').textContent==='修改后的名称'`);
      check('rename updates node caption without changing prompt',await js(`document.querySelector('[aria-label="图片生成提示词"]').value===${JSON.stringify(assets[0].prompt)}`));
      const edited=await state();await doubleClick(ids[0]);await key('Delete');await key('z',['control']);await click('关闭图片查看器');await wait(`!document.querySelector('.canvas-image-viewer')`);const editedAfter=await state();
      check('viewer preserves unsaved edits and blocks canvas delete or undo shortcuts',edited.dirty&&editedAfter.dirty&&edited.revision===editedAfter.revision&&JSON.stringify(edited.history)===JSON.stringify(editedAfter.history));
      await run('history.undo');await wait(`document.querySelector('[aria-label="图片名称"]').value==='竖图'`);await run('history.redo');await wait(`document.querySelector('[aria-label="图片名称"]').value==='修改后的名称'`);check('inspector rename supports undo and redo',true);
      await run('project.save');check('inspector name persists on save',(await js(`window.tugou.open(${JSON.stringify(project)})`)).document.assets[0].name==='修改后的名称');
      await run('ui.navigate',{workspace:'canvas',nodeId:ids[1]});await wait(`document.querySelector('[aria-label="图片生成提示词"]')?.value===${JSON.stringify(assets[0].prompt)}`);check('processed image shows source prompt and provenance',await js(`document.querySelector('.canvas-inspector').textContent.includes('来源素材的记录的提示词')&&document.querySelector('.canvas-inspector').textContent.includes('来源：竖图')`));
      await doubleClick(ids[1]);w.setSize(960,720);await delay(250);check('wide image fits after window resize',await fitted());await capture('wide-narrow-dark');await click('关闭图片查看器');
      await click('切换浅色主题');await doubleClick(ids[1]);check('light theme retains borderless image and visible controls',await js(`document.documentElement.dataset.theme==='light'&&getComputedStyle(document.querySelector('.viewer-controls')).color==='rgb(255, 255, 255)'&&document.querySelector('.viewer-controls').getBoundingClientRect().bottom<=innerHeight`));await capture('wide-narrow-light');await click('关闭图片查看器');
      await run('ui.navigate',{workspace:'canvas',nodeId:ids[2]});await wait(`document.querySelector('[aria-label="图片生成提示词"]')?.placeholder.includes('没有可读取')`);check('import without prompt explicitly shows missing record',await js(`document.querySelector('[aria-label="图片生成提示词"]').value===''`));
      await run('ui.navigate',{workspace:'assets'});await click('预览 修改后的名称');await click('查看完整详情');await wait(`!!document.querySelector('[aria-label="素材提示词"]')`);check('asset library retains its management details',await js(`document.querySelector('[aria-label="素材名称"]').value==='修改后的名称'&&document.querySelector('[aria-label="素材提示词"]').value===${JSON.stringify(assets[0].prompt)}`));
      check('no renderer errors',report.errors.length===0);finish(0);
    }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
  });
});require('../desktop-main.cjs');
