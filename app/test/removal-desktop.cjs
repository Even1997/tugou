const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/removal-desktop');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.resolve('test-results/removal-dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[]};let done=false;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
  w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const wait=async s=>{for(let i=0;i<120;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
    const click=selector=>js(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const textClick=text=>js(`Array.from(document.querySelectorAll('.ant-modal-wrap:not([style*="display: none"]) button')).findLast(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`);
    const shot=async name=>{await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
    const {bridge}=require('../core/mcp.cjs'),call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
    const state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision});
    const font=(name,args={})=>js(`window.tugou.fontCommand(${JSON.stringify('font.'+name)},${JSON.stringify(args)})`);
    try{
      await wait(`!!document.querySelector('.workspace-rail')`);await run('project.create',{name:'当前未保存工程'});
      const board=(await run('artboard.create',{name:'测试',width:400,height:400})).id;
      await run('layer.create',{artboardId:board,kind:'text',properties:{text:'保留撤销',width:200,height:80}});
      await run('project.save');const other=await js(`window.tugou.create('另一个工程')`);await js('location.reload()');await wait(`!!document.querySelector('.workspace-rail')`);
      // Reloaded app still restores current, then introduce a real dirty change again.
      await run('project.create',{name:'删除当前工程'});await run('artboard.create',{name:'未保存画板',width:400,height:400});const active=await state();
      await click('[aria-label="管理项目"]');await wait(`!!document.querySelector('[aria-label="删除项目 另一个工程"]')`);await shot('projects-dark');
      await click('[aria-label="删除项目 另一个工程"]');await textClick('取消');check('cancel project deletion keeps project',(await js('window.tugou.list()')).some(p=>p.id===other.id));
      await click('[aria-label="删除项目 另一个工程"]');await textClick('删除');await wait(`!document.querySelector('[aria-label="删除项目 另一个工程"]')`);
      const kept=await state();check('deleting another project preserves dirty document and undo',kept.projectId===active.projectId&&kept.dirty&&kept.history.undo===active.history.undo);
      await click('[aria-label="删除项目 删除当前工程"]');check('current project confirmation warns about unsaved edits',await js(`document.querySelector('#dialogs').textContent.includes('未保存的修改')`));await textClick('删除');await wait(`!document.querySelector('[aria-label="删除项目 删除当前工程"]')`);
      const empty=await state();check('current deletion clears document, dirty flag and undo',!empty.projectId&&!empty.dirty&&empty.history.undo===0);await click('[aria-label="关闭管理项目"]');
      const p=await font('project.create',{name:'春日来信',characters:'春日来信ABC',requestId:'create-font'}),q=await font('project.create',{name:'待删除字体',characters:'AB',requestId:'create-font2'});
      const file=path.join(profile,'workspace','fonts',p.id,'project.json'),data=JSON.parse(fs.readFileSync(file));data.published={fontResource:{jobId:'fixture'}};data.atlases=[{id:'image1',sha256:'fixture',format:'png',width:100,height:100}];
      const imageDir=path.join(path.dirname(file),'originals');fs.mkdirSync(imageDir,{recursive:true});const bytes=await require('sharp')({create:{width:100,height:100,channels:4,background:'white'}}).png().toBuffer(),hash=require('../core/storage.cjs').hash(bytes);data.atlases[0].sha256=hash;fs.writeFileSync(path.join(imageDir,hash+'.png'),bytes);fs.writeFileSync(file,JSON.stringify(data));
      await click('.workspace-rail [aria-label="字体"]');await wait(`!!document.querySelector('[aria-label="删除字体 待删除字体"]')`);await shot('fonts-dark');
      await click('[aria-label="删除字体 待删除字体"]');await textClick('取消');check('cancel font deletion leaves library intact',(await font('project.list')).projects.length===2);
      await click('[aria-label="删除字体 待删除字体"]');await textClick('删除');await wait(`!document.querySelector('[aria-label="删除字体 待删除字体"]')`);check('font card delete refreshes library',(await font('project.list')).projects.length===1);
      await click('.font-project-open');await wait(`!!Array.from(document.querySelectorAll('.font-publish button')).find(b=>b.textContent==='取消发布')`);
      await js(`Array.from(document.querySelectorAll('.font-publish button')).find(b=>b.textContent==='取消发布').click()`);await textClick('取消发布');await wait(`!Array.from(document.querySelectorAll('.font-publish button')).some(b=>b.textContent==='取消发布')`);check('unpublish removes font selector entry',(await font('library')).custom.length===0);
      await js(`Array.from(document.querySelectorAll('.font-tabs button')).find(b=>b.textContent==='导入图集').click()`);await wait(`!!Array.from(document.querySelectorAll('.font-import button')).find(b=>b.textContent==='移除图集')`);await js(`Array.from(document.querySelectorAll('.font-import button')).find(b=>b.textContent==='移除图集').click()`);await textClick('移除图集');await wait(`document.querySelector('.font-import')?.textContent.includes('导入字形图片')`);check('atlas removal shows empty state and preserves source image',fs.existsSync(path.join(imageDir,hash+'.png')));
      await click('.rail-bottom button[aria-label="切换浅色主题"]');w.setSize(1000,760);await shot('font-light');
      await js(`Array.from(document.querySelectorAll('.font-publish button')).find(b=>b.textContent==='删除字体').click()`);await shot('delete-font-light');await textClick('删除');await wait(`document.querySelector('.font-workspace')?.textContent.includes('创建你的第一款字体')`);check('deleting current font returns to empty library',true);
      await js('location.reload()');await wait(`!!document.querySelector('.workspace-rail')`);check('deleted projects and fonts stay deleted after reload',!(await js('window.tugou.list()')).some(p=>p.id===active.projectId)&&(await font('project.list')).projects.length===0);
      check('no renderer errors',report.errors.length===0);finish(0);
    }catch(e){report.failure=e.stack;console.error(e);await shot('failure').catch(()=>{});finish(1);}
  });
});require('../desktop-main.cjs');
