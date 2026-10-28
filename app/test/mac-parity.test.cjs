const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {windowChrome,installedForUpdates}=require('../core/desktop-platform.cjs');
const {fontEnvironment,setupHint}=require('../core/font-environment.cjs');
const {normalizeFonts}=require('../core/font-catalog.cjs'),{script,macFonts}=require('../core/mac-fonts.cjs');
const {setup}=require('../scripts/setup-font-runtime.cjs');
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'tugou-parity-')));t.after(async()=>{assert.ok(path.basename(root).startsWith('tugou-parity-'));await fs.rm(root,{recursive:true,force:true});});return root;}

test('Mac reserves native traffic lights while Windows retains custom controls',()=>{
  assert.deepEqual(windowChrome('win32'),{frame:false});assert.equal(windowChrome('darwin').frame,undefined);assert.equal(windowChrome('darwin').titleBarStyle,'hidden');assert.deepEqual(windowChrome('darwin').trafficLightPosition,{x:16,y:20});
});
test('installed updater accepts system and user Applications; refuses preview and mounted DMG',()=>{
  const base={packaged:true,platform:'darwin',home:'/Users/字体 用户',exists:()=>false};
  for(const root of ['/Applications','/Users/字体 用户/Applications'])assert.ok(installedForUpdates({...base,executable:root+'/土狗.app/Contents/MacOS/Tugou'}));
  for(const executable of ['/Volumes/土狗/土狗.app/Contents/MacOS/Tugou','/Applications-fake/土狗.app/Contents/MacOS/Tugou','/Applications/Tugou'])assert.equal(installedForUpdates({...base,executable}),false);
  assert.equal(installedForUpdates({...base,packaged:false,executable:'/Applications/土狗.app/Contents/MacOS/Tugou'}),false);
  assert.ok(installedForUpdates({packaged:true,platform:'win32',executable:'C:\\Apps\\土狗\\Tugou.exe',exists:p=>p==='C:\\Apps\\土狗\\Uninstall Tugou.exe'}));
});
test('Mac font adapter enumerates normal faces, aliases and CSS weights',()=>{
  const fonts={Regular:0,Bold:.4,Light:-.4,Italic:0},members=Object.keys(fonts).map(n=>[n,n,5,n==='Italic'?1:0]);
  const raw=vm.runInNewContext(script,{ObjC:{import:()=>{},deepUnwrap:v=>v,unwrap:v=>v},$:{NSFontManager:{sharedFontManager:{availableFontFamilies:['.Hidden','中文 Family'],availableMembersOfFontFamily:()=>members}},NSFont:{fontWithNameSize:name=>({displayName:name,fontDescriptor:{objectForKey:()=>({objectForKey:()=>fonts[name]})}})}}});
  const result=normalizeFonts(macFonts(JSON.parse(raw)));assert.equal(result.length,1);assert.deepEqual(result[0].weights,[300,400,700]);assert.ok(result[0].aliases.includes('Bold'));assert.equal(result[0].family,'中文 Family');
  assert.deepEqual(normalizeFonts(macFonts([{family:'Empty',traits:[]}]))[0].weights,[400]);
});
test('new text layers use bundled font on both platforms without overriding explicit choices',()=>{
  const {createLayer}=require('../core/layers.cjs'),{builtinFace}=require('../core/font-weights.cjs');
  assert.ok(builtinFace(createLayer('text')));assert.equal(createLayer('text',{fontFamily:'Custom'}).fontFamily,'Custom');assert.equal(createLayer('shape').fontFamily,undefined);
});
test('font environment checks architecture and traversal before selecting an interpreter',async t=>{
  const root=await fixture(t);await fs.mkdir(path.join(root,'bin'));await fs.writeFile(path.join(root,'bin/python3'),'fixture',{mode:0o755});await fs.writeFile(path.join(root,'potrace'),'fixture',{mode:0o755});
  const manifest={platform:'darwin',arch:'arm64',python:'bin/python3',potrace:'potrace'},write=m=>fs.writeFile(path.join(root,'runtime.json'),JSON.stringify(m));
  await write(manifest);assert.ok((await fontEnvironment(root,'darwin','arm64')).ready);await assert.rejects(fontEnvironment(root,'darwin','x64'),/芯片/);await assert.rejects(fontEnvironment(root,'win32','arm64'),/系统/);
  await write({...manifest,python:'../evil/python'});await assert.rejects(fontEnvironment(root,'darwin','arm64'),/路径/);
  await write({...manifest,python:path.resolve(root,'bin/python3')});await assert.rejects(fontEnvironment(root,'darwin','arm64'),/路径/);
  assert.match(setupHint('darwin'),/node scripts/);assert.doesNotMatch(setupHint('darwin'),/ps1/);
});
test('font installer uses native paths and writes configuration only after probes succeed',async t=>{
  const root=await fixture(t),source=path.join(root,'potrace source');await fs.mkdir(source);
  for(const name of ['potrace','COPYING','AUTHORS','README'])await fs.writeFile(path.join(source,name),'fixture');
  const calls=[],target=path.join(root,'font runtime'),workspace=path.join(root,'workspace');
  const run=(file,args)=>{calls.push({file,args});if(args.includes('-c')&&args.at(-1).includes('sys.version_info'))return JSON.stringify({version:[3,12],machine:'arm64'});if(args.includes('-c')&&args.at(-1).includes('m.version'))return '{}';return '';};
  await setup(['python3',source,target,workspace],{platform:'darwin',arch:'arm64',run});
  const m=JSON.parse(await fs.readFile(path.join(target,'runtime.json'),'utf8'));assert.equal(m.python,'bin/python3');assert.equal(m.potrace,'potrace/potrace');assert.equal(m.arch,'arm64');assert.equal(m.platform,'darwin');assert.ok(calls.some(c=>c.args.includes('--no-deps')));assert.equal(JSON.parse(await fs.readFile(path.join(workspace,'font-runtime.json'),'utf8')).directory,target);
  await assert.rejects(setup(['python3',source,target,workspace],{platform:'darwin',arch:'x64',run}),/芯片/);
  const failed=path.join(root,'failed');await assert.rejects(setup(['python3',source,failed],{platform:'darwin',arch:'arm64',run:(f,a)=>{if(a.includes('install'))throw Error('offline');return run(f,a);}}),/offline/);await assert.rejects(fs.access(path.join(failed,'runtime.json')));
});
test('POSIX venv allows final Python symlink',{skip:process.platform==='win32'?'Windows host cannot create POSIX executable symlinks; run on macOS':false},async t=>{
  const root=await fixture(t),env=path.join(root,'environment'),outside=path.join(root,'interpreter');await fs.mkdir(env);await fs.mkdir(path.join(env,'bin'));
  await fs.writeFile(outside,'fixture',{mode:0o755});await fs.writeFile(path.join(env,'potrace'),'fixture',{mode:0o755});
  await fs.symlink(outside,path.join(env,'bin/python3'),'file');
  await fs.writeFile(path.join(env,'runtime.json'),JSON.stringify({python:'bin/python3',potrace:'potrace'}));
  assert.ok((await fontEnvironment(env,'darwin')).ready);
});
test('font environment rejects linked data directories',async t=>{
  const root=await fixture(t),env=path.join(root,'environment');await fs.mkdir(env);await fs.mkdir(path.join(env,'bin'));
  await fs.writeFile(path.join(env,'bin/python3'),'fixture',{mode:0o755});await fs.writeFile(path.join(env,'potrace'),'fixture',{mode:0o755});
  await fs.symlink(path.join(env,'bin'),path.join(env,'linked-bin'),process.platform==='win32'?'junction':'dir');
  await fs.writeFile(path.join(env,'runtime.json'),JSON.stringify({python:'linked-bin/python3',potrace:'potrace'}));
  await assert.rejects(fontEnvironment(env,'darwin'),/链接/);
});
test('packaging retains separate signed-runtime Mac architectures, ZIP updates and Windows installer',()=>{
  const c=require('../electron-builder.cjs');assert.ok(c.mac.hardenedRuntime);assert.equal(c.mac.minimumSystemVersion,'13.0');for(const target of c.mac.target)assert.deepEqual(target.arch,['arm64','x64']);assert.ok(c.mac.target.some(t=>t.target==='zip'));assert.equal(c.win.target[0].target,'nsis');assert.equal(c.nsis.deleteAppDataOnUninstall,false);
});
