const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {EventEmitter}=require('node:events');
const main=fs.readFileSync(path.join(__dirname,'../desktop-main.cjs'),'utf8');
const preload=fs.readFileSync(path.join(__dirname,'../preload.cjs'),'utf8');
const settle=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function fixture(t,platform='win32'){
  t.mock.timers.enable({apis:['setTimeout']});
  const ipc=new EventEmitter(),window=new EventEmitter(),handlers=new Map(),messages=[],errors=[];
  let bridge,closed=false,hidden=false,shutdown=0,resumed=0;
  const context={window,dirty:true,closing:false,confirmingClose:false,quitting:false,
    process:{platform},settings:{updates:{state:{status:'idle'}}},setTimeout,clearTimeout,
    randomUUID:()=>String(Math.random()),handle:(name,fn)=>handlers.set(name,fn),
    tasks:{shutdown:async()=>{shutdown++;}},dialog:{showErrorBox:(title,message)=>errors.push({title,message})}};
  window.webContents={send:(name,...args)=>{messages.push(name);ipc.emit(name,{},...args);},reload:()=>{}};
  window.isDestroyed=()=>closed;window.hide=()=>{hidden=true;};
  window.close=()=>{const event={preventDefault(){this.prevented=true;}};window.emit('close',event);if(!event.prevented)closed=true;};
  handlers.set('dirty',value=>{context.dirty=value;});
  ipc.invoke=async(channel,...args)=>{
    try{return {ok:true,value:await handlers.get(channel.replace('tugou:',''))(...args)};}
    catch(error){return {ok:false,error:error.message};}
  };
  vm.runInNewContext(preload,{require:()=>({contextBridge:{exposeInMainWorld:(_name,value)=>{bridge=value;}},ipcRenderer:ipc}),process:{platform}});
  // Execute the production close/IPC handlers with a fake Electron window, without building the UI.
  vm.runInNewContext(main.slice(main.indexOf('  let closeSave=null;'),main.indexOf('  const refreshShortcuts=')),context);
  const f={context,bridge,window,ipc,messages,errors,get closed(){return closed;},get hidden(){return hidden;},get shutdown(){return shutdown;},get resumed(){return resumed;},
    register:prepare=>bridge.onBeforeClose(prepare,()=>{resumed++;})};
  return f;
}
test('close waits for renderer save acknowledgement before shutting down',async t=>{
  const f=fixture(t);let finish;
  f.register(async()=>{await new Promise(resolve=>{finish=resolve;});await f.bridge.dirty(false);});
  f.window.close();await settle();assert.equal(f.closed,false);assert.equal(f.shutdown,0);
  f.window.close();assert.equal(f.messages.filter(m=>m==='tugou:before-close').length,1);
  finish();await settle();assert.equal(f.closed,true);assert.equal(f.shutdown,1);assert.equal(f.errors.length,0);
});
test('save failure keeps the window open and resumes editing, including when close confirmation is disabled',async t=>{
  const f=fixture(t);f.context.preferences={value:{confirmClose:false}};
  f.register(async()=>{throw Error('磁盘已满');});f.window.close();await settle();
  assert.equal(f.closed,false);assert.equal(f.context.dirty,true);assert.equal(f.shutdown,0);assert.equal(f.resumed,1);assert.match(f.errors[0].message,/磁盘已满/);
});
test('missing renderer response cancels close; a late response cannot close the window',async t=>{
  const f=fixture(t);let finish;
  f.register(async()=>{await new Promise(resolve=>{finish=resolve;});await f.bridge.dirty(false);});
  f.window.close();await settle();t.mock.timers.tick(30000);await settle();
  assert.equal(f.closed,false);assert.equal(f.resumed,1);assert.match(f.errors[0].message,/取消关闭/);
  finish();await settle();assert.equal(f.closed,false);assert.equal(f.shutdown,0);
});
test('Mac close saves before hiding and releases the edit lock',async t=>{
  const f=fixture(t,'darwin');f.register(()=>f.bridge.dirty(false));f.window.close();await settle();
  assert.equal(f.hidden,true);assert.equal(f.closed,false);assert.equal(f.shutdown,0);assert.equal(f.resumed,1);
});
test('Mac quit saves before shutdown, and save failure cancels quitting',async t=>{
  const f=fixture(t,'darwin');f.context.quitting=true;
  let fail=true;f.register(async()=>{if(fail)throw Error('保存失败');await f.bridge.dirty(false);});
  f.window.close();await settle();assert.equal(f.context.quitting,false);assert.equal(f.closed,false);
  fail=false;f.context.quitting=true;f.window.close();await settle();assert.equal(f.closed,true);assert.equal(f.shutdown,1);
});
test('dirty acknowledgement and task shutdown failures both prevent close',async t=>{
  const f=fixture(t);f.register(async()=>{});f.window.close();await settle();assert.equal(f.closed,false);assert.match(f.errors[0].message,/未保存/);
  f.context.dirty=false;f.context.tasks.shutdown=async()=>{throw Error('任务保存失败');};f.window.close();await settle();
  assert.equal(f.closed,false);assert.match(f.errors[1].message,/任务保存失败/);assert.equal(f.resumed,2);
});
test('installing an update closes an already-saved session without calling disabled IPC',async t=>{
  const f=fixture(t);f.context.dirty=false;f.context.settings.updates.state.status='installing';f.window.close();await settle();
  assert.equal(f.closed,true);assert.equal(f.messages.includes('tugou:before-close'),false);
});
test('save IPC cannot commit a revision and then report a recent-project settings failure',async()=>{
  let save,committed=0,fail=true;const order=[];
  vm.runInNewContext(main.slice(main.indexOf("  handle('save',"),main.indexOf("  handle('import',")),{
    handle:(_name,fn)=>{save=fn;},projects:{projectPath:async()=>{order.push('validate');},save:async()=>{committed++;order.push('write');return {revision:2};}},
    settings:{remember:async()=>{order.push('remember');if(fail)throw Error('settings disk full');}}});
  await assert.rejects(save('id',{},1),/settings disk full/);assert.equal(committed,0);
  fail=false;assert.equal((await save('id',{},1)).revision,2);assert.equal(committed,1);
  assert.deepEqual(order,['validate','remember','validate','remember','write']);
});
