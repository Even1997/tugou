const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp'),{randomUUID}=require('node:crypto');
const {LocalAIService,validateLocalSettings}=require('../core/local-ai.cjs'),{saveImage}=require('../core/generation.cjs'),{runProcess}=require('../core/local-process.cjs'),{verifiedDownload}=require('../core/runtime-files.cjs');
const out=path.resolve('test-results/cutout-repair'),runtimeFolder=process.env.TUGOU_TEST_RUNTIME||'D:/CanvasStudioRuntime';
const report={checks:[],samples:[]};
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
(async()=>{
 await fs.mkdir(out,{recursive:true});const root=await fs.mkdtemp(path.join(out,'native-')),engine=new LocalAIService({root}),signal=new AbortController().signal;
 const downloaded=await verifiedDownload(require('../runtime/components.json').cutoutLight,path.join(out,'verified-cache'),signal);
 check('model download matches pinned SHA256',(await fs.stat(downloaded)).size===4574861);
 await engine.configure(runtimeFolder);const status=await engine.status();
 check('installed precise and lightweight models are independently discovered',status.cutoutModels.includes('birefnet')&&status.cutoutModels.includes('u2netp'));
 const settings=validateLocalSettings({operation:'cutout',model:'u2netp'},{width:512,height:768}),runtime=await engine.resolveRuntime(settings,undefined,{width:512,height:768});
 check('lightweight uses explicit CPU and correct weights',runtime.provider==='CPUExecutionProvider'&&runtime.modelPaths.u2netp.endsWith('u2netp.onnx'));
 const inspect=b=>({width:b.readUInt32BE(16),height:b.readUInt32BE(20)});
 for(const name of ['white','gray','pattern','transparent']){
  const source=await fs.readFile(path.resolve('test-results/local-ai-fixtures',name+'.png')),asset=await saveImage(root,source,inspect),stages=[],started=Date.now();
  const result=await engine.processInput(asset,settings,runtime,signal,randomUUID(),s=>stages.push(s));
  const decoded=await sharp(result).ensureAlpha().raw().toBuffer({resolveWithObject:true}),original=await sharp(source).ensureAlpha().raw().toBuffer();
  check(name+' keeps exact dimensions and original RGB',decoded.info.width===asset.width&&decoded.info.height===asset.height&&original.every((v,i)=>i%4===3||v===decoded.data[i]));
  let removed=0,visible=0,soft=0;for(let i=3;i<original.length;i+=4){assert.ok(decoded.data[i]<=original[i]);removed+=decoded.data[i]<original[i];visible+=decoded.data[i]>0;soft+=decoded.data[i]>0&&decoded.data[i]<255;}
  check(name+' preserves existing transparency and produces a nonempty matte',removed>(name==='transparent'?0:original.length/40)&&visible>original.length/40&&soft>0);
  await fs.writeFile(path.join(out,name+'-cutout.png'),result);report.samples.push({name,seconds:(Date.now()-started)/1000,removed,visible,soft,stages});
 }
 const source=await fs.readFile(path.resolve('test-results/local-ai-fixtures/white.png')),asset=await saveImage(root,source,inspect),abort=new AbortController();
 await assert.rejects(engine.processInput(asset,settings,runtime,abort.signal,randomUUID(),stage=>{if(stage==='识别主体')abort.abort();}),{name:'AbortError'});
 check('cancel stops owned inference and cleans job files',(await fs.readdir(path.join(root,'local-jobs'))).length===0);
 const spec=path.join(out,'benchmark.json');await fs.writeFile(spec,JSON.stringify({input:path.resolve('test-results/local-ai-fixtures/white.png'),output:path.join(out,'benchmark.png'),model:runtime.modelPaths.u2netp,provider:runtime.provider,cutoutModel:'u2netp'}));
 const output=await runProcess(runtime.python,['-I','-u',path.resolve('test/cutout-benchmark.py'),spec],{signal});report.memory=JSON.parse(output.trim().split('\n').at(-1));
 check('measured worker stays below lightweight memory budget',report.memory.result===0&&report.memory.peakWorking<1024**3&&(!report.memory.peakCommit||report.memory.peakCommit<2*1024**3));
 await fs.writeFile(path.join(out,'native-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report.memory));
})().catch(async e=>{report.failure=e.stack;await fs.writeFile(path.join(out,'native-report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
