const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{EventEmitter}=require('node:events');
const {Preferences,languageFor,validate}=require('../core/preferences.cjs');
const {Updates}=require('../core/updates.cjs');
async function folder(t){const p=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-settings-'));t.after(()=>fs.rm(p,{recursive:true,force:true}));return p;}
test('image concurrency defaults to eight and persists only integers from one to thirty-two',async t=>{
  const p=await folder(t),s=new Preferences(p);await s.init();assert.equal(s.value.imageConcurrency,8);
  await fs.writeFile(s.file,JSON.stringify({theme:'light'}));await s.init();assert.equal(s.value.imageConcurrency,8);assert.equal(s.value.theme,'light');
  for(const imageConcurrency of [1,8,16,32]){await s.save({imageConcurrency});const restored=new Preferences(p);await restored.init();assert.equal(restored.value.imageConcurrency,imageConcurrency);}
  for(const imageConcurrency of [0,33,1.5,'8',null,NaN,Infinity])assert.throws(()=>s.save({imageConcurrency}),/INVALID_SETTINGS/);
  assert.equal(s.value.imageConcurrency,32);assert.equal(JSON.parse(await fs.readFile(s.file)).imageConcurrency,32);
});
test('preferences persist all five languages and preserve concurrent partial updates',async t=>{
  const p=await folder(t),s=new Preferences(p);await s.init();await Promise.all([s.save({theme:'light'}),s.save({zoom:125}),s.save({notifyTasks:false})]);
  for(const language of ['zh-CN','zh-TW','en','ja','ko']){await s.save({language});const restored=new Preferences(p);await restored.init();assert.equal(restored.value.language,language);assert.equal(restored.value.theme,'light');assert.equal(restored.value.zoom,125);assert.equal(restored.value.notifyTasks,false);}
});
test('preferences reject unknown keys, invalid ranges, secrets and prototype keys',()=>{
  for(const input of [null,[],{language:'xx'},{zoom:1000},{autoCheck:'true'},{apiKey:'x'},{feedUrl:'http://evil'},{constructor:true},JSON.parse('{"__proto__":true}')])assert.throws(()=>validate(input));
  assert.equal(languageFor({followSystemLanguage:true},'zh-Hant-HK'),'zh-TW');assert.equal(languageFor({followSystemLanguage:true},'ko-KR'),'ko');assert.equal(languageFor({followSystemLanguage:true},'fr-FR'),'en');assert.equal(languageFor({followSystemLanguage:false,language:'ja'},'zh-CN'),'ja');
});
test('corrupt preference files are reported and not overwritten',async t=>{const p=await folder(t);await fs.writeFile(path.join(p,'preferences.json'),'broken');await assert.rejects(new Preferences(p).init());assert.equal(await fs.readFile(path.join(p,'preferences.json'),'utf8'),'broken');});
async function fixture(t,options={}){const u=new EventEmitter(),events=[],profile=await folder(t);let checks=0,downloads=0,installs=0;
 u.checkForUpdates=async()=>{checks++;u.emit('checking-for-update');u.emit('update-available',{version:'0.8.2',releaseNotes:'Safe plain text <script>bad()</script>'});};u.downloadUpdate=async()=>{downloads++;u.emit('download-progress',{percent:45,total:100,transferred:45});u.emit('update-downloaded',{version:'0.8.2'});};u.quitAndInstall=(silent,relaunch)=>{assert.equal(silent,true);assert.equal(relaunch,true);installs++;};
 const updates=new Updates({updater:u,profile,version:'0.8.1',supported:true,guard:async()=>null,prepare:async()=>{},emit:s=>events.push(s),...options});await updates.init();return {u,updates,events,profile,counts:()=>({checks,downloads,installs})};}
test('manual check, download, real progress, ready and explicit install sequence',async t=>{const f=await fixture(t);await f.updates.check();assert.equal(f.updates.state.status,'available');assert.equal(f.counts().downloads,0);assert.equal(f.u.autoInstallOnAppQuit,false);await f.updates.download();assert.equal(f.updates.state.status,'ready');assert.ok(f.events.some(e=>e.status==='downloading'&&e.percent===45));assert.equal(f.counts().installs,0);await f.updates.install();assert.equal(f.counts().installs,1);});
test('startup bypasses persisted check time; automatic checks repeat every thirty minutes',async t=>{
 let now=100000000;const f=await fixture(t,{now:()=>now});await f.updates.check({automatic:true});
 const second=await fixture(t,{profile:f.profile,now:()=>now});assert.equal(second.updates.state.lastChecked,now);await second.updates.check({automatic:true});assert.equal(second.counts().checks,1);
 now+=1800000-1;await second.updates.check({automatic:true});assert.equal(second.counts().checks,1);
 now++;await second.updates.check({automatic:true,autoDownload:true});assert.equal(second.counts().checks,2);assert.equal(second.updates.state.status,'ready');assert.equal(second.counts().downloads,1);
});
test('failed automatic checks retry after five minutes, then return to thirty minutes',async t=>{
 let now=100000000,checks=0;const f=await fixture(t,{now:()=>now});f.u.checkForUpdates=async()=>{checks++;throw Error('offline');};
 await f.updates.check({automatic:true});now+=299999;await f.updates.check({automatic:true});assert.equal(checks,1);
 f.u.checkForUpdates=async()=>{checks++;f.u.emit('update-not-available');};now++;await f.updates.check({automatic:true});assert.equal(checks,2);assert.equal(f.updates.state.status,'latest');
 now+=300000;await f.updates.check({automatic:true});assert.equal(checks,2);await f.updates.check();assert.equal(checks,3);
});
test('private or missing release is an error, never latest, and can be retried',async t=>{const f=await fixture(t);f.u.checkForUpdates=async()=>{throw Object.assign(Error('404 latest.yml'),{code:'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'});};await f.updates.check();assert.equal(f.updates.state.status,'error');assert.equal(f.updates.state.error,'releaseUnavailable');f.u.checkForUpdates=async()=>f.u.emit('update-not-available');await f.updates.check();assert.equal(f.updates.state.status,'latest');assert.equal(f.updates.state.error,null);});
test('corrupt download never enables installation',async t=>{const f=await fixture(t);await f.updates.check();f.u.downloadUpdate=async()=>{throw Error('sha512 checksum mismatch');};await f.updates.download();assert.equal(f.updates.state.status,'error');await assert.rejects(f.updates.install());assert.equal(f.counts().installs,0);});
test('unsaved work and active tasks block install, second guard catches new edits during flush',async t=>{let reason='unsaved';const f=await fixture(t,{guard:async()=>reason});await f.updates.check();await f.updates.download();await f.updates.install();assert.equal(f.updates.state.blocked,'unsaved');reason='tasksBusy';await f.updates.install();assert.equal(f.updates.state.blocked,'tasksBusy');reason=null;f.updates.prepare=async()=>{reason='unsaved';};await f.updates.install();assert.equal(f.counts().installs,0);assert.equal(f.updates.state.status,'ready');});
test('preview builds do not contact update feed or start installer',async t=>{const f=await fixture(t,{supported:false});await f.updates.check({automatic:true});assert.equal(f.updates.state.status,'portable');await assert.rejects(f.updates.download());await assert.rejects(f.updates.install());assert.deepEqual(f.counts(),{checks:0,downloads:0,installs:0});});
test('concurrent checks and downloads are not submitted twice',async t=>{const f=await fixture(t);let release,count=0;f.u.checkForUpdates=async()=>{count++;await new Promise(r=>release=r);f.u.emit('update-available',{version:'1.0.0'});};const first=f.updates.check();await f.updates.check();assert.equal(count,1);release();await first;let done;f.u.downloadUpdate=async()=>{count++;await new Promise(r=>done=r);f.u.emit('update-downloaded',{version:'1.0.0'});};const download=f.updates.download();await f.updates.download();assert.equal(count,2);done();await download;});
test('update handoff is invoked only after guards and flush succeed',async t=>{const calls=[];let reason='unsaved';const f=await fixture(t,{guard:async()=>reason,prepare:async()=>calls.push('flush'),beforeInstall:async()=>calls.push('handoff')});await f.updates.check();await f.updates.download();await f.updates.install();assert.deepEqual(calls,[]);reason=null;await f.updates.install();assert.deepEqual(calls,['flush','handoff']);assert.equal(f.counts().installs,1);});
test('skipping a version persists across launches and prevents only its automatic download',async t=>{
 const f=await fixture(t);await assert.rejects(f.updates.skip(),/UPDATE_NOT_AVAILABLE/);await f.updates.check();await f.updates.skip();
 const next=await fixture(t,{profile:f.profile});assert.equal(next.updates.state.skippedVersion,'0.8.2');
 await next.updates.check({automatic:true,autoDownload:true});assert.equal(next.updates.state.status,'available');assert.equal(next.counts().downloads,0);
 await next.updates.check({autoDownload:true});assert.equal(next.updates.state.status,'ready');assert.equal(next.counts().downloads,1);assert.equal(next.counts().installs,0);
 next.u.checkForUpdates=async()=>next.u.emit('update-available',{version:'0.8.3'});next.updates.lastAttempt=null;
 let downloaded=false;next.u.downloadUpdate=async()=>{downloaded=true;next.u.emit('update-downloaded',{version:'0.8.3'});};
 await next.updates.check({automatic:true,autoDownload:true});assert.equal(next.updates.state.version,'0.8.3');assert.equal(next.updates.state.status,'ready');assert.equal(downloaded,true);
});
test('skip and check persistence cannot overwrite each other; save failure remains retryable',async t=>{
 const f=await fixture(t);await f.updates.check();await Promise.all([f.updates.check(),f.updates.skip()]);
 const saved=JSON.parse(await fs.readFile(path.join(f.profile,'update-state.json'),'utf8'));assert.equal(saved.skippedVersion,'0.8.2');assert.ok(saved.lastChecked);
 f.updates.set({skippedVersion:null});const persist=f.updates.persist;f.updates.persist=async()=>{throw Error('disk failure');};
 await assert.rejects(f.updates.skip(),/disk failure/);assert.equal(f.updates.state.skippedVersion,null);f.updates.persist=persist;await f.updates.skip();assert.equal(f.updates.state.skippedVersion,'0.8.2');
});
test('MCP stdio exits cooperatively for updates and read calls report restart status',async t=>{
 const dir=await folder(t),session=path.join(dir,'mcp-session.json'),state={version:1,port:65500,token:'a'.repeat(64),pid:process.pid};await fs.writeFile(session,JSON.stringify(state));
 const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve(__dirname,'../core/mcp.cjs'),'--session',session],stderr:'pipe'}),client=new Client({name:'update-test',version:'1.0'});t.after(()=>client.close());await client.connect(transport);
 const closed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MCP did not release executable')),4000);client.onclose=()=>{clearTimeout(timer);resolve();};});await fs.writeFile(session,JSON.stringify({...state,updating:true}));
 await assert.rejects(require('../core/mcp.cjs').bridge(session,'get_state',{}),e=>e.code==='SESSION_UPDATING');await closed;
});

