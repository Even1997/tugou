const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/font-ocr'),acceptance=JSON.parse(fs.readFileSync(path.join(out,'acceptance.json'))),profile=fs.mkdtempSync(path.join(out,'ui-profile-'));
fs.cpSync(acceptance.root,path.join(profile,'workspace'),{recursive:true});process.env.TUGOU_DATA_DIR=profile;
if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;else process.env.TUGOU_BUILD_DIR=path.resolve('test-results/font-ocr-build');process.env.TUGOU_FONT_RUNTIME='F:/婚礼请柬/tugou-components/font-runtime';
const report={checks:[],errors:[],profile},check=(n,v)=>{assert.ok(v,n);report.checks.push(n);};let done=false;
let transport;
function finish(code){transport?.close();if(done)return;done=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));app.exit(code);}
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async s=>{for(let i=0;i<600;i++){if(await js(s))return;await delay(200);}throw Error('Timeout: '+s);};
 const click=async label=>{await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}).click()`);await delay(250);};
 const input=(label,value)=>js(`(()=>{let e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const capture=async name=>{w.showInactive();await delay(300);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
 try{
  w.setSize(1380,900);await wait(`!!document.querySelector('.workspace-rail [aria-label="字体"]')`);await js(`document.querySelector('.workspace-rail [aria-label="字体"]').click()`);await wait(`Array.from(document.querySelectorAll('.font-project-card')).some(b=>b.textContent.includes('粗圆原图识别'))`);await js(`Array.from(document.querySelectorAll('.font-project-card')).find(b=>b.textContent.includes('粗圆原图识别')).click()`);await wait(`!!document.querySelector('.font-character-grid')`);await click('导入图集');await wait(`document.querySelectorAll('.font-recognition-list button').length===24`);
  check('real 256 candidates restored with OCR mapping UI',await js(`document.querySelector('.font-recognition header small').textContent.includes('256 个候选')`));
  check('recognition does not automatically select candidates',await js(`document.querySelector('.font-recognition header small').textContent.includes('已选 0')`));await capture('recognition-dark');
  await click('选择可信匹配');check('explicit selection chooses a subset',await js(`document.querySelector('.font-recognition header small').textContent.includes('已选 0')===false`));await capture('recognition-selected');
  await js(`document.querySelector('.font-recognition-list button').click()`);await input('对应字符','阿');await delay(120);check('character mapping editable',await js(`document.querySelector('.font-recognition-list button').textContent.startsWith('阿')`));await input('裁切左','-4');check('crop coordinates clamp to image',await js(`document.querySelector('[aria-label="裁切左"]').value==='0'`));
  // Reload proves persisted OCR, then use two manually confirmed candidates rather than confidence.
  await click('字符库');await click('导入图集');await wait(`document.querySelectorAll('.font-recognition-list button').length===24`);await js(`document.querySelector('.font-recognition-check input').click()`);await js(`document.querySelectorAll('.font-recognition-list button')[1].click()`);await input('对应字符','一');await js(`document.querySelector('.font-recognition-check input').click()`);await delay(150);
  check('duplicate selected identity blocks correction',await js(`document.querySelector('.font-recognition footer button:last-child').disabled`));await capture('recognition-duplicate');await input('对应字符','二');await delay(100);check('correcting duplicate enables action',await js(`!document.querySelector('.font-recognition footer button:last-child').disabled`));
  for(const [width,height,zoom] of [[940,640,1],[1380,900,1.25],[1380,900,1]]){w.setSize(width,height);w.webContents.setZoomFactor(zoom);await delay(250);check('no horizontal overflow '+width+'/'+zoom,await js(`document.documentElement.scrollWidth<=innerWidth&&document.querySelector('.font-workspace').scrollWidth<=document.querySelector('.font-workspace').clientWidth`));}
  await js(`document.querySelector('.font-recognition footer button:last-child').click()`);await wait(`document.querySelector('.font-result-info')?.textContent.includes('字')&&!document.querySelector('.font-progress')`);check('UI confirmed mapping launches real correction',await js(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='应用本批字形'&&!b.disabled)`));await capture('recognition-corrected');
  await click('导入图集');await wait(`!!document.querySelector('.font-recognition-list')`);if(await js(`!!document.querySelector('[aria-label="切换浅色主题"]')`))await js(`document.querySelector('[aria-label="切换浅色主题"]').click()`);await capture('recognition-light');check('both themes keep white glyph inspection surface',await js(`getComputedStyle(document.querySelector('.font-glyph-crop')).backgroundColor==='rgb(255, 255, 255)'`));
  check('no renderer console errors',report.errors.length===0);
  const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
  const script=process.env.TUGOU_TEST_APP?path.join(path.dirname(process.env.TUGOU_TEST_APP),'core/mcp.cjs'):path.resolve('core/mcp.cjs');
  transport=new StdioClientTransport({command:process.execPath,args:[script,'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
  const client=new Client({name:'ocr-check',version:'1.0.0'});await client.connect(transport);
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
  const state=await call('get_state'),catalog=await call('list_commands',{domain:'font'});
  check('real stdio MCP exposes recognition schema',catalog.commands.some(c=>c.name==='font.atlas.recognize'));
  const run=(command,args={})=>call('run_command',{command:'font.'+command,args,expectedRevision:state.revision});
  const p=await run('project.get',{projectId:acceptance.realProjectId}),atlas=p.atlases[0];
  const started=await run('atlas.recognize',{projectId:p.id,fontRevision:p.fontRevision,requestId:require('node:crypto').randomUUID(),atlasId:atlas.id});
  let task;do{task=await call('run_command',{command:'task.wait',args:{id:started.taskId,timeoutMs:1000}});}while(task.timedOut);
  check('real MCP recognition task completes',task.task.status==='completed');
  const result=await run('job.get',{projectId:p.id,id:started.jobId});check('MCP receives editable 256 glyph mappings',result.result.report.candidates.length===256);
  const after=await call('get_state');check('font recognition does not modify canvas revision',after.revision===state.revision&&after.dirty===state.dirty);
  const font=fs.readFileSync(path.join(acceptance.root,'automation','unordered-152.ttf')).toString('base64');
  check('exported unordered font loads in actual Chromium',await js(`(async()=>{const f=new FontFace('OCRProof',Uint8Array.from(atob(${JSON.stringify(font)}),c=>c.charCodeAt(0)));await f.load();document.fonts.add(f);return f.status==='loaded'&&document.fonts.check('20px OCRProof');})()`));
  finish(0);
 }catch(e){report.failure=e.stack;await capture('ui-failure').catch(()=>{});finish(1);}
});});process.argv.push('--mcp-enable');require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
