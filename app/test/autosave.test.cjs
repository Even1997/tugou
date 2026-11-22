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
  f.edit=(text,autoSave=true)=>{f.record={...f.record,document:{text}};f.dirty=true;f.queue.changed(autoSave);};
  f.tick=async ms=>{t.mock.timers.tick(ms);await settle();};
  t.after(()=>f.queue.dispose());return f;
}
test('idle does not write; edits debounce for 1500 ms without blocking the live document',async t=>{
  const f=fixture(t);await f.tick(5000);assert.equal(f.writes.length,0);
  f.edit('one');await f.tick(300);f.edit('two');assert.equal(f.record.document.text,'two');
  await f.tick(1499);assert.equal(f.writes.length,0);await f.tick(1);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].document.text,'two');assert.equal(f.dirty,false);
});
test('continuous edits produce three writes in thirty seconds',async t=>{
  const f=fixture(t);
  for(let i=0;i<60;i++){f.edit(String(i));await f.tick(500);}
  assert.deepEqual(f.writes.map(r=>r.document.text),['19','39','59']);
});
test('separate editing bursts are still subject to the ten-second interval',async t=>{
  const f=fixture(t);f.edit('first');await f.tick(1500);f.edit('second');
  await f.tick(9999);assert.equal(f.writes.length,1);
  await f.tick(1);assert.equal(f.writes.length,2);assert.equal(f.writes[1].document.text,'second');
});
test('slow save preserves edits, document identity and queues the latest revision',async t=>{
  const first=deferred();let calls=0;
  const f=fixture(t,r=>++calls===1?first.promise:{...r,revision:r.revision+1});
  f.edit('first');await f.tick(1500);f.edit('latest');const live=f.record.document;
  await f.tick(3000);assert.equal(f.writes.length,1);assert.equal(f.dirty,true);
  first.resolve({id:'a',document:{text:'first'},revision:2});await settle();
  assert.equal(f.record.document,live);assert.equal(f.dirty,true);assert.equal(f.record.revision,2);
  await f.tick(6999);assert.equal(f.writes.length,1);
  await f.tick(1);assert.equal(f.writes.length,2);assert.equal(f.writes[1].revision,2);
  assert.equal(f.writes[1].document,live);assert.equal(f.dirty,false);
});
test('dragging during a save stays dirty without starting another background write',async t=>{
  const first=deferred(),f=fixture(t,r=>r.revision===1?first.promise:{...r,revision:r.revision+1});
  f.edit('before drag');await f.tick(1500);f.edit('after drag',false);
  first.resolve({id:'a',revision:2,document:{text:'before drag'}});await settle();
  await f.tick(30000);assert.equal(f.writes.length,1);assert.equal(f.dirty,true);
  await f.queue.flush();assert.equal(f.writes.length,2);assert.equal(f.writes[1].document.text,'after drag');assert.equal(f.dirty,false);
});
test('manual and leave-page flushes join the same writer and bypass the interval',async t=>{
  const first=deferred();let calls=0;
  const f=fixture(t,r=>++calls===1?first.promise:{...r,revision:r.revision+1});
  f.edit('one');await f.tick(1500);f.edit('two',false);f.blocked=true;
  const manual=f.queue.flush(),leave=f.queue.flush();await settle();assert.equal(f.writes.length,1);
  first.resolve({id:'a',revision:2,document:{text:'one'}});await Promise.all([manual,leave]);
  assert.equal(f.writes.length,2);assert.equal(f.writes[1].document.text,'two');assert.equal(f.dirty,false);
});
test('save errors preserve dirty data, stop retry loops and allow explicit retry',async t=>{
  let fail=true;const f=fixture(t,r=>{if(fail)throw Error('disk full');return {...r,revision:r.revision+1};});
  f.edit('keep me');await f.tick(1500);assert.equal(f.states.at(-1).state,'saveFailed');
  assert.equal(f.dirty,true);assert.equal(f.record.document.text,'keep me');
  f.edit('keep me after drag',false);assert.equal(f.states.at(-1).state,'saveFailed');
  await f.tick(10000);assert.equal(f.writes.length,1);
  await assert.rejects(f.queue.flush(),/disk full/);assert.equal(f.dirty,true);assert.equal(f.record.document.text,'keep me after drag');
  fail=false;await f.queue.flush();assert.equal(f.dirty,false);assert.equal(f.states.at(-1).state,'saved');
});
test('an edit after a failed save schedules another attempt',async t=>{
  let fail=true;const f=fixture(t,r=>{if(fail)throw Error('offline');return {...r,revision:r.revision+1};});
  f.edit('one');await f.tick(1500);fail=false;f.edit('two');await f.tick(10000);
  assert.equal(f.writes.length,2);assert.equal(f.dirty,false);
});
test('project switching cannot apply an old response to the new project',async t=>{
  const first=deferred(),f=fixture(t,()=>first.promise);f.edit('old');await f.tick(1500);
  f.record={id:'b',revision:8,document:{text:'new project'}};f.dirty=false;f.queue.reset();
  first.resolve({id:'a',revision:2,document:{text:'old'}});await settle();
  assert.equal(f.record.id,'b');assert.equal(f.record.revision,8);assert.equal(f.record.document.text,'new project');
});
test('busy operations defer background saves and resume without losing the deadline',async t=>{
  const f=fixture(t);f.blocked=true;f.edit('one');await f.tick(1500);assert.equal(f.writes.length,0);
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
test('drag alone skips automatic writes; explicit flush persists its position and preserves revision checks',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  const temporary=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(temporary,'tugou-autosave-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new ProjectStore(root);await store.init();let record=await store.create('自动保存'),dirty=false,state;
  const queue=createAutosave({read:()=>record,dirty:()=>dirty,snapshot:()=>record.document,blocked:()=>false,
    write:(...args)=>store.save(...args),commit:(saved,unchanged)=>{record={...saved,document:record.document};if(unchanged)dirty=false;},status:s=>{state=s;}});
  t.after(()=>queue.dispose());
  const initial={...record.document,tugouCanvas:{version:1,nodes:[{id:'n',type:'text',position:{x:0,y:0},data:{name:'节点',text:'内容'}}],edges:[],viewport:{x:0,y:0,zoom:1}}};
  record=await store.save(record.id,initial,record.revision);
  const moved=structuredClone(record.document);moved.tugouCanvas.nodes[0].position={x:35,y:12};
  record={...record,document:moved};dirty=true;queue.changed(false);
  t.mock.timers.tick(30000);await settle();
  assert.equal((await store.read(record.id)).revision,record.revision);
  assert.deepEqual((await store.read(record.id)).document.tugouCanvas.nodes[0].position,{x:0,y:0});
  await queue.flush();const reopened=await store.read(record.id);
  assert.deepEqual(reopened.document.tugouCanvas.nodes[0].position,{x:35,y:12});assert.equal(dirty,false);
  const external=await store.save(record.id,{...record.document,name:'外部修改'},record.revision);
  record={...record,document:{...record.document,name:'本地保留'}};dirty=true;queue.changed();
  await assert.rejects(queue.flush(),/工程已更新/);
  assert.equal(state,'saveFailed');assert.equal(record.document.name,'本地保留');assert.equal(dirty,true);
  assert.equal((await store.read(record.id)).revision,external.revision);
  assert.equal((await store.read(record.id)).document.name,'外部修改');
});
test('renderer hook keeps live document identity, coalesces drag and content, and pauses for gestures',async t=>{
  t.mock.timers.enable({apis:['setTimeout','Date'],now:10000});
  const source=(await fs.readFile(path.join(__dirname,'../renderer/use-autosave.js'),'utf8')).replace(/^import .*;\r?\n/gm,'').replace('export function','function');
  const slots=[],effects=[];let cursor=0,hook,projects=[{id:'a',name:'old'},{id:'b',name:'untouched'}];
  const gate=deferred(),writes=[];
  const window=Object.assign(new EventTarget(),{tugou:{save:async(id,document,revision,metadataOnly)=>{assert.equal(metadataOnly,true);writes.push({id,document,revision});if(writes.length===1)await gate.promise;return {id,name:document.name,revision:revision+1};}}});
  const scope={createAutosave,window,Date,suspendPages:doc=>doc,rememberPages:()=>{},
    useRef:value=>{const i=cursor++;return slots[i]??=( {current:value} );},
    useState:value=>{const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],next=>{slots[i]=next;}];},
    useEffect:fn=>{const i=cursor++;if(!(i in slots)){slots[i]=true;effects.push(fn);}}};
  vm.runInNewContext(source+'\nthis.useAutosave=useAutosave;',scope);
  const c={present:{current:{id:'a',revision:1,document:{name:'first'}}},dirtyRef:{current:true},busyRef:{current:false},
    pageDocument:()=>c.present.current.document,markDirty:(value,autoSave=true)=>{c.dirtyRef.current=value;if(value)hook.queue.changed(autoSave);else hook.queue.reset();},
    setRecord:record=>{c.present.current=record;},setProjects:update=>{projects=update(projects);}};
  const render=()=>{cursor=0;hook=scope.useAutosave(c);};render();const cleanup=effects.map(fn=>fn());t.after(()=>cleanup.forEach(fn=>fn?.()));
  const flush=hook.queue.flush();await settle();
  const live={name:'typed while saving'};c.present.current={...c.present.current,document:live};c.markDirty(true);render();
  gate.resolve();await flush;render();
  assert.equal(c.present.current.document,live);assert.equal(c.present.current.revision,3);assert.equal(c.dirtyRef.current,false);
  assert.equal(writes[1].revision,2);assert.equal(writes[1].document,live);assert.equal(projects[0].name,live.name);assert.equal(projects[1].name,'untouched');
  assert.equal(hook.state,'saved');assert.equal(hook.error,'');

  const dispatch=type=>window.dispatchEvent(Object.assign(new Event(type),{pointerId:1}));
  const tick=async ms=>{t.mock.timers.tick(ms);await settle();};
  c.present.current={...c.present.current,document:{...live,name:'edited before dragging'}};
  c.markDirty(true);dispatch('pointerdown');await tick(12000);assert.equal(writes.length,2);
  const moved={...c.present.current.document,x:42};
  c.present.current={...c.present.current,document:moved};c.markDirty(true,false);
  dispatch('pointerup');await tick(100);await tick(0);
  assert.equal(writes.length,3);assert.equal(writes.at(-1).document,moved);

  c.markDirty(true);dispatch('pointerdown');dispatch('dragstart');dispatch('pointercancel');
  await tick(12000);assert.equal(writes.length,3);
  dispatch('dragend');await tick(100);await tick(0);assert.equal(writes.length,4);

  c.markDirty(true);await tick(9950);dispatch('wheel');
  await tick(50);assert.equal(writes.length,4);
  await tick(200);await tick(0);assert.equal(writes.length,5);
});
test('saving reads the previous revision once and restores its original bytes on recovery',async t=>{
  const temp=await fs.realpath(os.tmpdir()),root=await fs.mkdtemp(path.join(temp,'tugou-save-backup-'));
  t.after(async()=>{const actual=await fs.realpath(root);assert.equal(path.dirname(actual),temp);assert.ok(path.basename(actual).startsWith('tugou-save-backup-'));await fs.rm(actual,{recursive:true,force:true});});
  const store=new ProjectStore(root);await store.init();
  const previous=await store.create('上一版'),file=await store.projectPath(previous.id),bytes=await fs.readFile(file);
  const read=store.readSnapshot.bind(store);let reads=0;
  store.readSnapshot=(...args)=>{reads++;return read(...args);};
  const input={...previous.document,name:'写入时的快照'},pending=store.save(previous.id,input,previous.revision);
  input.name='随后修改';
  const saved=await pending;
  assert.equal(reads,1);assert.equal(saved.document.name,'写入时的快照');
  assert.deepEqual(await fs.readFile(file+'.bak'),bytes);
  await fs.writeFile(file,'malformed');
  const recovered=await store.read(previous.id);
  assert.equal(recovered.recovered,true);assert.deepEqual(recovered.document,previous.document);
});
