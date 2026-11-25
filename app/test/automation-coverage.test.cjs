const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {ConnectionStore}=require('../core/connection.cjs');
const {createDispatcher}=require('../core/automation-host.cjs');
const {batch,validate,listCommands}=require('../core/automation-commands.cjs');
async function fixture(t,services={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-mcp-coverage-'));
  t.after(async()=>{assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(os.tmpdir()));assert.ok(path.basename(root).startsWith('tugou-mcp-coverage-'));await fs.rm(root,{recursive:true,force:true});});
  const connections=new ConnectionStore(root,{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()});
  const state={revision:'r1',projectId:'project',document:{id:'project',name:'test',width:128,height:128,background:'#fff',modules:[],recipes:[],layers:[],assets:[{id:'image',kind:'image'}],jobs:[]}};
  let notifications=0;
  const dispatch=await createDispatcher({root,connections,ui:async action=>{if(action==='models.changed'){notifications++;return;}return structuredClone(state);},projects:{verifyResources:async()=>{}},...services});
  const run=async(command,args={})=>dispatch('run_command',{command,args,expectedRevision:'r1'});
  const model=async(command,args={})=>run(command,{settingsRevision:(await connections.listSuppliers()).revision,...args});
  return {root,connections,state,dispatch,run,model,notifications:()=>notifications};
}
async function setup(f){
  const p=await f.model('models.provider.create',{name:'供应商',baseUrl:'https://example.com/v1/'});
  const a=await f.model('models.key.create',{providerId:p.id,name:'Key A',apiKey:'secret-a'}),b=await f.model('models.key.create',{providerId:p.id,name:'Key B',apiKey:'secret-b'});
  for(const key of [a,b])await f.model('models.set',{id:key.id,models:[{id:'image-model',purposes:['image']},{id:'vision-model',purposes:['analysis']}]});
  await f.model('models.assign',{purpose:'image',keyId:a.id,modelId:'image-model'});await f.model('models.assign',{purpose:'analysis',keyId:b.id,modelId:'vision-model'});
  return {p,a,b};
}
test('MCP provider has one URL, independent Keys and explicit per-purpose models',async t=>{
  const f=await fixture(t),{p,a,b}=await setup(f),status=await f.run('models.status');
  assert.equal(status.providers[0].endpoints.length,1);assert.equal(status.connections.length,2);assert.equal(status.connections[0].baseUrl,'https://example.com/v1');
  assert.equal((await f.connections.readPrivate('image')).apiKey,'secret-a');assert.equal((await f.connections.readPrivate('analysis')).apiKey,'secret-b');
  assert.ok(!JSON.stringify(status).includes('secret-'));assert.equal(f.notifications(),7);
  await f.model('models.provider.update',{id:p.id,patch:{name:'改名'}});assert.equal((await f.connections.listSuppliers()).routes.image,a.id);
  const changed=await f.model('models.provider.update',{id:p.id,patch:{baseUrl:'https://other.example/v1'}});
  assert.deepEqual(changed.clearedPurposes,['image','analysis']);const next=await f.run('models.status');assert.ok(next.connections.every(c=>c.baseUrl==='https://other.example/v1'&&!c.models.length));
  await f.model('models.key.delete',{id:a.id});assert.equal((await f.run('models.status')).connections[0].id,b.id);
  await f.model('models.provider.delete',{id:p.id});assert.equal((await f.run('models.status')).connections.length,0);
});
test('MCP Key changes invalidate only its own models, preserve other credentials and do not journal secrets',async t=>{
  const f=await fixture(t),{a,b}=await setup(f);
  const result=await f.model('models.key.update',{id:a.id,patch:{apiKey:'replacement-secret'}});
  assert.deepEqual(result.clearedPurposes,['image']);assert.ok(!JSON.stringify(result).includes('replacement-secret'));assert.equal((await f.run('models.status')).routes.analysis,b.id);
  await f.model('models.key.update',{id:b.id,patch:{clearKey:true}});assert.equal((await f.run('models.status')).connections.find(c=>c.id===b.id).hasKey,false);
  await assert.rejects(fs.access(path.join(f.root,'mcp-requests.json')),e=>e.code==='ENOENT');
});
test('MCP stale configuration, invalid URL, invalid model route and credential fields reject without saving',async t=>{
  const f=await fixture(t),{p,a}=await setup(f),before=await fs.readFile(path.join(f.root,'connection.enc'));
  const invalid=[()=>f.run('models.provider.update',{id:p.id,patch:{name:'stale'},settingsRevision:0}),()=>f.model('models.provider.update',{id:p.id,patch:{baseUrl:'https://user:secret@example.com'}}),()=>f.model('models.assign',{purpose:'audio',keyId:a.id,modelId:'image-model'}),()=>f.model('models.assign',{purpose:'image',keyId:a.id}),()=>f.model('models.key.update',{id:a.id,patch:{apiKey:'\nsecret'}}),()=>f.model('models.key.update',{id:a.id,patch:{apiKey:'secret',clearKey:true}}),()=>f.model('models.key.update',{id:a.id,patch:{apiKey:'   '}})];
  for(const action of invalid){await assert.rejects(action);assert.deepEqual(await fs.readFile(path.join(f.root,'connection.enc')),before);}
  await f.model('models.set',{id:a.id,models:[]});assert.equal((await f.run('models.status')).routes.image,null);
});
test('MCP probes the specified saved Key, does not save fetched catalogs and rejects late results',async t=>{
  const f=await fixture(t),headers=[];let release,received;
  const server=http.createServer(async(req,res)=>{headers.push(req.headers.authorization);received?.();if(release)await release.promise;res.end(JSON.stringify({data:[{id:req.headers.authorization.endsWith('a')?'model-a':'model-b'}]}));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const p=await f.model('models.provider.create',{name:'fixture',baseUrl:`http://127.0.0.1:${server.address().port}/v1`});
  const a=await f.model('models.key.create',{providerId:p.id,name:'A',apiKey:'secret-a'}),b=await f.model('models.key.create',{providerId:p.id,name:'B',apiKey:'secret-b'});
  const revision=(await f.run('models.status')).revision;
  assert.deepEqual((await f.model('models.fetch',{id:a.id})).models,['model-a']);assert.deepEqual((await f.model('models.fetch',{id:b.id})).models,['model-b']);assert.equal((await f.model('models.test',{id:b.id})).models,undefined);
  assert.equal((await f.run('models.status')).revision,revision);assert.ok((await f.run('models.status')).connections.every(c=>!c.models.length));assert.deepEqual(headers,['Bearer secret-a','Bearer secret-b','Bearer secret-b']);
  const ready=new Promise(r=>{received=r;});release={};release.promise=new Promise(r=>{release.resolve=r;});
  const pending=f.model('models.fetch',{id:a.id});await ready;await f.model('models.key.update',{id:a.id,patch:{apiKey:'new-secret'}});release.resolve();await assert.rejects(pending,e=>e.code==='CONFIG_CONFLICT');
});
test('MCP retries use snapshots, deduplicate and reject tasks from other projects',async t=>{
  let count=0;const tasks=[{id:'w',status:'failed',context:{kind:'workflow',projectId:'project'}},{id:'other',status:'failed',context:{kind:'workflow',projectId:'other'}}];
  const f=await fixture(t,{tasks:{list:()=>tasks},workflow:{retry:async id=>{assert.equal(id,'w');count++;return {id:'retry'};}}});
  assert.equal((await f.run('task.retry',{id:'w',requestId:'once'})).taskId,'retry');assert.equal((await f.run('task.retry',{id:'w',requestId:'once'})).replayed,true);assert.equal(count,1);
  await assert.rejects(f.run('task.retry',{id:'other',requestId:'foreign'}),e=>e.code==='INVALID_TARGET');assert.equal(count,1);
});
test('MCP category and cloud batches preserve partial receipts and do not repeat paid work',async t=>{
  let count=0;const partial={ids:['submitted'],error:'partial'};
  const f=await fixture(t,{cloud:{startBatch:async()=>{count++;return {batchId:'batch',...partial}}},semantic:{generate:async()=>{count++;return partial},analyze:async()=>({id:'analysis'}),read:async(p,id)=>({projectId:p,id,categories:['人物']})}});
  const args={ids:['image'],requestId:'batch',settings:{operation:'cloudEnhance'}};
  assert.equal((await f.run('cloud.batch',args)).ids[0],'submitted');assert.equal((await f.run('cloud.batch',args)).replayed,true);
  assert.equal((await f.run('semantic.generate',{assetId:'image',plan:'人物\n背景',requestId:'split'})).error,'partial');assert.equal(count,2);
  await assert.rejects(f.run('semantic.generate',{assetId:'image',plan:'人物\n人物',requestId:'invalid'}));assert.equal(count,2);
  assert.equal((await f.run('semantic.analyze',{assetId:'image',requestId:'analyze'})).taskId,'analysis');assert.equal((await f.run('semantic.read',{id:'analysis'})).projectId,'project');
});
test('MCP unused asset deletion is undoable document data; referenced assets reject atomically',async()=>{
  const d={id:'p',name:'p',width:128,height:128,modules:[],recipes:[],assets:[{id:'a'},{id:'b'}],layers:[],jobs:[],tugouCanvas:{version:1,nodes:[{id:'n',type:'asset',position:{x:0,y:0},data:{assetId:'a',role:'参考'}}],edges:[],viewport:{x:0,y:0,zoom:1}}};
  assert.throws(()=>batch(d,[{name:'remove',command:'asset.delete',args:{ids:['b','a']}}]),e=>e.code==='IN_USE');assert.equal(d.assets.length,2);
  const result=batch(d,[{name:'remove',command:'asset.delete',args:{ids:['b']}}]);assert.deepEqual(result.document.assets,[{id:'a'}]);assert.equal(d.assets.length,2);
});
test('new commands have strict schemas and shared workflow fields are writable',()=>{
  assert.equal(listCommands().length,217);
  validate('image.processNode',{nodeId:'tool',requestId:'once'});
  validate('canvas.update',{id:'tool',properties:{parameters:{model:'anime',scale:2}}});
  assert.ok(!listCommands().some(c=>c.name==='models.cli.save'));
  assert.throws(()=>validate('models.key.create',{providerId:'a',name:'b',apiKey:'c',settingsRevision:0,endpointId:'extra'}));
  assert.throws(()=>validate('generation.angle',{nodeId:'a',assetId:'b',requestId:'r',params:{horizontalAngle:61}}));
  validate('canvas.update',{id:'n',properties:{camera:'近景',excludeUpstreamText:true,inputRoles:{start:'主体'}}});
  for(const [key,value] of Object.entries({instructions:'温柔',firstFrameId:'start',lastFrameId:'end',generateAudio:true,watermark:false,videoOptions:'{}'}))assert.throws(()=>validate('canvas.update',{id:'n',properties:{[key]:value}}));
});
test('coverage inventory accounts for every desktop business handler and names real commands',async()=>{
  const inventory=require('../../docs/engineering/mcp-coverage.json'),source=(await Promise.all(['desktop-main.cjs','core/font-desktop.cjs','core/settings-desktop.cjs'].map(file=>fs.readFile(path.join(__dirname,'..',file),'utf8')))).join('\n');
  const handlers=[...source.matchAll(/^\s*handle\('([^']+)'/gm)].map(m=>m[1]),mapped=inventory.ipc.flatMap(row=>row.handlers);
  assert.equal(new Set(mapped).size,mapped.length);assert.deepEqual(mapped.sort(),handlers.sort());
  const names=new Set(listCommands().map(c=>c.name));
  for(const row of [...inventory.ipc,...inventory.editor]){
    assert.ok(['covered','partial','missing','internal','uiOnly'].includes(row.status));
    for(const name of row.commands)assert.ok(names.has(name),name);
    if(row.source)await fs.access(path.join(__dirname,'../..',row.source));
  }
});

test('MCP brandKit, asset.star, artboard.dataMerge, canvas.matrix and exportSheet commands work end-to-end',async t=>{
  const pngMagic=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
  const f=await fixture(t,{
    filesRoot:null,
  });
  const filesRoot=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-mcp-sheets-'));
  t.after(()=>fs.rm(filesRoot,{recursive:true,force:true}));
  const boards=require('../core/artboards.cjs'),layers=require('../core/layers.cjs'),wf=require('../core/workflow-nodes.cjs');
  const created=boards.create({width:800,height:600,layers:[]},{width:800,height:600,name:'请柬模板'});
  const textLayer=layers.createLayer('text',{parentId:created.id,name:'称呼',text:'欢迎 {{姓名}} · {{桌号}}',x:40,y:40,width:400,height:60,fontSize:32,color:'#111111'});
  const gen=wf.workflowNode('image',{x:100,y:100});gen.id='g1';gen.data.prompt='唯美花艺';
  const live={
    revision:'r1',projectId:'project',
    document:{
      id:'project',name:'MCP新能力',width:800,height:600,background:'#ffffff',modules:[],recipes:[],jobs:[],
      assets:[{id:'a1',kind:'image',name:'图1',width:400,height:300},{id:'a2',kind:'image',name:'图2',width:400,height:300}],
      layers:[...created.document.layers,textLayer],
      tugouCanvas:{version:1,nodes:[{id:'n1',type:'asset',position:{x:0,y:0},data:{assetId:'a1',role:'参考图'}},gen],edges:[{id:'e1',source:'n1',target:'g1'}],viewport:{x:0,y:0,zoom:1}},
    },
  };
  let rev=1;
  const dispatch=await createDispatcher({
    root:f.root,filesRoot,connections:f.connections,projects:{verifyResources:async()=>{}},
    ui:async(action,args)=>{
      if(action==='snapshot')return structuredClone(live);
      if(action==='commit'){live.document=structuredClone(args.document);live.revision=`r${++rev}`;return structuredClone(live);}
      if(action==='artboard.exportSheet'||action==='asset.exportSheet'){return {mimeType:'image/png',data:pngMagic.toString('base64')};}
      return structuredClone(live);
    },
  });
  const run=(command,args={})=>dispatch('run_command',{command,args,expectedRevision:live.revision});

  // 1. Brand Kit get & update
  assert.deepEqual((await run('project.brandKit.get')).brandKit,{colors:[],headingFont:'',bodyFont:''});
  const updatedKit=await run('project.brandKit.update',{colors:[{hex:'#2563eb',name:'主题蓝'}],headingFont:'思源宋体'});
  assert.equal(updatedKit.brandKit.colors[0].hex,'#2563EB');
  assert.equal((await run('project.brandKit.get')).brandKit.headingFont,'思源宋体');

  // 2. Asset 0-5 star rating + asset.search(minRating/rating/sort) + query_objects rating summary
  await run('asset.rate',{ids:['a1'],rating:5});
  await run('asset.rate',{ids:['a2'],rating:3});
  const highRated=await run('asset.search',{minRating:4});
  assert.deepEqual(highRated.objects.map(a=>a.id),['a1']);
  const exactThree=await run('asset.search',{rating:3});
  assert.deepEqual(exactThree.objects.map(a=>a.id),['a2']);
  const sortedByRating=await run('asset.search',{sort:'rating'});
  assert.deepEqual(sortedByRating.objects.map(a=>a.id),['a1','a2']);
  const queried=await dispatch('query_objects',{kind:'asset'});
  assert.equal(queried.objects.find(a=>a.id==='a1').rating,5);
  assert.equal(queried.objects.find(a=>a.id==='a2').rating,3);
  assert.deepEqual(queried.objects.find(a=>a.id==='a1').workspaces,['canvas']);
  assert.deepEqual(queried.objects.find(a=>a.id==='a2').workspaces,[]);
  const canvasOnly=await run('asset.search',{workspace:'canvas'});
  assert.deepEqual(canvasOnly.objects.map(a=>a.id),['a1']);
  const unusedOnly=await run('asset.search',{workspace:'unused'});
  assert.deepEqual(unusedOnly.objects.map(a=>a.id),['a2']);

  // 3. Artboard Data Merge
  const merged=await run('artboard.dataMerge',{artboardId:created.id,rows:[{'姓名':'张三','桌号':'1号桌'},{'姓名':'李四','桌号':'2号桌'}]});
  assert.equal(merged.ids.length,2);
  const mergedTexts=live.document.layers.filter(l=>l.kind==='text').map(l=>l.text);
  assert.ok(mergedTexts.includes('欢迎 张三 · 1号桌'));
  assert.ok(mergedTexts.includes('欢迎 李四 · 2号桌'));

  // 4. Canvas Matrix expansion with inherited edges & bounds check
  const matrix=await run('canvas.matrix',{nodeId:'g1',variants:['水彩','胶片'],models:['model-a']});
  assert.equal(matrix.ids.length,2);
  assert.equal(live.document.tugouCanvas.edges.filter(e=>e.source==='n1').length,3);
  await assert.rejects(()=>run('canvas.matrix',{nodeId:'g1',variants:['单变体']}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>run('canvas.matrix',{nodeId:'n1',variants:['A','B']}),e=>e.code==='INVALID_TARGET');

  // 5. Contact Sheet exports (artboard & asset) with extension & overwrite guards
  const sheetRes=await run('artboard.exportSheet',{artboardIds:[created.id,...merged.ids],path:'review/boards.png',columns:3});
  assert.equal(sheetRes.bytes,pngMagic.length);
  const assetSheetRes=await run('asset.exportSheet',{assetIds:['a1','a2'],path:'review/assets.png',theme:'dark'});
  assert.equal(assetSheetRes.bytes,pngMagic.length);
  await assert.rejects(()=>run('asset.exportSheet',{assetIds:['a1'],path:'review/assets.jpg'}),e=>e.code==='INVALID_ARGUMENT');
  await assert.rejects(()=>run('asset.exportSheet',{assetIds:['a1'],path:'review/assets.png'}),e=>e.code==='EEXIST');
});

