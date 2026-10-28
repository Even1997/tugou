const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const root=process.cwd(),out=path.join(root,'test-results/font-weights',process.env.TUGOU_FONT_TEST_GROUP||process.env.TUGOU_FONT_FILTER||'all');fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;delete process.env.TUGOU_DEV_PREVIEW;delete process.env.TUGOU_BUILD_DIR;process.argv.push('--mcp-enable');
const main=process.env.TUGOU_TEST_APP||path.join(root,'desktop-main.cjs');app.setAppPath(path.dirname(main));fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,notifyTasks:false,autoCheck:false}));
const {bridge}=require('../core/mcp.cjs'),report={checks:[],errors:[],main},check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name)};
let done=false;const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,process.env.TUGOU_TEST_APP?'packaged.json':'desktop.json'),JSON.stringify(report,null,2));app.exit(code)};setTimeout(()=>{report.failure='timeout';finish(1)},180000);
app.on('browser-window-created',(_,w)=>{w.webContents.on('render-process-gone',(_,details)=>{report.crash=details;console.error('RENDERER_EXIT',details);finish(1)});w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message)});w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),wait=async s=>{for(let i=0;i<160;i++){if(await js(s))return;await delay(80)}throw Error('Timeout '+s)};
 const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value};
 const state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision}),object=async id=>(await call('get_object',{kind:'layer',id})).object;
 const shot=async name=>{w.showInactive();await delay(100);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide()};
 try{
 await wait(`!!document.querySelector('.workspace-rail')`);w.webContents.session.enableNetworkEmulation({offline:true});
 const library=await run('font.library');check('MCP lists genuine builtin weights',JSON.stringify(library.builtin.find(f=>f.family==='Source Han Sans SC').weights)==='[250,300,350,400,500,700,900]');check('local font enumeration retains intermediate weights',library.system.some(f=>f.weights.includes(600)));
 await run('project.create',{name:'字体粗细验收'});const project=(await state()).projectId,board=(await run('artboard.create',{name:'粗细对比',width:1000,height:360})).id;
 await run('artboard.update',{id:board,patch:{background:'#ffffff'}});
 const id=(await run('layer.create',{artboardId:board,kind:'text',properties:{text:'春日来信 山川湖海\nABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz',fontFamily:'Source Han Sans SC',fontSize:40,color:'#202124',width:940,height:260,x:30,y:40,fontWeight:400}})).id;
 const preview=async()=>Buffer.from((await call('preview',{artboardId:board,maxSize:1000})).data,'base64');
 await run('workspace.show',{workspace:'layers',layerIds:[id]});await wait(`!!document.querySelector('[aria-label="字体粗细"]')`);
 await js(`document.querySelector('[aria-label="字体粗细"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')?.textContent.includes('700')`);
 check('weight popup displays seven genuine weights',await js(`document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').length===7`));await shot('dropdown');
 await js(`Array.from(document.querySelectorAll('.ant-select-item-option')).find(e=>e.title==='粗体 · 700').click()`);await wait(`document.querySelector('.font-picker')?.textContent.includes('粗体 · 700')`);check('UI weight change persists to layer',(await object(id)).fontWeight===700);
 const bold=await preview();await run('history.undo');check('weight change is undoable',(await object(id)).fontWeight===400);const normal=await preview();check('genuine bold changes glyph pixels',!normal.equals(bold));await run('history.redo');check('redo restores exact raster',(await preview()).equals(bold));
 await run('project.save');await run('project.create',{name:'重开'});await run('project.open',{id:project});check('saved weight survives reopen',(await object(id)).fontWeight===700&&(await preview()).equals(bold));
 await run('artboard.export',{artboardId:board,path:'bold-export.png'});const exported=fs.readFileSync(path.join((await state()).filesRoot,'bold-export.png'));check('PNG export equals preview pixels',(await sharp(exported).raw().toBuffer()).equals(await sharp(bold).raw().toBuffer()));
 const samples=[],proof=[],timings=[];
 const faceSizes=Object.fromEntries(require('../core/builtin-fonts.cjs').builtinFonts.flatMap(f=>require('../core/font-weights.cjs').fontFaces(f).map(face=>['Tugou_Builtin_'+f.id+':'+face.weight,face.bytes])));
 for(const font of require('../core/builtin-fonts.cjs').builtinFonts.filter(f=>!process.env.TUGOU_FONT_FILTER||process.env.TUGOU_FONT_FILTER.split(',').some(key=>f.id===key||f.id.includes(key)))){
  
  const weights=require('../core/font-weights.cjs').fontFaces(font).map(f=>f.weight).sort((a,b)=>a-b),rasters=new Set();
  for(const weight of weights){const started=Date.now();await run('layer.update',{id,patch:{fontFamily:font.family,fontWeight:weight,text:(font.sample||'春日来信 山川湖海\nABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz')}});report.current={id:font.id,weight};const image=await preview();timings.push(Date.now()-started);rasters.add(image.toString('base64'));check(font.id+' '+weight+' loads offline',await js(`Array.from(document.fonts).some(f=>f.family===${JSON.stringify('Tugou_Builtin_'+font.id)}&&f.weight===${JSON.stringify(String(weight))}&&f.status==='loaded')`));
   const registeredBytes=await js(`Array.from(document.fonts).reduce((sum,f)=>sum+(${JSON.stringify(faceSizes)}[f.family+':'+f.weight]||0),0)`);
   report.peakRegisteredFontBytes=Math.max(report.peakRegisteredFontBytes||0,registeredBytes);
   report.peakAppWorkingSetKiB=Math.max(report.peakAppWorkingSetKiB||0,app.getAppMetrics().reduce((sum,p)=>sum+(p.memory?.workingSetSize||0),0));
   if(weight===(font.weight||400)){const folder=path.join(root,'test-results/font-weights/samples');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,font.id+'.png'),image);}
   if(font.family==='Source Han Sans SC')samples.push({input:await sharp(image).extract({left:0,top:20,width:1000,height:200}).png().toBuffer(),left:0,top:samples.length*200});
  }
  check(font.id+' weights have distinct glyph pixels',rasters.size===weights.length);proof.push({family:font.family,weights});
 }
 report.fonts=proof;if(samples.length)fs.writeFileSync(path.join(out,'weight-comparison.png'),await sharp({create:{width:1000,height:samples.length*200,channels:4,background:'#fff'}}).composite(samples).png().toBuffer());
 await run('layer.update',{id,patch:{fontFamily:'jf-openhuninn-2.1',fontWeight:400}});await run('workspace.show',{workspace:'layers',layerIds:[id]});await wait(`document.querySelector('[aria-label="字体粗细"]')?.disabled`);check('single-weight font shows one disabled selector',true);
 await run('layer.update',{id,patch:{fontFamily:'Source Han Sans SC',fontWeight:700,fontStyle:'italic',text:'春日来信 山川湖海\nABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz'}});check('italic can coexist with weight',!(await preview()).equals(bold));
 await run('layer.update',{id,patch:{fontStyle:'normal'}});check('returning to an evicted face restores original pixels',(await preview()).equals(bold));await js("document.querySelector('.font-picker').scrollIntoView({block:'center'})");await shot('applied');
 timings.sort((a,b)=>a-b);report.switchP95Ms=timings[Math.floor(timings.length*.95)];
 check('registered font bytes remain within the 64 MiB budget',report.peakRegisteredFontBytes<=64*1024*1024);
 if(process.env.TUGOU_TEST_APPEARANCE){
   await js(`document.querySelector('button[aria-label="切换浅色主题"]')?.click()`);await wait(`document.documentElement.dataset.theme==='light'`);
   await js(`document.querySelector('.font-picker').scrollIntoView({block:'center'})`);await shot('light');
   w.setSize(940,760);await delay(150);await js(`document.querySelector('.font-picker').scrollIntoView({block:'center'})`);
   check('font and weight controls fit narrow property panel',await js(`Array.from(document.querySelectorAll('.font-picker .ant-select')).every(e=>{const r=e.getBoundingClientRect();return r.width>100&&r.right<=innerWidth})`));await shot('narrow');
 }
 check('no renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;report.loaded=await js('Array.from(document.fonts).map(f=>({family:f.family,weight:f.weight,status:f.status}))').catch(()=>[]);console.error(e);await shot('failure').catch(()=>{});finish(1)}
 });});require(main);
