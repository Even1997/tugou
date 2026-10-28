const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto'),{runProcess}=require('../core/local-process.cjs');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve(process.env.TUGOU_FONT_TEST_OUTPUT||'test-results/font-normalization');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;
const report={checks:[],root:path.join(profile,'workspace'),filesRoot:path.join(profile,'automation'),datasets:[],errors:[]};
const python=path.join(process.env.TUGOU_FONT_RUNTIME,'Scripts/python.exe');
let transport,done=false,primary;
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},240000);
app.on('browser-window-created',(_,window)=>{
 window.show=()=>{};window.focus=()=>{};window.webContents.setBackgroundThrottling(false);if(primary)return;primary=window;
 window.webContents.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);});
 window.webContents.once('did-finish-load',async()=>{
  const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
  try{
   const descriptor=path.join(profile,'mcp-session.json');
   for(let i=0;i<100&&!fs.existsSync(descriptor);i++)await new Promise(r=>setTimeout(r,50));
   const script=process.env.TUGOU_TEST_APP?path.join(path.dirname(process.env.TUGOU_TEST_APP),'core/mcp.cjs'):path.resolve('core/mcp.cjs');
   transport=new StdioClientTransport({command:process.execPath,args:[script,'--session',descriptor],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'font-normalization-proof',version:'1.0.0'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r;};
   const run=async(command,args={})=>(await call('run_command',{command,args,expectedRevision:(await call('get_state')).structuredContent.revision})).structuredContent;
   const original=(await call('get_state')).structuredContent;
   const catalog=(await call('list_commands',{domain:'font'})).structuredContent;
   check('MCP normalization schema discoverable',catalog.commands.find(c=>c.name==='font.atlas.process')?.inputSchema.properties.normalization);
   check('runtime advertises four opt-in corrections',(await run('font.status')).normalization.length===4);
   for(const dataset of [
    {name:'Spring Letter',characters:'春日来信',source:process.env.TUGOU_FONT_SPRING,kind:'spring'},
    {name:'Full Repertoire',characters:fs.readFileSync(process.env.TUGOU_FONT_CHARACTERS,'utf8').trim(),source:process.env.TUGOU_FONT_REFERENCE,kind:'controlled'},
   ]){
    const project=await run('font.project.create',{name:dataset.name,characters:dataset.characters,requestId:randomUUID()});
    const write=async(command,args={})=>run(command,{projectId:project.id,fontRevision:(await run('font.project.get',{projectId:project.id})).fontRevision,requestId:randomUUID(),...args});
    const wait=async job=>{let r;do{r=await run('task.wait',{id:job.taskId,timeoutMs:1000});}while(r.timedOut);assert.equal(r.task.status,'completed',JSON.stringify(r.task));return (await run('font.job.get',{projectId:project.id,id:job.jobId})).result;};
    const plan=await write('font.atlas.plan'),planned=await wait(plan);
    const planFile=path.join(report.root,'fonts',project.id,'jobs',plan.jobId,'plan.json');
    await runProcess(python,[path.resolve('test/font-normalization-fixtures.py'),planFile,dataset.source,report.filesRoot,dataset.kind],{timeout:60000});
    const inputRecords=JSON.parse(fs.readFileSync(path.join(report.filesRoot,'normalization-input-records.json'),'utf8'));
    const ids=[];
    for(const page of planned.plan.pages)ids.push((await write('font.atlas.import',{planId:plan.jobId,page:page.page,path:`normalization-input-${page.page}.png`,sourceNote:dataset.kind==='spring'?'Original AI Spring atlas; same scale and padding for all four cells':'Controlled 152-glyph stress fixture; deliberate scale/translation/weight perturbations'})).atlas.id);
    const result={...dataset,source:undefined,projectId:project.id,planJob:plan.jobId,inputRecords,variants:{}};
    report.datasets.push(result);
    for(const mode of ['before','after']){
     const job=await write('font.atlas.process',{atlasIds:ids,background:'light',...(mode==='after'?{normalization:{}}:{})}),processed=await wait(job);
     check(`${dataset.name} ${mode}: complete glyphs`,processed.report.glyphs.length===[...dataset.characters].length&&processed.report.errors.length===0);
     await write('font.revision.apply',{candidateId:job.jobId});
     const buildJob=await write('font.build',{mode:'draft'}),built=await wait(buildJob);
     check(`${dataset.name} ${mode}: actual TTF/WOFF2`,built.report.cmapRoundTrip&&built.report.allOutlinesNonempty);
     const folder=path.join(out,dataset.kind,mode);fs.mkdirSync(folder,{recursive:true});
     const jobDir=path.join(report.root,'fonts',project.id,'jobs',job.jobId);
     const buildDir=path.join(report.root,'fonts',project.id,'jobs',buildJob.jobId);
     for(const asset of built.artifacts)fs.copyFileSync(path.join(buildDir,asset.file),path.join(folder,asset.file));
     for(const asset of processed.artifacts)fs.copyFileSync(path.join(jobDir,asset.file),path.join(folder,asset.file));
     result.variants[mode]={jobId:job.jobId,buildJobId:buildJob.jobId,elapsedSeconds:processed.elapsedSeconds,peakMiB:processed.peakWorkingSetBytes/1024**2,folder};
     if(mode==='after'){
      const records=processed.report.glyphs.map(g=>g.normalization);
      check(`${dataset.name}: every glyph records corrections`,records.every(Boolean));
      check(`${dataset.name}: dot/counter topology unchanged`,records.every(r=>r.before.components===r.after.components&&r.before.holes===r.after.holes));
      check(`${dataset.name}: isotropic scale only`,records.every(r=>r.transform.scale>=.6&&r.transform.scale<=1.6));
      const measured=records.filter(r=>r.beforeErrorPixels);
      check(`${dataset.name}: metrics include every glyph, including safety-limited ones`,measured.length===records.length);
      result.measurements={};
      for(const dimension of ['center','size','baseline','weight']){
       const mean=key=>measured.reduce((s,r)=>s+r[key][dimension],0)/measured.length;
       result.measurements[dimension]={before:mean('beforeErrorPixels'),after:mean('afterErrorPixels')};
       check(`${dataset.name}: ${dimension} average error improves`,mean('afterErrorPixels')<mean('beforeErrorPixels'));
      }
      result.needsReview=processed.report.normalization.needsReview;
      const preview=await call('run_command',{command:'font.artifact.preview',args:{projectId:project.id,jobId:job.jobId,artifactId:'normalization-0.png'},expectedRevision:(await call('get_state')).structuredContent.revision});
      check(`${dataset.name}: MCP comparison image`,preview.content.some(c=>c.type==='image'));
      const query=await run('font.glyph.query',{projectId:project.id,limit:100});
      check(`${dataset.name}: query returns per-glyph normalization`,query.glyphs.every(g=>g.normalization));
      await assert.rejects(()=>write('font.build',{mode:'strict'}));check(`${dataset.name}: correction does not bypass human review`,true);
     }
     const font=fs.readFileSync(path.join(folder,'font.ttf')).toString('base64');
     const browser=await window.webContents.executeJavaScript(`(async()=>{const face=new FontFace('NormalizationProof',Uint8Array.from(atob(${JSON.stringify(font)}),c=>c.charCodeAt(0)));await face.load();document.fonts.clear();document.fonts.add(face);const c=document.createElement('canvas');c.width=1152;c.height=80+Math.ceil(${dataset.characters.length}/16)*72;const x=c.getContext('2d');x.fillStyle='#faf9f5';x.fillRect(0,0,c.width,c.height);x.fillStyle='#18262c';x.font='56px NormalizationProof';const text=${JSON.stringify(dataset.characters)};for(let i=0;i<text.length;i++)x.fillText(text[i],20+(i%16)*70,72+Math.floor(i/16)*72);return{status:face.status,png:c.toDataURL('image/png')};})()`);
     check(`${dataset.name} ${mode}: Chromium FontFace loads`,browser.status==='loaded');
     fs.writeFileSync(path.join(folder,'chromium.png'),Buffer.from(browser.png.split(',')[1],'base64'));
    }
   }
   const after=(await call('get_state')).structuredContent;
   check('desktop document and dirty state unchanged',original.revision===after.revision&&original.dirty===after.dirty);
   check('desktop no console errors',report.errors.length===0);
   console.log(JSON.stringify({checks:report.checks.length,output:out}));finish(0);
  }catch(error){report.failure=error.stack;console.error(error);finish(1);}
 });
});
process.argv.push('--mcp-enable');require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
