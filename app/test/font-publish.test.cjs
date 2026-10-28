const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {FontService}=require('../core/font-service.cjs'),{RequestJournal}=require('../core/automation-host.cjs'),{hash}=require('../core/storage.cjs');
test('publication is explicit, revision checked, idempotent and preserves previous version on failure',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'font-publish-'));
  t.after(async()=>{assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(os.tmpdir()));assert.ok(path.basename(root).startsWith('font-publish-'));await fs.rm(root,{recursive:true,force:true});});
  const tasks=[],service=new FontService(root,{list:()=>tasks}),journal=new RequestJournal(path.join(root,'journal.json'));await journal.init();
  const run=(name,a={})=>service.execute('font.'+name,a,{journal});
  let p=await run('project.create',{name:'发布测试',characters:'A',requestId:'create'});
  p=await service.load(p.id);p.current='source1';p.covered='A';const bytes=Buffer.from([0,1,0,0,0,0,0,0,0,0,0,0]);
  async function job(sourceRevision){const id=randomUUID(),dir=path.join(root,'fonts',p.id,'jobs',id);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'font.ttf'),bytes);await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({artifacts:[{file:'font.ttf',mimeType:'font/ttf',sha256:hash(bytes)}]}));p.jobs.push({id,taskId:id,sourceRevision,operation:'build'});tasks.push({id,status:'completed'});await service.save(p);return id;}
  const first=await job('source1');assert.equal((await run('library')).custom.length,0);await assert.rejects(run('face',{projectId:p.id,jobId:first}),/先发布/);
  const args={projectId:p.id,fontRevision:p.fontRevision,requestId:'publish1',jobId:first};
  await run('publish',args);p=await service.load(p.id);assert.equal(p.published.fontResource.jobId,first);assert.equal((await run('library')).custom.length,1);assert.deepEqual((await run('publish',args)).published,p.published);
  await assert.rejects(run('publish',{...args,requestId:'stale'}),e=>e.code==='FONT_CONFLICT');
  const old=p.published;p.current='source2';await service.save(p);assert.deepEqual((await run('project.get',{projectId:p.id})).published,old);assert.equal((await run('library')).custom[0].jobId,first);
  await assert.rejects(run('publish',{...args,fontRevision:p.fontRevision,requestId:'old-source'}),e=>e.code==='FONT_CONFLICT');
  const second=await job('source2'),file=path.join(root,'fonts',p.id,'jobs',second,'font.ttf');await fs.writeFile(file,'corrupt');
  await assert.rejects(run('publish',{...args,fontRevision:p.fontRevision,jobId:second,requestId:'bad'}),/校验失败/);assert.deepEqual((await service.load(p.id)).published,old);
  tasks.find(t=>t.id===second).status='failed';await assert.rejects(run('publish',{...args,fontRevision:p.fontRevision,jobId:second,requestId:'failed'}),/先在字体工作台/);assert.deepEqual((await service.load(p.id)).published,old);tasks.find(t=>t.id===second).status='completed';
  await fs.writeFile(file,bytes);p=await run('publish',{...args,fontRevision:p.fontRevision,jobId:second,requestId:'publish2'});
  assert.equal((await run('library')).custom[0].jobId,second);assert.equal(p.published.sourceRevision,'source2');assert.deepEqual(await fs.readFile(path.join(root,'resources',old.fontResource.resource)),bytes);
});
