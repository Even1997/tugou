// Isolated real desktop + loopback Images API. Never reads the user's providers or project.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),sharp=require('sharp'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/cloud-paint');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'desktop-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[],requests:[]};let transport,finished=false;
const server=http.createServer(async(req,res)=>{
 try {
  const parts=[];for await(const p of req)parts.push(p);
  if(req.url.endsWith('/chat/completions')){
   report.requests.push('vision');res.setHeader('Content-Type','application/json');
   res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({categories:['左侧人物']})}}]}));return;
  }
  const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(parts)}).formData();
  const [width,height]=form.get('size').split('x').map(Number),split=form.get('prompt').includes('grayscale segmentation mask');
  report.requests.push(split?'split':form.has('mask')?'masked-edit':'enhance');
  const data=Buffer.alloc(width*height*4);
  for(let i=0;i<width*height;i++){
   const value=i%width<width/2?255:0;
   data.set(split?[value,value,value,255]:[210,70,90,255],i*4);
  }
  const png=await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
 }catch(e){res.writeHead(500);res.end('fixture failure');report.errors.push(e.message);}
});server.listen(0,'127.0.0.1');
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();server.closeAllConnections();server.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},150000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<600;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable: '+${JSON.stringify(label)});b.click()})()`);await delay(100);};
  const input=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="${label}"]');if(!e)throw Error('input missing');e.focus();Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(80);await js(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await delay(80);};
  const capture=async name=>{w.showInactive();await delay(250);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
  const submitDisabled=`[...document.querySelectorAll('button')].find(b=>b.textContent==='提交云端')?.disabled`;
  const draw=async(points)=>{
   const r=await js(`(()=>{const r=document.querySelector('[aria-label="涂画修改区域画布"]').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
   const p=([x,y])=>({x:Math.round(r.x+x*r.width),y:Math.round(r.y+y*r.height)});
   w.webContents.sendInputEvent({type:'mouseMove',...p(points[0])});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p(points[0])});
   for(const point of points.slice(1)){w.webContents.sendInputEvent({type:'mouseMove',...p(point)});await delay(20);}
   w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p(points.at(-1))});await delay(100);
  };
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'cloud-tools-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(80);return r;};
   await state();await call('list_commands',{domain:'cloud'});
   await run('project.create',{name:'云端工具隔离检查'});const project=(await state()).projectId;
   const data=Buffer.alloc(64*48*4);for(let i=0;i<64*48;i++)data.set([i%256,90,180,i%5?255:128],i*4);
   const png=await sharp(data,{raw:{width:64,height:48,channels:4}}).png().toBuffer();
   const asset=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'透明边缘测试图')`);
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:[${JSON.stringify(asset)}]},r.revision))`);await run('project.open',{id:project});
   await run('ui.navigate',{workspace:'tools'});await click('AI 局部修改');
   check('navigation no longer offers three unreliable cloud tools',await js(`!['云端增强','创意放大','AI 类别拆分'].some(name=>[...document.querySelectorAll('.tools-navigation button')].some(b=>b.textContent===name))`));
   await wait(`document.querySelector('.cloud-tool-status')?.textContent.includes('请先配置')`);
   check('unconfigured image model blocks UI before request',await js(submitDisabled));
   check('required instruction is directly visible',await js(`!!document.querySelector('textarea[aria-label="云端修改要求"]')`));
   await click('配置模型');await wait(`!!document.querySelector('.ant-modal')`);await click('取消');
   await js(`window.tugou.saveConnection(${JSON.stringify({baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'fixture-only-key',model:'fixture-editor'})})`);
   await js(`window.dispatchEvent(new Event('tugou-connection-changed'))`);await wait(`document.querySelector('.cloud-tool-status')?.textContent.includes('填写修改要求')`);
   check('configured model still blocks empty instruction',await js(submitDisabled));
   await input('云端修改要求','去掉区域内的杂物');check('empty paint mask blocks submitting the entire image',await js(submitDisabled));
   await click('涂画修改区域');await wait(`document.querySelector('[aria-label="涂画修改区域画布"]')?.dataset.ready==='true'`);
   await click('应用修改区域');check('empty mask cannot be applied',await js(`document.querySelector('.cloud-mask-editor').textContent.includes('请先涂画')`));
   await input('涂画笔刷大小（原图 px）',12);await draw([[.2,.5],[.35,.5],[.5,.5],[.65,.5],[.8,.5]]);
   await click('擦除');await input('涂画笔刷大小（原图 px）',4);await draw([[.5,.5]]);
   await click('清空区域');await click('应用修改区域');check('clearing all strokes rejects empty export',await js(`document.querySelector('.cloud-mask-editor').textContent.includes('请先涂画')`));
   await click('撤销涂画');await click('重做涂画');await click('撤销涂画');await capture('paint');
   await click('应用修改区域');await wait(`!document.querySelector('.cloud-mask-editor')`);
   const painted=(await call('query_objects',{kind:'asset',limit:100})).objects.find(a=>a.id!==asset.id);
   check('paint stores a mask without calling a paid model',Boolean(painted)&&report.requests.length===0);
   // The renderer owns the unsaved document; query resource metadata directly when not yet saved.
   await run('project.save');const paintedDoc=await js(`window.tugou.open(${JSON.stringify(project)})`),savedMask=paintedDoc.document.assets.find(a=>a.id===painted.id);
   const alpha=await sharp(fs.readFileSync(path.join(profile,'workspace','resources',savedMask.resource))).extractChannel('alpha').raw().toBuffer();
   check('freehand mask exports exact source dimensions and erased hole',savedMask.width===64&&savedMask.height===48&&alpha[24*64+16]>0&&alpha[24*64+32]===0&&alpha[0]===0);
   await click('涂画修改区域');await wait(`document.querySelector('[aria-label="涂画修改区域画布"]')?.dataset.ready==='true'`);await click('清空区域');await click('取消');
   check('cancel does not overwrite the saved mask',(await call('query_objects',{kind:'asset',limit:100})).objects.length===2);
   await click('AI 扩图');await click('AI 局部修改');
   check('switching tools retains paint mask and edit instruction',!(await js(submitDisabled))&&await js(`document.querySelector('[aria-label="云端修改要求"]').value==='去掉区域内的杂物'`));
   await click('蒙版规则');await input('蒙版向内羽化（px）',3);await capture('feather-controls');
   check('mask rules fit without horizontal clipping',await js(`(()=>{const e=document.querySelector('.cloud-mask-rules'),r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.left>=0&&r.right<=innerWidth})()`));await click('蒙版规则');
   check('paint mask exposes inward feather without a provider call',report.requests.length===0);
   await click('提交云端');await wait(`document.querySelectorAll('.processing-item').length===1`);
   check('local-edit workflow automatically compares result',await js(`!!document.querySelector('.image-comparison.view-compare')`));await capture('edit');
   await click('AI 扩图');await input('扩图宽度',64);await input('扩图高度',48);
   check('invalid extension blocks submit',await js(submitDisabled));
   await input('扩图宽度',320);await input('扩图高度',304);await click('提交云端');await wait(`document.querySelectorAll('.processing-item').length===2`);
   check('extension workflow completes',true);await capture('extend');
   await click('素材');const count=report.requests.length;let rejected=false;
   try{await run('cloud.process',{assetId:asset.id,settings:{operation:'cloudEdit',instruction:''},requestId:'invalid-cloud-edit'});}catch(e){rejected=/填写/.test(e.message);}
   check('MCP also rejects invalid edit before network request',rejected&&report.requests.length===count);
   const task=await run('cloud.process',{assetId:asset.id,settings:{operation:'cloudEdit',instruction:'修改涂画区域',maskMode:'asset',maskId:painted.id,maskChannel:'alpha',feather:5},requestId:'valid-cloud-paint'});
   const done=await run('task.wait',{id:task.taskId,timeoutMs:30000});check('MCP edits with the same painted mask',done.status==='completed'||done.task?.status==='completed');
   // Task completion persists result files; the renderer imports them on its 1.2s poll.
   for(let i=0;i<100;i++){if((await call('query_objects',{kind:'asset',limit:100})).objects.length===5)break;await delay(100);}
   check('completed MCP result is imported by renderer',(await call('query_objects',{kind:'asset',limit:100})).objects.length===5);
   await run('project.save');await run('project.open',{id:project});const saved=await js(`window.tugou.open(${JSON.stringify(project)})`);
   check('source, paint mask and three outputs persist after reopen',saved.document.assets.length===5);
   check('UI and MCP feather settings persist independently',JSON.stringify(saved.document.assets.filter(a=>a.toolResult?.operation==='cloudEdit').map(a=>a.toolResult.feather).sort())==='[3,5]');
   for(const result of saved.document.assets.filter(a=>a.toolResult)){
    const rgba=await sharp(fs.readFileSync(path.join(profile,'workspace','resources',result.resource))).ensureAlpha().raw().toBuffer();
    const s=result.toolResult;
    if(s.operation==='cloudEdit'){let changed=0;for(let p=0;p<64*48;p++){const i=p*4;if(!alpha[p])assert.deepEqual(rgba.subarray(i,i+4),data.subarray(i,i+4));else if(!rgba.subarray(i,i+4).equals(data.subarray(i,i+4)))changed++;}assert.ok(changed>0);}
    if(s.operation==='cloudExtend')for(let y=0;y<48;y++){const start=((y+s.top)*result.width+s.left)*4;assert.deepEqual(rgba.subarray(start,start+64*4),data.subarray(y*64*4,(y+1)*64*4));}
    if(s.operation==='cloudSplit')for(let i=0;i<64*48;i++){assert.deepEqual(rgba.subarray(i*4,i*4+3),data.subarray(i*4,i*4+3));assert.equal(rgba[i*4+3],i%64<32?data[i*4+3]:0);}
   }
   check('unpainted and erased pixels stay byte-identical after UI and MCP edits',true);
   // Verify a downsampled portrait preview still exports original-resolution geometry.
   const portraitBytes=await sharp(path.resolve('test-results/local-ai-fixtures/white.png')).resize(2048,3072).png().toBuffer();
   const portrait=await js(`window.tugou.storeRaster(${JSON.stringify([...portraitBytes])},'人物涂画测试')`);
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:[...r.document.assets,${JSON.stringify(portrait)}]},r.revision))`);await run('project.open',{id:project});await run('ui.navigate',{workspace:'tools'});await click('AI 局部修改');
   await js(`document.querySelector('.tools-material-list [data-asset-id="${portrait.id}"]').click()`);await delay(100);
   await input('云端修改要求','修改涂画处');check('changing source clears the previous paint mask',await js(submitDisabled));
   w.setSize(960,720);await click('切换浅色主题');await wait(`document.documentElement.dataset.theme==='light'`);
   await click('涂画修改区域');await wait(`document.querySelector('[aria-label="涂画修改区域画布"]')?.dataset.ready==='true'`);
   await input('涂画笔刷大小（原图 px）',64);await draw([[.3,.4],[.4,.4],[.5,.4],[.6,.4]]);await capture('paint-portrait-light');
   check('paint action fits inside a 960x720 window',await js(`(()=>{const b=[...document.querySelectorAll('.cloud-mask-editor button')].find(b=>b.textContent==='应用修改区域'),r=b.getBoundingClientRect();return r.bottom<=innerHeight&&r.right<=innerWidth})()`));
   await click('应用修改区域');await wait(`!document.querySelector('.cloud-mask-editor')`);await run('project.save');const largeDoc=await js(`window.tugou.open(${JSON.stringify(project)})`),largeMask=largeDoc.document.assets.at(-1);
   const largeAlpha=await sharp(path.join(profile,'workspace','resources',largeMask.resource)).extractChannel('alpha').raw().toBuffer();
   check('downsampled preview exports exact 2048x3072 mask coordinates',largeMask.width===2048&&largeMask.height===3072&&largeAlpha[Math.round(3072*.4)*2048+Math.round(2048*.45)]>0&&largeAlpha[0]===0);
   const legacy=largeDoc.document.assets.find(a=>a.toolResult);
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:r.document.assets.map(a=>a.id===${JSON.stringify(legacy.id)}?{...a,name:'历史云端增强',toolResult:{...a.toolResult,operation:'cloudEnhance'}}:a)},r.revision))`);await run('project.open',{id:project});await run('ui.navigate',{workspace:'tools'});
   await js(`document.querySelector('.processing-history summary').click()`);await js(`[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('历史云端增强')).click()`);await delay(100);
   check('legacy cloud output remains viewable without reactivating removed tool',await js(`!!document.querySelector('.image-comparison.view-result')&&document.querySelector('.tools-options>button[aria-pressed=true]')?.textContent==='分辨率调整'`));
   check('no renderer errors or real provider calls',report.errors.length===0&&report.requests.length===3);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
