// Real desktop UI and IPC; only the native destination picker is automated.
const {app,dialog,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/image-save');fs.mkdirSync(out,{recursive:true});
const reopen=process.argv.includes('--reopen'),fixtureFile=path.join(out,'fixture.json');
let fixture=reopen?JSON.parse(fs.readFileSync(fixtureFile)):null;
const profile=fixture?.profile||fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-'))),dest=path.join(profile,'保存 图片'),second=path.join(profile,'另一个目录');
fs.mkdirSync(dest,{recursive:true});fs.mkdirSync(second,{recursive:true});
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false,theme:'light'}));
let savePath=path.join(dest,'canvas.png'),folder=second,cancel=false,options,calls=0,finished=false,transport;
dialog.showSaveDialog=async(_w,o)=>{options=o;calls++;return {canceled:cancel,filePath:savePath};};
dialog.showOpenDialog=async(_w,o)=>{options=o;calls++;return {canceled:cancel,filePaths:[folder]};};
const report={profile,checks:[],errors:[]},check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,reopen?'reopen.json':'report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},150000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<400;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const click=async(selector,text)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text===undefined?'true':`e.textContent.trim()===${JSON.stringify(text)}`});if(!e||e.disabled)throw Error('Missing button '+${JSON.stringify(text||selector)});e.click()})()`);await delay(180);};
  const context=async selector=>{await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:r.x+Math.min(30,r.width/2),clientY:r.y+Math.min(30,r.height/2)}))})()`);await wait(`!!document.querySelector('.image-save-menu:not(.ant-dropdown-hidden) [role=menuitem]')`);};
  const capture=async name=>{if(process.platform!=='darwin')w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());if(process.platform!=='darwin')w.hide();};
  const remembered=()=>JSON.parse(fs.readFileSync(path.join(profile,'image-export.json'))).directory;
  try{
   w.setSize(1380,900);await wait(`!!document.querySelector('.workspace-rail')`);
   if(reopen){
    cancel=true;await js(`tugou.chooseExport('重启后')`);check('new process restores last successful directory',path.dirname(options.defaultPath)===dest);
    await js(`tugou.chooseExport(['批量'])`);check('batch picker restores same directory after restart',options.defaultPath===dest);
    check('no renderer errors',!report.errors.length);return finish(0);
   }
   const png=await require('sharp')({create:{width:1600,height:900,channels:4,background:{r:200,g:80,b:20,alpha:.5}}}).png().toBuffer();
   const jpg=await require('sharp')(png).jpeg({quality:94}).toBuffer();
   const assets=[];for(const [bytes,name] of [[png,'生成图片'],[jpg,'照片.jpeg']])assets.push(await js(`tugou.storeRaster(new Uint8Array(${JSON.stringify([...bytes])}),${JSON.stringify(name)})`));
   let doc= require('../core/artboards.cjs').normalize({name:'保存图片检查',width:640,height:480,background:'transparent',assets,layers:[require('../core/layers.cjs').createLayer('group',{id:'artboard-main',artboard:true,name:'画板 1',width:640,height:480,background:'transparent',clipContent:true})]});
   doc.tugouCanvas={version:1,nodes:[{id:'image-node',type:'asset',position:{x:40,y:40},data:{assetId:assets[0].id,role:'主体身份'}},{id:'text-node',type:'text',position:{x:480,y:40},data:{name:'普通文本',text:'普通文本'}}],edges:[],viewport:{x:0,y:0,zoom:1}};
   const id=await js(`(async()=>{const r=await tugou.create('保存图片检查');await tugou.save(r.id,{...r.document,...${JSON.stringify(doc)}},r.revision);return r.id})()`);
   fixture={profile,id,assets};fs.writeFileSync(fixtureFile,JSON.stringify(fixture));
   await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:'canvas'}))`);const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;
   await wait(`!!document.querySelector('[data-id="image-node"] .node-media-preview')`);
   transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'image-save-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;},state=()=>call('get_state');
   const run=async(command,args)=>call('run_command',{command,args,expectedRevision:(await state()).revision});
   await run('canvas.create',{type:'text',position:{x:500,y:400},properties:{text:'保留未保存内容'}});const before=await state();
   await context('[data-id="image-node"] .node-media-preview');await capture('canvas-menu');await click('.image-save-menu:not(.ant-dropdown-hidden) [role=menuitem]','保存图片…');await delay(250);
   check('canvas right-click saves exact original bytes',fs.readFileSync(savePath).equals(png));let initialDirectory;try{initialDirectory=app.getPath('pictures');}catch{initialDirectory=app.getPath('home');}check('first save uses available system directory',path.dirname(options.defaultPath)===initialDirectory);check('successful save remembers directory',remembered()===dest);
   const after=await state();check('save preserves unsaved project revision and history',before.revision===after.revision&&before.dirty===after.dirty&&JSON.stringify(before.history)===JSON.stringify(after.history));
   cancel=true;savePath=path.join(second,'cancel.png');await context('[data-id="image-node"] .canvas-card');await click('.image-save-menu:not(.ant-dropdown-hidden) [role=menuitem]');check('cancel creates no file or directory change',!fs.existsSync(savePath)&&remembered()===dest);check('next picker starts in last directory',path.dirname(options.defaultPath)===dest);cancel=false;
   const count=calls;await js(`document.querySelector('[data-id="text-node"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2}))`);await delay(100);check('text nodes do not offer image saving',!await js(`!!document.querySelector('.image-save-menu:not(.ant-dropdown-hidden) [role=menuitem]')`)&&calls===count);
   await run('ui.navigate',{workspace:'assets'});await wait(`!!document.querySelector('.asset-card')`);
   savePath=path.join(second,'library.jpeg');await context('.asset-card:has([aria-label="预览 照片.jpeg"])');await capture('library-menu');await click('.image-save-menu:not(.ant-dropdown-hidden) [role=menuitem]');await delay(200);
   check('library right-click preserves JPEG bytes and extension',fs.readFileSync(savePath).equals(jpg)&&/照片\.jpe?g$/.test(options.defaultPath));check('library shares previous directory',path.dirname(options.defaultPath)===dest&&remembered()===second);
   savePath=path.join(second,'library-button.png');await click('.asset-card:has([aria-label="预览 生成图片"]) button[aria-label="保存图片"]');await delay(200);check('library visible save button works',fs.readFileSync(savePath).equals(png));
   await run('ui.navigate',{workspace:'layers'});await wait(`!!document.querySelector('[data-board-id="artboard-main"]')`);
   savePath=path.join(dest,'board.png');await js(`(()=>{const e=document.querySelector('[data-board-id="artboard-main"]');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,button:2,clientX:r.x+30,clientY:r.y+30}))})()`);await wait(`!!document.querySelector('.board-context-menu')`);await click('.board-context-menu [role=menuitem]','保存图片');await wait(`!!document.querySelector('.gif-export-preview')`);await click('.ant-modal button','保存 PNG');await wait(`!document.querySelector('.ant-modal')`);
   check('composition defaults to library save directory',path.dirname(options.defaultPath)===second);const board=nativeImage.createFromPath(savePath);check('composition saves native artboard size and alpha',board.getSize().width===640&&board.getSize().height===480&&board.toBitmap()[3]===0);check('composition updates shared directory',remembered()===dest);
   cancel=true;await js(`tugou.chooseExport(['画板一','画板二'])`);check('batch folder picker shares successful directory',options.defaultPath===dest);cancel=false;
   fs.writeFileSync(path.join(profile,'not-a-folder'),'file');savePath=path.join(profile,'not-a-folder','failed.png');await js(`tugou.exportAsset(${JSON.stringify(id)},${JSON.stringify(doc)},${JSON.stringify(assets[0].id)}).then(()=>{throw Error('expected failure')},()=>true)`);check('failed write does not replace remembered directory',remembered()===dest);
   await run('project.save',{});check('no renderer errors',!report.errors.length);finish(0);
  }catch(error){report.failure=error.stack;console.error(error);try{await capture('failure');}catch{}finish(1);}
 });
});require(process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):'../desktop-main.cjs');
