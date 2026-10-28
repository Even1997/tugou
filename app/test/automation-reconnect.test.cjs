const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {automationEnabled}=require('../core/automation-startup.cjs');
const {bridge}=require('../core/mcp.cjs');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-reconnect-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('MCP opt-in persists across ordinary launches and does not enable untouched profiles',async t=>{
  const dir=await fixture(t);assert.equal(await automationEnabled(dir,false),false);
  assert.equal(await automationEnabled(dir,true),true);assert.equal(await automationEnabled(dir,false),true);
});
test('existing client rereads rotated descriptor and safely retries reads during restart',async t=>{
  const dir=await fixture(t),session=path.join(dir,'session.json');let requests=0;
  const server=net.createServer(s=>s.once('data',b=>{const r=JSON.parse(b);requests++;assert.equal(r.token,'b'.repeat(64));s.end(JSON.stringify({ok:true,value:{revision:'new'}})+'\n');}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  const pending=bridge(session,'get_state',{}, {reconnectTimeoutMs:1000});
  await fs.writeFile(session,JSON.stringify({version:1,port:server.address().port,token:'b'.repeat(64)}));
  assert.equal((await pending).value.revision,'new');assert.equal(requests,1);
  await fs.rm(session);
  const start=Date.now();await assert.rejects(()=>bridge(session,'run_command',{command:'generation.start',args:{}},{reconnectTimeoutMs:3000}),{code:'ENOENT'});
  assert.ok(Date.now()-start<1000);assert.equal(requests,1);
});
test('a disconnected write is never replayed even after the server accepted it',async t=>{
  const dir=await fixture(t),session=path.join(dir,'session.json');let writes=0;
  const server=net.createServer(s=>s.once('data',()=>{writes++;s.end();}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>server.close());
  await fs.writeFile(session,JSON.stringify({version:1,port:server.address().port,token:'c'.repeat(64)}));
  await assert.rejects(()=>bridge(session,'run_command',{command:'layer.merge',args:{ids:['l']}}),{code:'SESSION_CLOSED'});assert.equal(writes,1);
});
