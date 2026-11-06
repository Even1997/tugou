// Isolated real desktop + loopback Images API. Never reads the user's providers or project.
const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),sharp=require('sharp'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const entry=process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):path.resolve(__dirname,'../desktop-main.cjs'),appRoot=path.dirname(entry);
const out=path.resolve('test-results/canvas-local-edit');fs.mkdirSync(out,{recursive:true});
const profile=fs.realpathSync(fs.mkdtempSync(path.join(out,'desktop-')));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require(path.join(appRoot,'core/preference-values.cjs')).defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[],requests:[]};let transport,finished=false;
const server=http.createServer(async(req,res)=>{
 try {
  const parts=[];for await(const p of req)parts.push(p);
  const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(parts)}).formData();
  assert.ok(req.url.endsWith('/images/edits'));
  const [width,height]=form.get('size').split('x').map(Number);
  const mask=Buffer.from(await form.get('mask').arrayBuffer()),first=Buffer.from(await form.getAll('image[]')[0].arrayBuffer());
  const alpha=await sharp(mask).extractChannel('alpha').raw().toBuffer();
  report.requests.push({model:form.get('model'),size:form.get('size'),quality:form.get('quality'),count:form.get('n'),images:form.getAll('image[]').length,firstWidth:(await sharp(first).metadata()).width,paintedAlpha:alpha[24*64+16],holeAlpha:alpha[24*64+32],outsideAlpha:alpha[0],prompt:form.get('prompt')});
  const data=Buffer.alloc(width*height*4);
  for(let i=0;i<width*height;i++){
   data.set([210,70,90,255],i*4);
  }
  const png=await sharp(data,{raw:{width,height,channels:4}}).png().toBuffer();
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png.toString('base64')}]}));
 }catch(e){res.writeHead(500);res.end('fixture failure');report.errors.push(e.message);}
});server.listen(0,'127.0.0.1');
const check=(label,ok)=>{assert.ok(ok,label);report.checks.push(label);console.log('PASS '+label);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'desktop-report.json'),JSON.stringify(report,null,2));transport?.close();server.closeAllConnections();server.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},150000);
app.on('browser-window-created',(_,w)=>{
 w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<600;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const click=async label=>{await js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('button unavailable: '+${JSON.stringify(label)});b.click()})()`);await delay(100);};
  const input=async(label,value)=>{await js(`(()=>{const e=document.querySelector('[aria-label="${label}"]');if(!e)throw Error('input missing');e.focus();Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await delay(80);await js(`document.querySelector('[aria-label="${label}"]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`);await delay(80);};
  const capture=async name=>{w.showInactive();await delay(250);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());w.hide();};
  const draw=async(points,beforeRelease)=>{
   const r=await js(`(()=>{const r=document.querySelector('[aria-label="涂画修改区域画布"]').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()`);
   const p=([x,y])=>({x:Math.round(r.x+x*r.width),y:Math.round(r.y+y*r.height)});
   w.webContents.sendInputEvent({type:'mouseMove',...p(points[0])});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p(points[0])});
   for(const point of points.slice(1)){w.webContents.sendInputEvent({type:'mouseMove',...p(point)});await delay(20);}
   if(beforeRelease)await beforeRelease();
   w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p(points.at(-1))});await delay(100);
  };
  const hoverBrush=async()=>{
   w.showInactive();await delay(150);
   const p=await js(`(()=>{const r=document.querySelector('[aria-label="涂画修改区域画布"]').getBoundingClientRect();return{x:Math.round(r.x+r.width*.35),y:Math.round(r.y+r.height*.35)}})()`);
   w.webContents.sendInputEvent({type:'mouseMove',...p});await delay(100);
  };
  const cursorMatches=async(size,width)=>{const info=await js(`(()=>{const c=document.querySelector('[aria-label="涂画修改区域画布"]').getBoundingClientRect(),ring=document.querySelector('.mask-brush-cursor'),r=ring.getBoundingClientRect();return {visible:getComputedStyle(ring).visibility,width:r.width,expected:${size}*c.width/${width},style:ring.getAttribute('style')}})()`);report.cursor=info;return info.visible==='visible'&&Math.abs(info.width-info.expected)<1;};
  const checkOverlay=async(id,label)=>{
   w.showInactive();await delay(200);
   const points=await js(`(()=>{const e=document.querySelector('[data-id="${id}"] .node-media-preview img'),r=e.getBoundingClientRect(),s=Math.min(r.width/64,r.height/48);return [[.25,.5],[.5,.5],[.05,.1]].map(([x,y])=>({x:Math.round(r.x+(r.width-64*s)/2+64*s*x),y:Math.round(r.y+(r.height-48*s)/2+48*s*y)}))})()`);
   const withOverlay=await sharp((await w.webContents.capturePage()).toPNG()).ensureAlpha().raw().toBuffer({resolveWithObject:true});
   await js(`document.querySelector('[data-id="${id}"] .node-region-overlay').style.visibility='hidden'`);await delay(60);
   const plain=await sharp((await w.webContents.capturePage()).toPNG()).ensureAlpha().raw().toBuffer();
   await js(`document.querySelector('[data-id="${id}"] .node-region-overlay').style.visibility=''`);w.hide();
   const differences=points.map(({x,y})=>{const i=(y*withOverlay.info.width+x)*4;return [...withOverlay.data.subarray(i,i+3)].reduce((sum,v,c)=>sum+Math.abs(v-plain[i+c]),0);});
   report.overlay={label,points,differences,info:await js(`(()=>{const e=document.querySelector('[data-id="${id}"] .node-region-overlay'),c=getComputedStyle(e),r=e.getBoundingClientRect();return {mask:c.maskImage,opacity:c.opacity,rect:{x:r.x,y:r.y,width:r.width,height:r.height}}})()`)};
   // GPU compositing can round each RGB channel by one level at fractional zoom.
   check(label,differences[0]>20&&differences[1]<=3&&differences[2]<=3);
  };
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);if(process.env.TUGOU_TEST_APP)check('renderer loaded from packaged ASAR',w.webContents.getURL().includes('app.asar'));for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.env.TUGOU_MCP_BINARY||process.execPath,args:[path.join(appRoot,'core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'canvas-local-edit-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(80);return r;};
   await state();await call('list_commands',{domain:'generation'});
   await run('project.create',{name:'图片节点局部修改检查'});const project=(await state()).projectId;
   const data=Buffer.alloc(64*48*4);for(let i=0;i<64*48;i++)data.set([i%256,90,180,i%5?255:128],i*4);
   const png=await sharp(data,{raw:{width:64,height:48,channels:4}}).png().toBuffer();
   const asset=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'透明边缘测试图')`);
   const portraitBytes=await sharp(png).resize(2048,3072).png().toBuffer();
   const portrait=await js(`window.tugou.storeRaster(${JSON.stringify([...portraitBytes])},'另一张竖图')`);
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:[${JSON.stringify(portrait)},${JSON.stringify(asset)}]},r.revision))`);await run('project.open',{id:project});

   const first=(await run('canvas.create',{type:'asset',sourceId:portrait.id,position:{x:0,y:0}})).id;
   const target=(await run('canvas.create',{type:'asset',sourceId:asset.id,position:{x:340,y:0}})).id;
   await run('ui.navigate',{workspace:'canvas',nodeId:first});
   const openPaint=async(id=target)=>{await js(`document.querySelector('[data-id="${id}"] [aria-label="局部修改"]').click()`);await wait(`document.querySelector('[aria-label="涂画修改区域画布"]')?.dataset.ready==='true'`);};
   // A hovered node must edit itself, even while a different image remains selected.
   await openPaint();
   check('node brush opens standalone paint without tools panel',await js(`!!document.querySelector('.cloud-mask-editor')&&!document.querySelector('.image-tools')`));
   check('opening paint does not request a model',report.requests.length===0);
   await click('应用修改区域');check('empty region cannot be applied',await js(`document.querySelector('.cloud-mask-editor').textContent.includes('请先涂画')`));
   await input('涂画笔刷大小（原图 px）',12);await hoverBrush();check('brush circle matches source pixel diameter at preview scale',await cursorMatches(12,64));
   await input('涂画笔刷大小（原图 px）',24);check('changing brush size updates stationary cursor',await cursorMatches(24,64));await capture('brush-size');
   w.webContents.sendInputEvent({type:'mouseMove',x:50,y:50});await delay(100);check('cursor hides outside image',await js(`getComputedStyle(document.querySelector('.mask-brush-cursor')).visibility==='hidden'`));
   await input('涂画笔刷大小（原图 px）',12);await draw([[.2,.5],[.35,.5],[.5,.5],[.65,.5],[.8,.5]]);
   await click('擦除');await hoverBrush();check('eraser cursor is dashed',await js(`getComputedStyle(document.querySelector('.mask-brush-cursor')).borderTopStyle==='dashed'`));await input('涂画笔刷大小（原图 px）',4);await draw([[.5,.5]]);
   await click('清空区域');await click('应用修改区域');check('clear rejects empty mask',await js(`document.querySelector('.cloud-mask-editor').textContent.includes('请先涂画')`));
   await click('撤销涂画');await click('重做涂画');await click('撤销涂画');await capture('paint-dark');
   await click('应用修改区域');await wait(`!document.querySelector('.cloud-mask-editor')`);
   check('mask apply does not call a paid model',report.requests.length===0);
   await run('project.save');const paintedDoc=await js(`window.tugou.open(${JSON.stringify(project)})`),savedMask=paintedDoc.document.assets.at(-1);
   const alpha=await sharp(path.join(profile,'workspace','resources',savedMask.resource)).extractChannel('alpha').raw().toBuffer();
   check('brush and eraser export source resolution with erased hole',savedMask.width===64&&savedMask.height===48&&alpha[24*64+16]>0&&alpha[24*64+32]===0&&alpha[0]===0);
   check('region belongs to clicked node despite different selection',paintedDoc.document.tugouCanvas.nodes.find(n=>n.id===target).data.localEdit.maskId===savedMask.id&&!paintedDoc.document.tugouCanvas.nodes.find(n=>n.id===first).data.localEdit);
   await openPaint();await click('清空区域');await click('取消');
   check('cancel preserves region and mask',(await call('query_objects',{kind:'asset',limit:100})).objects.length===3);
   await run('project.open',{id:project});await run('ui.navigate',{workspace:'canvas',nodeId:target});
   check('region persists after project reopen',await js(`document.querySelector('[data-id="${target}"]').textContent.includes('已设置局部区域')`));await capture('node-entry');
   await checkOverlay(target,'node overlay tints only painted area and keeps erased hole clear');
   await run('canvas.resize',{ids:[target],width:520,height:520});await run('ui.navigate',{workspace:'canvas',nodeId:target});await checkOverlay(target,'overlay stays aligned after node resize and canvas zoom');await capture('node-overlay-resized');
   await run('history.undo');await run('ui.navigate',{workspace:'canvas',nodeId:target});
   const desk=(await run('canvas.create',{type:'config',position:{x:720,y:0},properties:{name:'局部修改生成台',prompt:'把涂画处改为红色',model:'fixture-node-model',size:'64x48',quality:'high',count:2}})).id;
   await run('canvas.connect',{source:first,target:desk});await run('canvas.connect',{source:target,target:desk});await run('ui.navigate',{workspace:'canvas',nodeId:desk});
   check('generation desk shows region hint',await js(`document.querySelector('[data-id="${desk}"]').textContent.includes('局部生图')`));
   await js(`window.tugou.saveConnection(${JSON.stringify({baseUrl:'http://127.0.0.1:'+server.address().port,apiKey:'fixture-only-key',model:'fixture-shared-model'})})`);await js(`window.dispatchEvent(new Event('tugou-connection-changed'))`);
   await click('开始生成');
   for(let i=0;i<300;i++){if((await call('query_objects',{kind:'asset',limit:100})).objects.length===5)break;await delay(100);}
   await run('project.save');const saved=await js(`window.tugou.open(${JSON.stringify(project)})`),nodes=saved.document.tugouCanvas.nodes,results=saved.document.assets.filter(a=>a.generation?.nodeId===desk);
   check('generation desk automatically creates two result nodes',results.length===2&&results.every(a=>nodes.some(n=>n.data.assetId===a.id&&n.data.sourceNodeId===desk)));
   check('results connect to generation desk on its right',results.every(a=>{const n=nodes.find(n=>n.data.assetId===a.id);return n.position.x>720&&saved.document.tugouCanvas.edges.some(e=>e.source===desk&&e.target===n.id)}));
   check('node model size quality and count flow through image edits',report.requests.length===2&&report.requests.every(r=>r.model==='fixture-node-model'&&r.size==='64x48'&&r.quality==='high'&&r.count==='1'));
   check('masked image is first while other references remain',report.requests.every(r=>r.images===2&&r.firstWidth===64));
   check('API mask edits painted area and protects erased hole and outside',report.requests.every(r=>r.paintedAlpha===0&&r.holeAlpha===255&&r.outsideAlpha===255));
   check('generation prompt carries user instructions and region constraint',report.requests.every(r=>r.prompt.includes('把涂画处改为红色')&&r.prompt.includes('蒙版区域')));
   check('source remains unchanged and mask is not a result node',saved.document.assets.find(a=>a.id===asset.id).resource===asset.resource&&nodes.find(n=>n.id===target).data.assetId===asset.id&&!nodes.some(n=>n.data.assetId===savedMask.id));
   const request=JSON.parse(fs.readFileSync(path.join(profile,'workspace','requests',results[0].generation.taskId+'.json'),'utf8'));
   check('retry snapshot retains mask asset and source binding',request.compiled.references[0].maskId===savedMask.id&&request.assets.some(a=>a.id===savedMask.id));await run('ui.navigate',{workspace:'canvas',nodeId:desk});await capture('generation-results');
   await run('ui.navigate',{workspace:'canvas',nodeId:target});w.setSize(960,720);await click('切换浅色主题');await wait(`document.documentElement.dataset.theme==='light'`);
   await openPaint();await hoverBrush();check('cursor size remains correct in compact window',await cursorMatches(4,64));await capture('paint-light-compact');
   check('paint apply controls fit compact window',await js(`(()=>{const e=document.querySelector('.cloud-mask-editor'),c=e.querySelector('canvas').getBoundingClientRect(),b=[...e.querySelectorAll('button')].find(b=>b.textContent==='应用修改区域').getBoundingClientRect();return c.width>0&&c.left>=0&&c.right<=innerWidth&&b.bottom<=innerHeight&&b.right<=innerWidth})()`));
   await click('取消');check('cancel does not create a task',report.requests.length===2);
   await run('ui.navigate',{workspace:'canvas',nodeId:first});await openPaint(first);
   await input('涂画笔刷大小（原图 px）',64);await draw([[.3,.4],[.6,.4]]);await hoverBrush();check('large portrait cursor uses original pixel scale',await cursorMatches(64,2048));await capture('paint-portrait-light');
   await click('应用修改区域');await wait(`!document.querySelector('.cloud-mask-editor')`);await run('project.save');
   const largeDoc=await js(`window.tugou.open(${JSON.stringify(project)})`),largeMask=largeDoc.document.assets.at(-1);
   const largeAlpha=await sharp(path.join(profile,'workspace','resources',largeMask.resource)).extractChannel('alpha').raw().toBuffer();
   check('scaled portrait exports exact original 2048x3072 coordinates',largeMask.width===2048&&largeMask.height===3072&&largeAlpha[Math.round(3072*.4)*2048+Math.round(2048*.45)]>0&&largeAlpha[0]===0);
   await run('ui.navigate',{workspace:'canvas',nodeId:desk});check('conflicting regions block generation before network',await js(`document.querySelector('[data-id="${desk}"]').textContent.includes('只能连接一张')&&[...document.querySelectorAll('[data-id="${desk}"] button')].find(b=>b.textContent==='开始生成').disabled`));
   await run('ui.navigate',{workspace:'canvas',nodeId:first});await js(`document.querySelector('[data-id="${first}"] [aria-label="清除局部区域"]').click()`);await delay(100);
   check('clearing a region removes its overlay',await js(`!document.querySelector('[data-id="${first}"] .node-region-overlay')`));
   check('clear region restores ordinary reference without removing image',await js(`!document.querySelector('[data-id="${first}"]').textContent.includes('已设置局部区域')`));
   await run('project.save');const cleared=await js(`window.tugou.open(${JSON.stringify(project)})`);check('clearing one region preserves other image region',!cleared.document.tugouCanvas.nodes.find(n=>n.id===first).data.localEdit&&cleared.document.tugouCanvas.nodes.find(n=>n.id===target).data.localEdit.maskId===savedMask.id);
   await run('canvas.update',{id:target,properties:{localEdit:null}});await run('history.undo');
   check('undo restores cleared generation region',await js(`document.querySelector('[data-id="${target}"]').textContent.includes('已设置局部区域')`));
   check('undo restores region overlay',await js(`!!document.querySelector('[data-id="${target}"] .node-region-overlay')`));
   await openPaint(target);await click('清空区域');await click('矩形');await hoverBrush();
   check('shape mode uses crosshair and disables brush size',await js(`getComputedStyle(document.querySelector('.mask-brush-cursor')).visibility==='hidden'&&document.querySelector('[aria-label="涂画笔刷大小（原图 px）"]').disabled&&getComputedStyle(document.querySelector('[aria-label="涂画修改区域画布"]')).cursor==='crosshair'`));
   await draw([[.2,.2]]);await click('应用修改区域');check('shape click without dragging creates no area',await js(`document.querySelector('.cloud-mask-editor').textContent.includes('请先涂画')`));
   const previewSample=`(()=>{const c=document.querySelector('[aria-label="涂画修改区域画布"]');return [...c.getContext('2d').getImageData(Math.round(c.width*.25),Math.round(c.height*.25),1,1).data]})()`;
   const blankPreview=await js(previewSample),beforeDragRevision=await js(`document.querySelector('[aria-label="涂画修改区域画布"]').dataset.revision`);
   await draw([[.45,.4],[.3,.2],[.1,.1]],async()=>{
     await wait(`JSON.stringify(${previewSample})!==${JSON.stringify(JSON.stringify(blankPreview))}`);check('rectangle previews before releasing pointer',JSON.stringify(await js(previewSample))!==JSON.stringify(blankPreview)&&await js(`document.querySelector('[aria-label="涂画修改区域画布"]').dataset.revision===${JSON.stringify(beforeDragRevision)}`));
     fs.writeFileSync(path.join(out,'rectangle-drag.png'),(await w.webContents.capturePage()).toPNG());
   });
   await click('圆形');await draw([[.6,.6],[.9,.95]]);await draw([[.35,.9],[.1,.6]]);
   const circleSample=`(()=>{const c=document.querySelector('[aria-label="涂画修改区域画布"]');return [...c.getContext('2d').getImageData(Math.round(c.width*15.2/64),Math.round(c.height*36/48),1,1).data]})()`;
   const withCircle=await js(circleSample);await click('撤销涂画');check('undo removes only the last circle',JSON.stringify(await js(circleSample))!==JSON.stringify(withCircle));await click('重做涂画');check('redo restores the circle preview',JSON.stringify(await js(circleSample))===JSON.stringify(withCircle));
   await click('擦除');await input('涂画笔刷大小（原图 px）',4);await draw([[46.8/64,37.2/48]]);await capture('shapes-with-eraser');
   await click('应用修改区域');await wait(`!document.querySelector('.cloud-mask-editor')`);await run('project.save');
   const shapesDoc=await js(`window.tugou.open(${JSON.stringify(project)})`),shapeId=shapesDoc.document.tugouCanvas.nodes.find(n=>n.id===target).data.localEdit.maskId,shapeMask=shapesDoc.document.assets.find(a=>a.id===shapeId);
   const shapeAlpha=await sharp(path.join(profile,'workspace','resources',shapeMask.resource)).extractChannel('alpha').raw().toBuffer(),a=(x,y)=>shapeAlpha[y*64+x];
   check('reverse rectangle exports correct source coordinates',a(16,12)===255&&a(4,12)===0&&a(31,12)===0);
   check('circles stay round in both drag directions and erase accepts shape regions',a(15,36)===255&&a(45,33)>0&&a(47,37)===0&&a(39,30)===0&&a(8,30)===0&&a(28,36)===0&&a(0,0)===0);
   await run('ui.navigate',{workspace:'canvas',nodeId:target});await capture('shape-node-overlay');check('saved shapes display on image node',await js(`document.querySelector('[data-id="${target}"] .node-region-overlay').style.maskImage.includes(${JSON.stringify(shapeMask.resource)})`));
   await openPaint(first);await click('清空区域');await click('矩形');await draw([[.3,.35],[.1,.2]]);await click('圆形');await draw([[.6,.5],[.8,.8]]);await capture('shapes-portrait-light');
   check('shape tools and apply action fit compact window',await js(`(()=>{const e=document.querySelector('.cloud-mask-editor'),buttons=[...e.querySelectorAll('.mask-paint-toolbar button'),...e.querySelectorAll('footer button')];return buttons.every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})})()`));
   await click('应用修改区域');await wait(`!document.querySelector('.cloud-mask-editor')`);await run('project.save');
   const highDoc=await js(`window.tugou.open(${JSON.stringify(project)})`),highMask=highDoc.document.assets.at(-1),highAlpha=await sharp(path.join(profile,'workspace','resources',highMask.resource)).extractChannel('alpha').raw().toBuffer();
   let minX=2048,maxX=0,minY=3072,maxY=0;for(let y=0;y<3072;y++)for(let x=1024;x<2048;x++)if(highAlpha[y*2048+x]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
   check('scaled portrait shapes export full resolution with equal circle width and height',highMask.width===2048&&highMask.height===3072&&highAlpha[800*2048+400]===255&&highAlpha[1741*2048+1434]===255&&Math.abs((maxX-minX)-(maxY-minY))<=2&&maxX-minX>400&&highAlpha[0]===0);
   check('shape drawing and saving do not call a model',report.requests.length===2);
   check('no renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require(entry);
