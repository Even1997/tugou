const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const sharp=require('sharp');
const out=path.resolve(process.env.TUGOU_TEST_OUTPUT||'test-results/comprehensive-mcp'),kind=process.env.TUGOU_TEST_APP?'packaged':'source';fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;
if(!process.env.TUGOU_TEST_APP)process.env.TUGOU_BUILD_DIR=path.join(out,'build');else delete process.env.TUGOU_BUILD_DIR;
const report={checks:[],errors:[],profile},sleep=ms=>new Promise(r=>setTimeout(r,ms));let client,transport,ended=false,paid=0,mainWindow,fixtureDelay=700,generationGate;
const server=http.createServer(async(req,res)=>{
 const chunks=[];for await(const chunk of req)chunks.push(chunk);
 if(req.url.endsWith('/models'))res.end(JSON.stringify({data:[{id:'fixture-image'},{id:'fixture-analysis'}]}));
 else if(req.url.endsWith('/images/generations')||req.url.endsWith('/images/edits')){paid++;await generationGate;await sleep(fixtureDelay);res.end(JSON.stringify({data:[{b64_json:report.fixture}]}));}
 else if(req.url.endsWith('/chat/completions')){
  const body=JSON.parse(Buffer.concat(chunks).toString()),semantic=body.messages?.[0]?.content?.includes('可分别提取');
  res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(semantic?{categories:['人物','背景']}:{summary:'验收图片',modules:[{name:'画风',kind:'style',text:'简洁配色'}],uncertainties:[]})}}]}));
 }else{res.statusCode=404;res.end();}
});
const finish=code=>{if(ended)return;ended=true;delete report.fixture;fs.writeFileSync(path.join(out,kind+'.json'),JSON.stringify(report,null,2));transport?.close();server.closeAllConnections();server.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);if(mainWindow)return;mainWindow=w;w.webContents.on('render-process-gone',(_,details)=>{report.failure=details;finish(1);});w.webContents.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);});w.webContents.once('did-finish-load',async()=>{
 const js=s=>w.webContents.executeJavaScript(s,true),check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
 const shot=async name=>{await w.capturePage();await sleep(120);fs.writeFileSync(path.join(out,kind+'-'+name+'.png'),(await w.capturePage()).toPNG());};
 try{
  await require('./automation-session-checks.cjs').prepare({profile,js,check,sleep});
  const descriptor=path.join(profile,'mcp-session.json');for(let i=0;!fs.existsSync(descriptor)&&i<100;i++)await sleep(50);assert.ok(fs.existsSync(descriptor));
  const invalid=path.join(profile,'invalid-session.json'),descriptorValue=JSON.parse(fs.readFileSync(descriptor));fs.writeFileSync(invalid,JSON.stringify({...descriptorValue,token:'0'.repeat(64)}));
  const rejected=await require('../core/mcp.cjs').bridge(invalid,'get_state',{});check('invalid bridge credential is refused',!rejected.ok&&rejected.error.code==='UNAUTHORIZED');
  const script=process.env.TUGOU_TEST_APP?path.join(path.dirname(process.env.TUGOU_TEST_APP),'core','mcp.cjs'):path.resolve('core/mcp.cjs');
  transport=new StdioClientTransport({command:process.env.TUGOU_MCP_BINARY||process.execPath,args:[script,'--session',descriptor],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
  let stderr='';transport.stderr.on('data',b=>{stderr+=b;report.stderr=stderr;});client=new Client({name:'tugou-acceptance',version:'1.0.0'});await client.connect(transport);
  const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r;};
  const value=async(name,args={})=>(await call(name,args)).structuredContent;
  const state=()=>value('get_state');
  const run=async(command,args={})=>{
   for(let attempt=0;;attempt++)try{return await value('run_command',{command,args,expectedRevision:(await state()).revision});}
   catch(error){let code;try{code=JSON.parse(error.message).code;}catch{}if(code!=='CONFLICT'||attempt>=2)throw error;
    // Background task results can advance the live document after get_state. Only explicit non-commits are retried.
    report.revisionRetries=(report.revisionRetries||0)+1;
   }
  };
  const query=(kind)=>value('query_objects',{kind,limit:100});
  const object=async(kind,id)=>(await value('get_object',{kind,id})).object;
  const batch=async steps=>value('batch',{expectedRevision:(await state()).revision,steps});
  const step=(name,command,args={})=>({name,command,args}),ref=name=>({$ref:name+'.id'});
  await run('project.save');
  const summary=await value('list_commands'),full=await value('list_commands',{schemas:true});report.discoverySummaryBytes=Buffer.byteLength(JSON.stringify(summary));report.discoveryFullBytes=Buffer.byteLength(JSON.stringify(full));
  check('compact discovery retains all commands with fewer schema tokens',summary.total===135&&!summary.commands[0].inputSchema&&report.discoverySummaryBytes<report.discoveryFullBytes/2);
  const focused=await value('list_commands',{domain:'scene.camera',search:'activate',schemas:true});check('command search returns focused schema on demand',focused.commands.length===1&&focused.commands[0].name==='scene.camera.activate'&&!!focused.commands[0].inputSchema);
  check('SDK initializes actual stdio MCP and discovers tools',(await client.listTools()).tools.length===7);
  check('resources and task templates discoverable',(await client.listResources()).resources.length===2&&(await client.listPrompts()).prompts.length===3);
  const started=Date.now();await state();report.stateLatencyMs=Date.now()-started;
  const created=await run('project.create',{name:'MCP 实机验收'});check('creates project in live window',created.projectId&&created.name==='MCP 实机验收');
  const initial=await state(),setup=await batch([
   step('board','artboard.create',{name:'测试画板',width:128,height:128}),
   step('shape','layer.create',{artboardId:ref('board'),kind:'shape',properties:{x:16,y:16,width:96,height:96,color:'#ff0000'}}),
   step('mask','mask.create',{id:ref('shape')}),
   step('text','canvas.create',{type:'text',position:{x:0,y:0},properties:{text:'一只小猫'}}),
   step('desk','canvas.create',{type:'config',position:{x:350,y:0},properties:{size:'64x64'}}),
   step('edge','canvas.connect',{source:ref('text'),target:ref('desk')})]);
  const board=setup.results.board.id,shape=setup.results.shape.id,desk=setup.results.desk.id;
  check('batch creates graph and board with one undo',setup.history.undo===initial.history.undo+1&&setup.counts.edges===1);
  await run('workspace.show',{workspace:'canvas'});await sleep(500);check('live canvas reflects MCP nodes',await js('[...document.querySelectorAll(".node-text")].some(t=>t.textContent==="一只小猫")'));
  const before=await state();await assert.rejects(()=>batch([step('rename','project.rename',{name:'不应写入'}),step('bad','layer.update',{id:'missing',patch:{x:100}})]));check('failed batch leaves live document and history intact',(await state()).revision===before.revision);
  const stale=await client.callTool({name:'run_command',arguments:{command:'project.rename',args:{name:'过期修改'},expectedRevision:initial.revision}});check('stale revision rejected',stale.isError&&stale.content[0].text.includes('CONFLICT'));
  await run('history.undo');check('UI history undoes whole batch',(await query('canvasNode')).total===0);await run('history.redo');check('UI history redoes whole batch',(await query('canvasNode')).total===2);
  await sleep(150);await js(`document.querySelector('.node-text').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`);await sleep(100);
  await js(`(()=>{const input=document.querySelector('.node-text-editor');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'用户未保存的修改');input.dispatchEvent(new Event('input',{bubbles:true}));input.blur();})()`);await sleep(200);
  check('MCP reads unsaved manual text edits',(await object('canvasNode',setup.results.text.id)).data.text==='用户未保存的修改');
  await run('layer.update',{id:shape,patch:{name:'蒙版测试形状'}});check('MCP preserves manual edits in another module',(await object('canvasNode',setup.results.text.id)).data.text==='用户未保存的修改');
  await run('selection.rectangle',{artboardId:board,x:16,y:16,width:48,height:96});await run('mask.fill',{id:shape,mode:'hide'});await run('selection.clear',{artboardId:board});
  const masked=await object('layer',shape);check('mask fill changes only mask bitmap',masked.mask.bitmap?.resource&&!masked.bitmap&&masked.color==='#ff0000');
  const png=await call('preview',{artboardId:board,maxSize:128});const image=png.content.find(c=>c.type==='image');fs.writeFileSync(path.join(out,kind+'-masked.png'),Buffer.from(image.data,'base64'));
  const pixels=await sharp(Buffer.from(image.data,'base64')).ensureAlpha().raw().toBuffer(),at=(x,y)=>[...pixels.subarray((y*128+x)*4,(y*128+x)*4+4)];
  check('mask actually hides selected pixels and preserves unselected red',at(32,60)[1]===255&&at(90,60)[0]===255&&at(90,60)[1]===0);
  const maskPng=await call('preview',{artboardId:board,id:shape,mode:'mask',maxSize:128});check('black-white mask preview returns image',maskPng.content.some(c=>c.type==='image'));
  await run('mask.loadSelection',{id:shape});check('mask loaded as artboard selection',!!(await object('artboard',board)).selection.bitmap);
  await run('history.undo');check('pixel edit uses same undo history',!(await object('artboard',board)).selection);
  const originalMask=(await object('layer',shape)).mask.bitmap.resource;
  await run('paint.stroke',{id:shape,target:'mask',maskMode:'reveal',points:[{x:30,y:30},{x:30,y:80}],size:20,hardness:100});
  check('brush uses shared mask engine without painting image',(await object('layer',shape)).mask.bitmap.resource!==originalMask&&!(await object('layer',shape)).bitmap);
  await run('history.undo');
  const oversized=await run('layer.create',{artboardId:board,kind:'shape',properties:{width:100000,height:100000}});
  await run('mask.create',{id:oversized.id});await run('selection.rectangle',{artboardId:board,x:0,y:0,width:32,height:32});
  const budgetBefore=await state();
  for(const [command,args] of [['mask.fill',{id:oversized.id,mode:'hide'}],['paint.stroke',{id:oversized.id,target:'mask',points:[{x:1,y:1}],size:10}]]){
    await assert.rejects(()=>run(command,args),/RESOURCE_LIMIT/);
    const after=await state();check(command+' rejects oversized target without changing document or undo',after.revision===budgetBefore.revision&&after.history.undo===budgetBefore.history.undo);
  }
  await run('history.undo');await run('history.undo');await run('history.undo');
  await run('layer.effects',{id:shape,effects:[{type:'shadow',distance:2,radius:2}]});check('layer effects are validated and editable',(await object('layer',shape)).effects[0].type==='shadow');await run('history.undo');
  const adj=await run('layer.adjustment',{artboardId:board,adjustment:{type:'brightnessContrast',brightness:10}});check('adjustment creates real engine layer',(await object('layer',adj.id)).kind==='adjustment');await run('history.undo');
  await run('artboard.export',{artboardId:board,path:'result.png'});check('export stays within session root',fs.existsSync(path.join(profile,'automation','result.png')));
  await assert.rejects(()=>run('artboard.export',{artboardId:board,path:'../escape.png'}));check('export traversal denied',!fs.existsSync(path.join(profile,'escape.png')));
  await assert.rejects(()=>run('artboard.export',{artboardId:board,path:'result.png'}));check('export does not overwrite existing files',true);
  const imported=await run('asset.import',{path:'result.png'});check('asset imported into live project',imported.ids.length===1);
  const picture=await run('layer.create',{artboardId:board,kind:'image',properties:{assetId:imported.ids[0],x:0,y:0,width:16,height:16}});
  const assetPreview=await call('run_command',{command:'asset.preview',args:{id:imported.ids[0],maxSize:64}});check('asset thumbnail returns native MCP image',assetPreview.content.some(c=>c.type==='image'));
  const processed=await run('image.process',{ids:imported.ids,settings:{operation:'mirror'},requestId:'local-mirror'});await run('task.wait',{id:processed.taskId,timeoutMs:10000});check('local image processing completes through existing task queue',(await run('task.get',{id:processed.taskId})).status==='completed');await sleep(1500);
  const subject=await client.callTool({name:'run_command',arguments:{command:'selection.subject',args:{id:picture.id,requestId:'subject'},expectedRevision:(await state()).revision}});check('AI subject selection reports missing runtime before creating task',subject.isError&&subject.content[0].text.includes('NOT_READY'));
  await run('workspace.show',{workspace:'layers',layerIds:[shape]});await sleep(200);await shot('layers');
  const unsafe=await client.callTool({name:'run_command',arguments:{command:'project.open',args:{id:created.projectId},expectedRevision:(await state()).revision}});check('unsaved project cannot be silently discarded',unsafe.isError&&unsafe.content[0].text.includes('UNSAVED_CHANGES'));
  await run('project.save');check('save clears dirty and uses actual disk revision',!(await state()).dirty);await run('project.open',{id:created.projectId});check('saved mask survives reopen',!!(await object('layer',shape)).mask.bitmap);
  report.fixture=(await sharp({create:{width:64,height:64,channels:4,background:'#00cc88'}}).png().toBuffer()).toString('base64');await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await js(`tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'fixture-secret-do-not-return',model:'fixture',analysisModel:'fixture-analysis'})`);
  const models=await run('models.status');check('model status never returns Key',!JSON.stringify(models).includes('fixture-secret-do-not-return'));
  let releaseGeneration;generationGate=new Promise(resolve=>{releaseGeneration=resolve;});
  const task=await run('generation.start',{nodeId:desk,requestId:'stable-request'});const duplicate=await run('generation.start',{nodeId:desk,requestId:'stable-request'});
  check('duplicate request returns same task',task.taskId===duplicate.taskId&&duplicate.replayed);
  const progress=[],waited=await client.callTool({name:'run_command',arguments:{command:'task.wait',args:{id:task.taskId,timeoutMs:10000}}},undefined,{onprogress:p=>{progress.push(p);if(p.message.includes('等待模型返回'))releaseGeneration();}});generationGate=undefined;report.generationProgress=progress;
  // SDK may remove the progress handler when a final reply shares its input chunk with the last notification.
  // The final tool result is authoritative for completion; intermediate notifications must still arrive.
  check('standard MCP reports running progress and returns terminal state',progress.some(p=>p.message.includes('等待模型返回'))&&!waited.isError&&waited.structuredContent.task.status==='completed'&&!waited.structuredContent.timedOut&&progress.every((p,i)=>p.total===undefined&&(!i||p.progress>progress[i-1].progress)));
  await sleep(1600);check('exactly one provider request',paid===1);
  check('generation completion is visible through MCP',(await run('task.get',{id:task.taskId})).status==='completed');
  const nodes=(await query('canvasNode')).objects;check('generated result becomes a separate linked node',nodes.length===3&&(await query('edge')).total===2);
  fixtureDelay=3000;const cancelled=await run('generation.start',{nodeId:desk,requestId:'cancel-request'});await require('./automation-session-checks.cjs').waits({client,script,descriptor,taskId:cancelled.taskId,check});fixtureDelay=700;check('task can be cancelled via MCP',(await run('task.get',{id:cancelled.taskId})).status==='cancelled');
  const analyzed=await run('analysis.start',{assetId:imported.ids[0],instruction:'分析',requestId:'analysis-request'});await run('task.wait',{id:analyzed.taskId,timeoutMs:10000});
  const drafts=await run('analysis.results');check('visual analysis results can be inspected',drafts.drafts[0]?.modules[0]?.text==='简洁配色');
  await run('analysis.apply',{id:analyzed.taskId,createRecipe:true});check('analysis imports editable prompts and recipe',(await query('prompt')).total===1&&(await query('recipe')).total===1);await run('history.undo');
  const cloud=await run('cloud.process',{assetId:imported.ids[0],requestId:'cloud-request',settings:{operation:'cloudEnhance'}});await run('task.wait',{id:cloud.taskId,timeoutMs:10000});
  const review=await run('cloud.review',{id:cloud.taskId});check('cloud result can be reviewed without requesting again',review.asset?.resource&&review.job?.source?.id===imported.ids[0]);
  const callsBeforeResolve=paid,resolved=await run('cloud.resolve',{id:cloud.taskId,action:'keepRaw'});await run('task.wait',{id:resolved.taskId,timeoutMs:10000});check('cloud review resolution reuses returned image',paid===callsBeforeResolve&&(await run('task.get',{id:resolved.taskId})).status==='completed');await sleep(1400);
  const largeStart=Date.now();await batch(Array.from({length:100},(_,i)=>step('text'+i,'canvas.create',{type:'text',position:{x:i*10,y:900},properties:{text:'批量 '+i}})));report.batch100Ms=Date.now()-largeStart;
  const page=await value('query_objects',{kind:'canvasNode',limit:20});check('large canvas query is paginated',page.objects.length===20&&page.nextOffset===20&&page.total>=103);await run('history.undo');
  await run('workspace.show',{workspace:'canvas'});await sleep(250);await shot('canvas');
  await require('./automation-scene-checks.cjs')({call,value,state,run,query,object,batch,step,ref,check,report,out,kind,profile,js,shot,sleep});
  await require('./automation-coverage-checks.cjs')({call,value,state,run,query,object,batch,step,ref,check,report,out,kind,profile,js,shot,sleep,fixtureUrl:`http://127.0.0.1:${server.address().port}/v1`,setFixtureDelay:ms=>{fixtureDelay=ms;}});
  check('all real operations left hidden test window hidden',!w.isVisible());
  report.stderr=stderr;report.commands=(await value('list_commands',{schemas:false})).commands.length;
  await client.close();finish(0);
 }catch(e){report.failure=e.stack;report.text=await js('document.body.innerText').catch(()=>null);await shot('failure').catch(()=>{});finish(1);}
});});
require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');

