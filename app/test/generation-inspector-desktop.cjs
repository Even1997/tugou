// Isolated real renderer and MCP; no image generation or remote model calls.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {bridge}=require('../core/mcp.cjs');
const out=path.resolve('test-results/generation-inspector');fs.mkdirSync(out,{recursive:true});
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
  const state=()=>call('get_state'),run=async(command,args={})=>{await js('document.activeElement?.blur()');const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(150);return r;};
  const node=async id=>(await call('get_object',{kind:'canvasNode',id})).object;
  const click=async(selector,text)=>{await js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>${text?`e.textContent.trim()===${JSON.stringify(text)}`:'true'});if(!e||e.disabled)throw Error('Unavailable control');e.click()})()`);await delay(150);};
  const type=async(label,value)=>{await js(`(()=>{const e=document.querySelector('.generation-inspector [aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(150);};
  const capture=async name=>{w.showInactive();await delay(120);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
  try{
   w.setSize(1380,900);await wait(`!!document.querySelector('.workspace-rail')`);
   await run('project.create',{name:'生成台设置检查'});
   const id=(await run('canvas.create',{type:'image',position:{x:0,y:0},properties:{name:'26年税务师实务三件套',prompt:'设计一张税务师考试学习海报',model:'gpt-image-2.5-sunburst',size:'1024x1024',count:1}})).id;
   await run('ui.navigate',{workspace:'canvas',nodeId:id});
   const opened=`document.querySelector('.inspector-generation-params')?.open`;
   check('generation parameters open immediately',await js(opened));
   check('model source and quantity unit are visible',await js(`document.querySelector('.inspector-model-label').textContent.includes('单独指定')&&document.querySelector('.inspector-count').textContent.includes('张')`));
   const before=await state();await click('.inspector-generation-params>summary');check('user can collapse generation parameters',!await js(opened));await click('.inspector-generation-params>summary');
   check('expanding parameters does not modify project or undo',(await state()).revision===before.revision&&JSON.stringify((await state()).history)===JSON.stringify(before.history));
   await click('.generation-inspector .ratio-choices button','16:9');check('ratio selection updates saved node',(await node(id)).data.size==='1280x720');
   await click('.generation-inspector .resolution-choices button','2K');check('resolution selection retains chosen ratio',(await node(id)).data.size==='2048x1152');
   await type('生成数量','3');check('quantity input updates node',(await node(id)).data.count===3);
   await run('history.undo');check('quantity change can be undone',(await node(id)).data.count===1);
   await run('history.redo');check('quantity change can be redone',(await node(id)).data.count===3);
   await type('模型（留空使用共享连接）','');check('empty model uses shared connection',await js(`document.querySelector('.inspector-model-label').textContent.includes('共享连接')`)&&(await node(id)).data.model==='');
   await type('模型（留空使用共享连接）','gpt-image-2.5-sunburst');
   await click('.inspector-disclosure .ant-collapse-header','更多参数');check('advanced options remain accessible',await js(`!!document.querySelector('.inspector-advanced input[aria-label="负面提示词"]')`));
   await type('负面提示词','不需要水印');check('advanced parameter updates node',(await node(id)).data.negativePrompt==='不需要水印');await click('.inspector-disclosure .ant-collapse-header','更多参数');
   for(const [theme,width,height] of [['light',1380,900],['dark',1380,900],['light',940,640]]){
    w.setSize(width,height);await js(`if(document.documentElement.dataset.theme!==${JSON.stringify(theme)})document.querySelector('[aria-label="切换${theme==='dark'?'深':'浅'}色主题"]').click()`);await wait(`document.documentElement.dataset.theme===${JSON.stringify(theme)}`);await delay(150);
    check(theme+' '+width+' inspector has no horizontal overflow',await js(`(()=>{const e=document.querySelector('.canvas-inspector'),r=e.getBoundingClientRect();return r.right<=innerWidth&&e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll('.ratio-choices button')].every(b=>b.clientWidth>=45)})()`));
    await capture(theme+'-'+width);
   }
   await click('.inspector-generation-params>summary');
   const config=(await run('canvas.create',{type:'config',position:{x:450,y:0},properties:{name:'上游参数',model:'gpt-image-2.5-sunburst',size:'1024x1536',count:2}})).id;
   await run('ui.navigate',{workspace:'canvas',nodeId:config});check('newly selected generation node defaults open',await js(opened));
   await run('canvas.connect',{source:config,target:id});await run('ui.navigate',{workspace:'canvas',nodeId:id});
   check('inherited settings visibly identify source and block local changes',await js(`document.querySelector('.inspector-model-label').textContent.includes('继承上游')&&document.querySelector('.generation-inspector [aria-label="生成数量"]').disabled&&document.querySelector('.generation-inspector [aria-label="生成数量"]').value==='2'&&[...document.querySelectorAll('.generation-inspector .ratio-choices button')].every(e=>e.disabled)`));
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(error){report.failure=error.stack;console.error(error);try{await capture('failure')}catch{}finish(1);}
 });
});require(process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):'../desktop-main.cjs');
