const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve(process.env.TUGOU_FONT_TEST_OUTPUT||'test-results/font-mcp');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(out,'profile-'));process.env.TUGOU_DATA_DIR=profile;
const report={checks:[],root:path.join(profile,'workspace'),filesRoot:path.join(profile,'automation'),errors:[]};
let transport,done=false,primary;
const finish=code=>{if(done)return;done=true;fs.writeFileSync(path.join(out,'acceptance.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
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
   const client=new Client({name:'font-pipeline-acceptance',version:'1.0.0'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r;};
   const run=async(command,args={})=>(await call('run_command',{command,args,expectedRevision:(await call('get_state')).structuredContent.revision})).structuredContent;
   const original=(await call('get_state')).structuredContent;
   const catalog=(await call('list_commands',{domain:'font'})).structuredContent;
   check('font commands discoverable with schemas',catalog.commands.some(c=>c.name==='font.atlas.preview')&&catalog.commands.every(c=>c.inputSchema));
   report.result=await require('./font-checks.cjs')({run,call,root:report.root,filesRoot:report.filesRoot,check,
    characters:fs.readFileSync(process.env.TUGOU_FONT_CHARACTERS,'utf8').trim(),referenceFont:process.env.TUGOU_FONT_REFERENCE,python:path.join(process.env.TUGOU_FONT_RUNTIME,'Scripts/python.exe')});
   const after=(await call('get_state')).structuredContent;
   check('real desktop document and dirty state unchanged',original.revision===after.revision&&original.dirty===after.dirty);
   const font=fs.readFileSync(path.join(report.filesRoot,'export/font.ttf')).toString('base64');
   const browser=await window.webContents.executeJavaScript(`(async()=>{const data=Uint8Array.from(atob(${JSON.stringify(font)}),c=>c.charCodeAt(0));const face=new FontFace('AtlasVerification',data);await face.load();document.fonts.add(face);const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=320;const c=canvas.getContext('2d');c.fillStyle='#faf9f5';c.fillRect(0,0,1200,320);c.font='52px AtlasVerification';c.fillStyle='#172434';c.fillText('木林森 明日山水 永正白云',24,84);c.fillText('ABCDEFGHIJKLMNOPQRSTUVWXYZ',24,164);c.fillText('abcdefghijklmnopqrstuvwxyz',24,244);return {status:face.status,loaded:document.fonts.check('52px AtlasVerification'),png:canvas.toDataURL('image/png')};})()`);
   check('exported TTF loads and renders in actual Chromium',browser.status==='loaded'&&browser.loaded);
   fs.writeFileSync(path.join(out,'chromium-proof.png'),Buffer.from(browser.png.split(',')[1],'base64'));
   check('desktop has no console errors',report.errors.length===0);
   console.log(JSON.stringify({checks:report.checks.length,output:out}));finish(0);
  }catch(error){report.failure=error.stack;console.error(error);finish(1);}
 });
});
process.argv.push('--mcp-enable');require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
