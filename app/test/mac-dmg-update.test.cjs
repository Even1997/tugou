const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),{createHash}=require('node:crypto');
const {MacDmgUpdater}=require('../core/mac-dmg-updater.cjs');
const {Updates}=require('../core/updates.cjs');
const bytes=Buffer.from('Tugou DMG verification fixture\n'.repeat(8000)),digest=createHash('sha256').update(bytes).digest('hex');
function release(version='0.8.3'){
  return {tag_name:'v'+version,draft:false,prerelease:false,body:'Release notes <script>not executable</script>',assets:['arm64','x64'].map(arch=>({name:`tugou-${version}-mac-${arch}.dmg`,browser_download_url:`https://github.com/Even1997/tugou/releases/download/v${version}/tugou-${version}-mac-${arch}.dmg`,digest:'sha256:'+digest,size:bytes.length}))};
}
async function fixture(t,{arch='arm64',version='0.8.2'}={}){
  const profile=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tugou-dmg-test-'))),events=[],opened=[],requests=[];
  t.after(()=>fs.rm(profile,{recursive:true,force:true}));
  let data=release(),status=200;
  const u=new MacDmgUpdater({profile,version,arch,openPath:async file=>{opened.push(file);return '';},fetchRelease:async(url,options)=>{
    requests.push(url);assert.equal(url,'https://api.github.com/repos/Even1997/tugou/releases/latest');assert.equal(options.redirect,'error');return {ok:status===200,json:async()=>structuredClone(data)};
  }});
  let quit=0;const updates=new Updates({updater:u,profile,version,supported:true,guard:async()=>{throw Error('DMG must not touch the project');},prepare:async()=>{throw Error('DMG must not flush or quit');},beforeInstall:async()=>quit++,emit:s=>events.push(s)});await updates.init();
  return {u,updates,events,opened,requests,profile,setRelease:v=>data=v,setStatus:v=>status=v,quit:()=>quit};
}
async function server(t){
  let mode='ok';const ranges=[],originalFetch=global.fetch;
  const s=http.createServer((req,res)=>{
    ranges.push(req.headers.range);const offset=Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1]||0);
    const body=mode==='corrupt'?Buffer.alloc(bytes.length):bytes;
    if(offset)res.writeHead(206,{'Content-Range':`bytes ${offset}-${bytes.length-1}/${bytes.length}`,'Content-Length':bytes.length-offset});else res.writeHead(200,{'Content-Length':bytes.length});
    res.end(body.subarray(offset));
  });await new Promise(r=>s.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{s.close(r);s.closeAllConnections();}));
  t.mock.method(global,'fetch',(url,options)=>originalFetch(`http://127.0.0.1:${s.address().port}/asset`,options));
  return {ranges,setMode:v=>mode=v};
}
test('both architectures select only the exact stable DMG; numeric versions never downgrade',async t=>{
  for(const arch of ['arm64','x64']){const f=await fixture(t,{arch});await f.updates.check();assert.equal(f.updates.state.installMode,'dmg');assert.equal(f.updates.state.status,'available');assert.match(f.u.asset.name,new RegExp(`mac-${arch}\\.dmg$`));assert.equal(f.opened.length,0);}
  const f=await fixture(t,{version:'0.8.9'});f.setRelease(release('0.8.10'));await f.updates.check();assert.equal(f.updates.state.status,'available');f.setRelease(release('0.8.2'));await f.updates.check();assert.equal(f.updates.state.status,'latest');assert.equal(f.updates.state.version,null);assert.equal(f.updates.state.notes,'');
});
test('missing architecture, unsafe metadata, prereleases and HTTP errors never claim latest',async t=>{
  const mutations=[r=>r.assets=[],r=>r.draft=true,r=>r.prerelease=true,r=>r.tag_name='invalid',r=>r.tag_name='v0.9.0-beta.1',r=>r.assets[0].browser_download_url='https://evil.invalid/app.dmg',r=>r.assets[0].digest=null,r=>r.assets[0].size=5*1024**3];
  const f=await fixture(t);for(const mutate of mutations){const r=release();mutate(r);f.setRelease(r);await f.updates.check();assert.equal(f.updates.state.status,'error');assert.equal(f.updates.state.error,'releaseUnavailable');await assert.rejects(f.updates.download());assert.equal(f.u.asset,null);}
  for(const status of [403,404,500]){f.setStatus(status);await f.updates.check();assert.equal(f.updates.state.status,'error');}
  f.setStatus(200);f.setRelease(release());await f.updates.check();assert.equal(f.updates.state.status,'available');
});
test('real streamed download resumes, verifies, opens manually and reuses verified cache',async t=>{
  const network=await server(t),f=await fixture(t);await f.updates.check();
  const folder=path.join(f.profile,'updates','mac-dmg',digest);await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,digest+'.part'),bytes.subarray(0,70000));
  await f.updates.download();assert.equal(f.updates.state.status,'ready');assert.equal(network.ranges[0],'bytes=70000-');assert.ok(f.events.some(e=>e.status==='downloading'&&e.transferred>0));assert.deepEqual(await fs.readFile(f.u.file),bytes);assert.equal(f.opened.length,0);
  await assert.rejects(f.updates.install(),/MANUAL_INSTALL/);await f.updates.openInstaller();assert.equal(f.opened[0],f.u.file);assert.equal(f.quit(),0);assert.equal(f.updates.state.status,'ready');
  await f.u.downloadUpdate();assert.equal(network.ranges.length,1);
  await fs.writeFile(f.u.file,'tampered');await f.updates.openInstaller();assert.equal(f.updates.state.status,'error');assert.equal(f.opened.length,1);
  await f.updates.check();await f.updates.download();assert.equal(f.updates.state.status,'ready');assert.equal(network.ranges.length,2);
});
test('corruption cannot become ready or open; retry and open errors remain recoverable',async t=>{
  const network=await server(t),f=await fixture(t);await f.updates.check();network.setMode('corrupt');await f.updates.download();assert.equal(f.updates.state.status,'error');assert.equal(f.u.file,null);await assert.rejects(f.updates.openInstaller());
  network.setMode('ok');await f.updates.check();await f.updates.download();f.u.openPath=async()=> 'No handler';await f.updates.openInstaller();assert.equal(f.updates.state.status,'error');assert.equal(f.quit(),0);
});
test('automatic download is opt-in, never opens the DMG; checks persist throttling',async t=>{
  const network=await server(t),f=await fixture(t);await f.updates.check({automatic:true});assert.equal(network.ranges.length,0);await f.updates.check({automatic:true,autoDownload:true});assert.equal(f.requests.length,1);
  await f.updates.check({autoDownload:true});assert.equal(f.updates.state.status,'ready');assert.equal(f.opened.length,0);assert.equal(network.ranges.length,1);
  const restored=new Updates({updater:f.u,profile:f.profile,version:'0.8.2',supported:true,guard:async()=>null,prepare:async()=>{}});await restored.init();await restored.check({automatic:true});assert.equal(f.requests.length,2);
});
test('a linked download cache is refused',async t=>{
  const f=await fixture(t);await f.updates.check();const other=path.join(f.profile,'other');await fs.mkdir(other);await fs.symlink(other,path.join(f.profile,'updates'),process.platform==='win32'?'junction':'dir');await f.updates.download();assert.equal(f.updates.state.status,'error');assert.deepEqual(await fs.readdir(other),[]);
});
test('DMG metadata allows packages above 1 GiB without changing the component download limit',async t=>{
  const f=await fixture(t),r=release();r.assets[0].size=1024**3+1;f.setRelease(r);await f.updates.check();assert.equal(f.updates.state.status,'available');
  await assert.rejects(require('../core/runtime-files.cjs').verifiedDownload(f.u.asset,f.profile,new AbortController().signal),/组件下载清单无效/);
});
