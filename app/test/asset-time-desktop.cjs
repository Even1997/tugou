// Isolated desktop acceptance; fixtures only, no provider requests or user data.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {bridge}=require('../core/mcp.cjs');
const out=path.resolve('test-results/asset-time');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false,theme:'light'}));
const report={checks:[],errors:[]};let done=false;
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1)},90000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message)});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<250;i++){if(await js(s))return;await delay(30)}throw Error('Timeout '+s);};
  const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
  const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args,{reconnectTimeoutMs:0,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});await delay(150);return r;};
  const click=async(selector,text)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text?`e.textContent.trim()===${JSON.stringify(text)}`:'true'});if(!e)throw Error('Missing '+${JSON.stringify(selector)});e.click()})()`);await delay(150);};
  const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
  try{
   w.setSize(1380,900);await wait(`!!document.querySelector('.workspace-rail')`);
   const bytes=await require('sharp')({create:{width:800,height:600,channels:4,background:'#a9bacd'}}).png().toBuffer();
   const file=path.join(profile,'上传的婚礼照片.png');fs.writeFileSync(file,bytes);
   require('electron').dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});
   const imported=(await js('tugou.importImage()'))[0];
   const generated={...await js(`tugou.storeRaster(new Uint8Array(${JSON.stringify([...bytes])}),'税务师全家桶·海报生成结果')`),generation:{taskId:'fixture',prompt:'隔离预览'},createdAt:'2026-11-01T01:35:46.000Z'};
   const old={...generated,id:'old-image',name:'没有时间记录的图片'};delete old.createdAt;
   const text={id:'text-asset',kind:'text',name:'提示词 P1',text:'普通文本不显示图片时间'};
   const assets=[imported,generated,old,text];
   const nodes=assets.map((a,i)=>({id:'node-'+i,type:'asset',position:{x:i*430,y:40},data:{assetId:a.id,role:'参考图片'}}));
   nodes.push({...require('../core/workflow-nodes.cjs').workflowNode('panorama',{x:1750,y:40}),id:'panorama-node',data:{name:'全景生成结果',prompt:'隔离预览',outputAssetId:generated.id,outputAssetIds:[generated.id],size:'2048x1024'}});
   const doc={assets,tugouCanvas:{version:1,nodes,edges:[],viewport:{x:0,y:0,zoom:1}}};
   const id=await js(`(async()=>{const r=await tugou.create('图片时间检查');await tugou.save(r.id,{...r.document,...${JSON.stringify(doc)}},r.revision);return r.id})()`);
   await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:'canvas'}))`);
   const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;
   await wait(`!!document.querySelector('[data-id="node-0"] time')`);
   check('uploaded image time survives project reload',await js(`document.querySelector('[data-id="node-0"] time').dateTime===${JSON.stringify(imported.createdAt)}`));
   check('node name precedes generation completion time',await js(`(()=>{const e=document.querySelector('[data-id="node-1"] .node-caption-text');return e.children[0].tagName==='STRONG'&&e.children[1].dateTime===${JSON.stringify(generated.createdAt)}&&e.children[1].title==='完成时间'})()`));
   check('missing dates are explicit and text assets have no dates',await js(`document.querySelector('[data-id="node-2"] .asset-time').textContent==='完成时间未记录'&&!document.querySelector('[data-id="node-3"] .asset-time')`));
   check('canvas outline includes image time',await js(`document.querySelectorAll('.palette-item .asset-time').length===4`));
   await click('.palette-tabs button','素材');
   check('palette image names have timestamps below them',await js(`document.querySelectorAll('.palette-item time').length===2&&[...document.querySelectorAll('.palette-item time')].every(e=>e.getBoundingClientRect().top>=e.previousElementSibling.getBoundingClientRect().bottom)`));
   for(const [theme,width,height,expected] of [['light',1380,900,248],['dark',1380,900,248],['light',940,640,216]]){
    w.setSize(width,height);await js(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[aria-label="切换${theme==='dark'?'深':'浅'}色主题"]').click()`);await delay(200);
    check(theme+' '+width+' sidebar is wider without horizontal overflow',await js(`(()=>{const e=document.querySelector('.canvas-palette');return e.offsetWidth===${expected}&&e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll('.asset-time')].every(t=>t.getBoundingClientRect().right<=e.getBoundingClientRect().right)&&document.documentElement.scrollWidth<=innerWidth})()`));
    await capture(theme+'-'+width);
   }
   await run('ui.navigate',{workspace:'canvas',nodeId:'panorama-node'});await wait(`!!document.querySelector('[data-id="panorama-node"] .node-result-caption time')`);
   check('panorama result displays its own name and completion time',await js(`document.querySelector('[data-id="panorama-node"] .node-result-caption time').dateTime===${JSON.stringify(generated.createdAt)}`));
   w.setSize(1380,900);await run('ui.navigate',{workspace:'assets'});await wait(`!!document.querySelector('.asset-card time')`);
   check('library displays upload and completion dates under names',await js(`document.querySelectorAll('.asset-card time').length===2&&[...document.querySelectorAll('.asset-card time')].every(e=>e.previousElementSibling.tagName==='STRONG')`));
   await click('.asset-preview[aria-label="预览 上传的婚礼照片"]');
   check('library details include date',await js(`!!document.querySelector('.library-details .asset-time')`));await capture('library');
   await click('.library-details button','查看完整详情');await wait(`!!document.querySelector('#dialogs .asset-time')`);
   check('full material details include date',await js(`!!document.querySelector('#dialogs .asset-time')`));
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(error){report.failure=error.stack;console.error(error);try{await capture('failure')}catch{}finish(1);}
 });
});require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
