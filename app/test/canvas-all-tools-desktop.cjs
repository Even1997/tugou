// Isolated desktop: real raster/GIF, loopback image API, simulated local AI runtime.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),sharp=require('sharp'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const entry=process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):path.resolve(__dirname,'../desktop-main.cjs'),appRoot=path.dirname(entry);
const out=path.resolve('test-results/canvas-all-tools');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'desktop-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require(path.join(appRoot,'core/preference-values.cjs')).defaults,autoCheck:false,notifyTasks:false}));
const http=require('node:http');const requests=[];
const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const b of req)chunks.push(b);const f=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();const [width,height]=f.get('size').split('x').map(Number);requests.push({path:req.url,size:f.get('size'),mask:!!f.get('mask')});const png=await sharp({create:{width,height,channels:4,background:'#52ad98'}}).png().toBuffer();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));}catch(e){res.writeHead(500);res.end();}});server.listen(0,'127.0.0.1');
const {ConnectionStore}=require(path.join(appRoot,'core/connection.cjs'));
ConnectionStore.prototype.readPrivate=async()=>({baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'test-only',model:'fixture-edit'});
const {LocalAIService}=require(path.join(appRoot,'core/local-ai.cjs'));
LocalAIService.prototype.resolveRuntime=async()=>({folder:profile,provider:'CPUExecutionProvider'});
LocalAIService.prototype.execute=async function(job,runtime,signal,id,part){const a=job.inputs[0],bytes=await fs.promises.readFile(path.join(profile,'workspace/resources',a.resource));const scale=job.settings.operation==='upscale'?job.settings.scale:1;signal.throwIfAborted();await part({inputIndex:0,index:0,count:1,bytes:await sharp(bytes).resize(a.width*scale,a.height*scale).png().toBuffer()});};
let transport,finished=false;const report={checks:[],errors:[],layoutNotifications:[]};
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();server.closeAllConnections();server.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},240000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error'){if(e.message.startsWith('ResizeObserver loop'))report.layoutNotifications.push({message:e.message,after:report.checks.at(-1)});else report.errors.push(e.message);}});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<200;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const capture=async name=>{await delay(200);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);if(process.env.TUGOU_TEST_APP)check('renderer loaded from packaged ASAR',w.webContents.getURL().includes('app.asar'));w.setSize(1380,900);w.showInactive();await delay(200);
   for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.env.TUGOU_MCP_BINARY||process.execPath,args:[path.join(appRoot,'core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'canvas-all-tools-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(100);return r;};
   const node=async id=>(await call('get_object',{kind:'canvasNode',id})).object,asset=async id=>(await call('get_object',{kind:'asset',id})).object;
   const waitFor=async(fn,label)=>{for(let i=0;i<600;i++){if(await fn())return;await delay(50);}throw Error('Timeout '+label);};
   const click=async(label,scope='document')=>{await js(`(()=>{const b=[...${scope}.querySelectorAll('button,[role=menuitem]')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing button '+${JSON.stringify(label)});b.click()})()`);await delay(120);};
   await state();await call('list_commands',{domain:'canvas'});await run('project.create',{name:'全部工具台验收'});const project=(await state()).projectId;
   const bytes=await sharp({create:{width:8,height:6,channels:4,background:'#32649a'}}).png().toBuffer(),white=await sharp({create:{width:8,height:6,channels:4,background:'#699bd1'}}).png().toBuffer();
   const original=await js(`tugou.storeRaster(${JSON.stringify([...bytes])},'原图')`),second=await js(`tugou.storeRaster(${JSON.stringify([...white])},'白底或材质')`);
   const lut={id:'identity',name:'Identity',text:'LUT_1D_SIZE 2\n0 0 0\n1 1 1'};
   await js(`tugou.open('${project}').then(r=>tugou.save(r.id,{...r.document,assets:${JSON.stringify([original,second])},imageToolLuts:[${JSON.stringify(lut)}]},r.revision))`);await run('project.open',{id:project});
   const source=(await run('canvas.create',{type:'asset',sourceId:original.id,position:{x:0,y:0}})).id,secondary=(await run('canvas.create',{type:'asset',sourceId:second.id,position:{x:0,y:300}})).id;
   await run('ui.navigate',{workspace:'canvas'});await click('添加节点');
   const names=require(path.join(appRoot,'core/canvas-tools.cjs')).names;
   check('all 20 current tools appear in add-node menu',await js(`${JSON.stringify(Object.values(names))}.every(name=>[...document.querySelectorAll('.canvas-node-picker [role=menuitem]')].some(e=>e.textContent===name))`));
   check('removed tools are absent from canvas menu',await js(`!['AI 局部修改','框选提取','选区替换'].some(name=>[...document.querySelectorAll('.canvas-node-picker [role=menuitem]')].some(e=>e.textContent===name))`));
   await click('水平镜像',`document.querySelector('.canvas-node-picker')`);
   const created=(await call('query_objects',{kind:'canvasNode',limit:100})).objects.find(n=>n.type==='imageTool');check('menu creates a real mirror workbench',(await node(created.id)).data.operation==='mirror');
   const options={upscale:{model:'anime',scale:2},cutout:{model:'u2netp'},crop:{left:1,top:1,width:4,height:3},resize:{scale:2},extend:{padding:2},tile:{width:12,height:8},pattern:{width:12,height:8},lut:{lutId:'identity'},split:{splitMode:'grid',rows:2,columns:2},cloudExtend:{width:16,height:14,left:4,top:4},gif:{width:8,height:6,delay:100,frameDelays:{[secondary]:200}}};
   const completed={};let index=0;
   for(const operation of Object.keys(names)){
    const id=operation==='mirror'?created.id:(await run('canvas.create',{type:'imageTool',sourceId:operation,position:{x:400,y:index++*280},properties:{parameters:options[operation]||{}}})).id;
    await run('canvas.connect',{source,target:id});if(['mattePair','texture','gif'].includes(operation))await run('canvas.connect',{source:secondary,target:id});
    await run('ui.navigate',{workspace:'canvas',nodeId:id});await delay(100);
    check(operation+' exposes parameters without horizontal overflow',await js(`(()=>{const e=document.querySelector('.canvas-tool-inspector');return !!e&&e.scrollWidth<=e.clientWidth+1})()`));
    if(operation==='lut'){
      const old=(await node(id)).data.parameters.lutId;
      await js(`(()=>{const input=document.querySelector('[aria-label="导入 Cube LUT"]'),dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(lut.text)}],'new.cube',{type:'text/plain'}));input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      await waitFor(async()=>(await node(id)).data.parameters.lutId!==old,'LUT import');check('LUT imported in node persists in project',true);
    }
    if(operation==='watermark'){
      await js(`document.querySelector('[aria-label="水印修复方式"]').closest('.ant-select').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);await delay(100);await js(`[...document.querySelectorAll('.ant-select-item-option')].find(e=>e.textContent==='涂画区域').click()`);await delay(150);await click('涂画修复区域');await wait(`document.querySelector('[aria-label="涂画修改区域画布"]')?.dataset.ready==='true'`);
      w.showInactive();await delay(200);const p=await js(`(()=>{const r=document.querySelector('[aria-label="涂画修改区域画布"]').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
      w.webContents.sendInputEvent({type:'mouseMove',...p});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await delay(100);await click('应用修改区域');
      await waitFor(async()=>!!(await node(id)).data.parameters.maskId,'mask save');await wait(`!document.querySelector('.cloud-mask-editor')`);check('watermark node stores painted mask binding',true);
    }
    if(operation==='gif'){
      const compiled=await run('canvas.compile',{id});check('MCP previews GIF ordered inputs and parameters',compiled.inputs.length===2&&compiled.settings.operation==='gif');
     await click('前移输入 2');check('GIF frame reorder persists',(await node(id)).data.inputOrder[0]===secondary);await click('后移输入 1');await capture('gif-settings');
    }
    await click('开始处理',`document.querySelector('[data-id="${id}"]')`);
    await waitFor(async()=>{const tasks=await js('tugou.tasks()'),t=tasks.filter(t=>t.context?.nodeId===id).at(-1);if(['failed','review'].includes(t?.status))throw Error(operation+': '+t.message);return !!(await node(id)).data.outputAssetId;},operation+' result');
    const n=await node(id),a=await asset(n.data.outputAssetId),output=await node('result-'+a.id);completed[operation]={id,asset:a};
    check(operation+' creates independent right-side output',output.position.x>n.position.x+320&&a.id!==original.id);
    if(operation==='split'){
      const parts=JSON.parse(fs.readFileSync(path.join(profile,'workspace/results',a.toolResult.taskId+'.json'))).assets;
      check('split publishes four separate right-side images',parts.length===4&&(await Promise.all(parts.map(a=>node('result-'+a.id)))).every(n=>n.position.x>400));
    }
    if(operation==='gif')check('GIF encodes ordered frames and individual delays',a.gif?.frames===2&&a.gif.delays.join(',')==='100,200');
    if(operation==='cloudExtend')check('AI extend preserves requested canvas dimensions',a.width===16&&a.height===14);
    if(operation==='crop')check('crop produces selected dimensions',a.width===4&&a.height===3);
   }
   const end=(await run('canvas.create',{type:'imageTool',sourceId:'mirror',position:{x:1300,y:0}})).id;
   await run('canvas.connect',{source:'result-'+completed.crop.asset.id,target:end});await run('image.processNode',{nodeId:end,requestId:'chain'});
   await waitFor(async()=>!!(await node(end)).data.outputAssetId,'chain');check('result image can feed another tool',(await asset((await node(end)).data.outputAssetId)).toolResult.sourceId===completed.crop.asset.id);
   await run('history.undo');check('result merge undoes in one step',!(await node(end)).data.outputAssetId);await run('history.redo');check('redo restores result',!!(await node(end)).data.outputAssetId);
   const direct=(await run('canvas.create',{type:'imageTool',sourceId:'mirror',position:{x:1800,y:0}})).id;await run('canvas.connect',{source:completed.resize.id,target:direct});
   await run('canvas.update',{id:completed.resize.id,properties:{parameters:{scale:4}}});await run('ui.navigate',{workspace:'canvas',nodeId:direct});
   check('changed upstream parameters prevent stale processing',await js(`document.querySelector('[data-id="${direct}"] button.ant-btn-primary').disabled`));
   check('original file remains byte-identical',fs.readFileSync(path.join(profile,'workspace/resources',original.resource)).equals(bytes));
   check('only AI extend calls mock image API',requests.length===1&&requests[0].mask);
   await run('ui.navigate',{workspace:'canvas',nodeId:completed.crop.id});w.unmaximize();w.setSize(960,720);await wait(`innerWidth<=960&&innerHeight<=720`);w.showInactive();await capture('crop-compact');
   check('compact inspector stays within viewport',await js(`(()=>{const e=document.querySelector('.canvas-tool-inspector'),r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth+1&&r.right<=innerWidth+1})()`));
   await delay(250);const layoutCount=report.layoutNotifications.length;await delay(500);check('layout settles without recurring observer notifications',report.layoutNotifications.length===layoutCount);check('no renderer exceptions',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require(entry);
