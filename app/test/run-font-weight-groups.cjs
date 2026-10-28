const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const fonts=require('../core/builtin-fonts.cjs').builtinFonts,report={groups:[],failures:[],families:fonts.length,faces:fonts.reduce((n,f)=>n+1+(f.variants?.length||0),0)};
(async()=>{
 for(let i=0;i<fonts.length;i+=3){
  const group='group-'+(i/3+1),env={...process.env,TUGOU_FONT_TEST_GROUP:group,TUGOU_FONT_FILTER:fonts.slice(i,i+3).map(f=>f.id).join(',')};delete env.ELECTRON_RUN_AS_NODE;
  const start=Date.now(),child=spawn(require('electron'),['test/font-weights-desktop.cjs'],{env,windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  const code=await new Promise(resolve=>child.on('exit',resolve));const folder=path.join('test-results/font-weights',group);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,process.env.TUGOU_TEST_APP?'packaged.log':'desktop.log'),output);
  const result=JSON.parse(fs.readFileSync(path.join(folder,process.env.TUGOU_TEST_APP?'packaged.json':'desktop.json')));
  report.groups.push({group,code,ms:Date.now()-start,checks:result.checks.length,fonts:result.fonts||[],failure:result.failure||result.crash});
  console.log(group,code===0?'PASS':'FAIL',result.checks.length,Date.now()-start+'ms');
  if(code!==0){report.failures.push(group);console.log(output.slice(-1800));}
  fs.writeFileSync('test-results/font-weights/'+(process.env.TUGOU_TEST_APP?'packaged-groups.json':'groups.json'),JSON.stringify(report,null,2));
 }
 process.exitCode=report.failures.length?1:0;
})();
