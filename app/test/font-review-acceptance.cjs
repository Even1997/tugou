const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {TaskQueue}=require('../core/tasks.cjs'),{createDispatcher}=require('../core/automation-host.cjs'),{runProcess}=require('../core/local-process.cjs');
(async()=>{
 const out=path.resolve('test-results/font-review');await fs.mkdir(out,{recursive:true});
 const root=await fs.mkdtemp(path.join(out,'workspace-')),filesRoot=path.join(root,'automation');await fs.mkdir(filesRoot);
 const tasks=new TaskQueue(root);await tasks.init();const report={root,checks:[]};
 const check=(n,v)=>{assert.ok(v,n);report.checks.push(n);console.log(n);};
 const dispatch=await createDispatcher({root,filesRoot,tasks,ui:async()=>({revision:'review-v1',document:null,dirty:false})});
 const run=(name,args={})=>dispatch('run_command',{command:'font.'+name,args,expectedRevision:'review-v1'});
 let p;const write=async(name,args={})=>{p=await run('project.get',{projectId:p.id});return run(name,{projectId:p.id,fontRevision:p.fontRevision,requestId:randomUUID(),...args});};
 const wait=async r=>{for(let i=0;i<1200;i++){const j=await run('job.get',{projectId:p.id,id:r.jobId});if(!['running','queued'].includes(j.task.status)){assert.equal(j.task.status,'completed',JSON.stringify(j.failure||j.result?.report?.errors||j.task));return j;}await new Promise(r=>setTimeout(r,250));}throw Error('timeout');};
 try{
  await runProcess(path.join(process.env.TUGOU_FONT_RUNTIME,'Scripts/python.exe'),[path.resolve('test/font-ocr-fixture.py'),filesRoot,'600'],{timeout:30000});
  const expected=JSON.parse(await fs.readFile(path.join(filesRoot,'expected.json'),'utf8'));
  p=await run('project.create',{name:'自由导入600字验证',characters:'',requestId:randomUUID()});report.projectId=p.id;
  check('empty reference library is valid',p.characters==='');
  const imported=await write('atlas.import',{path:'unordered-152.png'});report.atlasId=imported.atlas.id;
  check('import needs no plan, page, order or character quota',!imported.atlas.planId&&!imported.atlas.page);
  await assert.rejects(()=>write('atlas.process',{atlasIds:[imported.atlas.id],background:'light'}),e=>e.code==='MAPPING_REQUIRED');check('unmapped source cannot silently use fixed grid',true);
  const recognized=await wait(await write('atlas.recognize',{atlasId:imported.atlas.id}));report.recognitionId=recognized.id;
  report.ocr={count:recognized.result.report.candidates.length,elapsed:recognized.result.elapsedSeconds,peakMemory:recognized.result.peakWorkingSetBytes};
  check('real OCR detects over 512 glyph boxes',report.ocr.count>512);
  const entries=expected.map((g,i)=>({...g,included:i!==1,reviewed:i===0}));
  const saved=await write('atlas.review',{jobId:recognized.id,entries});
  const reviewed=await run('job.get',{projectId:p.id,id:recognized.id});check('600 review mappings persist including exclusions and confirmations',reviewed.review.entries.length===600&&reviewed.review.entries[0].reviewed&&!reviewed.review.entries[1].included);
  await assert.rejects(()=>run('atlas.review',{projectId:p.id,fontRevision:saved.fontRevision-1,requestId:randomUUID(),jobId:recognized.id,entries}),e=>e.code==='FONT_CONFLICT');check('stale review cannot overwrite newer draft',true);
  const base={atlasIds:[imported.atlas.id],background:'light',merge:true};
  await assert.rejects(()=>write('atlas.process',{...base,mapping:{jobId:recognized.id,glyphs:[expected[0],expected[0]]}}),e=>e.code==='DUPLICATE_GLYPH');check('duplicate characters cannot overwrite silently',true);
  const small=await wait(await write('atlas.process',{...base,mapping:{jobId:recognized.id,glyphs:expected.slice(0,7)},normalization:{}}));
  await write('revision.apply',{candidateId:small.id});p=await run('project.get',{projectId:p.id});
  check('seven outside-library glyphs apply and enter library',p.covered.length===7&&p.characters.length===7);
  const subset=await wait(await write('build',{mode:'draft'}));check('seven glyphs export without completing a quota',subset.result.report.glyphCount===7&&subset.result.report.cmapRoundTrip);
  const large=await wait(await write('atlas.process',{...base,mapping:{jobId:recognized.id,glyphs:expected}}));
  report.processing={elapsed:large.result.elapsedSeconds,peakMemory:large.result.peakWorkingSetBytes};check('all 600 corrected boxes vectorize without count cap',large.result.report.glyphs.length===600&&large.result.report.geometry==='pass');
  await write('revision.apply',{candidateId:large.id});const built=await wait(await write('build',{mode:'draft'}));
  check('600 glyph TTF and WOFF2 have valid cmap and outlines',built.result.report.glyphCount===600&&built.result.report.cmapRoundTrip&&built.result.report.allOutlinesNonempty);
  await run('artifact.export',{projectId:p.id,jobId:built.id,artifactId:'font.ttf',path:'review-600.ttf'});
  // Repeat OCR leaves a realistic fresh default-review screen for desktop QA.
  const fresh=await wait(await write('atlas.recognize',{atlasId:imported.atlas.id}));report.freshRecognitionId=fresh.id;
  const old=JSON.parse(await fs.readFile('test-results/font-ocr/acceptance.json','utf8'));
  const real=JSON.parse(await fs.readFile(path.join(old.root,'fonts',old.realProjectId,'project.json'),'utf8'));
  const source=real.atlases[0];await fs.copyFile(path.join(old.root,'fonts',real.id,'originals',source.sha256+'.'+source.format),path.join(filesRoot,'special.png'));
  p=await run('project.create',{name:'粗圆原图自由复核',characters:'',requestId:randomUUID()});report.realProjectId=p.id;
  const realImport=await write('atlas.import',{path:'special.png'});const realOcr=await wait(await write('atlas.recognize',{atlasId:realImport.atlas.id}));
  report.real={count:realOcr.result.report.candidates.length,elapsed:realOcr.result.elapsedSeconds};
  check('user special 256 glyph source works without library or plan',report.real.count===256);
 }catch(e){report.failure=e.stack;throw e;}finally{await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));await tasks.shutdown();}
})().catch(e=>{console.error(e);process.exitCode=1;});
