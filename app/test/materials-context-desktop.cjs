// Isolated desktop: real context menu and document edits, no user project or API calls.
const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const entry=process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):path.resolve(__dirname,'../desktop-main.cjs'),appRoot=path.dirname(entry);
const out=path.resolve('test-results/materials-context');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'desktop-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require(path.join(appRoot,'core/preference-values.cjs')).defaults,autoCheck:false,notifyTasks:false}));
let transport,finished=false,saves=0;const report={checks:[],errors:[]};
dialog.showSaveDialog=async()=>{saves++;return {canceled:true};};
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<200;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const capture=async name=>{await delay(200);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
  const card=name=>`[...document.querySelectorAll('.asset-card')].find(e=>e.querySelector('strong')?.textContent===${JSON.stringify(name)})`;
  const has=name=>js(`!!(${card(name)})`);
  const context=async name=>{await js(`(${card(name)}).scrollIntoView({block:'nearest'})`);await delay(200);await js(`(()=>{const e=${card(name)};const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:r.x+40,clientY:r.y+40}))})()`);await wait(`!!document.querySelector('.image-save-menu [role=menuitem]')`);};
  const item=async label=>{await js(`[...document.querySelectorAll('.image-save-menu [role=menuitem]')].find(e=>e.textContent.trim()===${JSON.stringify(label)}).click()`);await delay(150);};
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);if(process.env.TUGOU_TEST_APP)check('renderer loaded from packaged ASAR',w.webContents.getURL().includes('app.asar'));
   for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.env.TUGOU_MCP_BINARY||process.execPath,args:[path.join(appRoot,'core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'materials-context-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(100);return r;};
   await state();await call('list_commands',{domain:'canvas'});await run('project.create',{name:'素材右键删除验收'});const project=(await state()).projectId;
   const png=await sharp({create:{width:80,height:60,channels:4,background:'#729ee8'}}).png().toBuffer();
   const image=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'保留图片')`);
   const names=['待删除图片','画布引用','局部蒙版','图层引用','配方引用'];
   const assets=[image,...names.map((name,i)=>({...image,id:'fixture-'+i,name})),{id:'text-fixture',name:'文本素材',kind:'text',text:'右键也可删除文本'}];
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:${JSON.stringify(assets)},recipes:[{...${JSON.stringify(require(path.join(appRoot,'core/prompts.cjs')).newRecipe())},references:[{assetId:'fixture-4',role:'reference'}]}]},r.revision))`);
   await run('project.open',{id:project});
   await run('canvas.create',{type:'asset',sourceId:'fixture-1',position:{x:0,y:0},properties:{localEdit:{assetId:'fixture-1',maskId:'fixture-2'}}});
   const board=(await run('artboard.create',{name:'引用检查',width:200,height:200})).id;
   await run('layer.create',{artboardId:board,kind:'image',properties:{assetId:'fixture-3',width:80,height:60}});
   await run('ui.navigate',{workspace:'assets'});w.setSize(1380,900);w.showInactive();await delay(200);
   await js(`window.confirmCalls=[];window.confirmResult=false;window.confirm=message=>{window.confirmCalls.push(message);return window.confirmResult;};void 0;`);
   await js(`(${card('保留图片')}).querySelector('input').click()`);
   await context('待删除图片');
   check('image menu contains save and danger delete',await js(`document.querySelectorAll('.image-save-menu [role=menuitem]').length===2&&document.querySelector('.image-save-menu .ant-dropdown-menu-item-danger')?.textContent==='删除'`));
   await capture('image-menu');await item('删除');
   check('cancel keeps clicked image and selection',await has('待删除图片')&&await js(`(${card('保留图片')}).querySelector('input').checked&&window.confirmCalls[0].includes('原文件不会删除')`));
   await js('window.confirmResult=true');await context('待删除图片');await item('删除');
   check('delete targets clicked image, retaining other selected material',!await has('待删除图片')&&await js(`(${card('保留图片')}).querySelector('input').checked`));
   check('resource file is preserved',fs.readFileSync(path.join(profile,'workspace','resources',image.resource)).equals(png));
   await run('history.undo');check('undo restores deleted material',await has('待删除图片'));
   for(const name of ['画布引用','局部蒙版','图层引用','配方引用']){
    const revision=(await state()).revision,confirms=await js('window.confirmCalls.length');await context(name);await item('删除');
    check(name+' prevents deletion without changing document',await has(name)&&(await state()).revision===revision&&await js(`window.confirmCalls.length===${confirms}&&document.querySelector('[role=alert]').textContent.includes('仍被')`));
   }
   await context('文本素材');check('text material has delete only',await js(`document.querySelectorAll('.image-save-menu [role=menuitem]').length===1&&document.querySelector('.image-save-menu [role=menuitem]').textContent==='删除'`));
   await item('删除');check('text deletion succeeds and clears old error',!await has('文本素材')&&await js(`!document.querySelector('.asset-library [role=alert]')`));
   await context('保留图片');await item('保存图片…');check('save action still opens export dialog',saves===1&&await has('保留图片'));
   await js(`(${card('待删除图片')}).querySelector('input').click();document.querySelector('.library-toolbar [aria-label="移除 (2)"]').click()`);await delay(150);
   check('toolbar batch deletion retains referenced materials',!await has('保留图片')&&!await has('待删除图片')&&await has('画布引用'));
   await run('history.undo');check('batch deletion remains one undo step',await has('保留图片')&&await has('待删除图片'));
   await js(`document.querySelector('button[aria-label="切换浅色主题"]')?.click()`);w.showInactive();w.setSize(960,720);await delay(500);await context('保留图片');await capture('menu-narrow-light');
   check('narrow window menu stays within viewport',await js(`(()=>{const r=document.querySelector('.image-save-menu').getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`));
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require(entry);
