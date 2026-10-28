const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {ConnectionStore}=require('../core/connection.cjs');
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-connection-'));
  const store=new ConnectionStore(root,{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()});
  const requests=[];let mode='ok';
  const server=http.createServer((req,res)=>{
    requests.push({url:req.url,method:req.method,auth:req.headers.authorization});
    if(mode==='timeout')return;
    if(mode==='redirect'){res.writeHead(302,{location:'/leak'});res.end();return;}
    if(typeof mode==='number'){res.writeHead(mode);res.end('do-not-display-secret');return;}
    if(mode==='large'){res.writeHead(200,{'content-length':3*1024*1024});res.end();return;}
    if(mode==='invalid'){res.end('<html>not an API</html>');return;}
    res.setHeader('content-type','application/json');res.end(JSON.stringify(mode==='empty'?{data:[]}:mode==='format'?{items:[]}:{data:[{id:'vision'},{id:'image'},{id:'image'},{id:' '},{id:'bad\nname'},{foo:'bad'}]}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(root,{recursive:true,force:true});});
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  await store.save({baseUrl,apiKey:'saved-test-key',model:'kept-model'});
  return {store,root,baseUrl,requests,mode:value=>{mode=value;}};
}
test('draft probes use current address/key, preserve saved bytes and never return the key',async t=>{
  const f=await fixture(t),before=await fs.readFile(path.join(f.root,'connection.enc'));
  const result=await f.store.probe({baseUrl:f.baseUrl+'/gateway/v1/',apiKey:'draft-test-key'},true);
  assert.equal(result.ok,true);assert.deepEqual(result.models,['image','vision']);assert.equal(result.count,2);assert.equal(JSON.stringify(result).includes('test-key'),false);
  assert.deepEqual(f.requests,[{url:'/gateway/v1/models',method:'GET',auth:'Bearer draft-test-key'}]);
  assert.deepEqual(await fs.readFile(path.join(f.root,'connection.enc')),before);
});
test('blank Key uses saved key; connection test returns no catalog; empty catalog succeeds',async t=>{
  const f=await fixture(t);const r=await f.store.probe({baseUrl:f.baseUrl,apiKey:''});assert.equal(r.ok,true);assert.equal(r.models,undefined);assert.equal(f.requests[0].auth,'Bearer saved-test-key');assert.equal(f.requests[0].url,'/v1/models');
  f.mode('empty');assert.deepEqual((await f.store.probe({},true)).models,[]);
});
test('rejects missing keys, malformed URLs, credential URLs and remote HTTP before sending',async t=>{
  const f=await fixture(t);await assert.rejects(f.store.probe({clearKey:true}),/密钥/);
  for(const baseUrl of ['oops','https://user:secret@example.com','http://example.com','https://example.com?key=secret'])await assert.rejects(f.store.probe({baseUrl}),/地址|HTTPS/);
  await assert.rejects(f.store.probe({apiKey:'bad\nkey'}),/换行/);assert.equal(f.requests.length,0);
});
test('HTTP errors stay actionable and never reflect provider bodies',async t=>{
  const f=await fixture(t);for(const code of [401,403,404,405,429,500]){f.mode(code);const r=await f.store.probe({},true);assert.equal(r.ok,false);assert.match(r.message,new RegExp(String(code)));assert.equal(r.message.includes('do-not-display-secret'),false);if(code===404)assert.match(r.message,/手动/);}
});
test('invalid, oversized and unsupported payloads fail safely; timeout is bounded; redirects are not followed',async t=>{
  const f=await fixture(t);for(const mode of ['invalid','large','format','redirect']){f.mode(mode);assert.equal((await f.store.probe({},true)).ok,false);}
  assert.equal(f.requests.some(r=>r.url==='/leak'),false);f.mode('timeout');const r=await f.store.probe({},true,30);assert.equal(r.ok,false);assert.match(r.message,/超时/);
});
