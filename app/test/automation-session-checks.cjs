const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const {bridge}=require('../core/mcp.cjs');
async function prepare({profile,js,check,sleep}){
 const descriptor=path.join(profile,'mcp-session.json');await sleep(300);check('ordinary launch leaves MCP disabled',!fs.existsSync(descriptor));
 assert.ok(await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='新建工程');b?.click();return !!b;})()`));
 await js(`document.querySelector('[aria-label="工程操作"]').click()`);await sleep(100);
 await js(`[...document.querySelectorAll('.project-menu button')].find(b=>b.textContent.trim()==='重命名工程').click()`);
 for(let i=0;i<100&&!await js(`!!document.querySelector('input[aria-label="新工程名称"]')`);i++)await sleep(50);
 await js(`(()=>{const input=document.querySelector('input[aria-label="新工程名称"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'启用前编辑的工程');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await sleep(100);
 await js(`document.querySelector('[role="dialog"] form').requestSubmit()`);
 for(let i=0;i<100&&!await js(`document.querySelector('.project-menu').textContent.includes('启用前编辑的工程')`);i++)await sleep(50);
 assert.ok(await js(`document.querySelector('.project-menu').textContent.includes('启用前编辑的工程')`),'edit committed before enabling second process');
 const enable=()=>new Promise((resolve,reject)=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(process.env.TUGOU_MCP_BINARY||process.execPath,process.env.TUGOU_TEST_APP?['--mcp-enable']:[path.resolve('main.cjs'),'--mcp-enable'],{env,stdio:'ignore',windowsHide:true});
  const timer=setTimeout(()=>{child.kill();reject(Error('second instance failed to attach'));},10000);
  child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);code===0?resolve():reject(Error('second instance exit '+code));});
 });
 await enable();for(let i=0;i<100&&!fs.existsSync(descriptor);i++)await sleep(50);assert.ok(fs.existsSync(descriptor));
 const state=(await bridge(descriptor,'get_state',{})).value;
 check('second process enables MCP without discarding edits or undo history',state.name==='启用前编辑的工程'&&state.history.undo>0);
 const first=fs.readFileSync(descriptor,'utf8');await enable();await sleep(150);check('repeated enable reuses the same session and document',fs.readFileSync(descriptor,'utf8')===first&&(await bridge(descriptor,'get_state',{})).value.projectId===state.projectId);
}
async function waits({client,script,descriptor,taskId,check}){
 const controller=new AbortController(),updates=[];
 await assert.rejects(()=>client.callTool({name:'run_command',arguments:{command:'task.wait',args:{id:taskId,timeoutMs:30000}}},undefined,{signal:controller.signal,onprogress:p=>{updates.push(p);controller.abort();}}));
 check('SDK request cancellation stops waiting and receives real progress',updates.length>0&&updates[0].total===undefined&&updates[0].message.includes('已等待'));
 const transport=new StdioClientTransport({command:process.env.TUGOU_MCP_BINARY||process.execPath,args:[script,'--session',descriptor],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'}),other=new Client({name:'second-client',version:'1.0'});
 try{
  await other.connect(transport);
  const get=await other.callTool({name:'run_command',arguments:{command:'task.get',args:{id:taskId}}});
  check('cancelling wait leaves generation running',!get.isError&&['running','queued'].includes(get.structuredContent.status));
  let cancelled;
  const wait=await client.callTool({name:'run_command',arguments:{command:'task.wait',args:{id:taskId,timeoutMs:10000}}},undefined,{onprogress:()=>{cancelled??=other.callTool({name:'run_command',arguments:{command:'task.cancel',args:{id:taskId}}});}});
  assert.ok(cancelled);const cancel=await cancelled;
  check('second MCP client can cancel task while first client waits',!cancel.isError&&!wait.isError&&wait.structuredContent.task.status==='cancelled'&&!wait.structuredContent.timedOut);
 }finally{await other.close();await transport.close();}
}
module.exports={prepare,waits};
