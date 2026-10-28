const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createDispatcher}=require('../core/automation-host.cjs'),{validate}=require('../core/automation-commands.cjs');
const {FontService}=require('../core/font-service.cjs');
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'tugou-font-')),filesRoot=path.join(root,'files');await fs.mkdir(filesRoot);
 t.after(async()=>{assert.ok(path.basename(root).startsWith('tugou-font-'));assert.equal(path.dirname(await fs.realpath(root)),await fs.realpath(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});});
 const tasks={list:()=>[]},dispatch=await createDispatcher({root,filesRoot,tasks,ui:async()=>({revision:'v1',dirty:true,document:null})});
 const run=(command,args)=>dispatch('run_command',{command,args,expectedRevision:'v1'});
 return {root,filesRoot,run,service:new FontService(root,tasks)};
}
test('font schema rejects executable arguments, oversized images and malformed revisions',()=>{
 for(const args of [{projectId:'p',fontRevision:-1,requestId:'r'},{projectId:'p',fontRevision:0,requestId:'r',cellSize:8192},{projectId:'p',fontRevision:0,requestId:'r',executable:'cmd.exe'}])assert.throws(()=>validate('font.atlas.plan',args));
 assert.throws(()=>validate('font.review.record',{projectId:'p',fontRevision:0,requestId:'r',characters:'A',identity:'probably',style:'accepted',note:'x'}));
 const processArgs={projectId:'p',fontRevision:0,requestId:'r',atlasIds:['a'],background:'light'};
 validate('font.atlas.process',{...processArgs,normalization:{}});
 validate('font.atlas.process',{...processArgs,normalization:{weight:false,cjkExtent:720}});
 validate('font.atlas.recognize',{projectId:'p',fontRevision:0,requestId:'r',atlasId:'a'});
 validate('font.glyph.preview',{projectId:'p',characters:'春A'});assert.throws(()=>validate('font.glyph.preview',{projectId:'p',characters:'A'.repeat(257)}));assert.throws(()=>validate('font.glyph.preview',{projectId:'p',characters:'A',path:'../outside'}));
 validate('font.atlas.process',{...processArgs,mapping:{jobId:'r',glyphs:[{character:'春',box:[0,1,100,120]}]}});
 for(const mapping of [{jobId:'r',glyphs:[]},{jobId:'r',glyphs:[{character:'春',box:[0,-1,100,120]}]},{jobId:'r',glyphs:[{character:'春',box:[0,1,100.2,120]}]}])assert.throws(()=>validate('font.atlas.process',{...processArgs,mapping}));
 validate('font.atlas.import',{projectId:'p',fontRevision:0,requestId:'r',planId:'plan',page:100,path:'page.png'});
 for(const normalization of [{strokeWidth:0},{cjkExtent:10000},{weight:'yes'},{executable:'cmd.exe'}])assert.throws(()=>validate('font.atlas.process',{...processArgs,normalization}));
 const refine={projectId:'p',fontRevision:0,requestId:'r',path:'input.ttf'};
 validate('font.outline.refine',{...refine,smoothing:0,bold:0});
 for(const extra of [{smoothing:-1},{smoothing:25},{bold:13},{bold:'4'},{preserveTopology:false},{executable:'cmd.exe'}])assert.throws(()=>validate('font.outline.refine',{...refine,...extra}));
});
test('font projects deduplicate codepoints, reject invisible characters and keep independent revisions',async t=>{
 const f=await fixture(t),p=await f.run('font.project.create',{name:'Test Font',characters:'AAa木木',requestId:'a'});
 assert.equal(p.characters,'Aa木');assert.equal(p.fontRevision,0);
 for(const c of ['A\n','A\u200b','A\ud800'])await assert.rejects(()=>f.run('font.project.create',{name:'Test Font',characters:c,requestId:c}),e=>e.code==='INVALID_ARGUMENT');
 await assert.rejects(()=>f.run('font.project.get',{projectId:'../../outside'}),e=>e.code==='INVALID_ARGUMENT');
 assert.equal((await f.run('font.project.list',{})).projects.length,1);
});

test('font library copies the full repertoire into isolated Chinese-named projects and keeps batch order',async t=>{
 const f=await fixture(t),{templates,batches,prompt,group}=require('../core/font-library.cjs');
 const chars=[...templates.common],pages=batches(templates.common);
 assert.equal(chars.length,3849);assert.equal(new Set(chars).size,3849);assert.equal(pages.length,16);
 assert.equal(pages.map(p=>p.characters).join(''),templates.common);assert.equal([...pages.at(-1).characters].length,9);
 assert.equal(chars.filter(c=>group(c)==='chinese').length,3755);assert.equal([...templates.sample].length,152);
 assert.ok(prompt('春日来信',pages[1]).includes(chars.slice(256,272).join(' ')));
 const a=await f.run('font.project.create',{name:'春日来信',characters:templates.common,requestId:'full'}),b=await f.run('font.project.create',{name:'胖泡泡',characters:templates.latin,requestId:'latin'});
 assert.notEqual(a.id,b.id);assert.equal((await f.service.load(a.id)).characters,templates.common);assert.equal((await f.service.load(b.id)).characters,templates.latin);
 await assert.rejects(()=>f.run('font.project.create',{name:'  ',characters:'A',requestId:'blank'}),e=>e.code==='INVALID_ARGUMENT');
 const large=await f.run('font.project.create',{name:'Large',characters:Array.from({length:4097},(_,i)=>String.fromCodePoint(0x4e00+i)).join(''),requestId:'large'});assert.equal([...large.characters].length,4097);
 const empty=await f.run('font.project.create',{name:'Empty',characters:'',requestId:'empty'});assert.equal(empty.characters,'');
});
test('font artifacts reject forged IDs, checksum changes and filesystem junctions',async t=>{
 const f=await fixture(t),p=await f.run('font.project.create',{name:'Test Font',characters:'A',requestId:'a'});
 const project=await f.service.load(p.id),id=require('node:crypto').randomUUID(),dir=path.join(f.root,'fonts',p.id,'jobs',id);await fs.mkdir(dir,{recursive:true});
 project.jobs.push({id,taskId:'task',operation:'build'});await f.service.save(project);
 const data=Buffer.from('private fixture'),{hash}=require('../core/storage.cjs');await fs.writeFile(path.join(dir,'font.ttf'),data);
 await fs.writeFile(path.join(dir,'result.json'),JSON.stringify({artifacts:[{id:'font.ttf',file:'font.ttf',sha256:hash(data),mimeType:'font/ttf'}]}));
 const dispatch=await createDispatcher({root:f.root,filesRoot:f.filesRoot,tasks:{list:()=>[{id:'task',status:'completed'}]},ui:async()=>({revision:'v1'})});
 const exp=args=>dispatch('run_command',{command:'font.artifact.export',expectedRevision:'v1',args:{projectId:p.id,jobId:id,artifactId:'font.ttf',...args}});
 await assert.rejects(()=>exp({artifactId:'../input.json',path:'out.ttf'}),e=>e.code==='NOT_FOUND');
 await fs.symlink(dir,path.join(f.filesRoot,'link'),process.platform==='win32'?'junction':'dir');
 await assert.rejects(()=>exp({path:'link/out.ttf'}),/链接/);
 await fs.writeFile(path.join(dir,'font.ttf'),'tamper');
 await assert.rejects(()=>exp({path:'out.ttf'}),e=>e.code==='ARTIFACT_CHANGED');
});
