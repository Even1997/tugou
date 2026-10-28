const fs=require('node:fs'),path=require('node:path'),{app}=require('electron');
module.exports=async({w,js,check,delay,report,base})=>{
  await js(fs.readFileSync(path.join(base,'stress.js'),'utf8'));
  report.memory=[];const sample=()=>{report.memory.push({at:Date.now(),processes:app.getAppMetrics().map(p=>({type:p.type,workingSetMiB:p.memory.workingSetSize/1024}))});if(report.memory.length%15===0)js('window.__stressProgress').then(progress=>fs.writeFileSync(path.join(base,'progress.json'),JSON.stringify(progress))).catch(()=>{});};sample();const timer=setInterval(sample,1000);
  try{
    report.stress=[];
    const long=Boolean(process.env.TUGOU_LONG_STRESS);
    for(const dimensions of [{width:3840,height:2160,count:long?400:40},{width:4096,height:4096,count:long?240:60},{width:7680,height:4320,count:6}]){
      const result=await js(`paintStress(${JSON.stringify(dimensions)})`);report.stress.push(result);
      check(`${dimensions.width}x${dimensions.height}: every stroke present`,result.allStrokesPresent);
      check(`${dimensions.width}x${dimensions.height}: decoded cache within 192 MiB`,result.maxCacheBytes<=192*1024**2);
      await delay(1000);
    }
  }finally{clearInterval(timer);sample();}
};