test('workspace preferences persist and reject invalid interaction settings',async t=>{
  const p=await folder(t),settings=new Preferences(p);await settings.init();
  assert.equal(settings.value.canvasGridSize,24);assert.equal(settings.value.startupWorkspace,'home');assert.equal(settings.value.canvasWheel,'zoom');
  const patch={startupWorkspace:'layers',reduceMotion:true,canvasGridSize:32,canvasSnap:true,canvasMinimap:true,canvasWheel:'pan'};
  await settings.save(patch);const restored=new Preferences(p);await restored.init();for(const [key,value] of Object.entries(patch))assert.equal(restored.value[key],value);
  for(const bad of [{startupWorkspace:'unknown'},{canvasGridSize:0},{canvasGridSize:'24'},{canvasWheel:'scroll'},{canvasSnap:1},{reduceMotion:null},{canvasMinimap:'true'}])assert.throws(()=>settings.save(bad),/INVALID_SETTINGS/);
  assert.deepEqual(JSON.parse(await fs.readFile(settings.file,'utf8')),restored.value);
  const {validate:command}=require('../core/automation-commands.cjs');for(const settingsTab of ['canvas','notifications','about'])command('ui.navigate',{settingsTab});assert.throws(()=>command('ui.navigate',{settingsTab:'bogus'}));
});
