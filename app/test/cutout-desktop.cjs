const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const edgeQA=process.env.TUGOU_EDGE_QA==='1';
const out=path.resolve(edgeQA?'test-results/cutout-edges':'test-results/cutout-repair'),profile=fs.mkdtempSync(path.join(out,'desktop-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.mkdirSync(path.join(profile,'workspace'),{recursive:true});
fs.writeFileSync(path.join(profile,'workspace/local-runtime.json'),JSON.stringify({folder:process.env.TUGOU_TEST_RUNTIME||'D:/CanvasStudioRuntime',provider:'DmlExecutionProvider'}));
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[]};let transport,finished=false;
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},150000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<600;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable: '+${JSON.stringify(label)});b.click()})()`);await delay(120);};
  const choose=async value=>{await js(`document.querySelector('[aria-label="抠图模型"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('[data-option-value="${value}"]')`);await js(`document.querySelector('[data-option-value="${value}"]').click()`);await delay(150);};
  const capture=async name=>{w.showInactive();await delay(250);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'cutout-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(80);return r;};
   await state();for(const domain of ['image','tools','selection','layer'])await call('list_commands',{domain});
   await run('project.create',{name:'轻量主体抠图验收'});const project=(await state()).projectId;
   const png=fs.readFileSync(path.resolve('test-results/local-ai-fixtures/white.png'));
   const asset=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'婚纱人物样例')`);
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:[${JSON.stringify(asset)}]},r.revision))`);await run('project.open',{id:project});
   await run('ui.navigate',{workspace:'tools'});await click('主体抠图');
   await wait(`document.querySelector('.local-tool-status')?.textContent.includes('已就绪')`);
   check('UI defaults to explicitly labeled lightweight CPU model',await js(`document.querySelector('[aria-label="抠图模型"]').closest('.studio-select').dataset.value==='u2netp'`));
   const status=await run('tools.status');check('MCP reports both models and independent readiness',status.cutoutModels.length===2&&status.readiness.cutoutLight.ready);
   await choose('birefnet');
   check('precise choice retains its actual resource guard',await js(`[...document.querySelectorAll('button')].find(b=>b.textContent==='开始处理').disabled`)===!status.readiness.cutout.ready);
   await choose('u2netp');
   if(edgeQA){
    const setNumber=async(label,value)=>{await js(`(()=>{const input=document.querySelector('[aria-label="${label}"]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'${value}');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(80);await js(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await delay(80);};
    check('edge controls default to off',await js(`['边缘收缩（px）','向内羽化（px）'].every(label=>document.querySelector('[aria-label="'+label+'"]').value==='0')`));
    await setNumber('边缘收缩（px）',1);await setNumber('向内羽化（px）',0.5);
   }
   await click('开始处理');await wait(`document.querySelectorAll('.processing-item').length===1`);
   check('real UI inference completes and opens comparison',await js(`!!document.querySelector('.image-comparison.view-compare')`));await capture('desktop-cutout');
   await click('素材');const task=await run('image.process',{ids:[asset.id],settings:{operation:'cutout',model:'u2netp',...(edgeQA?{edgeShrink:2,edgeFeather:0.5}:{})},requestId:'light-cutout-qa'});
   const done=await run('task.wait',{id:task.taskId,timeoutMs:30000});check('real MCP image processing completes',done.task?.status==='completed');
   for(let i=0;i<100;i++){if((await call('query_objects',{kind:'asset',limit:100})).objects.length===3)break;await delay(100);}
   const board=await run('artboard.create',{name:'抠图验收',width:512,height:768});
   const layer=await run('layer.create',{artboardId:board.id,kind:'image',properties:{assetId:asset.id,width:512,height:768,x:0,y:0}});
   const readiness=await js(`window.tugou.subjectStatus({width:512,height:768})`);
   check('AI subject selection exposes a ready model',readiness.ready&&['birefnet','u2netp'].includes(readiness.model));
   // This host has insufficient commit for BiRefNet. Do not force its memory threshold for testing.
   if(readiness.model==='u2netp'){
    const subject=await run('selection.subject',{id:layer.id,requestId:'light-subject-qa'});
    const complete=await run('task.wait',{id:subject.taskId,timeoutMs:30000});check('MCP subject selection uses lightweight worker successfully',complete.task?.status==='completed');
   }else report.subjectLimit='Host currently has enough memory for precise model; expensive precise selection skipped';
   await run('project.save');await run('project.open',{id:project});const saved=await js(`window.tugou.open(${JSON.stringify(project)})`);
   check('two cutout outputs survive save/reopen with model metadata',saved.document.assets.length===3&&saved.document.assets.filter(a=>a.toolResult).every(a=>a.toolResult.model==='u2netp'));
   if(edgeQA){const results=saved.document.assets.filter(a=>a.toolResult).map(a=>a.toolResult);check('UI and MCP retain their own edge parameters after reopening',results.some(r=>r.edgeShrink===1&&r.edgeFeather===0.5)&&results.some(r=>r.edgeShrink===2&&r.edgeFeather===0.5));}
   if(readiness.model==='u2netp')check('subject selection is saved on its artboard',Boolean(saved.document.layers.find(l=>l.id===board.id)?.selection));
   check('renderer has no errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('desktop-failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
