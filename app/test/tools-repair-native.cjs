const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
const {LocalAIService}=require('../core/local-ai.cjs'),{RuntimeInstaller}=require('../core/runtime-install.cjs'),{TaskQueue}=require('../core/tasks.cjs');
const out=path.resolve(__dirname,'../test-results/tools-repair');
const report={checks:[],timings:{}};
const check=(label,value)=>{assert.ok(value,label);report.checks.push(label);console.log('PASS '+label);};
(async()=>{
 await fs.mkdir(out,{recursive:true});
 const root=await fs.mkdtemp(path.join(out,'native-'));report.root=root;
 const local=new LocalAIService({root}),tasks=new TaskQueue(root);await tasks.init();
 const installer=new RuntimeInstaller(local,tasks);
 await installer.start(root,{upscale:true,cutout:false});await tasks.execution;
 const installed=tasks.list().at(-1);check('real download, hash verification, extraction and activation',installed.status==='completed');
 const status=await local.status();report.runtime=status;
 check('three upscale models available without Python',status.models.length===3&&!status.cutout);
 await assert.rejects(fs.access(path.join(status.folder,'segment-python')));
 const source=await sharp({create:{width:64,height:48,channels:4,background:{r:85,g:140,b:210,alpha:0.5}}}).png().toBuffer();
 const input={width:64,height:48,dataUrl:'data:image/png;base64,'+source.toString('base64')};
 for(const model of ['anime','general','illustration']){
  const scale=model==='anime'?2:4,runtime=await local.resolveRuntime({operation:'upscale',model}),progress=[],start=Date.now();
  const result=await local.processInput(input,{operation:'upscale',model,scale},runtime,new AbortController().signal,model,(message,p)=>progress.push({message,p}));
  const pixels=await sharp(result).raw().toBuffer({resolveWithObject:true});
  check(model+' dimensions and original half-transparency preserved',pixels.info.width===64*scale&&pixels.info.height===48*scale&&pixels.info.channels===4&&pixels.data.every((v,i)=>i%4!==3||v===128));
  check(model+' native inference progress received',progress.some(p=>/%/.test(p.message)&&p.p>=5&&p.p<=90));
  report.timings[model]=Date.now()-start;await fs.writeFile(path.join(out,model+'.png'),result);
 }
 const runtime=await local.resolveRuntime({operation:'upscale',model:'general'}),controller=new AbortController();
 const big=await sharp(source).resize(512,512).png().toBuffer();
 const task=local.processInput({width:512,height:512,dataUrl:'data:image/png;base64,'+big.toString('base64')},{operation:'upscale',model:'general',scale:4},runtime,controller.signal,'cancel',(m,p)=>{if(p===5)setTimeout(()=>controller.abort(),100);});
 await assert.rejects(task,e=>e.name==='AbortError');
 await assert.rejects(fs.access(path.join(root,'local-jobs/cancel')));check('cancel stops native process and removes incomplete output',true);
 await tasks.shutdown();
})().catch(e=>{report.failure=e.stack;process.exitCode=1;console.error(e);}).finally(()=>fs.writeFile(path.join(out,'native-report.json'),JSON.stringify(report,null,2)));
