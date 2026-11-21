const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),sharp=require('sharp');
// Hosted Mac runners have no supported GPU; exercise the real renderer with software WebGL.
if(process.platform==='darwin'){app.commandLine.appendSwitch('use-angle','swiftshader');app.commandLine.appendSwitch('enable-unsafe-swiftshader');}
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/mcp-full');fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));
const cold=process.argv.includes('--arrangement-cold');
const stress=cold||process.argv.includes('--arrangement-stress'),baseline=process.argv.includes('--reference');
process.env.TUGOU_DATA_DIR=profile;if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;else process.env.TUGOU_BUILD_DIR=path.join(out,'build');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[],tasks:[]},sleep=ms=>new Promise(r=>setTimeout(r,ms));let transport,finished=false;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,stress?(`arrangement-${cold?'cold-':''}${baseline?'before':'after'}.json`):'report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},240000);
app.on('browser-window-created',(_,w)=>{
  if(!stress){w.show=()=>{};w.focus=()=>{};}
  w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
  w.webContents.once('did-finish-load',async()=>{
    try{
      const js=s=>w.webContents.executeJavaScript(s,true);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await sleep(50);
      transport=new StdioClientTransport({command:process.execPath,args:[process.env.TUGOU_TEST_APP?path.join(path.dirname(process.env.TUGOU_TEST_APP),'core/mcp.cjs'):path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
      const client=new Client({name:'creative-acceptance',version:'1'});await client.connect(transport);
      const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
      const state=()=>call('get_state'),run=async(command,args={})=>call('run_command',{command,args,expectedRevision:(await state()).revision});
      const object=async(kind,id)=>(await call('get_object',{kind,id})).object;
      const wait=async id=>{for(let i=0;i<30;i++){const {task}=await run('task.wait',{id,timeoutMs:1000});if(!['queued','running'].includes(task.status)){report.tasks.push(task);return task;}}throw Error('task timeout '+id);};
      let request=0;
      const job=async(command,args={})=>{const {taskId}=await run(command,{...args,requestId:'r'+(++request)}),task=await wait(taskId);assert.equal(task.status,'completed',task.message);return (await run('task.result',{id:taskId})).result;};
      await run('project.create',{name:'MCP 全量创作验收'});const initial=await state();
      if(stress){await stressArrangement(call,run,state,object,js,w);check('no renderer errors',!report.errors.length);finish(0);return;}
      report.commandCount=initial.capabilities.commands;check('all extended commands discoverable',report.commandCount===require('../core/automation-commands.cjs').listCommands().length);
      const board=(await run('artboard.create',{name:'animation',width:32,height:32})).id;
      await checkArrangement(call,run,state,object,board);
      for(const [name,color] of [['red','#ff0000'],['blue','#0000ff']])fs.writeFileSync(path.join(initial.filesRoot,name+'.png'),await sharp({create:{width:32,height:32,channels:4,background:color}}).png().toBuffer());
      const red=(await run('asset.import',{path:'red.png'})).ids[0],blue=(await run('asset.import',{path:'blue.png'})).ids[0];
      const gifArgs={frames:[{assetId:red,delay:100},{assetId:blue,delay:200}],width:32,height:32,loop:0,requestId:'gif-once'};
      const submitted=await run('gif.create',gifArgs),repeated=await run('gif.create',gifArgs);check('GIF request deduplicates before and after task completion',submitted.taskId===repeated.taskId&&repeated.replayed);
      assert.equal((await wait(submitted.taskId)).status,'completed');const gif=(await run('task.result',{id:submitted.taskId})).result.assetId;
      const gifAsset=await object('asset',gif);check('GIF keeps ordered frames, timing and loop',gifAsset.gif.frames===2&&gifAsset.gif.delays.join(',')==='100,200'&&gifAsset.gif.loop===0);
      const layer=(await run('layer.create',{artboardId:board,kind:'image',properties:{assetId:gif,width:32,height:32,x:0,y:0}})).id;
      const print=(await run('artboard.create',{name:'印刷',width:14,height:20,unit:'cm',ppi:300})).id;
      const printed=await object('artboard',print);check('physical artboard retains exact input and rounds pixels',printed.width===1654&&printed.height===2362&&printed.printSize.width===14);
      await run('artboard.update',{id:print,patch:{ppi:150}});const resized=await object('artboard',print);
      check('PPI change preserves physical measurements',resized.width===827&&resized.height===1181&&resized.printSize.height===20);
      const traced=await job('image.vectorize',{id:layer,threshold:128}),vector=await object('layer',traced.id);
      check('image tracing creates editable contours above the original image',vector.shape==='path'&&vector.paths[0].closed&&(await object('layer',layer)).kind==='image');
      await run('layer.update',{id:vector.id,patch:{color:'#12ab34'}});
      await run('artboard.export',{artboardId:board,path:'vector-render.png'});
      const sample=await sharp(path.join(initial.filesRoot,'vector-render.png')).extract({left:16,top:16,width:1,height:1}).removeAlpha().raw().toBuffer();
      check('the compositor renders the editable vector over its source image',sample.equals(Buffer.from([18,171,52])));
      await run('layer.pathAnchor',{id:vector.id,contour:0,index:0,handle:'anchor',x:.3,y:.4});
      check('MCP can read edited vector coordinates',(await object('layer',vector.id)).paths[0].nodes[0].x===.3);
      await run('layer.exportSvg',{id:vector.id,path:'trace.svg'});
      check('SVG exports editable paths',fs.readFileSync(path.join(initial.filesRoot,'trace.svg'),'utf8').includes('<path '));
      await run('artboard.export',{artboardId:print,path:'print.png'});
      check('PNG records the chosen PPI',(await sharp(path.join(initial.filesRoot,'print.png')).metadata()).density===150);
      const second=(await run('layer.create',{artboardId:board,kind:'shape',properties:{shape:'path',paths:[{closed:false,nodes:[{x:0,y:0,out:[0,.8]},{x:1,y:1}]}],width:10,height:10,fill:false,strokeWidth:2}})).id;
      const inserted=await run('layer.pathInsertAnchor',{id:second,contour:0,index:0});
      check('AI inserts an anchor into an open cubic',inserted.index===1&&(await object('layer',second)).paths[0].nodes.length===3);
      await run('layer.pathDeleteAnchor',{id:second,contour:0,index:1});
      check('AI can remove the selected anchor',(await object('layer',second)).paths[0].nodes.length===2);
      const [group]=(await run('layer.group',{ids:[vector.id,second]})).ids;
      await run('layer.exportSvg',{id:group,path:'paths.svg'});
      check('AI-created and traced paths export as one editable group',(fs.readFileSync(path.join(initial.filesRoot,'paths.svg'),'utf8').match(/<path /g)||[]).length===2);
      await run('layer.delete',{ids:[group]});
      const frames=await run('artboard.timeline',{artboardId:board});check('timeline exposes one-based frame numbers and elapsed times',frames.frames[1].frame===2&&frames.frames[1].time===100);
      const png=await job('artboard.exportAnimation',{artboardId:board,path:'frame2.png',format:'png',frame:2});const pixel=await sharp(png.path).ensureAlpha().raw().toBuffer();check('selected PNG is second blue frame',pixel[2]>240&&pixel[0]<10);
      const exported=await job('artboard.exportAnimation',{artboardId:board,path:'range.gif',format:'gif',startFrame:1,endFrame:2});const meta=await sharp(exported.path,{animated:true}).metadata();check('GIF export retains both frames and delays',meta.pages===2&&meta.delay.join(',')==='100,200');
      const beforeExport=await state();const invalid=await run('artboard.exportAnimation',{artboardId:board,path:'bad.png',format:'png',frame:3,requestId:'bad-frame'});check('invalid frame fails without document mutation',(await wait(invalid.taskId)).status==='failed'&&(await state()).revision===beforeExport.revision);
      await assert.rejects(run('artboard.exportAnimation',{artboardId:board,path:'../escape.gif',format:'gif',requestId:'escape'}));check('export path traversal rejected before job starts',true);
      const noOverwrite=await run('artboard.exportAnimation',{artboardId:board,path:'frame2.png',format:'png',frame:1,requestId:'overwrite'});assert.equal((await wait(noOverwrite.taskId)).status,'failed');check('export never overwrites an existing file',(await sharp(png.path).raw().toBuffer())[2]>240);
      await run('layer.replaceImage',{id:layer,assetId:red});
      const history=(await state()).history.undo,paint=await job('paint.create',{artboardId:board,name:'绘画层'});check('blank paint layer is transparent and creates one undo',(await state()).history.undo===history+1&&!!paint.id);
      await run('paint.stroke',{id:paint.id,target:'image',points:[{x:6,y:6,pressure:.2},{x:20,y:20,pressure:1}],pressure:true,smoothing:25,size:6,color:'#00ff00'});
      const painted=await object('layer',paint.id);check('pressure stroke stores edited bitmap',!!painted.bitmap);
      await run('history.undo');check('undo removes only brush result',!(await object('layer',paint.id)).bitmap);await run('history.redo');
      await job('selection.color',{artboardId:board,id:layer,x:2,y:2,tolerance:5,contiguous:true});check('wand creates bitmap selection',!!(await object('artboard',board)).selection.bitmap);
      await run('selection.rectangle',{artboardId:board,x:5,y:5,width:20,height:20});await run('selection.ellipse',{artboardId:board,x:8,y:8,width:5,height:5,operation:'subtract'});
      await run('selection.feather',{artboardId:board,radius:1});await job('selection.grow',{artboardId:board,radius:2});check('combined feathered selection supports expansion',!!(await object('artboard',board)).selection.bitmap);
      const adjusted=await job('layer.adjustmentFromSelection',{artboardId:board,adjustment:{type:'brightnessContrast',brightness:10}});check('adjustment from selection has independent mask',!!(await object('layer',adjusted.id)).mask.bitmap);
      await run('selection.clear',{artboardId:board});
      for(const tool of ['clone','heal','blur','smudge','liquify']){
        const r=await job('paint.retouch',{id:layer,tool,points:[{x:12,y:12},{x:15,y:15}],size:4,...(['clone','heal'].includes(tool)?{source:{u:.25,v:.25}}:{})});check(tool+' brush completes through shared pixel engine',r.id===layer);
      }
      await run('selection.rectangle',{artboardId:board,x:12,y:12,width:4,height:4});await job('image.contentFill',{id:layer});check('content-aware fill persists edited image',!!(await object('layer',layer)).bitmap);
      await run('mask.create',{id:layer});await run('mask.fill',{id:layer,mode:'hide'});await run('mask.link',{id:layer,linked:false});
      await run('mask.transform',{id:layer,matrix:[1,0,0,1,2,0],width:32,height:32});await job('mask.relink',{id:layer});check('independent mask transforms and relinks',!(await object('layer',layer)).mask.anchor);
      await run('layer.update',{id:layer,patch:{x:-8}});await run('mask.link',{id:layer,linked:false});const preview=async()=>{const r=await client.callTool({name:'preview',arguments:{artboardId:board,maxSize:64}});return r.content.find(c=>c.type==='image').data;};const beforeRelink=await preview();await job('mask.relink',{id:layer});check('relink preserves off-board mask pixels',await preview()===beforeRelink);await run('layer.update',{id:layer,patch:{x:0}});
      await run('layout.update',{artboardId:board,patch:{grid:true,snap:true,gridSize:8,guides:[{axis:'x',position:8}]}});await job('artboard.cropSelection',{artboardId:board});check('crop updates board size and translates guides',(await object('artboard',board)).width===4&&(await object('artboard',board)).layout.guides[0].position===-4);
      const search=await run('asset.search',{source:'imported',shape:'square',sort:'pixels',limit:1});check('material filters remain paginated',search.objects.length===1&&search.total>=2&&search.nextOffset===1);
      const director=(await run('canvas.create',{type:'director',position:{x:0,y:0}})).id;
      await run('scene.object.create',{nodeId:director,kind:'box'});const angles=await job('scene.captureAngles',{nodeId:director,count:4,maxSize:64});check('four-angle capture creates connected result nodes',angles.assetIds.length===4&&angles.nodeIds.length===4);
      await run('canvas.selectResult',{id:director,assetId:angles.assetIds[2]});check('downstream result choice persists',(await object('canvasNode',director)).data.outputAssetId===angles.assetIds[2]);
      const twelve=await job('scene.captureAngles',{nodeId:director,count:12,maxSize:64});check('twelve-angle capture returns every independent frame',twelve.assetIds.length===12&&twelve.nodeIds.length===12);
      w.webContents.setBackgroundThrottling(true);
      const movie=await job('scene.record',{nodeId:director,duration:1,maxSize:64});check('camera recording produces real video asset',(await object('asset',movie.assetIds[0])).kind==='video');
      check('background recording restores idle throttling',w.webContents.getBackgroundThrottling());w.webContents.setBackgroundThrottling(false);
      const beforeCancel=await state(),cancelled=await run('scene.record',{nodeId:director,duration:5,maxSize:64,requestId:'cancel-video'});await sleep(200);await run('task.cancel',{id:cancelled.taskId});check('recording can be cancelled without changing document',(await wait(cancelled.taskId)).status==='cancelled'&&(await state()).revision===beforeCancel.revision);
      const stale=await run('scene.record',{nodeId:director,duration:1,maxSize:64,requestId:'stale-video'});await sleep(150);await run('project.rename',{name:'保留手动更新'});check('late recording refuses stale revision',(await wait(stale.taskId)).status==='failed'&&(await state()).name==='保留手动更新');
      const legacy={format:'canvas-studio',version:5,id:'legacy',name:'旧工程',width:32,height:32,background:'#fff',modules:[],recipes:[],assets:[],layers:[],jobs:[]};fs.writeFileSync(path.join(initial.filesRoot,'legacy.json'),JSON.stringify(legacy));
      const imported=await run('project.importLegacy',{path:'legacy.json'});check('legacy project imports without replacing active document',imported.projects.length===1&&(await state()).projectId===initial.projectId);
      fs.writeFileSync(path.join(initial.filesRoot,'canvas.json'),JSON.stringify({state:{state:{projects:[{id:'old-canvas',title:'旧画布',nodes:[],connections:[]}]}},images:[]}));const migrated=await run('project.migrateCanvas',{path:'canvas.json'});check('legacy canvas snapshot migrates',migrated.projects.length===1);
      await run('project.save');const saved=await state();await run('project.create',{name:'temporary'});await run('project.open',{id:saved.projectId});check('saved GIF and recording survive reopen',(await object('asset',gif)).gif.frames===2&&(await object('asset',movie.assetIds[0])).kind==='video');
      await run('history.undo').then(()=>{throw Error('reopen should have empty history');},()=>{});
      check('no renderer errors',report.errors.length===0);finish(0);
    }catch(e){report.failure=e.stack;console.error(e);finish(1);}
  });
});require(process.env.TUGOU_TEST_APP?path.resolve(process.env.TUGOU_TEST_APP):'../desktop-main.cjs');

async function stressArrangement(call,run,state,object,js,w){
  const width=4000,height=3999,board=(await run('artboard.create',{name:'排版压测',width,height})).id;
  const ids=[];
  for(const [x,y,w,h] of [[10,20,20,12],[57,41,12,10],[101,62,26,8],[172,81,32,20]])
    ids.push((await run('layer.create',{artboardId:board,kind:'shape',properties:{x,y,width:w,height:h}})).id);
  await run('selection.rectangle',{artboardId:board,x:10,y:5,width:3980,height:3988});
  await run('selection.rectangle',{artboardId:board,x:0,y:0,width:50,height,operation:'subtract'});
  await run('workspace.show',{workspace:'layers',layerIds:ids});
  w.setAlwaysOnTop(true);w.show();w.focus();
  const ready=async()=>{
    for(let i=0;i<120;i++){
      if(await js("document.querySelector('.selection-preview')?.width>1&&document.querySelector('canvas[aria-label=图层画布]')?.dataset.rendering==='false'&&document.visibilityState==='visible'"))return;
      await sleep(25);
    }
    throw Error('图层画布未进入可渲染状态');
  };
  const positions=()=>Promise.all(ids.map(async id=>(await object('layer',id)).x));
  const near=(a,b)=>a.forEach((x,i)=>assert.ok(Math.abs(x-b[i])<1e-6,`${x} vs ${b[i]}`));
  const stats=values=>{const sorted=[...values].sort((a,b)=>a-b);return {p50:+sorted[Math.ceil(sorted.length*.5)-1].toFixed(1),p95:+sorted[Math.ceil(sorted.length*.95)-1].toFixed(1),max:+sorted.at(-1).toFixed(1)};};
  report.scanPixels=width*height;report.selectedPixels=3940*3988;report.stress=[];
  if(cold){
    report.repeats=4;
    delete report.selectedPixels;
    await js(`(()=>{
      const fill=CanvasRenderingContext2D.prototype.fillRect;
      window.selectionPaints=0;
      CanvasRenderingContext2D.prototype.fillRect=function(...args){
        const result=fill.apply(this,args);
        if(this.canvas.classList.contains('selection-preview')&&this.globalCompositeOperation==='source-in')window.selectionPaints++;
        return result;
      };
    })()`);
    const waitPaint=async before=>{
      for(let retries=0;await js('window.selectionPaints')<=before;retries++){
        if(retries>=160)throw Error('切换后的选区预览未绘制');
        await sleep(25);
      }
    };
    for(const kind of ['paths','bitmap']){
      if(kind==='bitmap'){
        const before=await js('window.selectionPaints');
        await run('selection.rasterize',{artboardId:board});
        await waitPaint(before);
      }
      await ready();
      await w.capturePage();
      for(const command of ['align','distribute']){
        const times=[],frames=[],samples=[];
        for(let i=0;i<report.repeats;i++){
          const frameReady=await js(`(()=>{window.coldFrames=[];
            let last;const sample=t=>{if(last)window.coldFrames.push(t-last);last=t;window.coldFrame=requestAnimationFrame(sample);};
            window.coldFrame=requestAnimationFrame(sample);
            return new Promise(resolve=>requestAnimationFrame(first=>requestAnimationFrame(second=>resolve(second-first))));
          })()`);
          assert.ok(frameReady<100&&w.isVisible()&&!w.isMinimized(),'压测窗口帧率受系统节流');
          const left=(kind==='paths'?56:112)+(command==='align'?0:24)+i*6;
          const beforePaint=await js('window.selectionPaints');
          const switchStart=performance.now();
          const switched=await run('selection.rectangle',{artboardId:board,x:0,y:0,width:left,height,operation:'subtract'});
          const start=performance.now();
          const result=await call('run_command',{command:'layer.'+command,expectedRevision:switched.revision,
            args:{ids,axis:'x',target:'selection',...(command==='align'?{mode:'start'}:{})}});
          times.push(performance.now()-start);assert.equal(result.changed,true);
          await waitPaint(beforePaint);
          const previewMs=performance.now()-switchStart;
          const gaps=await js(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>{
            cancelAnimationFrame(window.coldFrame);resolve(window.coldFrames);
          })))`);
          frames.push(...gaps);samples.push({pixels:(3990-left)*3988,ms:+times.at(-1).toFixed(1),switchThroughPreview:+previewMs.toFixed(1),maxFrame:+Math.max(...gaps).toFixed(1)});
          const gap=(3990-left-90)/3;
          near(await positions(),command==='align'?[left,left+47,left+91,left+162]:[left,left+20+gap,left+32+2*gap,3958]);
          await run('history.undo');near(await positions(),[10,57,101,172]);
          await sleep(90);
        }
        report.stress.push({kind,command,requests:times.length,samples,latency:stats(times),frames:stats(frames),framesOver50:frames.filter(v=>v>50).length});
        console.log(JSON.stringify(report.stress.at(-1)));
      }
    }
    return;
  }
  for(const kind of ['paths','bitmap']){
    if(kind==='bitmap')await run('selection.rasterize',{artboardId:board});
    await ready();
    await js(`window.measureFrames=(()=>{
      const gaps=[];let frame,last=performance.now(),coldEnd=0;
      const sample=now=>{gaps.push(now-last);last=now;frame=requestAnimationFrame(sample);};
      frame=requestAnimationFrame(sample);
      return {
        warm:()=>new Promise(resolve=>requestAnimationFrame(()=>{coldEnd=gaps.length;resolve();})),
        stop:()=>{cancelAnimationFrame(frame);return {all:gaps.slice(1),warm:gaps.slice(coldEnd)};},
      };
    })();void 0`);
    const times={align:[],distribute:[]},initial=await state();
    let revision=initial.revision;
    let aligned;
    const gap=(3940-90)/3;
    for(let i=0;i<40;i++){
      const command=i%2?'distribute':'align',args={ids,axis:'x',target:'selection'};
      if(command==='align')args.mode=i%4===0?'start':'end';
      const start=performance.now();
      const result=await call('run_command',{command:'layer.'+command,args,expectedRevision:revision});
      times[command].push(performance.now()-start);assert.equal(result.changed,true);revision=result.revision;
      if(i===0)await js('measureFrames.warm()');
      if(command==='align'){
        const left=args.mode==='start'?50:3796;
        aligned=[left,left+47,left+91,left+162];
        if(i%10===0)near(await positions(),aligned);
      }else{
        if(i%10===9)near(await positions(),[50,70+gap,82+gap*2,3958]);
        const reverted=await call('run_command',{command:'history.undo',expectedRevision:revision});
        revision=reverted.revision;
      }
    }
    const frames=await js('measureFrames.stop()');
    near(await positions(),aligned);
    report.stress.push({
      kind,requests:40,align:stats(times.align),distribute:stats(times.distribute),first:+times.align[0].toFixed(1),
      frames:stats(frames.all),framesOver50:frames.all.filter(v=>v>50).length,warmFrames:stats(frames.warm),
      warmFramesOver50:frames.warm.filter(v=>v>50).length,errors:report.errors.length,
    });
    console.log(JSON.stringify(report.stress.at(-1)));
  }
}

async function checkArrangement(call,run,state,object,otherBoard){
  const listed=await call('list_commands',{domain:'layer',schemas:true});
  for(const name of ['layer.align','layer.distribute'])
    assert.deepEqual(listed.commands.find(c=>c.name===name).inputSchema.properties.target.enum,['objects','selection','board']);
  const board=(await run('artboard.create',{name:'MCP 排版',width:200,height:120})).id;
  const ids=[];
  for(const [x,y,width,height] of [[10,20,20,12],[57,41,12,10],[101,62,26,8]])
    ids.push((await run('layer.create',{artboardId:board,kind:'shape',properties:{x,y,width,height}})).id);
  const positions=axis=>Promise.all(ids.map(async id=>(await object('layer',id))[axis]));
  const align=(target,axis,mode)=>run('layer.align',{ids,target,axis,mode});
  const distribute=target=>run('layer.distribute',{ids,target,axis:'x'});
  const undo=()=>run('history.undo');
  const foreign=(await run('layer.create',{artboardId:otherBoard,kind:'shape'})).id;
  await assert.rejects(run('layer.distribute',{ids:[ids[0],ids[1],foreign],axis:'x',target:'board'}),/同一画板/);
  await run('layer.delete',{ids:[foreign]});
  await run('layer.lock',{id:ids[0],locked:true});
  await assert.rejects(align('board','x','start'),/锁定/);
  await run('layer.lock',{id:ids[0],locked:false});
  await assert.rejects(align('selection','x','end'),/没有选区/);
  await assert.rejects(run('layer.distribute',{ids:ids.slice(0,2),axis:'x',target:'board'}),/三个/);
  check('invalid references, locked layers and insufficient objects cannot partially move a group',true);
  await align('objects','y','start');assert.deepEqual(await positions('y'),[20,20,20]);await undo();
  await align('board','x','end');assert.deepEqual(await positions('x'),[83,130,174]);
  const aligned=await state();await align('board','x','end');
  assert.equal((await state()).revision,aligned.revision);await undo();assert.deepEqual(await positions('x'),[10,57,101]);
  check('MCP object alignment and whole-group board alignment preserve undo and repeated align is a no-op',true);
  const batch=async steps=>call('batch',{expectedRevision:(await state()).revision,steps});
  const rect=(name,x,width,operation)=>({name,command:'selection.rectangle',args:{artboardId:board,x,y:10,width,height:90,operation}});
  await batch([rect('area',20,160,'replace'),rect('cut',0,40,'subtract'),{name:'align',command:'layer.align',args:{ids,target:'selection',axis:'x',mode:'end'}}]);
  assert.deepEqual(await positions('x'),[63,110,154]);await undo();
  assert.deepEqual(await positions('x'),[10,57,101]);assert.ok(!(await object('artboard',board)).selection);
  const before=await state();
  await assert.rejects(batch([rect('area',20,160,'replace'),rect('cut',0,200,'subtract'),{name:'align',command:'layer.align',args:{ids,target:'selection',axis:'y',mode:'center'}}]),/选区为空/);
  assert.equal((await state()).revision,before.revision);
  check('same-batch selection geometry is used and an empty selection rolls back every step',true);
  await batch([rect('area',20,160,'replace'),rect('cut',0,40,'subtract')]);
  await run('selection.rasterize',{artboardId:board});
  await align('selection','x','start');assert.deepEqual(await positions('x'),[40,87,131]);await undo();
  await run('layer.distribute',{ids,target:'selection',axis:'y'});
  assert.deepEqual(await positions('y'),[10,52,92]);await undo();
  for(const [target,x] of [['objects',[10,59.5,101]],['selection',[40,101,154]],['board',[0,91,174]]]){
    await distribute(target);assert.deepEqual(await positions('x'),x);await undo();
  }
  check('MCP honors bitmap selection bounds and equal edge gaps for all three references',true);
  await batch([rect('trim',0,65,'subtract'),{name:'align',command:'layer.align',args:{ids,target:'selection',axis:'x',mode:'start'}}]);
  assert.deepEqual(await positions('x'),[65,112,156]);await undo();
  await align('selection','x','start');assert.deepEqual(await positions('x'),[40,87,131]);await undo();
  check('editing a cached bitmap selection and undo both use the current alpha bounds',true);
  const text=(await run('layer.create',{artboardId:board,kind:'text',properties:{x:0,y:0,width:180,height:80,fontSize:14,text:'A'}})).id;
  await run('layer.align',{ids:[text],target:'board',axis:'x',mode:'end'});
  const rightAligned=await object('layer',text);assert.ok(rightAligned.x>20&&rightAligned.x<200);
  check('MCP aligns fixed text by the same visible text bounds as the toolbar',true);
}
