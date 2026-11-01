// Real downloads and native processing in an isolated test profile. Run explicitly.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {CleanupTools}=require('../core/cleanup-tools.cjs'),{TaskQueue}=require('../core/tasks.cjs');
const {hash,atomicWrite}=require('../core/storage.cjs'),{cleanupDefaults,validateCleanup}=require('../core/cleanup-settings.cjs');
const out=path.resolve('test-results/cleanup'),root=path.join(out,'profile','projects');
const report={checks:[],platform:process.platform};
const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);console.log('PASS '+name);};
(async()=>{
 await fs.mkdir(root,{recursive:true});const tools=new CleanupTools({root}),tasks=new TaskQueue(root);await tasks.init();
 const before=await tools.status();check('status does not initiate downloads',tasks.list().length===0||tasks.list().every(t=>!['queued','running'].includes(t.status)));
 for(const operation of ['metadata','watermark']){
  if(!before[operation].ready){const task=await tools.install(tasks,operation);await tasks.completions.get(task.id);const done=tasks.list().find(t=>t.id===task.id);check(operation+' explicit installation completes: '+done.message,done.status==='completed');}
  check(operation+' independently ready',(await tools.status())[operation].ready);
 }
 const runtimes={metadata:await tools.runtime('metadata'),watermark:await tools.runtime('watermark')};
 const save=async(bytes,name)=>{const info=await sharp(bytes).metadata(),resource=hash(bytes)+'.'+(info.format==='jpeg'?'jpg':info.format);await atomicWrite(path.join(root,'resources',resource),bytes);return {id:name,name,resource,width:info.width,height:info.height};};
 const execute=async(input,operation,options={},mask)=>{let part;await tools.execute({inputs:[input],mask,settings:{operation,...cleanupDefaults[operation],...options}},runtimes[operation],new AbortController().signal,'test',async p=>{part=p;},()=>{});return part;};
 const source=await sharp({create:{width:240,height:160,channels:4,background:{r:42,g:126,b:188,alpha:.8}}}).png().toBuffer();
 for(const format of ['png','jpeg','webp']){
  const file=path.join(out,'fixture.'+(format==='jpeg'?'jpg':format));
  await sharp(source).withMetadata({orientation:6}).toFormat(format).toFile(file);
  await tools.exif(runtimes.metadata,['-overwrite_original','-Artist=cleanup fixture','-GPSLatitude=23.5','-GPSLongitude=114.2','-GPSLatitudeRef=N','-GPSLongitudeRef=E','-XMP-dc:Description=fixture prompt',file],new AbortController().signal);
  const bytes=await fs.readFile(file),input=await save(bytes,format),inspection=await tools.inspect(input);
  check(format+' detects GPS and descriptive metadata',inspection.fields.some(f=>f.key.includes('GPS'))&&inspection.fields.some(f=>f.key.includes('Artist')));
  const result=await execute(input,'metadata');
  check(format+' removes private metadata',result.report.removed.some(k=>k.includes('GPS'))&&!result.report.remaining.some(k=>/GPS|Artist|Description/.test(k)));
  check(format+' display/encoding fields are not false residuals',result.report.status==='cleaned'&&result.report.remaining.length===0);
  const [a,b]=await Promise.all([sharp(bytes).raw().toBuffer(),sharp(result.bytes).raw().toBuffer()]);
  const ia=await sharp(bytes).metadata(),ib=await sharp(result.bytes).metadata();
  check(format+' exact pixels, ICC and orientation preserved',a.equals(b)&&ia.icc.equals(ib.icc)&&ia.orientation===ib.orientation);
  check(format+' original unchanged',(await fs.readFile(path.join(root,'resources',input.resource))).equals(bytes));
  await fs.writeFile(path.join(out,'cleaned.'+(format==='jpeg'?'jpg':format)),result.bytes);
 }
 const marked=await sharp(source).composite([{input:Buffer.from('<svg width="240" height="160"><rect x="175" y="115" width="30" height="20" fill="white"/></svg>')}]).png().toBuffer();
 const input=await save(marked,'watermark'),original=await sharp(marked).ensureAlpha().raw().toBuffer();
 const maskBytes=await sharp({create:{width:240,height:160,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:Buffer.from('<svg width="240" height="160"><rect x="170" y="110" width="40" height="30" fill="white"/></svg>')}]).png().toBuffer();
 const mask=await save(maskBytes,'mask');
 for(const mode of ['region','mask']){
  const result=await execute(input,'watermark',{mode,left:170,top:110,width:40,height:30,maskId:mask.id},mask),pixels=await sharp(result.bytes).ensureAlpha().raw().toBuffer();let changed=0;
  for(let y=0;y<160;y++)for(let x=0;x<240;x++){const i=(y*240+x)*4;assert.equal(pixels[i+3],original[i+3]);if(x<170||x>=210||y<110||y>=140)assert.ok(pixels.subarray(i,i+4).equals(original.subarray(i,i+4)));else if(!pixels.subarray(i,i+3).equals(original.subarray(i,i+3)))changed++;}
  check(mode+' changes selected pixels only, keeps alpha',changed>0);await fs.writeFile(path.join(out,mode+'.png'),result.bytes);
 }
 const blank=await save(source,'blank'),noop=await execute(blank,'watermark');check('auto no-detection preserves original bytes',noop.report.status==='no_watermark'&&noop.bytes.equals(source));
 const cmyk=await save(await sharp(source).toColourspace('cmyk').jpeg().toBuffer(),'cmyk');
 await assert.rejects(()=>execute(cmyk,'watermark'),/8 位 RGB/);check('CMYK is rejected instead of silently changing colors',true);
 const gammaFile=path.join(out,'gamma.png');await fs.writeFile(gammaFile,source);
 await tools.exif(runtimes.metadata,['-overwrite_original','-PNG:Gamma=2.2','-PNG:SRGBRendering=Perceptual','-Artist=fixture',gammaFile],new AbortController().signal);
 const gammaAsset=await save(await fs.readFile(gammaFile),'gamma'),gamma=await execute(gammaAsset,'metadata');
 const cleanedGamma=path.join(out,'gamma-cleaned.png');await fs.writeFile(cleanedGamma,gamma.bytes);
 const colorTags=async file=>{const [record]=JSON.parse(await tools.exif(runtimes.metadata,['-j','-Gamma','-SRGBRendering',file],new AbortController().signal));delete record.SourceFile;return record;};
 assert.deepEqual(await colorTags(gammaFile),await colorTags(cleanedGamma));check('PNG gamma and rendering intent retained without ICC',true);
 const trailerAsset=await save(Buffer.concat([source,Buffer.from('PRIVATE_TRAILER_FIXTURE')]),'trailer'),trailerResult=await execute(trailerAsset,'metadata');
 check('PNG trailing data is explicitly removed',!trailerResult.bytes.includes(Buffer.from('PRIVATE_TRAILER_FIXTURE')));
 for(const orientation of [2,3,4,5,6,7,8]){
  const bytes=await sharp(marked).withMetadata({orientation}).png().toBuffer(),input=await save(bytes,'oriented-'+orientation);
  Object.assign(input,(await sharp(bytes).metadata()).autoOrient);
  const result=await execute(input,'watermark',{mode:'region',left:10,top:10,width:20,height:20}),info=await sharp(result.bytes).metadata();
  const expected=await sharp(bytes).autoOrient().ensureAlpha().raw().toBuffer(),actual=await sharp(result.bytes).ensureAlpha().raw().toBuffer();
  assert.equal(info.width,input.width);assert.equal(info.height,input.height);
  for(let y=0;y<input.height;y++)for(let x=0;x<input.width;x++){const i=(y*input.width+x)*4;if(x<10||x>=30||y<10||y>=30)assert.ok(expected.subarray(i,i+4).equals(actual.subarray(i,i+4)));}
  check('EXIF '+orientation+' uses displayed coordinates and preserves outside pixels',true);
 }
 const demo=path.resolve('../../references/remove-ai-watermarks/demo_banana_before.png');
 try{await fs.access(demo);const bytes=await fs.readFile(demo),input=await save(bytes,'real-watermark'),start=Date.now(),result=await execute(input,'watermark');report.realSample={milliseconds:Date.now()-start,...result.report};await fs.writeFile(path.join(out,'detected-watermark.png'),result.bytes);check('real known watermark detected and reports quality honestly',result.report.marks.length>0&&['cleaned','partial','unvalidated'].includes(result.report.status));}catch(error){if(error.code!=='ENOENT')throw error;report.realSample='reference fixture not present';}
 await assert.rejects(()=>execute(input,'watermark',{mode:'mask',maskId:'empty'},blank),/保留部分/);check('full-image mask rejected',true);
 assert.throws(()=>validateCleanup({operation:'watermark',...cleanupDefaults.watermark,mode:'region',left:239,width:2},input));check('out-of-bounds selection rejected',true);
 assert.throws(()=>validateCleanup({operation:'metadata',preserveDisplay:false},input));check('display preservation cannot be disabled',true);
 const controller=new AbortController();controller.abort();await assert.rejects(()=>tools.inspect(input,controller.signal));check('cancelled read does not produce result',true);
 check('scratch jobs cleaned up',(await fs.readdir(path.join(root,'cleanup-jobs'))).length===0);
 report.status='passed';
})().catch(e=>{report.status='failed';report.error=e.stack;console.error(e);process.exitCode=1;}).finally(async()=>{await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'native-report.json'),JSON.stringify(report,null,2));});
