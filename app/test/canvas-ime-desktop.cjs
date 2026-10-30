// Isolated renderer and Chromium IME events; never edits the user's open project.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {bridge}=require('../core/mcp.cjs');
const out=path.resolve('test-results/canvas-ime');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'desktop-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=process.env.TUGOU_IME_BUILD_DIR||path.join(out,'ui');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[],events:[]};let done=false;
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},60000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.setIgnoreMouseEvents(true);w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error'&&!e.message.startsWith('ResizeObserver loop'))report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
  const wait=async s=>{for(let i=0;i<200;i++){if(await js(`Boolean(${s})`))return;await delay(30);}throw Error('Timeout '+s);};
  const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args,{reconnectTimeoutMs:0,signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;};
  const run=async(command,args={})=>{await js('document.activeElement?.blur()');const r=await call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});await delay(50);return r;};
  const node=async id=>(await call('get_object',{kind:'canvasNode',id})).object;
  const input=async text=>{await w.webContents.debugger.sendCommand('Input.insertText',{text});await delay(35);};
  const compose=async(text,commit=text)=>{
   await w.webContents.debugger.sendCommand('Input.imeSetComposition',{text,selectionStart:text.length,selectionEnd:text.length});await delay(50);
   await input(commit);
  };
  try{
   await wait("document.querySelector('.workspace-rail')");w.webContents.debugger.attach('1.3');
   await js(`window.imeEvents=[];for(const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input'])document.addEventListener(type,e=>{if(e.target.matches('textarea,input'))imeEvents.push({type,data:e.data,inputType:e.inputType,composing:e.isComposing,value:e.target.value})},true)`);
   await js(`window.rawInput=document.createElement('textarea');document.body.append(rawInput);rawInput.focus()`);await compose('，');check('native textarea commits a single IME comma with this event sequence',await js('rawInput.value')==='，');await js('rawInput.remove();imeEvents=[]');
   await run('project.create',{name:'输入法标点验收'});const project=(await call('get_state')).projectId;
   const text=(await run('canvas.create',{type:'text',position:{x:0,y:0},properties:{text:''}})).id;
   await run('ui.navigate',{workspace:'canvas',nodeId:text});
   await js(`document.querySelector('[data-id="${text}"] .node-text').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);
   await wait("document.querySelector('[aria-label=\"节点内文本\"]')===document.activeElement");
   await js(`(()=>{const e=document.activeElement,d=Object.getOwnPropertyDescriptor(e,'value');Object.defineProperty(e,'value',{...d,set(value){imeEvents.push({type:'value-set',value,prior:d.get.call(this),stack:Error().stack});d.set.call(this,value)}})})()`);
   const history=(await call('get_state')).history.undo;
   await w.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'，',selectionStart:1,selectionEnd:1});await delay(60);
   check('IME draft stays visible without committing unfinished text',await js('document.activeElement.value')==='，'&&(await node(text)).data.text==='');await input('，');report.events=await js('imeEvents');
   check('one IME comma commits exactly one comma in the DOM',await js('document.activeElement.value')==='，');
   check('one IME comma commits exactly once in the node',(await node(text)).data.text==='，');
   check('composition end and final input create only one undo step',(await call('get_state')).history.undo===history+1);
   check('composition never writes the old value back into the native textarea',!report.events.some(e=>e.type==='value-set'));
   await compose('。');check('a following IME full stop is not duplicated',(await node(text)).data.text==='，。');
   await compose('ni','你');await compose('hao','好');await compose('！');
   check('Chinese composition and punctuation preserve the full sentence',(await node(text)).data.text==='，。你好！');
   await input('，，……！！');check('intentional repeated punctuation is preserved',(await node(text)).data.text==='，。你好！，，……！！');
   await input(',.;:!?');check('English punctuation is inserted once',(await node(text)).data.text==='，。你好！，，……！！,.;:!?');
   let expected='，。你好！，，……！！,.;:!?';
   await compose('，');await compose('，');expected+='，，';check('two deliberate IME commas remain two commas',(await node(text)).data.text===expected);
   await run('history.undo');check('undo removes exactly one committed IME character',(await node(text)).data.text===expected.slice(0,-1));await run('history.redo');check('redo restores exactly one committed IME character',(await node(text)).data.text===expected);
   const edit=async()=>{await js(`document.querySelector('[data-id="${text}"] .node-text').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);await wait("document.querySelector('[aria-label=\"节点内文本\"]')===document.activeElement");};
   await edit();await js('document.activeElement.setSelectionRange(0,0)');await compose('“');expected='“'+expected;check('IME punctuation inserts at the caret without jumping to the end',(await node(text)).data.text===expected);
   await js('document.activeElement.setSelectionRange(0,1)');await compose('「');expected='「'+expected.slice(1);check('IME replaces selected text without duplicating it',(await node(text)).data.text===expected);
   await js('document.activeElement.setSelectionRange(document.activeElement.value.length,document.activeElement.value.length)');await w.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'取消',selectionStart:2,selectionEnd:2});await delay(40);await w.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});await delay(40);
   check('cancelled composition leaves committed text intact',(await node(text)).data.text===expected&&await js('document.activeElement.value')===expected);
   await input('\n粘贴，，……！！');expected+='\n粘贴，，……！！';check('multiline text and intentional punctuation are preserved',(await node(text)).data.text===expected);
   await w.webContents.debugger.sendCommand('Input.imeSetComposition',{text:'完成',selectionStart:2,selectionEnd:2});await delay(40);
   await js(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',ctrlKey:true,isComposing:true,bubbles:true}))`);check('Ctrl Enter does not close the editor while composing',await js("!!document.querySelector('[aria-label=\"节点内文本\"]')"));
   await js('document.activeElement.blur()');await delay(80);expected+='完成';check('blur commits the final draft before closing the inline editor',(await node(text)).data.text===expected&&!await js("!!document.querySelector('[aria-label=\"节点内文本\"]')"));
   await js(`document.querySelector('[aria-label="画布自由提示词"]').focus();document.activeElement.setSelectionRange(document.activeElement.value.length,document.activeElement.value.length)`);await compose('；');expected+='；';check('sidebar prompt uses the same IME-safe input',(await node(text)).data.text===expected);
   for(const theme of ['light','dark']){
    await js(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[aria-label="切换${theme==='dark'?'深':'浅'}色主题"]').click()`);await delay(150);
    fs.writeFileSync(path.join(out,'text-'+theme+'.png'),(await w.webContents.capturePage()).toPNG());
    check(theme+' input keeps its theme, label and usable width',await js(`(()=>{const e=document.querySelector('[aria-label="画布自由提示词"]'),r=e.getBoundingClientRect();return e.classList.contains('ant-input')&&r.width>100&&r.height>30&&document.documentElement.dataset.theme===${JSON.stringify(theme)}})()`));
   }
   await run('canvas.update',{id:text,properties:{text:'外部更新。'}});check('external changes replace the local draft',await js('document.querySelector("[aria-label=画布自由提示词]").value')==='外部更新。');await run('history.undo');check('undo restores the full text across the local draft boundary',(await node(text)).data.text===expected&&await js('document.querySelector("[aria-label=画布自由提示词]").value')===expected);
   const desk=(await run('canvas.create',{type:'image',position:{x:500,y:0},properties:{prompt:'生成要求'}})).id;await run('ui.navigate',{workspace:'canvas',nodeId:desk});
   await wait("document.querySelector('[aria-label=\"节点内提示词\"]')");await js(`document.querySelector('[aria-label="节点内提示词"]').focus();document.activeElement.setSelectionRange(document.activeElement.value.length,document.activeElement.value.length)`);await compose('，');check('generation desk punctuation is committed once',(await node(desk)).data.prompt==='生成要求，');
   const recipe=(await run('recipe.create',{name:'输入法配方',output:'配方要求'})).id;await run('ui.navigate',{workspace:'prompts'});await wait("document.querySelector('[aria-label=\"构图与输出\"]')");
   await js(`document.querySelector('[aria-label="构图与输出"]').focus();document.activeElement.setSelectionRange(document.activeElement.value.length,document.activeElement.value.length)`);await compose('！');check('recipe output punctuation is committed once',(await call('get_object',{kind:'recipe',id:recipe})).object.output==='配方要求！');
   await run('ui.navigate',{workspace:'canvas',nodeId:desk});await wait("document.querySelector('[aria-label=\"合成提示词\"]')?.value.includes('生成要求，')");await js(`const preview=document.querySelector('[aria-label="合成提示词"]');preview.closest('details').open=true;preview.focus()`);const preview=await js('document.activeElement.value');await input('只读');check('readonly prompt preview remains readonly',await js('document.activeElement.value')===preview);
   report.events=await js('imeEvents');await run('project.save');await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(project)},workspace:'canvas'}))`);const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;await wait(`document.querySelector('[data-id="${text}"]')`);
   check('saving and reloading preserve the exact committed punctuation',(await node(text)).data.text===expected&&(await node(desk)).data.prompt==='生成要求，'&&(await call('get_object',{kind:'recipe',id:recipe})).object.output==='配方要求！');
   check('no unexpected renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;report.events=await js('window.imeEvents||[]').catch(()=>[]);console.error(e);finish(1);}
 });
});require('../desktop-main.cjs');
