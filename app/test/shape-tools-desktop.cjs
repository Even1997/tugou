const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(process.env.TUGOU_QA_SCALE)app.commandLine.appendSwitch('force-device-scale-factor',process.env.TUGOU_QA_SCALE);
const A=require('../core/artboards.cjs'),L=require('../core/layers.cjs');
const base=process.env.TUGOU_QA_OUTPUT?path.resolve(process.env.TUGOU_QA_OUTPUT):path.resolve(__dirname,process.env.TUGOU_CONTROLS_TEST?'../test-results/composition-controls':'../test-results/shape-tools');fs.mkdirSync(base,{recursive:true});
const profile=fs.mkdtempSync(path.join(base,'desktop-'));process.env.TUGOU_DATA_DIR=profile;
process.env.TUGOU_BUILD_DIR=path.join(base,'build');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;
const report={profile,checks:[],errors:[]};let finished=false;
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(base,process.env.TUGOU_TEST_APP?'packaged.json':'desktop.json'),JSON.stringify(report,null,2));app.exit(code)};
setTimeout(()=>{report.failure='timeout';finish(1)},process.env.TUGOU_LONG_STRESS?600000:240000);
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)});
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name)};
    const wait=async s=>{for(let i=0;i<200;i++){if(await js(`Boolean(${s})`))return;await delay(40)}throw Error('timeout '+s)};
    const click=async(label,selector='button')=>{await js(`{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw Error('missing '+${JSON.stringify(label)});e.click()}`);await delay(200)};
    const set=async(label,value)=>{
      const openBrush=label==="硬度"&&!await js(`!!document.querySelector('[aria-label="硬度"]')?.getClientRects().length`);if(openBrush)await click("笔刷设置");
      if(await js(`document.querySelector('[aria-label="${label}"]')?.matches('.color-control-trigger')`)){
        await click(label);await js(`{const e=document.querySelector('.color-control-panel .ant-color-picker-hex-input input');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value).replace('#',''))});e.dispatchEvent(new Event('input',{bubbles:true}));}`);await delay(100);await click('应用颜色');
      }else if(await js(`!!document.querySelector('[aria-label="${label}"]')?.closest('.studio-select')`)){
        await js(`document.querySelector('[aria-label="${label}"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await delay(100);
        await js(`{const item=[...document.querySelectorAll('.studio-select-popup [data-option-value]')].find(e=>e.dataset.optionValue===${JSON.stringify(String(value))});if(!item)throw Error('missing option '+${JSON.stringify(String(value))});item.closest('.ant-select-item-option').click()}`);
      }else{
        await js(`{const e=document.querySelector('[aria-label="${label}"]');if(!e)throw Error('missing field ${label}');e.focus();Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))}`);await delay(80);
      }
      await js(`{const e=document.querySelector('[aria-label="${label}"]');e?.blur();e?.dispatchEvent(new FocusEvent('focusout',{bubbles:true}))}`);await delay(150);if(openBrush)await click('笔刷设置');
    };
    const shot=async name=>{await w.capturePage();await delay(250);if(name!=='failure'&&await js('!!document.querySelector("canvas[aria-label=图层画布]")'))await wait('document.querySelector("canvas[aria-label=图层画布]")?.dataset.rendering==="false"');fs.writeFileSync(path.join(base,name+'.png'),(await w.capturePage()).toPNG())};
    const save=async()=>{if(await js('!document.querySelector("button[aria-label=保存]").disabled'))await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return(await js(`tugou.open(${JSON.stringify(report.id)})`)).document};
    const load=async()=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'layers'}))`);const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;await wait('document.querySelector(".layer-stage")');await delay(450)};
    const drag=async(from,to,modifiers=[])=>{w.webContents.sendInputEvent({type:'mouseMove',...from});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...from});for(let i=1;i<=5;i++){w.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x+(to.x-from.x)*i/5),y:Math.round(from.y+(to.y-from.y)*i/5),modifiers:['leftButtonDown',...modifiers]});await delay(35)}w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...to,modifiers});await delay(300)};
    const key=async(keyCode,modifiers=[])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(180)};
    try{
      w.setSize(1440,960);
      let doc;
      if(process.env.TUGOU_MASK_TEST){const helpers={w,js,delay,check,wait,click,set,shot,save,load,key,report,base};if(!process.env.TUGOU_SKIP_MASK_BASE)await require('./mask-selection-checks.cjs')(helpers);if(process.env.TUGOU_PS_TEST)await require('./ps-selection-checks.cjs')(helpers);if(process.env.TUGOU_MASK_CONTROLS_TEST&&!process.env.TUGOU_SKIP_MASK_BASE)await require('./mask-controls-checks.cjs')(helpers);if(process.env.TUGOU_PAINT_BUDGET)await require('./paint-budget-checks.cjs')(helpers);if(process.env.TUGOU_PAINT_STRESS)await require('./paint-stress-checks.cjs')(helpers);if(process.env.TUGOU_MASK_OVERLAY)await require('./mask-overlay-checks.cjs')(helpers);if(process.env.TUGOU_PAINT_CONTINUITY)await require('./paint-continuity-checks.cjs')(helpers);check('no renderer errors',report.errors.length===0);finish(0);return;}
      if(process.env.TUGOU_TEXT_TEST){await require('./text-controls-checks.cjs')({w,js,delay,check,wait,click,set,shot,save,load,key,report});check('no renderer errors',report.errors.length===0);finish(0);return;}
      if(process.env.TUGOU_SELECTION_TEST){await require('./selection-alignment-checks.cjs')({w,js,delay,check,wait,click,set,shot,save,load,key,report,drag});check('no renderer errors',report.errors.length===0);finish(0);return;}
      if(!process.env.TUGOU_SHAPE_ONLY){
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:['01-paper.png','02-scene.png','03-couple.png'].map(n=>path.resolve(__dirname,'../../assets/studio-demo',n))});
      const assets=await js('tugou.importImage()');
      const layers=assets.map((a,i)=>L.createLayer('image',{id:'image-'+i,name:['纸张纹理','花园拱门','新人插画'][i],assetId:a.id,x:i===2?200:0,y:i===2?500:0,width:i===2?600:1024,height:i===2?900:1536}));
      report.id=await js(`(async()=>{const r=await tugou.create('婚礼请柬 · 合成工作区验收');await tugou.save(r.id,{...r.document,assets:${JSON.stringify(assets)},layers:${JSON.stringify(layers)},width:1024,height:1536},r.revision);return r.id})()`);
      await load();
      check('left main navigation retained, editing tools above stage, layer tree on right',await js(`(()=>{const rail=document.querySelector('.workspace-rail').getBoundingClientRect(),tools=document.querySelector('.composition-tools').getBoundingClientRect(),stage=document.querySelector('.layer-stage').getBoundingClientRect(),tree=document.querySelector('.layer-list').getBoundingClientRect();return rail.width===72&&tools.bottom<=stage.top&&tree.left>=stage.right-1&&!document.querySelector('.layer-assets')})()`));
      await click('新建画板');await click('横版主视觉','.board-size-presets button');await click('创建画板');
      doc=await save();check('new artboard persists alongside migrated legacy layers',A.boards(doc).length===2&&A.extract(doc,'artboard-main').layers.length===3);
      const second=A.boards(doc)[1].id;await set('画板名称','横版邀请函');await set('画板 X',-2200);await set('画板 Y',-400);
      await click('文字','.composition-primary-tools button');await set('图层名称','婚礼标题');await set('X',120);await set('Y',200);doc=await save();let title=doc.layers.find(l=>l.name==='婚礼标题');check('text edits use local coordinates on a negative-position artboard',title.x===120&&A.owner(doc,title.id).id===second);
      await set('移动图层到画板','artboard-main');doc=await save();check('cross-board transfer preserves relative position',A.owner(doc,title.id).id==='artboard-main'&&Math.abs(doc.layers.find(l=>l.id===title.id).x-120)<.01);
      await click('撤销');doc=await save();check('undo restores cross-board transfer',A.owner(doc,title.id).id===second);await click('重做');await save();
      await click('画板','.layer-sidebar .panel-heading button');await click('尺寸预设','.board-size-trigger');await set('画板宽度',1200);await set('画板高度',1600);await click('应用尺寸');doc=await save();check('custom dimensions update only active board',A.boards(doc)[0].width===1200&&A.boards(doc)[1].width===1920);
      await click('所有画板');await shot('overview-dark');
      await set('当前画板',second);await click('复制画板');doc=await save();check('board duplication has unique layer ids',A.boards(doc).length===3&&new Set(doc.layers.map(l=>l.id)).size===doc.layers.length);
      await click('删除画板','.board-actions button');await click('删除画板','.ant-modal-footer button');doc=await save();check('delete removes one artboard only',A.boards(doc).length===2);await click('撤销');doc=await save();check('undo restores deleted board',A.boards(doc).length===3);await click('重做');await save();
      await load();check('save and reload preserve multiple named artboards',await js('document.querySelector("[aria-label=当前画板]").closest(".studio-select").dataset.optionCount==="2"&&document.body.innerText.includes("横版邀请函")'));
      await set('当前画板','artboard-main');await click('聚焦画板');await js(`document.querySelector('[data-layer-id="image-2"]').click()`);await delay(150);await shot('edit-dark');
      check('inspector begins at context bar and layer controls remain visible',await js(`(()=>{const panel=document.querySelector('.layer-sidebar').getBoundingClientRect(),context=document.querySelector('.layer-parameter-row').getBoundingClientRect(),footer=document.querySelector('.composition-layer-footer').getBoundingClientRect();return Math.abs(panel.top-context.top)<2&&footer.bottom<=innerHeight&&!!document.querySelector('.layer-appearance [aria-label="混合模式"]')})()`));
      check('top-level legacy menus collected into more and export in header',await js(`document.querySelectorAll('.composition-more .layer-menu').length===9&&document.querySelector('#composition-export [aria-label="导出 PNG"]')!==null`));
      await click('更多编辑工具','summary');await click('添加','.composition-more .layer-menu summary');check('more menu exposes visible existing commands',await js(`(()=>{const e=[...document.querySelectorAll('.layer-menu[open] button')].find(e=>e.textContent==='矩形');return e.getBoundingClientRect().height>0})()`));await click('矩形','.layer-menu[open] button');doc=await save();check('nested more command creates shape',doc.layers.some(l=>l.kind==='shape'&&l.shape==='rect'));await click('撤销');await save();await key('Escape');check('Escape dismisses more menu',await js(`!document.querySelector('.composition-more[open]')`));await js(`document.querySelector('[data-layer-id="image-2"]').click()`);await delay(150);
      await set('X',297);await set('Y',676);await set('宽度',443);await set('高度',715);await save();await shot('matched-image');
      await click('等比缩放');await set('宽度',886);doc=await save();check('linked dimensions preserve aspect ratio',doc.layers.find(l=>l.id==='image-2').height===1430);await click('撤销');await save();
      await click('水平翻转','.flip-actions button');doc=await save();check('inspector flip changes selected image',doc.layers.find(l=>l.id==='image-2').flipX===true);await click('撤销');await save();
      await set('不透明度 %',63);doc=await save();check('layer opacity strip updates document',doc.layers.find(l=>l.id==='image-2').opacity===.63);await click('撤销');await save();
      await click('搜索图层');await set('搜索图层名称','新人');check('layer search retains ancestors and matching layer',await js(`document.querySelectorAll('.layer-row').length===2&&!!document.querySelector('[data-layer-id="image-2"]')`));await click('搜索图层');
      await set('筛选图层类型','text');check('type filter excludes images',await js(`!document.querySelector('[data-layer-id="image-2"]')`));await set('筛选图层类型','all');
      await click('锁定所选图层');check('locking disables properties and opacity',await js(`document.querySelector('[aria-label="宽度"]').matches(':disabled')&&document.querySelector('[aria-label="不透明度 %"]').matches(':disabled')`));await click('解锁所选图层');await save();
      await click('历史记录','.composition-layer-heading button');check('history shows real undo entries',await js(`document.querySelectorAll('.history-entry').length>0`));await click('图层','.composition-layer-heading button');
      await click('调整','.inspector-tabs button');check('adjustment tab exposes actual controls',await js(`document.querySelectorAll('.adjustment-grid button').length>3`));await shot('adjustments');await click('属性','.inspector-tabs button');
      await click('导航','.inspector-tabs button');check('navigator shows actual boards',await js(`document.querySelectorAll('.inspector-navigation > button').length===2`));await click('属性','.inspector-tabs button');
      await js(`document.querySelector('.move-tool-options input[type=checkbox]').click();document.querySelectorAll('.move-tool-options input[type=checkbox]')[1].click()`);check('transform visibility toggle hides handles',await js(`!document.querySelector('[data-handle="resize"]')`));await js(`document.querySelector('.move-tool-options input[type=checkbox]').click();document.querySelectorAll('.move-tool-options input[type=checkbox]')[1].click()`);

      await click('编辑蒙版','.composition-context button');await wait('document.querySelector("[aria-label=绘制目标]")');check('context action switches brush to mask editing',await js('document.querySelector("[aria-label=绘制目标]").closest(".studio-select").dataset.value==="mask"'));
      await set('蒙版浓度',80);await set('蒙版羽化',1.5);doc=await save();check('mask inspector changes persist',doc.layers.find(l=>l.id==='image-2').mask.density===80&&doc.layers.find(l=>l.id==='image-2').mask.feather===1.5);
      await js(`{const e=document.querySelector('[aria-label="蒙版浓度滑块"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'65');e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowLeft',bubbles:true}));}`);await delay(150);doc=await save();check('mask slider commits with keyboard',doc.layers.find(l=>l.id==='image-2').mask.density===65);
      await click('撤销');doc=await save();check('one undo restores one slider change',doc.layers.find(l=>l.id==='image-2').mask.density===80);
      await shot('mask-dark');await click('完成蒙版');
      // Group shortcuts must work without interfering with project undo.
      await js(`document.querySelector('[data-layer-id="image-0"]').click();document.querySelector('[data-layer-id="image-1"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}));document.querySelector('.layer-stage').focus()`);await key('g',['control']);doc=await save();check('Ctrl+G creates a local group',doc.layers.some(l=>l.kind==='group'&&!l.artboard));
      await js(`document.querySelector('.layer-stage').focus()`);await key('g',['control','shift']);doc=await save();check('Ctrl+Shift+G restores ungrouped children',!doc.layers.some(l=>l.kind==='group'&&!l.artboard));
      await click('所有画板');
      const before=await js(`document.querySelector('.layer-overlay > g').getAttribute('transform')`),rect=await js(`(()=>{const r=document.querySelector('.layer-stage').getBoundingClientRect();return{x:Math.round(r.left+70),y:Math.round(r.top+70)}})()`);
      w.webContents.sendInputEvent({type:'keyDown',keyCode:'Space'});await drag(rect,{x:rect.x+70,y:rect.y+40});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Space'});
      check('Space drag pans instead of editing content',before!==await js(`document.querySelector('.layer-overlay > g').getAttribute('transform')`));
      await click('所有画板');const origin=await js(`(()=>{const e=document.querySelector('[data-board-label="artboard-main"] text'),r=e.getBoundingClientRect();return{x:Math.round(r.left+20),y:Math.round(r.top+7)}})()`);doc=await save();const oldX=A.boards(doc)[0].x;
      await drag(origin,{x:origin.x+45,y:origin.y+20});doc=await save();check('dragging board title moves the board with its content',A.boards(doc)[0].x>oldX+20);
      await click('聚焦画板');await shot('before-resize');
      const corner=await js(`(()=>{const r=document.querySelector('.board-resize-handle').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`),oldWidth=A.boards(doc)[0].width;
      await drag(corner,{x:corner.x-35,y:corner.y-25});doc=await save();check('dragging artboard corner changes dimensions without scaling child positions',A.boards(doc)[0].width<oldWidth&&doc.layers.find(l=>l.id==='image-2').x===297);
      await click('撤销');doc=await save();check('undo restores artboard size',A.boards(doc)[0].width===oldWidth);
      await click('尺寸预设','.board-size-trigger');await shot('size-dialog');await click('取消','.board-dialog-actions button');
      const exported=path.join(base,'active-board.png');if(fs.existsSync(exported))fs.unlinkSync(exported);dialog.showSaveDialog=async()=>({canceled:false,filePath:exported});await click('导出 PNG');
      for(let i=0;i<180&&!fs.existsSync(exported);i++)await delay(100);const metadata=await require('sharp')(exported).metadata();check('desktop PNG export writes current artboard dimensions',metadata.width===1200&&metadata.height===1600);
      await click('切换浅色主题');await shot('overview-light');await click('切换深色主题');
      w.setSize(1100,800);await delay(300);await shot('compact');check('workspace fits at 1100 without horizontal document overflow',await js('document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector(".composition-tools").scrollWidth<=document.querySelector(".composition-tools").clientWidth+1'));
      report.resizeMetrics=await js(`(()=>{const c=document.querySelector('canvas[aria-label=图层画布]'),s=document.querySelector('.layer-stage'),g=document.querySelector('.layer-overlay > g');return {bitmap:[c.width,c.height],stage:[s.clientWidth,s.clientHeight],ratio:devicePixelRatio,transform:g.getAttribute('transform')}})()`);
      check('raster backing surface tracks resized viewport',Math.abs(report.resizeMetrics.bitmap[0]-report.resizeMetrics.stage[0]*Math.min(2,report.resizeMetrics.ratio))<=1);
      await click('所有画板');await shot('compact-fit');
      w.setSize(940,640);await w.capturePage();await delay(250);await click('所有画板');await shot('minimum-window');
      check('minimum 940px window keeps toolbar, inspector and canvas accessible',await js('document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector(".composition-tools").scrollWidth<=document.querySelector(".composition-tools").clientWidth+1&&document.querySelector(".layer-stage").clientHeight>250'));
      // Same FigCraft image assets and geometry, in an isolated project, for visual comparison.
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:['paper','arch','person'].map(n=>path.join(base,'reference-assets',n+'.png'))});
      const reference=await js('tugou.importImage()');
      const board=(id,name,x,y,width,height)=>L.createLayer('group',{id,name,x,y,width,height,artboard:true,background:'#f4f0e5',clipContent:true});
      const pic=(id,name,parentId,assetIndex,x,y,width,height,extra={})=>L.createLayer('image',{id,name,parentId,assetId:reference[assetIndex].id,x,y,width,height,...extra});
      const textLayer=(id,name,parentId,text,x,y,width,height,fontSize,bold=false)=>L.createLayer('text',{id,name,parentId,text,x,y,width,height,fontSize,fontStyle:bold?'bold':'normal',fontFamily:'Microsoft YaHei',color:'#536047',lineHeight:1.5});
      const scene=[board('thanks','感谢卡',1475,1600,1080,1080),pic('thanks-paper','纸张纹理','thanks',0,0,0,1080,1080,{locked:true}),pic('thanks-arch','花园拱门','thanks',1,605,486,454,562),textLayer('thanks-title','感谢语','thanks','谢谢你\n来到我们的故事里',97,140,929,220,69,true),
        board('welcome','欢迎屏',1475,335,1920,1080),pic('welcome-paper','纸张纹理','welcome',0,0,0,1920,1080,{locked:true}),pic('welcome-arch','花园拱门','welcome',1,1037,43,845,1026),pic('welcome-person','人物 · 手绘','welcome',2,1267,346,365,691),textLayer('welcome-title','欢迎语','welcome','欢迎来到\n我们的婚礼',134,259,998,280,88,true),textLayer('welcome-names','姓名','welcome','林予安  &  陈知夏',144,724,864,100,50),textLayer('welcome-date','日期','welcome','2026.10.24',144,864,864,80,42),
        board('portrait','请柬主视觉',0,0,1024,1536),pic('paper','纸张纹理','portrait',0,0,0,1024,1536,{locked:true}),pic('arch','花园拱门','portrait',1,72,261,880,1152),pic('person','人物 · 手绘','portrait',2,297,676,443,715,{mask:{x:0,y:0,width:1,height:1}}),textLayer('title','婚礼邀请','portrait','婚 礼 邀 请',0,115,1024,110,62,true),textLayer('caption','祝福语','portrait','与你相聚，见证幸福时刻',0,1440,1024,55,28)];
      scene.find(l=>l.id==='title').align='center';scene.find(l=>l.id==='caption').align='center';
      const referenceDoc={...doc,name:'婚礼请柬 · 原型对照',width:1080,height:1080,assets:reference,layers:scene};
      await js(`(async()=>{const current=await tugou.open(${JSON.stringify(report.id)});await tugou.save(current.id,${JSON.stringify(referenceDoc)},current.revision)})()`);
      w.setSize(1440,960);await load();await set('当前画板','portrait');await click('聚焦画板');await js(`document.querySelector('[data-layer-id="person"]').click()`);await delay(150);await shot('reference-image');check('fit immediately after board switch has positive zoom',await js(`Number(document.querySelector('[aria-label=编辑缩放]').closest('.studio-select').dataset.value)>0`));
      check('reference core transform controls fit without scrolling',await js(`(()=>{const p=document.querySelector('.composition-inspector').getBoundingClientRect(),f=document.querySelector('.flip-actions').getBoundingClientRect();return f.bottom<=p.bottom&&f.top>=p.top})()`));
      await click('编辑蒙版','.composition-context button');await set('蒙版羽化',1.5);await shot('reference-mask');await click('完成蒙版');
      await js(`document.querySelector('[data-layer-id="title"]').click()`);await delay(150);await shot('reference-text');await set('图层文字','婚 礼 邀 请');await set('字号',63);doc=await save();check('compact text inspector still edits typography',doc.layers.find(l=>l.id==='title').fontSize===63);await click('撤销');await save();
      await click('画板','.composition-primary-tools button');await click('所有画板');await shot('reference-boards');
      await set('工具栏画板宽度',1200);doc=await save();check('context bar width updates active board only',A.boards(doc).find(b=>b.id==='portrait').width===1200&&A.boards(doc).find(b=>b.id==='welcome').width===1920);await click('撤销');await save();
      await click('交换宽高');doc=await save();check('context swap uses board dimensions',A.boards(doc).find(b=>b.id==='portrait').width===1536&&A.boards(doc).find(b=>b.id==='portrait').height===1024);await click('撤销');await save();
      await click('切换浅色主题');await shot('reference-light');await click('切换深色主题');
      w.setSize(940,640);await delay(300);await click('所有画板');await shot('reference-compact');
      check('compact inspector keeps layer footer and stage visible',await js(`(()=>{const footer=document.querySelector('.composition-layer-footer').getBoundingClientRect(),stage=document.querySelector('.layer-stage');return footer.bottom<=innerHeight&&stage.clientHeight>=400&&document.documentElement.scrollWidth<=innerWidth})()`));
      w.setSize(1440,960);await delay(200);await set('当前画板','portrait');await click('聚焦画板');await js(`document.querySelector('[data-layer-id="person"]').click()`);await delay(150);
      await js(fs.readFileSync(path.join(base,'engine.js'),'utf8'));report.checks.push(...await js('artboardQA.verify()'));report.performance=await js('artboardQA.performance');
      await js(fs.readFileSync(path.join(base,'paint-engine.js'),'utf8'));report.paint=await js('paintQA.verify()');report.checks.push(...report.paint.checks);
      await js(fs.readFileSync(path.join(base,'paint-detail-engine.js'),'utf8'));report.checks.push(...(await js('detailQA.verify()')).checks);
      }else{report.id=await js("tugou.create('形状工具验收').then(r=>r.id)");}
      await js(fs.readFileSync(path.join(base,'before-composite.js'),'utf8'));
      await js(fs.readFileSync(path.join(base,'shape-engine.js'),'utf8'));report.shapes=await js('shapeQA.verify()');report.checks.push(...report.shapes.checks);
      const shapeBoards=[L.createLayer('group',{id:'draw-main',artboard:true,name:'形状练习',x:0,y:0,width:600,height:600,background:'#ffffff',clipContent:true}),L.createLayer('group',{id:'draw-next',artboard:true,name:'第二画板',x:740,y:0,width:600,height:600,background:'#ffffff',clipContent:true})];
      await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,name:'形状工具 · 验收',width:600,height:600,assets:[],layers:${JSON.stringify(shapeBoards)}},r.revision)})()`);await load();await click('所有画板');
      const screen=async(x,y)=>await js(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.querySelector('.layer-overlay > g').getScreenCTM());return{x:Math.round(p.x),y:Math.round(p.y)}})()`);
      const chooseShape=async label=>{await click('形状','summary');await click(label,'.shape-picker-grid button')};
      await click('形状','summary');await shot('shape-menu');check('top toolbar exposes six named shape choices',await js(`document.querySelectorAll('.shape-picker-grid button').length===6`));await click('矩形','.shape-picker-grid button');
      let from=await screen(40,40),to=await screen(200,140);await drag(from,to);doc=await save();let drawn=doc.layers.filter(l=>l.kind==='shape');check('drag creates rectangle with local coordinates',drawn.length===1&&Math.abs(drawn[0].x-40)<3&&Math.abs(drawn[0].width-160)<3);
      await click('撤销');doc=await save();check('one undo removes entire drawn shape',!doc.layers.some(l=>l.kind==='shape'));await click('重做');doc=await save();check('redo restores shape',doc.layers.filter(l=>l.kind==='shape').length===1);
      await chooseShape('圆形 / 椭圆');await drag(await screen(260,40),await screen(400,110),['shift']);doc=await save();check('Shift drag creates circle',Math.abs(doc.layers.at(-1).width-doc.layers.at(-1).height)<.01);
      await chooseShape('三角形');await set('绘制填充颜色','#f1b783');await drag(await screen(220,360),await screen(40,200));doc=await save();let triangle=doc.layers.at(-1);check('reverse triangle drag preserves local top-left and fill',triangle.shape==='triangle'&&Math.abs(triangle.x-40)<3&&Math.abs(triangle.y-200)<3&&triangle.color==='#f1b783');
      await set('形状描边','#30333a');await set('描边宽度',5);doc=await save();check('drawn shape stroke editable in inspector',doc.layers.find(l=>l.id===triangle.id).strokeWidth===5);
      await chooseShape('菱形');await drag(await screen(280,230),await screen(430,390));
      await chooseShape('星形');await set('绘制填充颜色','#bcc9ff');await drag(await screen(80,430),await screen(220,560),['shift']);
      await chooseShape('圆角矩形');await set('绘制圆角',30);await drag(await screen(300,440),await screen(520,550));doc=await save();check('all six shapes persist with radius',new Set(doc.layers.filter(l=>l.kind==='shape').map(l=>l.shape)).size===6&&doc.layers.at(-1).radius===30);await shot('shapes-dark');
      await chooseShape('三角形');const count=doc.layers.length;from=await screen(460,50);to=await screen(560,160);
      w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...from});w.webContents.sendInputEvent({type:'mouseMove',...to,modifiers:['leftButtonDown']});await wait('document.querySelector(".shape-draft polygon")');check('drawing uses vector preview before committing',await js(`!!document.querySelector('.shape-draft polygon')`));await shot('shape-drag-preview');await key('Escape');w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...to});doc=await save();check('Escape cancels shape without document changes',doc.layers.length===count);
      await chooseShape('矩形');from=await screen(480,80);await drag(from,from);doc=await save();check('click without drag does not create accidental shape',doc.layers.length===count);
      await chooseShape('圆形 / 椭圆');await js(`document.querySelector('[aria-label="启用形状填充"]').click()`);await set('绘制描边宽度',6);await drag(await screen(800,70),await screen(1030,250));doc=await save();const otherShape=doc.layers.find(l=>l.kind==='shape'&&l.parentId==='draw-next');check('drawing directly on neighboring board uses that board local coordinates',A.owner(doc,otherShape.id).id==='draw-next'&&Math.abs(otherShape.x-60)<3&&Math.abs(otherShape.y-70)<3);check('outline-only shape preserves fill and stroke settings',otherShape.fill===false&&otherShape.strokeWidth===6);
      await load();doc=await save();check('save reload restores shape types and styles',doc.layers.filter(l=>l.kind==='shape').length===7&&doc.layers.find(l=>l.id===otherShape.id).fill===false);
      await js(`document.querySelector('[data-layer-id="${otherShape.id}"]').click()`);await delay(150);await set('绘制描边宽度',9);doc=await save();check('selected shape appearance edits directly from context bar',doc.layers.find(l=>l.id===otherShape.id).strokeWidth===9);await click('撤销');await save();
      await click('锁定 第二画板');check('locked board disables shape appearance',await js(`document.querySelector('[aria-label="绘制描边宽度"]').matches(':disabled')`));await chooseShape('矩形');await click('所有画板');
      await drag(await screen(150,150),await screen(250,250));doc=await save();check('locked board rejects shape creation',doc.layers.filter(l=>l.kind==='shape').length===7);await click('解锁 第二画板');await key('Escape');
      await click('所有画板');await click('形状','summary');await shot('shapes-final');await key('Escape');await click('切换浅色主题');await shot('shapes-light');await click('切换深色主题');
      w.setSize(940,640);await delay(200);await click('形状','summary');await shot('shapes-compact');check('shape toolbar fits minimum width',await js(`document.querySelector('.composition-tools').scrollWidth<=document.querySelector('.composition-tools').clientWidth+1&&document.querySelector('.shape-picker-menu').getBoundingClientRect().right<innerWidth`));
      if(process.env.TUGOU_COLOR_TEST)await require('./color-controls-checks.cjs')({w,js,delay,check,wait,click,set,shot,save,load,key,report});
      if(process.env.TUGOU_CONTROLS_TEST)await require('./composition-controls-checks.cjs')({w,js,delay,check,wait,click,set,shot,save,load,key,report});
      check('no renderer errors',report.errors.length===0);finish(0);
    }catch(e){report.failure=e?.stack||String(e);await shot('failure');finish(1)}
  });
});
require(process.env.TUGOU_TEST_APP||'../main.cjs');
