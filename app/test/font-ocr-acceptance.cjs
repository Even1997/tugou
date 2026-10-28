const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {TaskQueue}=require('../core/tasks.cjs'),{createDispatcher}=require('../core/automation-host.cjs'),{runProcess}=require('../core/local-process.cjs');
(async()=>{
 const out=path.resolve('test-results/font-ocr'),root=await fs.mkdtemp(path.join(out,'workspace-')),filesRoot=path.join(root,'automation');await fs.mkdir(filesRoot);
 const tasks=new TaskQueue(root);await tasks.init();const checks=[],report={root,checks};
 const check=(name,value)=>{assert.ok(value,name);checks.push(name);console.log(name);};
 const dispatch=await createDispatcher({root,filesRoot,tasks,ui:async()=>({revision:'ocr-v1',document:null,dirty:false})});
 const run=(command,args={})=>dispatch('run_command',{command:'font.'+command,args,expectedRevision:'ocr-v1'});
 let p;const write=async(name,args={})=>{p=await run('project.get',{projectId:p.id});return run(name,{projectId:p.id,fontRevision:p.fontRevision,requestId:randomUUID(),...args});};
 const wait=async r=>{for(let i=0;i<900;i++){const j=await run('job.get',{projectId:p.id,id:r.jobId});if(!['running','queued'].includes(j.task.status)){assert.equal(j.task.status,'completed',JSON.stringify(j.failure||j.result?.report?.errors||j.task));return j;}await new Promise(r=>setTimeout(r,300));}throw Error('Timeout');};
 try{
  await runProcess(path.join(process.env.TUGOU_FONT_RUNTIME,'Scripts/python.exe'),[path.resolve('test/font-ocr-fixture.py'),filesRoot],{timeout:30000});
  const expected=JSON.parse(await fs.readFile(path.join(filesRoot,'expected.json'),'utf8'));
  const chars=require('../core/font-library.cjs').templates.sample;
  p=await run('project.create',{name:'乱序识别验证',characters:chars,requestId:randomUUID()});report.projectId=p.id;
  const plan=await wait(await write('atlas.plan',{layout:'grid256'}));
  const imported=await write('atlas.import',{path:'unordered-152.png',page:0,planId:plan.id});
  const r=await wait(await write('atlas.recognize',{atlasId:imported.atlas.id}));
  report.ocr=r.result.report;report.elapsed=r.result.elapsedSeconds;report.peakMemory=r.result.peakWorkingSetBytes;
  check('OCR does not require 9:16 or library order',r.result.report.candidates.length>100&&r.result.report.width===1200);
  const matches=r.result.report.candidates.filter(c=>expected.some(e=>e.character===c.character&&Math.abs((e.box[0]+e.box[2]-c.box[0]-c.box[2])/2)<60&&Math.abs((e.box[1]+e.box[3]-c.box[1]-c.box[3])/2)<60));
  report.correctIdentityAndLocation=matches.length;check('OCR proposes at least 100 correct identities at actual locations',matches.length>=100);
  check('recognition alone never applies source',(await run('project.get',{projectId:p.id})).current===null);
  const base={atlasIds:[imported.atlas.id],background:'light',merge:true};
  for(const [label,glyphs] of [['duplicate',[expected[0],expected[0]]],['outside',[{character:expected[0].character,box:[0,0,16000,20]}]],['invalid identity',[{character:' ',box:[0,0,100,100]}]]]){await assert.rejects(()=>write('atlas.process',{...base,mapping:{jobId:r.id,glyphs}}));check('reject '+label+' mapping',true);}
  await assert.rejects(()=>write('atlas.process',{...base,mapping:{jobId:plan.id,glyphs:[expected[0]]}}));check('cannot map from non-recognition job',true);
  const done=await wait(await write('atlas.process',{...base,mapping:{jobId:r.id,glyphs:expected},normalization:{}}));
  check('reviewed unordered 152 glyphs compile to correct identities',done.result.report.glyphs.length===152&&done.result.report.geometry==='pass');
  check('crop and recognition source retained',done.result.report.glyphs.every(g=>g.source.box.length===4));
  await write('revision.apply',{candidateId:done.id});const built=await wait(await write('build',{mode:'draft'}));
  check('TTF and WOFF2 actual cmap roundtrip',built.result.report.glyphCount===152&&built.result.report.cmapRoundTrip);
  await run('artifact.export',{projectId:p.id,jobId:built.id,artifactId:'font.ttf',path:'unordered-152.ttf'});
  check('TTF export nonempty',(await fs.stat(path.join(filesRoot,'unordered-152.ttf'))).size>1000);
  const original=process.env.TUGOU_OCR_REAL_IMAGE;
  if(original){
    p=await run('project.create',{name:'粗圆原图识别',characters:require('../core/font-library.cjs').templates.common,requestId:randomUUID()});report.realProjectId=p.id;
    await fs.copyFile(original,path.join(filesRoot,'real.png'));const realPlan=await wait(await write('atlas.plan',{layout:'grid256'}));
    const real=await write('atlas.import',{planId:realPlan.id,page:0,path:'real.png'});const recognized=await wait(await write('atlas.recognize',{atlasId:real.atlas.id}));
    const cs=recognized.result.report.candidates;report.real={candidates:cs,elapsed:recognized.result.elapsedSeconds,peakMemory:recognized.result.peakWorkingSetBytes};
    check('user image adaptive detection finds 256 boxes',cs.length===256);
    check('similar Latin symbols require explicit review',cs.filter(c=>c.character&&c.character.charCodeAt(0)<128).every(c=>c.warnings.includes('CASE_OR_SYMBOL_CHECK')));
    const glyphs=cs.filter(c=>c.score>=.9&&!c.warnings.length&&p.characters.includes(c.character)&&cs.filter(e=>e.character===c.character).length===1).map(({character,box})=>({character,box}));
    check('user image has over 100 unambiguous unique candidates',glyphs.length>100);
    const processed=await wait(await write('atlas.process',{atlasIds:[real.atlas.id],background:'light',merge:true,mapping:{jobId:recognized.id,glyphs},normalization:{}}));
    await write('revision.apply',{candidateId:processed.id});const font=await wait(await write('build',{mode:'draft'}));
    report.real.exported=font.result.report.glyphCount;check('real source selected glyphs export actual fonts',font.result.report.glyphCount===glyphs.length&&font.result.report.cmapRoundTrip);
    await run('artifact.export',{projectId:p.id,jobId:font.id,artifactId:'font.ttf',path:'real-selected.ttf'});
  }
 }catch(e){report.failure=e.stack;throw e;}finally{await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));await tasks.shutdown();}
})().catch(e=>{console.error(e);process.exitCode=1;});
