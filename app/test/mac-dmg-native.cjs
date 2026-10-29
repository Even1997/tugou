// Native CI acceptance against the actual release DMG and packaged download controller.
const {app}=require('electron'),fs=require('node:fs'),fsp=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const out=path.resolve('test-results/mac-release'),profile=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'tugou-dmg-native-')));
app.setPath('userData',profile);
const report={platform:process.platform,arch:process.arch,checks:[]};let server,mount;
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
app.whenReady().then(async()=>{
  assert.equal(process.platform,'darwin');
  const source=path.join(path.resolve(process.env.TUGOU_MAC_QA_BUNDLE),'Contents/Resources/app.asar');
  const version=require(path.join(source,'package.json')).version,name=`tugou-${version}-mac-${process.arch}.dmg`,original=path.resolve('release',name);
  const {MacDmgUpdater}=require(path.join(source,'core/mac-dmg-updater.cjs')),{hashFile}=require(path.join(source,'core/runtime-files.cjs'));
  const size=fs.statSync(original).size,digest=await hashFile(original),opened=[];
  server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Length':size});fs.createReadStream(original).pipe(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const realFetch=global.fetch;global.fetch=(url,options)=>realFetch(`http://127.0.0.1:${server.address().port}/dmg`,options);
  const updater=new MacDmgUpdater({profile,version:'0.0.0',openPath:async file=>{opened.push(file);return '';},fetchRelease:async()=>({ok:true,json:async()=>({tag_name:'v'+version,draft:false,prerelease:false,assets:[{name,browser_download_url:`https://github.com/Even1997/tugou/releases/download/v${version}/${name}`,size,digest:'sha256:'+digest}]})})});
  let progressed=false;updater.on('download-progress',p=>{if(p.transferred>0)progressed=true;});
  await updater.checkForUpdates();check('packaged controller selects native architecture',updater.asset.name===name);
  await updater.downloadUpdate();check('full release DMG streams and verifies',progressed&&fs.statSync(updater.file).size===size&&(await hashFile(updater.file))===digest);
  check('download does not launch an installer',opened.length===0);await updater.openInstaller();check('open action receives only the verified DMG',opened[0]===updater.file);
  const xml=execFileSync('hdiutil',['attach','-readonly','-nobrowse','-plist',updater.file],{timeout:120000});
  const mounted=JSON.parse(execFileSync('plutil',['-convert','json','-o','-','-'],{input:xml,encoding:'utf8'}));
  mount=mounted['system-entities'].find(entry=>entry['mount-point'])?.['mount-point'];check('downloaded DMG mounts natively',!!mount);
  const plist=path.join(mount,'Tugou.app/Contents/Info.plist');
  check('mounted application version matches release',execFileSync('/usr/libexec/PlistBuddy',['-c','Print CFBundleShortVersionString',plist],{encoding:'utf8'}).trim()===version);
  report.bytes=size;report.sha256=digest;report.version=version;report.passed=true;
}).catch(e=>{report.error=e.stack;console.error(e);}).finally(async()=>{
  if(mount)try{execFileSync('hdiutil',['detach',mount],{timeout:60000});}catch(e){report.passed=false;report.detachError=e.message;}
  server?.close();server?.closeAllConnections();fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'dmg-native.json'),JSON.stringify(report,null,2));
  await fsp.rm(profile,{recursive:true,force:true});app.exit(report.passed?0:1);
});
