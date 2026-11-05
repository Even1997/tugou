// Isolated desktop acceptance; fixtures only, no provider requests or user data.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {bridge}=require('../core/mcp.cjs');
const out=path.resolve('test-results/ui-regularity');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false,theme:'light'}));
const phase=process.argv.includes('--after')?'after':'before';fs.mkdirSync(path.join(out,phase),{recursive:true});
const report={checks:[],errors:[],screens:[]};let done=false;
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,phase,'report.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1)},90000);
app.on('browser-window-created',(_,w)=>{
 const focusWindow=w.focus.bind(w);w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message)});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<250;i++){if(await js(s))return;await delay(30)}throw Error('Timeout '+s);};
  const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
  const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args,{reconnectTimeoutMs:0,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});await delay(150);return r;};
  const click=async(selector,text)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text?`e.textContent.trim()===${JSON.stringify(text)}`:'true'});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.click()})()`);await delay(150);};
  const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,phase,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
  try{
   w.setSize(1440,960);await wait(`!!document.querySelector('.workspace-rail')`);
   const files=['01-paper.png','02-scene.png','03-couple.png','04-flowers.png'].map(f=>path.resolve('../assets/studio-demo',f));
   require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});
   const assets=await js('tugou.importImage()');
   const names=['婚礼邀请函 · 纸张纹理','花园场景 · 暖色自然光','新人合照 · 主体参考','花卉装饰 · 长名称排版与时间显示检查'];
   assets.forEach((a,i)=>{a.name=names[i];if(i===3)a.generation={prompt:'花卉素材',taskId:'fixture'};});
   const modules=[{id:'m-style',name:'画风 · 低饱和法式花园',kind:'style',text:'自然光影、细腻纸张纹理，温暖而克制的配色。保留画面主体和充足留白。',global:true},{id:'m-person',name:'人物 · 新人主体参考与服装',kind:'character',text:'保持人物五官、表情和服装一致。',global:false},{id:'m-layout',name:'版式 · 邀请函标题和正文',kind:'composition',text:'标题、日期与地点对齐，保持清晰的阅读层级。',global:false}];
   const recipe={id:'recipe',name:'花园婚礼邀请函 · 竖版',moduleIds:['m-style','m-person'],moduleBindings:[],references:[{assetId:assets[2].id,role:'人物身份'}],output:'法式花园婚礼邀请函，人物自然、光线柔和，为标题保留空间。',size:'1024x1536'};
   const nodes=assets.slice(0,2).map((a,i)=>({id:'image-'+i,type:'asset',position:{x:i*350,y:0},data:{assetId:a.id,role:'参考图片'}}));
   const desk=require('../core/workflow-nodes.cjs').workflowNode('config',{x:720,y:0});desk.id='desk';desk.data.prompt='生成一张清晰、规整的婚礼邀请函';nodes.push(desk);
   const layers=[require('../core/layers.cjs').createLayer('image',{id:'layer-image',name:'背景纸张',assetId:assets[0].id,width:700,height:1000,x:0,y:0}),require('../core/layers.cjs').createLayer('text',{id:'layer-title',name:'邀请函标题',text:'婚礼邀请函',x:100,y:180,width:500,height:100,fontSize:64,color:'#5a5144'})];
   const doc={assets,modules,recipes:[recipe],layers,tugouCanvas:{version:1,nodes,edges:[],viewport:{x:30,y:60,zoom:.75}}};
   const id=await js(`(async()=>{const r=await tugou.create('界面规整检查');await tugou.save(r.id,{...r.document,...${JSON.stringify(doc)}},r.revision);return r.id})()`);
   await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:'canvas'}))`);const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;await wait(`!!document.querySelector('.canvas-palette')`);
   for(const [theme,width,height] of (process.argv.includes('--interactions-only')?[]:[['light',1440,960],['light',1040,760],['dark',1440,960],...(phase==='after'?[['light',940,680]]:[])])){
    w.setSize(width,height);await js(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[aria-label="切换${theme==='dark'?'深':'浅'}色主题"]').click()`);await delay(150);
    for(const [index,workspace] of ['prompts','canvas','layers','tools','assets','fonts','settings'].entries()){
     await js('document.activeElement?.blur()');await click('.workspace-rail [aria-label="'+({prompts:'提示词',canvas:'画布',layers:'合成',tools:'工具',assets:'素材',fonts:'字体',settings:'设置'})[workspace]+'"]');await delay(350);
     if(workspace==='canvas')await run('ui.navigate',{workspace,nodeId:'desk'});
     const name=`${index+1}-${workspace}-${theme}-${width}`;await capture(name);
     const metrics=await js(`(()=>{const selectors=['.module-list','.canvas-palette','.tools-materials','.settings-nav','.library-details','.recipe-sidebar','.canvas-inspector','.tools-settings'];return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,panels:Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s);return [s,e?{width:e.offsetWidth,overflow:e.scrollWidth>e.clientWidth+1}:null]}))}})()`);
     if(phase==='after'){
      check(name+' has no horizontal panel overflow',!metrics.overflow&&Object.values(metrics.panels).filter(Boolean).every(p=>!p.overflow));
      const side=metrics.panels[({prompts:'.module-list',canvas:'.canvas-palette',tools:'.tools-materials',settings:'.settings-nav'})[workspace]];
      if(side)check(name+' uses shared sidebar width',side.width===(width>1150?248:width>1000?230:216));
      if(workspace==='canvas')check(name+' focused node stays inside canvas after inspector opens',await js(`(()=>{const n=document.querySelector('[data-id="desk"]').getBoundingClientRect(),r=document.querySelector('.flow-surface').getBoundingClientRect();return n.left>=r.left-1&&n.right<=r.right+1&&n.top>=r.top-1&&n.bottom<=r.bottom+1})()`));
      if(workspace==='canvas'){await click('.palette-tabs button','素材');check(name+' palette dates fit on one line',await js(`Array.from(document.querySelectorAll('.palette-item time')).every(e=>e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight)+1)`));await click('.palette-tabs button','画布');}
      if(workspace==='tools')check(name+' keeps timestamps on one line',await js(`Array.from(document.querySelectorAll('.tools-material-item time')).every(e=>e.getBoundingClientRect().height<=parseFloat(getComputedStyle(e).lineHeight)+1)`));
      if(workspace==='prompts')check(name+' shows distinct readable module names',await js(`Array.from(document.querySelectorAll('.module-tile>span')).map(e=>e.textContent).join('|')===${JSON.stringify(modules.map(m=>m.name).join('|'))}`));
     }
     report.screens.push({name,workspace,theme,...metrics});console.log('CAPTURE '+name);
    }
   }
   if(phase==='after'){
    w.setSize(1040,760);
    await click('.workspace-rail [aria-label="提示词"]');
    const checked=`document.querySelector('.module-tile input[aria-label="版式 · 邀请函标题和正文"]').checked`;
    check('recipe module starts unchecked',!await js(checked));
    await click('.module-tile input[aria-label="版式 · 邀请函标题和正文"]');check('module control still toggles recipe inclusion',await js(checked));
    await click('[aria-label="撤销"]');check('module selection can be undone',!await js(checked));
    await click('.module-tile input[aria-label="版式 · 邀请函标题和正文"]');await click('.module-tile input[aria-label="版式 · 邀请函标题和正文"]');
    w.showInactive();focusWindow();w.webContents.focus();await delay(120);
    await js(`document.querySelector('.module-tile input[aria-label="人物 · 新人主体参考与服装"]').focus()`);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await delay(80);
    report.focus=await js(`({active:document.activeElement.outerHTML,visible:document.activeElement.matches(':focus-visible'),focus:document.hasFocus(),outline:getComputedStyle(document.activeElement).outline})`);
    check('keyboard focus remains visible',await js(`getComputedStyle(document.activeElement).outlineStyle!=='none'`));await js('document.activeElement.blur()');w.hide();
    await click('.workspace-rail [aria-label="素材"]');await click('.library-filters button','生成结果');
    check('generated image filter retains correct result',await js(`document.querySelectorAll('.asset-card').length===1&&document.querySelector('.asset-card strong').textContent.startsWith('花卉')`));
    await click('.library-filters button','全部');check('all materials return after clearing filter',await js(`document.querySelectorAll('.asset-card').length===4`));
    await click('.library-details button','查看完整详情');await wait(`!!document.querySelector('#dialogs .asset-time')`);check('details still open with stored timestamp',await js(`!!document.querySelector('#dialogs time')`));await click('.ant-modal-close');
    await click('.workspace-rail [aria-label="工具"]');await click('.tools-material-item:nth-child(2)');
    check('tool source changes without affecting materials',await js(`document.querySelector('.image-tools-toolbar>strong').textContent.includes('花园场景')`));
    await click('button','基础处理');await capture('8-tools-basic-light-1040');
    await click('button','素材处理');await capture('9-tools-composite-light-1040');
    await click('.workspace-rail [aria-label="设置"]');
    for(const tab of ['appearance','models','shortcuts']){await run('ui.navigate',{workspace:'settings',settingsTab:tab});await capture('10-settings-'+tab+'-light-1040');check(tab+' settings fit viewport',await js(`document.querySelector('.settings-content').scrollWidth<=document.querySelector('.settings-content').clientWidth+1`));}
    await run('ui.navigate',{workspace:'settings',settingsTab:'general'});
    const sw='.settings-switch';const before=await js(`document.querySelector('${sw}').getAttribute('aria-checked')`);await click(sw);check('settings switch still responds',await js(`document.querySelector('${sw}').getAttribute('aria-checked')!==${JSON.stringify(before)}`));await click(sw);
   }
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(error){report.failure=error.stack;console.error(error);try{await capture('failure')}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
