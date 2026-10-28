// Launch the real packaged binary in an isolated profile; no QA hooks ship in the app.
const {spawn} = require('node:child_process');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const binary = path.resolve(process.argv[2] || 'release/win-unpacked/Tugou.exe');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const profile=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-package-qa-'));
 const report={platform:process.platform,binary,profile,checks:[]};
 let child=spawn(binary,['--remote-debugging-port=0'],{windowsHide:true,env:{...process.env,TUGOU_DATA_DIR:profile},stdio:['ignore','ignore','pipe']});
 let socket, log='', exited=false;
 child.stderr.on('data',data=>{log+=data.toString();});child.once('exit',()=>{exited=true;});
 const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
 try {
   for(let i=0;i<200&&!log.includes('DevTools listening on');i++){if(exited)throw new Error('Packaged process exited before startup');await delay(50);}
   const address=log.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);assert.ok(address,'local debugger ready');
   let page;
   for(let i=0;i<100&&!page;i++){page=(await(await fetch(`http://127.0.0.1:${address[1]}/json/list`)).json()).find(t=>t.type==='page'&&t.url.startsWith('file:'));if(!page)await delay(50);}
   socket=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject;});
   let sequence=0;const pending=new Map();
   socket.onmessage=event=>{const message=JSON.parse(event.data);if(pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}};
   const js=async expression=>{const id=++sequence;const answer=new Promise(resolve=>pending.set(id,resolve));socket.send(JSON.stringify({id,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true,userGesture:true}}));const message=await Promise.race([answer,delay(8000).then(()=>{throw new Error('Renderer response timeout');})]);if(message.error||message.result?.exceptionDetails)throw new Error(JSON.stringify(message.error||message.result.exceptionDetails));return message.result?.result?.value;};
   const wait=async expression=>{for(let i=0;i<100;i++){if(await js(`Boolean(${expression})`))return;await delay(50);}throw new Error('Timeout: '+expression);};
   await wait('document.querySelector(".studio-header")');
   check('packaged isolated renderer starts',await js('typeof require==="undefined"&&typeof process==="undefined"'));
   const created=await js('window.tugou.create("跨平台工程验收")');
   const changed={...created.document,unknownFutureField:{text:'保留',nested:[1,{value:true}]}};
   const saved=await js(`window.tugou.save(${JSON.stringify(created.id)},${JSON.stringify(changed)},${created.revision})`);
   const loaded=await js(`window.tugou.open(${JSON.stringify(created.id)})`);
   assert.deepEqual(loaded.document,changed);check('packaged save preserves unknown fields and full document',saved.revision===created.revision+1);
   check('packaged credential store encrypts and hides secret',(await js("window.tugou.saveConnection({baseUrl:'https://example.com/v1',model:'packaged-qa',apiKey:'packaged-test-secret'})")).hasKey);
   check('no plaintext key on disk',!(await fs.readFile(path.join(profile,'workspace','connection.enc'))).includes(Buffer.from('packaged-test-secret')));
   // Helper mode must bypass the normal app lock, even while the main app is running.
   await js('setTimeout(()=>window.tugou.window("close"),50);true');
   if(process.platform==='win32'){
     for(let i=0;i<100&&!exited;i++)await delay(50);
     assert.ok(exited,'packaged window closes gracefully');
     child=spawn(binary,[],{windowsHide:true,env:{...process.env,TUGOU_DATA_DIR:profile},stdio:'ignore'});
     await delay(800);
   }
   if(process.platform==='win32'){
     const temporary=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'tugou-key-import-'));
     try {
       await fs.copyFile(path.join(profile,'Local State'),path.join(temporary,'Local State'));
       const result=await new Promise((resolve,reject)=>{
         const helper=spawn(binary,['--tugou-key-reader',temporary,path.join(profile,'workspace','connection.enc')],{windowsHide:true,env:{...process.env,TUGOU_DATA_DIR:profile},stdio:['ignore','ignore','ignore','ipc']});let message;
         const timeout=setTimeout(()=>{helper.kill();reject(new Error('Packaged migration helper timeout'));},15000);
         helper.on('message',value=>{message=value;});helper.once('error',error=>{clearTimeout(timeout);reject(error);});helper.once('exit',code=>{clearTimeout(timeout);code===0?resolve(message):reject(new Error('Helper failed: '+code));});
       });
       check('packaged helper bypasses app lock and decrypts isolated fixture',result?.ok&&JSON.parse(result.value).apiKey==='packaged-test-secret');
     } finally {
       const root=await fs.realpath(os.tmpdir());if(path.dirname(temporary)!==root||!path.basename(temporary).startsWith('tugou-key-import-'))throw new Error('Unsafe cleanup path');
       await fs.rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:100});
     }
   }
   report.completed=true;
 }catch(error){report.failure=error.stack;process.exitCode=1;}
 finally {socket?.close();child.kill();await fs.mkdir('test-results',{recursive:true});await fs.writeFile(`test-results/packaged-${process.platform}.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(error=>{console.error(error);process.exitCode=1;});
