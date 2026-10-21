const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('../../web/node_modules/sharp');
const base=process.env.STUDIO_TEST_URL,root=path.resolve(__dirname,'../..'),evidence=path.join(root,'docs/studio-evidence/atelier-generation-review.json');
if(base!=='http://127.0.0.1:3439')throw Error('Isolated packaged server required');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const post=async(action,payload)=>{const r=await fetch(base+'/api/studio',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({action,payload})});assert.equal(r.status,200,await r.clone().text());return r.json()};
app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'studio-review-ui-')));
app.whenReady().then(async()=>{
 let server,requests=0,win;const errors=[],id='review-'+Date.now(),projectId='review-cloud-qa';
 const deadline=setTimeout(()=>{fs.writeFileSync(evidence,JSON.stringify({passed:false,error:'timeout',requests,errors}));app.exit(1)},180000);
 try{
  assert.ok((await post('list')).location.includes('atelier-qa'));
  const source=fs.readFileSync('D:/CanvasStudioLiveQA/source.png'),raw=fs.readFileSync('D:/CanvasStudioLiveQA/provider-output.png');
  server=http.createServer(async(req,res)=>{const body=[];for await(const c of req)body.push(c);assert.equal(req.url,'/v1/images/edits');requests++;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{b64_json:raw.toString('base64')}]}))});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await post('configure',{baseUrl:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fixture-no-billing',model:'cached-live-response'});
  const previous=await post('open',{id:'complex-export-qa'});
  const project={...previous,id:projectId,name:'原始生成结果恢复验收',updatedAt:new Date().toISOString(),assets:[{id:'review-source',name:'几何原图',dataUrl:'data:image/png;base64,'+source.toString('base64'),width:1024,height:1024,hasAlpha:false,createdAt:new Date().toISOString()}],layers:[],jobs:[],width:1024,height:1024};
  await post('save',project);
  const operation={kind:'edit',sourceId:'review-source',sourceWidth:1024,sourceHeight:1024,width:464,height:464,left:280,top:280};
  await post('generation-submit',{id,projectId,name:'尺寸不符的真实返回图',prompt:'中央圆形变蓝',size:'1024x1024',references:[project.assets[0].dataUrl],operation});
  const get=()=>post('generation-get',{id,projectId});
  const until=async(fn,label)=>{for(let n=0;n<600;n++){if(await fn())return;await wait(100)}throw Error('Timeout '+label)};
  await until(async()=>(await get()).status==='review','raw preserved');assert.equal(requests,1);
  const review=await get();assert.deepEqual([review.rawResult.width,review.rawResult.height],[1254,1254]);
  assert.deepEqual(Buffer.from(await(await fetch(base+review.rawResult.dataUrl)).arrayBuffer()),raw);
  win=new BrowserWindow({width:1300,height:960,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
  const run=code=>win.webContents.executeJavaScript(code,true),selector=`[data-generation-id="${id}"]`;
  const click=async(label,scope='document')=>{
   await run(`(()=>{const e=[...${scope}.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===${JSON.stringify(label)}||b.textContent.replace(/\\s/g,'')===${JSON.stringify(label.replace(/\s/g,''))}||(${JSON.stringify(label)}==='任务'&&b.textContent.trim().startsWith('任务')));if(!e)throw Error('Missing button '+${JSON.stringify(label)});e.click()})()`);
   if(label==='任务'){await until(()=>run(`!![...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.startsWith('云端生成'))`),'cloud tab');await run(`[...document.querySelectorAll('[role=tab]')].find(e=>e.textContent.startsWith('云端生成')).click()`)}
  };
  const article=`document.querySelector(${JSON.stringify(selector)})`;
  win.webContents.on('console-message',({level,message})=>{if(level==='error'||level===3)errors.push(message)});
  await win.loadURL(base+'/studio');await until(()=>run('document.body.innerText.includes("原始生成结果恢复验收")'),'project');await click('任务');
  await until(()=>run(`!!${article}&&${article}.innerText.includes('待确认')`),'review card');
  await click('查看原始图',article);await until(()=>run('!!document.querySelector("img[alt=模型原始返回图]")'),'raw preview');
  await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);fs.writeFileSync(path.join(root,'docs/studio-evidence/atelier-generation-review.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await click('收起原始图',article);win.setSize(960,680);await wait(500);
  assert.ok(await run(`['保存原始图','缩小对齐'].every(t=>{const b=[...${article}.querySelectorAll('button')].find(e=>e.textContent.trim()===t),r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})`));
  await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});await wait(500);fs.writeFileSync(path.join(root,'docs/studio-evidence/atelier-generation-review-960.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  await click('保存原始图',article);await until(()=>run(`[...${article}.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存原始图').disabled`),'raw collected');
  await click('关闭弹窗');await click('撤销 Ctrl+Z');await click('任务');await until(()=>run(`![...${article}.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存原始图').disabled`),'undo raw');
  await click('关闭弹窗');await click('重做 Ctrl+Shift+Z');await click('任务');await until(()=>run(`[...${article}.querySelectorAll('button')].find(b=>b.textContent.trim()==='保存原始图').disabled`),'redo raw');
  await until(async()=>(await post('open',{id:projectId})).assets.length===2,'saved assets');
  await win.reload();await until(()=>run('document.body.innerText.includes("原始生成结果恢复验收")'),'reload');await click('任务');await until(()=>run(`!!${article}&&${article}.innerText.includes('待确认')`),'review restored');
  await click('缩小对齐',article);await until(()=>run('document.body.innerText.includes("缩小并对齐")'),'confirmation');await click('返回');assert.equal((await get()).status,'review');assert.equal(requests,1);
  await click('缩小对齐',article);await click('缩小并对齐');await until(async()=>(await get()).status==='completed','local resolution');
  const completed=await get();assert.equal(requests,1);assert.equal(completed.rawResult.id,review.rawResult.id);assert.deepEqual([completed.result.width,completed.result.height],[1024,1024]);
  const bytes=Buffer.from(await(await fetch(base+completed.result.dataUrl)).arrayBuffer()),before=await sharp(source).ensureAlpha().raw().toBuffer(),after=await sharp(bytes).ensureAlpha().raw().toBuffer();
  let protectedPixels=0;for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)if(!(x>=280&&x<744&&y>=280&&y<744)){const i=(y*1024+x)*4;assert.ok(before.subarray(i,i+4).equals(after.subarray(i,i+4)));protectedPixels++}
  const center=Array.from(after.subarray((512*1024+512)*4,(512*1024+512)*4+4));assert.ok(center[2]>center[0]+50);
  await until(()=>run(`${article}.innerText.includes('已完成')`),'completed UI');await click('存入素材库',article);await until(async()=>(await post('open',{id:projectId})).assets.length===3,'both collected');
  assert.equal((await post('generation-resolve-size',{id,projectId})).result.id,completed.result.id);assert.equal(requests,1);assert.deepEqual(errors,[]);
  clearTimeout(deadline);fs.writeFileSync(evidence,JSON.stringify({at:new Date().toISOString(),passed:true,id,projectId,requests,newPaidRequests:0,protectedPixels,center,checks:['raw persisted before failure','raw bytes preserved','1300 and 960 UI','raw preview/save/undo/redo','reopen preserves review','confirmation cancel sends nothing','explicit local downsize','original pixels outside selection exact','raw and processed assets independently collected','repeat resolution idempotent'],errors},null,2));server.closeAllConnections();server.close();app.exit(0);
 }catch(error){clearTimeout(deadline);fs.writeFileSync(evidence,JSON.stringify({passed:false,error:error.stack,requests,errors},null,2));server?.closeAllConnections();server?.close();app.exit(1)}
});
