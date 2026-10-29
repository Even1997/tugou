const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {FontDownloads}=require('../core/font-downloads.cjs'),{hash}=require('../core/storage.cjs'),{verifiedDownload}=require('../core/runtime-files.cjs');
async function fixture(t){
  const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tugou-font-test-'))),bytes=Buffer.alloc(256*1024,31),face={id:'test',weight:400,file:'test.ttf',bytes:bytes.length,sha256:hash(bytes)};
  let requests=0,broken=false;const ranges=[];
  const server=http.createServer((req,res)=>{requests++;if(broken){res.writeHead(503).end();return;}const start=Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1]||0);ranges.push(start);res.writeHead(start?206:200,{'Content-Length':bytes.length-start,...(start?{'Content-Range':`bytes ${start}-${bytes.length-1}/${bytes.length}`}:{})});res.end(bytes.subarray(start));});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const options={faces:[face],download:(item,...args)=>verifiedDownload({...item,url:`http://127.0.0.1:${server.address().port}/font`},...args)},store=new FontDownloads(root,options);
  t.after(async()=>{server.close();server.closeAllConnections();await fs.rm(root,{recursive:true,force:true});});return {root,bytes,face,store,options,ranges,requests:()=>requests,fail:value=>broken=value};
}
test('cloud font downloads once, reports progress, survives a new service offline',async t=>{
  const f=await fixture(t),events=[];f.store.on('progress',e=>events.push(e));assert.equal((await f.store.status('test')).status,'cloud');
  await Promise.all([f.store.ensure('test'),f.store.ensure('test')]);assert.equal(f.requests(),1);assert.ok(events.some(e=>e.status==='downloading'));assert.equal(events.at(-1).status,'ready');
  f.fail(true);const next=new FontDownloads(f.root,f.options);assert.equal((await next.status('test')).status,'ready');await next.ensure('test');assert.equal(f.requests(),1);assert.deepEqual(await fs.readFile(await next.file('test')),f.bytes);
});
test('a failed download stays retryable and does not become an available font',async t=>{
  const f=await fixture(t);f.fail(true);await assert.rejects(f.store.ensure('test'));assert.equal((await f.store.status('test')).status,'error');assert.equal(await f.store.file('test'),null);f.fail(false);await f.store.ensure('test');assert.equal((await f.store.status('test')).status,'ready');
});
test('font download resumes a partial file and verifies the final bytes',async t=>{
  const f=await fixture(t);await fs.mkdir(f.store.folder,{recursive:true});await fs.writeFile(path.join(f.store.folder,f.face.sha256+'.part'),f.bytes.subarray(0,8192));await f.store.ensure('test');assert.deepEqual(f.ranges,[8192]);assert.ok(await f.store.file('test'));
});
test('same-size tampering is rejected and repaired before the font is served',async t=>{
  const f=await fixture(t);await f.store.ensure('test');const file=await f.store.file('test');await new Promise(r=>setTimeout(r,20));await fs.writeFile(file,Buffer.alloc(f.bytes.length,99));assert.equal(await f.store.file('test'),null);await f.store.ensure('test');assert.equal(f.requests(),2);assert.deepEqual(await fs.readFile(await f.store.file('test')),f.bytes);
});
test('unknown IDs and linked cache folders cannot download outside the profile',async t=>{
  const f=await fixture(t);assert.throws(()=>f.store.ensure('../escape'));const target=path.join(f.root,'other');await fs.mkdir(target);await fs.symlink(target,f.store.folder,process.platform==='win32'?'junction':'dir');await assert.rejects(f.store.ensure('test'),/链接/);assert.equal(f.requests(),0);
});
