// Runs on each native macOS runner against the packaged application, never a real user profile.
const {app,safeStorage,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/mac-release');fs.mkdirSync(out,{recursive:true});
assert.equal(process.platform,'darwin');
const bundle=path.resolve(process.env.TUGOU_MAC_QA_BUNDLE);
const source=path.join(bundle,'Contents/Resources/app.asar');
const profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;
process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require(path.join(source,'core/preference-values.cjs')).defaults,autoCheck:false,notifyTasks:false}));
const {bridge}=require(path.join(source,'core/mcp.cjs'));
const report={platform:process.platform,arch:process.arch,checks:[],errors:[]};let done=false;
function finish(code){if(done)return;done=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(code);}
function check(name,value){assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);}
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
  w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  w.webContents.once('did-finish-load',async()=>{try{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async s=>{for(let i=0;i<200;i++){if(await js(s))return;await delay(50);}throw Error('timeout '+s);};
    const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
    const run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});
    await wait(`!!document.querySelector('.studio-header')`);
    check('renderer loaded from packaged ASAR',w.webContents.getURL().includes('app.asar'));
    check('macOS isolated renderer bridge',await js(`window.tugou.platform==='darwin'&&typeof require==='undefined'`));
    check('native application menu installed',Menu.getApplicationMenu().items.length>0);
    check('no Windows window controls',await js(`!document.querySelector('.window-controls')`));
    check('brand clears Mac traffic lights',await js(`document.querySelector('.brand').getBoundingClientRect().left>=88`));
    const sharp=require(path.join(source,'node_modules/sharp'));
    const png=await sharp({create:{width:16,height:16,channels:4,background:'#5566cc'}}).png().toBuffer();
    check('packaged native sharp processes image',(await sharp(png).metadata()).width===16);
    await run('project.create',{name:'Mac 发布验证 中文路径'});await run('workspace.show',{workspace:'canvas'});
    await run('canvas.create',{type:'text',position:{x:0,y:0},properties:{text:'春日来信 Abc'}});
    await wait(`document.querySelectorAll('.react-flow__node').length===1`);
    for(const command of ['selectAll','copy','paste']){w.webContents.send('tugou:command',command);await delay(150);}
    await wait(`document.querySelectorAll('.react-flow__node').length===2`);check('native copy and paste canvas',true);
    w.webContents.send('tugou:command','undo');await wait(`document.querySelectorAll('.react-flow__node').length===1`);
    w.webContents.send('tugou:command','redo');await wait(`document.querySelectorAll('.react-flow__node').length===2`);check('undo and redo',true);
    await run('project.save');const saved=await call('get_state');
    check('MCP edits and saves project',!saved.dirty&&saved.counts.nodes===2);
    const fonts=await js(`window.tugou.fontCommand('font.library',{})`);
    report.fonts={system:fonts.system.length,builtin:fonts.builtin.length};
    check('Mac system and bundled fonts available',fonts.system.length>0&&fonts.builtin.length>0&&!fonts.warning);
    check('macOS credential encryption available',safeStorage.isEncryptionAvailable());
    await js(`document.querySelector('.rail-bottom [aria-label="设置"]').click()`);
    await wait(`document.querySelectorAll('[data-settings-tab]').length===7`);check('all settings sections open',true);
    for(const theme of ['light','dark']){
      await js(`window.tugou.settings('save',{theme:${JSON.stringify(theme)}})`);await delay(250);
      w.show();await delay(150);fs.writeFileSync(path.join(out,theme+'.png'),(await w.webContents.capturePage()).toPNG());
    }
    await js('location.reload()');await wait(`!!document.querySelector('.studio-header')`);
    check('saved project survives reload',(await call('get_state')).counts.nodes===2);
    w.close();await delay(150);check('closing Mac window keeps app alive',!w.isDestroyed()&&!w.isVisible());
    app.emit('activate');check('dock activation restores window',w.isVisible());
    check('no renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);finish(1);}});
});
require(path.join(source,'desktop-main.cjs'));
