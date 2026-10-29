const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ProjectStore}=require('../core/storage.cjs'),{FontService}=require('../core/font-service.cjs'),{RequestJournal}=require('../core/automation-host.cjs'),{validate}=require('../core/automation-commands.cjs');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-removal-'));
  t.after(async()=>{assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(os.tmpdir()));assert.ok(path.basename(root).startsWith('tugou-removal-'));await fs.rm(root,{recursive:true,force:true});});
  const list=[],tasks={list:()=>list,completions:new Map()},store=new ProjectStore(root);await store.init();
  const fonts=new FontService(root,tasks),journal=new RequestJournal(path.join(root,'journal.json'));await journal.init();
  const run=(name,args)=>{validate('font.'+name,args);return fonts.execute('font.'+name,args,{journal});};
  return {root,tasks,list,store,fonts,run};
}
test('project deletion checks revisions/tasks, removes backups and retains other projects/resources',async t=>{
  const {root,store,list,tasks}=await fixture(t);let p=await store.create('删除测试');const other=await store.create('保留');
  p=await store.save(p.id,{...p.document,name:'已修改'},p.revision);
  await fs.writeFile(path.join(root,'resources','keep.txt'),'shared');
  await assert.rejects(store.remove(p.id,p.revision-1,tasks),/已更新/);
  list.push({id:'task',status:'running',context:{projectId:p.id}});await assert.rejects(store.remove(p.id,p.revision,tasks),/任务/);
  list[0].status='cancelled';tasks.completions.set('task',Promise.resolve());await assert.rejects(store.remove(p.id,p.revision,tasks),/任务/);tasks.completions.clear();
  await store.remove(p.id,p.revision,tasks);assert.deepEqual((await store.list()).map(p=>p.id),[other.id]);
  await assert.rejects(store.read(p.id),{code:'ENOENT'});await assert.rejects(store.save(p.id,p.document,p.revision),{code:'ENOENT'});
  assert.equal(await fs.readFile(path.join(root,'resources','keep.txt'),'utf8'),'shared');
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'deleted-projects',p.id,'project.json'))).revision,p.revision);
  assert.ok(await fs.stat(path.join(root,'deleted-projects',p.id,'project.json.bak')));
  await assert.rejects(store.remove('../outside',1,tasks),/无效/);
});
test('font unpublish, atlas removal and project deletion preserve existing resources and reject conflicts',async t=>{
  const {root,fonts,run,list,tasks}=await fixture(t);let p=await run('project.create',{name:'自定义',characters:'春A',requestId:'create'});
  p=await fonts.load(p.id);p.atlases=[{id:'atlas1'},{id:'atlas2'}];p.published={fontResource:{resource:'keep.ttf',jobId:'build1'}};p.current='source';p.covered='春';p.jobs=[{id:'job',taskId:'task'}];await fonts.save(p);
  await fs.writeFile(path.join(root,'resources','keep.ttf'),'font');
  const args=()=>({projectId:p.id,fontRevision:p.fontRevision,requestId:require('node:crypto').randomUUID()});
  await assert.rejects(run('project.delete',{...args(),fontRevision:99}),e=>e.code==='FONT_CONFLICT');
  list.push({id:'task',status:'queued'});for(const name of ['project.delete','unpublish','atlas.remove'])await assert.rejects(run(name,{...args(),...(name==='atlas.remove'?{atlasId:'atlas1'}:{})}),e=>e.code==='BUSY');
  list[0].status='cancelled';tasks.completions.set('task',Promise.resolve());await assert.rejects(run('project.delete',args()),e=>e.code==='BUSY');tasks.completions.clear();
  p=await run('unpublish',args());assert.equal(p.published,undefined);assert.equal(p.current,'source');assert.equal(p.covered,'春');
  p=await run('atlas.remove',{...args(),atlasId:'atlas1'});assert.deepEqual(p.atlases,[{id:'atlas2'}]);assert.equal(p.jobs.length,1);assert.equal(p.covered,'春');
  await assert.rejects(run('atlas.remove',{...args(),atlasId:'missing'}),e=>e.code==='NOT_FOUND');
  const deletion=args();assert.equal((await run('project.delete',deletion)).deleted,true);assert.equal((await run('project.delete',deletion)).deleted,true);
  assert.equal((await run('project.list',{})).projects.length,0);await assert.rejects(fonts.load(p.id),e=>e.code==='NOT_FOUND');
  assert.equal(await fs.readFile(path.join(root,'resources','keep.ttf'),'utf8'),'font');assert.ok(await fs.stat(path.join(root,'deleted-fonts',p.id,'project.json')));
  assert.throws(()=>validate('font.project.delete',{...deletion,path:'../outside'}));
});
