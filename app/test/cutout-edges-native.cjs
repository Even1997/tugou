const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp'),{randomUUID}=require('node:crypto');
const {LocalAIService,validateLocalSettings}=require('../core/local-ai.cjs'),{saveImage}=require('../core/generation.cjs');
const out=path.resolve('test-results/cutout-edges'),report={checks:[],samples:[]};
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
(async()=>{
 await fs.mkdir(out,{recursive:true});const root=await fs.mkdtemp(path.join(out,'native-')),engine=new LocalAIService({root}),signal=new AbortController().signal;
 await engine.configure(process.env.TUGOU_TEST_RUNTIME||'D:/CanvasStudioRuntime');
 const settings=validateLocalSettings({operation:'cutout',model:'u2netp',edgeShrink:1,edgeFeather:0.5},{width:512,height:768}),runtime=await engine.resolveRuntime(settings,undefined,{width:512,height:768});
 const inspect=b=>({width:b.readUInt32BE(16),height:b.readUInt32BE(20)});
 for(const name of ['white','gray','pattern','transparent']){
  const source=await fs.readFile(path.resolve('test-results/local-ai-fixtures',name+'.png')),asset=await saveImage(root,source,inspect);
  const base=await engine.processInput(asset,{...settings,edgeShrink:0,edgeFeather:0},runtime,signal,randomUUID(),()=>{});
  const started=Date.now(),stages=[];
  const refined=await engine.processInput(asset,settings,runtime,signal,randomUUID(),s=>stages.push(s));
  const raw=await sharp(refined).ensureAlpha().raw().toBuffer({resolveWithObject:true}),baseline=await sharp(base).ensureAlpha().raw().toBuffer(),original=await sharp(source).ensureAlpha().raw().toBuffer();
  const prior=await sharp(path.resolve('test-results/cutout-repair',name+'-cutout.png')).ensureAlpha().raw().toBuffer();
  check(name+' zero settings preserve previous pixels exactly',baseline.equals(prior));
  check(name+' refined output preserves dimensions and RGB',raw.info.width===asset.width&&raw.info.height===asset.height&&original.every((v,i)=>i%4===3||v===raw.data[i]));
  let changed=0,visible=0;for(let i=3;i<baseline.length;i+=4){assert.ok(raw.data[i]<=baseline[i]&&raw.data[i]<=original[i]);changed+=raw.data[i]<baseline[i];visible+=raw.data[i]>0;}
  check(name+' removes fringe without adding opacity or erasing the subject',changed>0&&visible>raw.data.length/40&&stages.includes('优化主体边缘'));
  report.samples.push({name,seconds:(Date.now()-started)/1000,changed,visible});
  await fs.writeFile(path.join(out,name+'-base.png'),base);await fs.writeFile(path.join(out,name+'-refined.png'),refined);
  if(name==='white'){
   const label=Buffer.from('<svg width="1024" height="40"><text x="20" y="27" fill="white" font-family="sans-serif" font-size="18">Before / 0 px</text><text x="532" y="27" fill="white" font-family="sans-serif" font-size="18">After / shrink 1 px, feather 0.5 px</text></svg>');
   await sharp({create:{width:1024,height:808,channels:4,background:'#20242c'}}).composite([{input:base,left:0,top:40},{input:refined,left:512,top:40},{input:label,left:0,top:0}]).png().toFile(path.join(out,'comparison.png'));
  }
 }
 await fs.writeFile(path.join(out,'native-report.json'),JSON.stringify(report,null,2));
})().catch(async e=>{report.failure=e.stack;await fs.writeFile(path.join(out,'native-report.json'),JSON.stringify(report,null,2));console.error(e);process.exitCode=1;});
