// Isolated profile and local provider: no user project changes or paid generation.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const out=path.resolve('test-results/generation-sizes');fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'ui');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const {bridge}=require('../core/mcp.cjs'),report={checks:[],errors:[],resizeNotifications:[]},requests=[];let done=false,png;
const server=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);requests.push(JSON.parse(Buffer.concat(chunks).toString()));res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png}]}));});
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'desktop.json'),JSON.stringify(report,null,2));server.closeAllConnections();server.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},90000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')(e.message==='ResizeObserver loop completed with undelivered notifications.'?report.resizeNotifications:report.errors).push(e.message);});w.webContents.once('did-finish-load',async()=>{try{
 const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms)),check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
 const wait=async s=>{for(let i=0;i<160;i++){if(await js(s))return;await delay(40);}throw Error('timeout '+s);};
 const call=async(method,args={})=>{const r=await bridge(path.join(profile,'mcp-session.json'),method,args);if(!r.ok)throw Error(JSON.stringify(r.error));return r.value;},run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await call('get_state')).revision});
 const click=async(label,selector='button')=>{await js(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('missing '+${JSON.stringify(label)});b.click()})()`);await delay(100);};
 const open=async()=>{await js(`document.querySelector('.generation-size').click()`);await wait(`!!document.querySelector('.ant-popover:not(.ant-popover-hidden) .ratio-choices')`);};
 const scope='.ant-popover:not(.ant-popover-hidden)';
 const dropdown=async()=>{await js(`document.querySelector('${scope} [aria-label="生成台尺寸"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await wait(`!!document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')`);};
 await wait(`!!document.querySelector('.studio-header')`);await run('project.create',{name:'尺寸联动验收'});const desk=await run('canvas.create',{type:'config',position:{x:0,y:0},properties:{prompt:'本地尺寸检查'}});await run('workspace.show',{workspace:'canvas'});await wait(`!!document.querySelector('.generation-size')`);await open();
 for(const ratio of ['1:1','2:3','3:2','3:4','4:3','4:5','5:4','9:16','16:9']){
   await click(ratio,scope+' .ratio-choices button');await dropdown();
   const options=await js(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].map(e=>e.textContent.trim())`),[rw,rh]=ratio.split(':').map(Number);
   check(ratio+' dropdown contains only exact-ratio sizes',options.length>=2&&options.every(v=>{const [a,b]=v.split('×').map(Number);return a*rh===b*rw;}));
   await js(`Array.from(document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')).at(-1).click()`);await delay(100);
   check(ratio+' chosen resolution persisted',(await call('get_object',{kind:'canvasNode',id:desk.id})).object.data.size===options.at(-1).replace(/\s/g,'').replace('×','x'));
 }
 for(const theme of ['light','dark']){
   w.setSize(940,800);await js(`if(document.documentElement.dataset.theme!=='${theme}')document.querySelector('.rail-bottom button:last-child').click()`);await delay(150);
   if(!await js(`!!document.querySelector('${scope} .ratio-choices')`))await open();
   check(theme+' narrow popup fits viewport',await js(`(()=>{const e=document.querySelector('${scope} .tool-popover'),r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&e.scrollWidth<=e.clientWidth})()`));
   w.showInactive();await delay(100);fs.writeFileSync(path.join(out,theme+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();
 }
 await click('自动',scope+' .ratio-choices button');await click('自定义',scope+' .ratio-choices button');await wait(`!!document.querySelector('[aria-label="生成台尺寸（宽度）"]')`);
 check('custom from auto initializes two numeric pixel fields',await js(`Array.from(document.querySelectorAll('.generation-dimensions input')).length===2&&Array.from(document.querySelectorAll('.generation-dimensions input')).every(e=>e.type==='number'&&e.value==='1024')&&document.querySelectorAll('.generation-dimensions .ant-input-suffix').length===2`));
 const dimension=async(name,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="生成台尺寸（${name}）"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`);await delay(120);};
 await dimension('宽度','');check('clearing width does not clear height',await js(`document.querySelector('[aria-label="生成台尺寸（高度）"]').value==='1024'`));
 await dimension('宽度','1500');await dimension('高度','1001');
 check('custom size preserves arbitrary valid dimensions',(await call('get_object',{kind:'canvasNode',id:desk.id})).object.data.size==='1500x1001');
 check('custom fields stay side by side and fit popup',await js(`(()=>{const [a,b]=Array.from(document.querySelectorAll('.generation-dimensions input')).map(e=>e.getBoundingClientRect());return a.top===b.top&&a.right<b.left&&b.right<innerWidth})()`));
 w.showInactive();await delay(100);fs.writeFileSync(path.join(out,'custom-dimensions.png'),(await w.webContents.capturePage()).toPNG());w.hide();
 await click('自动',scope+' .ratio-choices button');await dropdown();check('auto dropdown has only auto',await js(`document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').length===1`));await click('自动','.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');
 await click('9:16',scope+' .ratio-choices button');await dropdown();await click('1440 × 2560','.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option');await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
 const url=`http://127.0.0.1:${server.address().port}/v1`;await js(`window.tugou.saveConnection({baseUrl:${JSON.stringify(url)},model:'local-image',apiKey:'local-fixture'})`);
 await run('generation.start',{nodeId:desk.id,requestId:'ratio-local'});await wait(`window.tugou.tasks().then(t=>t.some(t=>t.status==='completed'))`);
 check('image request sends selected portrait size unchanged',requests.length===1&&requests[0].size==='1440x2560');await run('project.save');await js('location.reload()');await wait(`!!document.querySelector('.generation-size')`);await open();
 check('saved ratio restores selected button',await js(`document.querySelector('${scope} .ratio-choices [aria-pressed="true"]').textContent.trim()==='9:16'`));
 check('saved size restores dropdown',await js(`document.querySelector('${scope} [aria-label="生成台尺寸"]').closest('.studio-select').dataset.value==='1440x2560'`));
 const below=()=>js(`(()=>{const trigger=document.querySelector('.generation-size').getBoundingClientRect(),popup=document.querySelector('${scope}').getBoundingClientRect();return popup.top>=trigger.bottom&&popup.bottom<=innerHeight&&popup.left>=0&&popup.right<=innerWidth})()`);
 check('size popup opens below trigger',await below());
 for(const zoom of [.75,1.25]){
   await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await run('canvas.viewport',{x:0,y:0,zoom});await delay(150);await open();await delay(150);check('popup stays below at zoom '+zoom,await below());
 }
 await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await run('canvas.viewport',{x:0,y:0,zoom:1});await run('canvas.update',{id:desk.id,position:{x:0,y:280}});await delay(150);await open();await delay(150);
 check('near bottom popup stays below and fits',await below());
 check('short popup scrolls to quality control',await js(`(()=>{const e=document.querySelector('${scope} .tool-popover');e.scrollTop=e.scrollHeight;const q=e.querySelector('[aria-label="生成台质量"]').getBoundingClientRect(),r=e.getBoundingClientRect();return e.scrollHeight>e.clientHeight&&q.top>=r.top&&q.bottom<=r.bottom})()`));
 w.showInactive();await delay(100);fs.writeFileSync(path.join(out,'downward-near-bottom.png'),(await w.webContents.capturePage()).toPNG());w.hide();
 check('no unexpected renderer errors',report.errors.length===0);finish(0);
 }catch(e){report.failure=e.stack;console.error(e);finish(1);}});});
server.listen(0,'127.0.0.1',async()=>{png=(await require('../core/cloud-pixels.cjs').encode({width:32,height:32,data:Buffer.alloc(4096,255)})).toString('base64');require(path.resolve('desktop-main.cjs'));});
