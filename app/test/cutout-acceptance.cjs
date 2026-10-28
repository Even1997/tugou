const {app,nativeImage}=require('electron'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {ProjectStore,hash}=require('../core/storage.cjs'),{TaskQueue}=require('../core/tasks.cjs');
const {LocalAIService}=require('../core/local-ai.cjs'),{ImageTaskService}=require('../core/image-tasks.cjs');
const {GenerationService,saveImage}=require('../core/generation.cjs');
const {decode}=require('../core/cloud-pixels.cjs');
const base=require('./qa-paths.cjs').path("local-final"),report={checks:[],metrics:[],outputs:[]};let tasks;
app.setPath('userData',path.join(base,'cutout-shell'));
async function main(){
  await fs.mkdir(base,{recursive:true});
  const profile=await fs.mkdtemp(path.join(base,'cutout-'));report.profile=profile;
  const store=new ProjectStore(path.join(profile,'workspace'));await store.init();
  tasks=new TaskQueue(store.root);await tasks.init();
  const engine=new LocalAIService(store),inspect=b=>nativeImage.createFromBuffer(b).getSize();
  const installed=JSON.parse(await fs.readFile(path.resolve(__dirname,'../test-results/installer-native.json'),'utf8'));
  report.runtime=await engine.configure(installed.runtime.folder);
  assert.ok(report.runtime.cutout);report.checks.push('pinned model and managed Python probe');
  const service=new ImageTaskService(store,tasks,inspect,null,engine),r=await store.create('真实主体抠图验收'),assets=[];
  for(const name of ['white','pattern','transparent'])assets.push({id:name,name,...await saveImage(store.root,await fs.readFile(path.resolve(__dirname,'../test-results/local-ai-fixtures',name+'.png')),inspect)});
  const document={...r.document,assets,futureCutout:{keep:true}};await store.save(r.id,document,r.revision);
  const start=Date.now(),batch=await service.start(r.id,document,['white','pattern'],{operation:'cutout'});
  await tasks.execution;report.batchMs=Date.now()-start;report.tasks=tasks.list();
  const entry=tasks.tasks.find(t=>t.id===batch.id);
  if(entry.status==='failed'&&entry.message.includes('可用内存不足')){
    report.blocked=entry.message;
    assert.equal((await fs.readdir(path.join(store.root,'local-jobs'))).length,0);
    const generation=new GenerationService(store,{},tasks,inspect);
    assert.equal((await generation.results(r.id)).length,0);
    report.checks.push('memory gate rejects before inference and publishes no partial batch','owned temporary job files cleaned');
    return;
  }
  assert.equal(entry.status,'completed',entry.message);report.checks.push('real two-image model batch completed');
  const transparent=await service.start(r.id,document,['transparent'],{operation:'cutout'});await tasks.execution;
  assert.equal(tasks.tasks.find(t=>t.id===transparent.id).status,'completed');
  const results=[];for(const id of [batch.id,transparent.id])results.push(...JSON.parse(await fs.readFile(path.join(store.root,'results',id+'.json'))).assets);
  const truth=await decode(await fs.readFile(path.join(store.root,'resources',assets[2].resource)));
  for(const output of results){
    const source=assets.find(a=>a.id===output.toolResult.sourceId),a=await decode(await fs.readFile(path.join(store.root,'resources',source.resource))),b=await decode(await fs.readFile(path.join(store.root,'resources',output.resource)));
    assert.equal(b.width,a.width);assert.equal(b.height,a.height);
    let union=0,intersection=0,solid=0,lost=0,background=0,leaked=0,soft=0;
    for(let i=0;i<a.data.length;i+=4){
      assert.equal(b.data[i],a.data[i]);assert.equal(b.data[i+1],a.data[i+1]);assert.equal(b.data[i+2],a.data[i+2]);assert.ok(b.data[i+3]<=a.data[i+3]);
      const t=truth.data[i+3],v=b.data[i+3];if(t>127||v>127)union++;if(t>127&&v>127)intersection++;
      if(t>250){solid++;if(v<128)lost++;}if(t===0){background++;if(v>127)leaked++;}if(v>0&&v<255)soft++;
    }
    const metrics={name:source.id,iou:intersection/union,solidLoss:lost/solid,backgroundLeak:leaked/background,softPixels:soft};report.metrics.push(metrics);
    const outputPath=path.join(base,'cutout-'+source.id+'.png');await fs.copyFile(path.join(store.root,'resources',output.resource),outputPath);report.outputs.push({path:outputPath,...output});
    assert.ok(metrics.iou>.90&&metrics.solidLoss<.05&&metrics.backgroundLeak<.05,'subject quality '+JSON.stringify(metrics));
    report.checks.push(source.id+': original RGB/alpha and dimensions preserved; subject coverage and background rejection');
  }
  assert.equal(hash(await fs.readFile(path.join(store.root,'resources',assets[0].resource))),assets[0].resource.split('.')[0]);
  const cancel=await service.start(r.id,document,['white','pattern'],{operation:'cutout'});
  for(let i=0;i<300&&!tasks.tasks.find(t=>t.id===cancel.id).message?.includes('加载');i++)await new Promise(r=>setTimeout(r,20));
  const at=Date.now();await tasks.cancel(cancel.id);await tasks.execution;report.cancelMs=Date.now()-at;
  assert.equal(tasks.tasks.find(t=>t.id===cancel.id).status,'cancelled');
  const generation=new GenerationService(store,{},tasks,inspect);assert.equal((await generation.results(r.id)).length,2);
  assert.equal((await fs.readdir(path.join(store.root,'local-jobs'))).length,0);
  report.checks.push('running model cancellation stops and publishes no batch','source bytes retained and temporary jobs cleaned');
  await tasks.shutdown();const restored=new TaskQueue(store.root);await restored.init();
  assert.equal(restored.tasks.find(t=>t.id===cancel.id).status,'cancelled');
  assert.equal((await store.read(r.id)).document.futureCutout.keep,true);
  report.checks.push('restart retains task state, source data and unknown fields without inference');
}
app.whenReady().then(main).catch(e=>{report.failure=e.stack}).finally(async()=>{if(tasks){await tasks.shutdown();report.tasks=tasks.list()};await fs.mkdir(base,{recursive:true});await fs.writeFile(path.join(base,'cutout-native.json'),JSON.stringify(report,null,2));app.exit(report.failure?1:report.blocked?2:0)});
