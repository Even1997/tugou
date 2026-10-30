// Drag real handles in an isolated project; never loads user data or submits generation.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {bridge}=require('../core/mcp.cjs');
const out=path.resolve('test-results/canvas-link-menu');fs.mkdirSync(out,{recursive:true});const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'profile-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[]};let finished=false;
const check=(name,v)=>{assert.ok(v,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
 w.setIgnoreMouseEvents(true);w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<160;i++){if(report.errors.length)throw Error(report.errors.join('\n'));if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args,{reconnectTimeoutMs:0,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(150);return r;};
  const objects=async kind=>Promise.all((await call('query_objects',{kind,limit:100})).objects.map(async n=>(await call('get_object',{kind,id:n.id})).object));
  const nodes=()=>objects('canvasNode'),edges=()=>objects('edge');
  const point=selector=>js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const blank=()=>js(`(()=>{const r=document.querySelector('.react-flow__pane').getBoundingClientRect();return {x:Math.round(r.right-100),y:Math.round(r.bottom-100)}})()`);
  const key=async keyCode=>{w.webContents.sendInputEvent({type:'keyDown',keyCode});w.webContents.sendInputEvent({type:'keyUp',keyCode});await delay(180);};
  const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('missing button');b.click()})()`);await delay(180);};
  const search=async value=>{await js(`(()=>{const e=document.querySelector('[aria-label="搜索节点类型"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()})()`);await delay(160);};
  const labels=()=>js(`Array.from(document.querySelectorAll('.canvas-node-picker [role="menuitem"]'),e=>e.textContent.trim())`);
  const capture=async name=>{w.showInactive();await delay(150);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
  const drag=async(a,b)=>{w.showInactive();await delay(100);w.webContents.sendInputEvent({type:'mouseMove',...a});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...a});await delay(80);for(let i=1;i<=8;i++){w.webContents.sendInputEvent({type:'mouseMove',x:Math.round(a.x+(b.x-a.x)*i/8),y:Math.round(a.y+(b.y-a.y)*i/8),button:'left',modifiers:['leftbuttondown']});await delay(45);}w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...b});await delay(250);};
  const open=async(id,type='source')=>{await drag(await point(`[data-id="${id}"] .react-flow__handle.${type}`),await blank());await wait(`!!document.querySelector('.canvas-node-picker')`);};
  const choose=async text=>{await search(text);await key('Enter');await wait(`!document.querySelector('.canvas-node-picker')`);};
  const equalState=(a,b)=>a.revision===b.revision&&a.dirty===b.dirty&&JSON.stringify(a.history)===JSON.stringify(b.history);
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);
   await run('project.create',{name:'拉线节点选择验收'});
   const a=(await run('canvas.create',{type:'text',position:{x:40,y:30},properties:{name:'提示词',text:'保留原始内容'}})).id;
   const b=(await run('canvas.create',{type:'config',position:{x:450,y:30},properties:{name:'已有生成台',prompt:'原始提示词'}})).id;
   await run('ui.navigate',{workspace:'canvas',overview:true});await run('project.save');await delay(250);
   const initial=await state();await open(a);
   check('drag from output to blank opens picker without white screen',await js(`!!document.querySelector('.studio-header')&&document.querySelector('[aria-label="搜索节点类型"]').placeholder.includes('可连接')`));
   const choices=await labels();check('output picker lists compatible generators only',choices.includes('生成台')&&choices.includes('图片生成')&&choices.includes('文本生成')&&!choices.includes('文字提示词')&&!choices.includes('图片节点')&&!choices.includes('导入图片'));
   check('picker stays inside the window',await js(`(()=>{const r=document.querySelector('.canvas-node-picker').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`));await capture('output-menu-dark');
   const opened=await state();report.opening={before:{revision:initial.revision,dirty:initial.dirty,history:initial.history},after:{revision:opened.revision,dirty:opened.dirty,history:opened.history}};
   check('opening picker changes no document or undo state',equalState(initial,opened));await key('Escape');await wait(`!document.querySelector('.canvas-node-picker')`);
   check('Escape cancels without nodes or edges',(await nodes()).length===2&&(await edges()).length===0&&equalState(initial,await state()));
   await open(a);await choose('生成台');const linked=(await nodes()).find(n=>n.id!==a&&n.id!==b),link=(await edges())[0];
   check('selecting generator creates a configured node and outgoing edge',linked.type==='config'&&linked.data.mode==='image'&&link.source===a&&link.target===linked.id);
   check('node and link share one undo step',(await state()).history.undo===initial.history.undo+1);await run('history.undo');check('undo removes node and link together',(await nodes()).length===2&&(await edges()).length===0);await run('history.redo');check('redo restores node and link',(await nodes()).length===3&&(await edges()).length===1);await run('history.undo');
   await open(b,'target');const incoming=await labels();check('dragging from input offers upstream text and image nodes',incoming.includes('文字提示词')&&incoming.includes('图片节点')&&!incoming.includes('生成台'));
   await choose('文字提示词');const upstream=(await nodes()).find(n=>n.id!==a&&n.id!==b),reverse=(await edges())[0];check('input-origin creation connects new node into existing target',upstream.type==='text'&&reverse.source===upstream.id&&reverse.target===b);await run('history.undo');
   await open(a);const p=await js(`(()=>{const r=document.querySelector('.react-flow__pane').getBoundingClientRect();return {x:Math.round(r.x+8),y:Math.round(r.y+8)}})()`);w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await wait(`!document.querySelector('.canvas-node-picker')`);
   await click('添加节点');await wait(`!!document.querySelector('.canvas-node-picker')`);check('outside cancellation clears pending connection',await js(`document.querySelector('[aria-label="搜索节点类型"]').placeholder==='搜索节点…'`));await choose('文字提示词');check('ordinary creation after cancellation adds no stale edge',(await nodes()).length===3&&(await edges()).length===0);await run('history.undo');
   await drag(await point(`[data-id="${a}"] .react-flow__handle.source`),await point(`[data-id="${b}"] .react-flow__handle.target`));check('direct connection to an existing handle still works',(await edges()).length===1&&(await nodes()).length===2&&!await js(`!!document.querySelector('.canvas-node-picker')`));await run('history.undo');
   const beforeInvalid=await state();await drag(await point(`[data-id="${b}"] .react-flow__handle.source`),await point(`[data-id="${a}"] .react-flow__handle.target`));check('invalid direct connection is ignored without crashing',equalState(beforeInvalid,await state())&&(await edges()).length===0&&await js(`!!document.querySelector('.studio-header')`));
   w.setSize(960,720);await click('切换浅色主题');await js(`document.activeElement?.blur()`);await run('ui.navigate',{overview:true});await open(a);check('compact light menu remains visible and in bounds',await js(`(()=>{const r=document.querySelector('.canvas-node-picker').getBoundingClientRect();return document.documentElement.dataset.theme==='light'&&r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`));await capture('output-menu-light');await key('Escape');
   check('original nodes and content remain intact',(await nodes()).find(n=>n.id===a).data.text==='保留原始内容'&&(await nodes()).find(n=>n.id===b).data.prompt==='原始提示词');
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
