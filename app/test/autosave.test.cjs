const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createAutosave}=require('../core/autosave.cjs');
const {ProjectStore}=require('../core/storage.cjs');
const vm=require('node:vm');
const settle=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture(t,write){
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  const f={record:{id:'a',revision:1,document:{text:'initial'}},dirty:false,blocked:false,writes:[],states:[]};
  f.queue=createAutosave({read:()=>f.record,dirty:()=>f.dirty,snapshot:()=>f.record.document,blocked:()=>f.blocked,
    write:async(id,document,revision)=>{const request={id,document,revision};f.writes.push(request);return write?write(request):{id,document,revision:revision+1};},
    commit:(saved,unchanged)=>{f.record={...saved,document:f.record.document};if(unchanged)f.dirty=false;},
    status:(state,error)=>f.states.push({state,error})});
  f.edit=text=>{f.record={...f.record,document:{text}};f.dirty=true;f.queue.changed();};
  f.tick=async ms=>{t.mock.timers.tick(ms);await settle();};
  t.after(()=>f.queue.dispose());return f;
}
test('idle does not write; edits debounce for 500 ms without blocking the live document',async t=>{
  const f=fixture(t);await f.tick(5000);assert.equal(f.writes.length,0);
  f.edit('one');await f.tick(300);f.edit('two');assert.equal(f.record.document.text,'two');
  await f.tick(499);assert.equal(f.writes.length,0);await f.tick(1);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].document.text,'two');assert.equal(f.dirty,false);
});
test('continuous edits trigger a save at three seconds',async t=>{
  const f=fixture(t);f.edit('0');
  for(let i=1;i<=7;i++){await f.tick(400);f.edit(String(i));}
  await f.tick(199);assert.equal(f.writes.length,0);await f.tick(1);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].document.text,'7');
});
test('slow save preserves edits, document identity and queues the latest revision',async t=>{
  const first=deferred();let calls=0;
  const f=fixture(t,r=>++calls===1?first.promise:{...r,revision:r.revision+1});
  f.edit('first');await f.tick(500);f.edit('latest');const live=f.record.document;
  await f.tick(3000);assert.equal(f.writes.length,1);assert.equal(f.dirty,true);
  first.resolve({id:'a',document:{text:'first'},revision:2});await settle();
  assert.equal(f.record.document,live);assert.equal(f.dirty,true);assert.equal(f.record.revision,2);
  await f.tick(0);assert.equal(f.writes.length,2);assert.equal(f.writes[1].revision,2);
  assert.equal(f.writes[1].document,live);assert.equal(f.dirty,false);
});
test('manual and leave-page flushes join the same writer and drain edits without waiting 500 ms',async t=>{
  const first=deferred();let calls=0;
  const f=fixture(t,r=>++calls===1?first.promise:{...r,revision:r.revision+1});
  f.edit('one');await f.tick(500);f.edit('two');f.blocked=true;
  const manual=f.queue.flush(),leave=f.queue.flush();await settle();assert.equal(f.writes.length,1);
  first.resolve({id:'a',revision:2,document:{text:'one'}});await Promise.all([manual,leave]);
  assert.equal(f.writes.length,2);assert.equal(f.writes[1].document.text,'two');assert.equal(f.dirty,false);
});
test('save errors preserve dirty data, stop retry loops and allow explicit retry',async t=>{
  let fail=true;const f=fixture(t,r=>{if(fail)throw Error('disk full');return {...r,revision:r.revision+1};});
  f.edit('keep me');await f.tick(500);assert.equal(f.states.at(-1).state,'saveFailed');
  assert.equal(f.dirty,true);assert.equal(f.record.document.text,'keep me');
  await f.tick(10000);assert.equal(f.writes.length,1);
  await assert.rejects(f.queue.flush(),/disk full/);assert.equal(f.dirty,true);
  fail=false;await f.queue.flush();assert.equal(f.dirty,false);assert.equal(f.states.at(-1).state,'saved');
});
test('an edit after a failed save schedules another attempt',async t=>{
  let fail=true;const f=fixture(t,r=>{if(fail)throw Error('offline');return {...r,revision:r.revision+1};});
  f.edit('one');await f.tick(500);fail=false;f.edit('two');await f.tick(500);
  assert.equal(f.writes.length,2);assert.equal(f.dirty,false);
});
test('project switching cannot apply an old response to the new project',async t=>{
  const first=deferred(),f=fixture(t,()=>first.promise);f.edit('old');await f.tick(500);
  f.record={id:'b',revision:8,document:{text:'new project'}};f.dirty=false;f.queue.reset();
  first.resolve({id:'a',revision:2,document:{text:'old'}});await settle();
  assert.equal(f.record.id,'b');assert.equal(f.record.revision,8);assert.equal(f.record.document.text,'new project');
});
test('busy operations defer background saves and resume without losing the deadline',async t=>{
  const f=fixture(t);f.blocked=true;f.edit('one');await f.tick(500);assert.equal(f.writes.length,0);
  f.blocked=false;await f.tick(100);await f.tick(0);assert.equal(f.writes.length,1);
});
test('reset and disposal cancel scheduled writes',async t=>{
  const f=fixture(t);f.edit('one');f.queue.reset();f.dirty=false;await f.tick(3000);
  assert.equal(f.writes.length,0);f.edit('two');f.queue.dispose();await f.tick(3000);assert.equal(f.writes.length,0);
});
test('save after undo/redo persists the final document, not an earlier snapshot',async t=>{
  const f=fixture(t);f.edit('added');f.edit('undo');f.edit('redo');await f.queue.flush();
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].document.text,'redo');
});
test('real storage reopens the latest save and rejects external revision conflicts',async t=>{
  const temporary=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(temporary,'tugou-autosave-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new ProjectStore(root);await store.init();let record=await store.create('自动保存'),dirty=false,state;
  const queue=createAutosave({read:()=>record,dirty:()=>dirty,snapshot:()=>record.document,blocked:()=>false,
    write:(...args)=>store.save(...args),commit:(saved,unchanged)=>{record={...saved,document:record.document};if(unchanged)dirty=false;},status:s=>{state=s;}});
  t.after(()=>queue.dispose());
  record={...record,document:{...record.document,name:'已编辑',modules:[{id:'m',name:'提示词',kind:'text',text:'已保存内容'}]}};dirty=true;queue.changed();
  await queue.flush();const reopened=await store.read(record.id);
  assert.equal(reopened.document.name,'已编辑');assert.equal(reopened.document.modules[0].text,'已保存内容');assert.equal(dirty,false);
  const external=await store.save(record.id,{...record.document,name:'外部修改'},record.revision);
  record={...record,document:{...record.document,name:'本地保留'}};dirty=true;queue.changed();
  await assert.rejects(queue.flush(),/工程已更新/);
  assert.equal(state,'saveFailed');assert.equal(record.document.name,'本地保留');assert.equal(dirty,true);
  assert.equal((await store.read(record.id)).revision,external.revision);
  assert.equal((await store.read(record.id)).document.name,'外部修改');
});
test('renderer hook keeps live document identity, updates revisions and only refreshes the saved project summary',async t=>{
  const source=(await fs.readFile(path.join(__dirname,'../renderer/use-autosave.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function','function');
  const slots=[],effects=[];let cursor=0,hook,projects=[{id:'a',name:'old'},{id:'b',name:'untouched'}];
  const gate=deferred(),writes=[];
  const scope={createAutosave,window:{tugou:{save:async(id,document,revision)=>{writes.push({id,document,revision});if(writes.length===1)await gate.promise;return {id,document,revision:revision+1};}}},
    useRef:value=>{const i=cursor++;return slots[i]??=( {current:value} );},
    useState:value=>{const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=next;}];},
    useEffect:fn=>{const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}}};
  vm.runInNewContext(source+'\nthis.useAutosave=useAutosave;',scope);
  const c={present:{current:{id:'a',revision:1,document:{name:'first'}}},dirtyRef:{current:true},busyRef:{current:false},
    pageDocument:()=>c.present.current.document,markDirty:value=>{c.dirtyRef.current=value;if(value)hook.queue.changed();else hook.queue.reset();},
    setRecord:record=>{c.present.current=record;},setProjects:update=>{projects=update(projects);}};
  const render=()=>{cursor=0;hook=scope.useAutosave(c);};render();const cleanup=effects.map(fn=>fn());t.after(()=>cleanup.forEach(fn=>fn?.()));
  const flush=hook.queue.flush();await settle();
  const live={name:'typed while saving'};c.present.current={...c.present.current,document:live};c.markDirty(true);render();
  gate.resolve();await flush;render();
  assert.equal(c.present.current.document,live);assert.equal(c.present.current.revision,3);assert.equal(c.dirtyRef.current,false);
  assert.equal(writes[1].revision,2);assert.equal(writes[1].document,live);assert.equal(projects[0].name,live.name);assert.equal(projects[1].name,'untouched');
  assert.equal(hook.state,'saved');assert.equal(hook.error,'');
});
