const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {TaskQueue}=require('../core/tasks.cjs'),{createDispatcher}=require('../core/automation-host.cjs');
(async()=>{
 const out=path.resolve('test-results/font-pipeline');await fs.mkdir(out,{recursive:true});
 const root=await fs.mkdtemp(path.join(out,'workspace-')),filesRoot=path.join(root,'automation');await fs.mkdir(filesRoot);
 const tasks=new TaskQueue(root);await tasks.init();
 const dispatch=await createDispatcher({root,filesRoot,tasks,ui:async()=>({revision:'fixture-v1',dirty:true,document:null})});
 const run=(command,args={})=>dispatch('run_command',{command,args,expectedRevision:'fixture-v1'});
 const checks=[],check=(name,value)=>{assert.ok(value,name);checks.push(name);};
 try{
  const result=await require('./font-checks.cjs')({run,call:dispatch,filesRoot,root,check,characters:(await fs.readFile(process.env.TUGOU_FONT_CHARACTERS,'utf8')).trim(),referenceFont:process.env.TUGOU_FONT_REFERENCE,python:path.join(process.env.TUGOU_FONT_RUNTIME,'Scripts/python.exe')});
  await tasks.shutdown();
  const reopened=await createDispatcher({root,filesRoot,tasks,ui:async()=>({revision:'fixture-v2',document:null})});
  check('font project and source survive service reopen',(await reopened('run_command',{command:'font.project.get',args:{projectId:result.projectId}})).current===result.processJob);
  await fs.writeFile(path.join(out,'acceptance.json'),JSON.stringify({checks,result,root,filesRoot},null,2));console.log(JSON.stringify({checks:checks.length,result,filesRoot}));
 }finally{await tasks.shutdown();}
})().catch(e=>{console.error(e);process.exitCode=1;});
