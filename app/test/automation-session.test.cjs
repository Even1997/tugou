const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const {EventEmitter}=require('node:events'),{setTimeout:delay}=require('node:timers/promises');
const {createDispatcher,startAutomationHost}=require('../core/automation-host.cjs');
const {bridge,sessionDiagnostic}=require('../core/mcp.cjs');
async function root(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-session-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('command discovery defaults to compact summaries and supports focused schemas',async t=>{
 const dir=await root(t),dispatch=await createDispatcher({root:dir});
 const summary=await dispatch('list_commands',{}),full=await dispatch('list_commands',{schemas:true});
 assert.equal(summary.total,135);assert.equal(summary.schemaMode,'summary');assert.ok(summary.commands.every(c=>!c.inputSchema&&Array.isArray(c.required)));assert.ok(JSON.stringify(summary).length<JSON.stringify(full).length*.5);
 const cameras=await dispatch('list_commands',{domain:'scene.camera'});assert.equal(cameras.total,4);assert.ok(cameras.commands.every(c=>c.inputSchema));
 const found=await dispatch('list_commands',{search:'mask fill'});assert.deepEqual(found.commands.map(c=>c.name),['mask.fill']);
 assert.equal((await dispatch('list_commands',{search:'no-such-command'})).total,0);
});
test('wait reports real stages, finishes on review, and abort never cancels the underlying task',async t=>{
 const dir=await root(t);let task={id:'t',status:'running',stage:'generating'},reads=0;
 const dispatch=await createDispatcher({root:dir,ui:async()=>({}),tasks:{list:()=>{reads++;return [task];},cancel:()=>{throw Error('must not cancel');}}});
 const progress=[],controller=new AbortController();
 await assert.rejects(()=>dispatch('run_command',{command:'task.wait',args:{id:'t',timeoutMs:30000}},{signal:controller.signal,onProgress:p=>{progress.push(p);controller.abort();}}),e=>e.code==='CANCELLED');
 assert.equal(reads,1);assert.equal(task.status,'running');assert.equal(progress[0].stage,'generating');assert.equal(progress[0].progress,undefined);
 const timer=setTimeout(()=>{task={...task,status:'review',stage:'saving',progress:100};},60);
 const result=await dispatch('run_command',{command:'task.wait',args:{id:'t',timeoutMs:1000}},{onProgress:p=>progress.push(p)});clearTimeout(timer);
 assert.equal(result.task.status,'review');assert.equal(result.timedOut,false);assert.equal(progress.at(-1).progress,100);
 const timed=await dispatch('run_command',{command:'task.wait',args:{id:'t',timeoutMs:0}});assert.equal(timed.timedOut,false);
});
test('bridge parses fragmented progress and final reply without exposing session token',async t=>{
 const dir=await root(t),token='a'.repeat(64);
 const server=net.createServer(socket=>socket.once('data',()=>{socket.write('{"pro');setTimeout(()=>socket.end('gress":{"elapsedMs":1,"status":"running"}}\n{"ok":true,"value":{"task":{"status":"completed"}}}\n'),5);}));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
 const session=path.join(dir,'session.json');await fs.writeFile(session,JSON.stringify({version:1,port:server.address().port,token}));
 const updates=[],result=await bridge(session,'run_command',{}, {onProgress:p=>updates.push(p)});assert.equal(updates.length,1);assert.equal(result.value.task.status,'completed');assert.ok(!JSON.stringify(updates).includes(token));
 await fs.writeFile(session,'null');await assert.rejects(()=>bridge(session,'get_state',{}),e=>sessionDiagnostic(e).code==='INVALID_SESSION');
 assert.equal(sessionDiagnostic({code:'ENOENT'}).code,'SESSION_NOT_ENABLED');assert.equal(sessionDiagnostic({code:'ECONNREFUSED'}).code,'SESSION_OFFLINE');
});
test('disconnect aborts a real host wait and repeated startup failures leave no IPC listeners',async t=>{
 const dir=await root(t),ipcMain=new EventEmitter(),app=new EventEmitter(),window=new EventEmitter();app.getPath=()=>dir;window.isDestroyed=()=>false;
 const frame={url:'file:///fixture'},contents={mainFrame:frame};window.webContents=contents;
 contents.send=(_channel,request)=>queueMicrotask(()=>ipcMain.emit('tugou:automation-reply',{sender:contents,senderFrame:frame},request.id,{ok:true,value:{revision:'r',document:null}}));
 let reads=0;const task={id:'t',status:'running'};
 const host=await startAutomationHost({window,ipcMain,app,entryUrl:frame.url,root:dir,tasks:{list:()=>{reads++;return [task];}}});t.after(host.close);
 const controller=new AbortController();await assert.rejects(()=>bridge(host.descriptor,'run_command',{command:'task.wait',args:{id:'t',timeoutMs:30000}},{signal:controller.signal,onProgress:()=>controller.abort()}),e=>e.code==='CANCELLED');
 await delay(40);const stopped=reads;await delay(300);assert.equal(reads,stopped);assert.equal(task.status,'running');host.close();assert.equal(ipcMain.listenerCount('tugou:automation-reply'),0);
 // Force descriptor write failure after bind, then retry: neither attempt may leak reply listeners.
 await fs.rm(host.descriptor);await fs.mkdir(host.descriptor);
 for(let i=0;i<2;i++){await assert.rejects(()=>startAutomationHost({window,ipcMain,app,entryUrl:frame.url,root:dir,tasks:{list:()=>[]}}));assert.equal(ipcMain.listenerCount('tugou:automation-reply'),0);}
});
