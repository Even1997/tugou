const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {Client}=require('@modelcontextprotocol/sdk/client/index.js'),{StdioClientTransport}=require('@modelcontextprotocol/sdk/client/stdio.js');
const out=path.resolve('test-results/canvas-groups');fs.mkdirSync(out,{recursive:true});const profile=fs.mkdtempSync(path.join(out,'profile-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=path.join(out,'dist');delete process.env.TUGOU_DEV_PREVIEW;process.argv.push('--mcp-enable');
fs.writeFileSync(path.join(profile,'preferences.json'),JSON.stringify({...require('../core/preference-values.cjs').defaults,autoCheck:false,notifyTasks:false}));
const report={checks:[],errors:[]};let transport,finished=false;
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
const finish=code=>{if(finished)return;finished=true;fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));transport?.close();app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('browser-window-created',(_,w)=>{
 w.webContents.setBackgroundThrottling(false);w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<180;i++){if(await js(s))return;await delay(50);}throw Error('Timeout '+s);};
  const rect=selector=>js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})()`);
  const drag=async(from,dx,dy)=>{from={x:Math.round(from.x),y:Math.round(from.y)};w.webContents.sendInputEvent({type:'mouseMove',...from});w.webContents.sendInputEvent({type:'mouseDown',...from,button:'left',clickCount:1});for(let i=1;i<=8;i++){w.webContents.sendInputEvent({type:'mouseMove',x:Math.round(from.x+dx*i/8),y:Math.round(from.y+dy*i/8),modifiers:['leftButtonDown']});await delay(40);}w.webContents.sendInputEvent({type:'mouseUp',x:Math.round(from.x+dx),y:Math.round(from.y+dy),button:'left',clickCount:1});await delay(300);};
  const key=async(keyCode,modifiers=['control'])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(150);};
  const capture=async name=>{w.showInactive();await delay(120);fs.writeFileSync(path.join(out,name+'.png'),(await w.webContents.capturePage()).toPNG());};
  try{
   await wait(`!!document.querySelector('.workspace-rail')`);for(let i=0;i<100&&!fs.existsSync(path.join(profile,'mcp-session.json'));i++)await delay(50);
   transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('core/mcp.cjs'),'--session',path.join(profile,'mcp-session.json')],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stderr:'pipe'});
   const client=new Client({name:'group-frame-qa',version:'1'});await client.connect(transport);
   const call=async(name,args={})=>{const r=await client.callTool({name,arguments:args});if(r.isError)throw Error(r.content[0].text);return r.structuredContent;};
   const state=()=>call('get_state'),run=async(command,args={})=>{const r=await call('run_command',{command,args,expectedRevision:(await state()).revision});await delay(100);return r;};
   const query=async()=>(await call('query_objects',{kind:'canvasNode',limit:100})).objects;
   await run('project.create',{name:'组合边框隔离验收'});const project=(await state()).projectId;
   const png=await require('sharp')({create:{width:220,height:800,channels:4,background:'#a8b9d9'}}).png().toBuffer();
   const asset=await js(`window.tugou.storeRaster(${JSON.stringify([...png])},'长图测试')`);
   await js(`window.tugou.open(${JSON.stringify(project)}).then(r=>window.tugou.save(r.id,{...r.document,assets:[${JSON.stringify(asset)}]},r.revision))`);await run('project.open',{id:project});
   const a=(await run('canvas.create',{type:'text',position:{x:-120,y:20},properties:{name:'文本',text:'文本节点'}})).id;
   const b=(await run('canvas.create',{type:'image',position:{x:300,y:20},properties:{name:'生成台'}})).id;
   const c=(await run('canvas.create',{type:'asset',sourceId:asset.id,position:{x:760,y:20}})).id;
   await run('page.activate',{kind:'canvas',id:'canvas-main'});await run('ui.navigate',{overview:true});await wait(`document.querySelectorAll('.react-flow__node').length===3`);await delay(300);
   const selector=id=>`.react-flow__node[data-id="${id}"]`;
   const bounds=async()=>Object.fromEntries(await Promise.all([a,b,c].map(async id=>[id,await rect(selector(id))])));
   const contained=async(name,minCount=3)=>{await delay(300);const g=await rect('.react-flow__node-group'),children=await js(`Array.from(document.querySelectorAll('.react-flow__node:not(.react-flow__node-group)')).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom}})`);check(name,children.length>=minCount&&children.every(r=>r.x>=g.x-1&&r.y>=g.y-1&&r.right<=g.right+1&&r.bottom<=g.bottom+1));};
   const ungrouped=await bounds();await js(`document.querySelector('.canvas-workspace').focus()`);await key('a');await key('g');await wait(`!!document.querySelector('.react-flow__node-group')`);
   await contained('keyboard grouping covers mixed measured text, desk and tall image');const grouped=await bounds();check('group creation does not move children',Object.keys(ungrouped).every(id=>Math.abs(ungrouped[id].x-grouped[id].x)<1&&Math.abs(ungrouped[id].y-grouped[id].y)<1));await run('ui.navigate',{overview:true});await capture('group-dark');
   let group=(await query()).find(n=>n.type==='group');await run('canvas.ungroup',{id:group.id});await run('canvas.group',{ids:[a,b,c]});await contained('MCP grouping reconciles natural image height after rendering');
   const before=await state();await delay(700);check('measurement reconciliation adds no undo step',(await state()).history.undo===before.history.undo);
   // Drag a child across the frame's left/top sides, then resize it across right/bottom.
   await run('ui.navigate',{overview:true});const caption=await rect(selector(a)+' .node-caption');const otherBefore=await rect(selector(c));const historyBefore=(await state()).history.undo;
   await drag({x:caption.x+45,y:caption.y+caption.height/2},-90,-65);await contained('child drag outside left and top expands frame');const otherAfter=await rect(selector(c));check('frame expansion does not displace siblings',Math.abs(otherBefore.x-otherAfter.x)<1&&Math.abs(otherBefore.y-otherAfter.y)<1);check('one drag creates one undo step',(await state()).history.undo===historyBefore+1);
   await run('history.undo');await contained('undo restores a containing frame');await run('history.redo');await contained('redo restores expanded frame');
   const wideFrame=await rect('.react-flow__node-group'),inwardCaption=await rect(selector(a)+' .node-caption'),fixedSibling=await rect(selector(c)),inwardUndo=(await state()).history.undo;
   await drag({x:inwardCaption.x+45,y:inwardCaption.y+inwardCaption.height/2},55,40);await contained('inward drag retains all children inside frame');
   const tightFrame=await rect('.react-flow__node-group'),stillSibling=await rect(selector(c));check('inward drag automatically shrinks width and height',tightFrame.width<wideFrame.width-40&&tightFrame.height<wideFrame.height-25);
   check('shrinking frame does not move siblings or add extra history',Math.abs(stillSibling.x-fixedSibling.x)<1&&Math.abs(stillSibling.y-fixedSibling.y)<1&&(await state()).history.undo===inwardUndo+1);
   await run('history.undo');const undone=await rect('.react-flow__node-group');check('undo restores the larger frame',Math.abs(undone.width-wideFrame.width)<1&&Math.abs(undone.height-wideFrame.height)<1);await run('history.redo');const redone=await rect('.react-flow__node-group');check('redo restores the tightened frame',Math.abs(redone.width-tightFrame.width)<1&&Math.abs(redone.height-tightFrame.height)<1);await capture('inward-tightened');
   await run('ui.navigate',{nodeId:b});await wait(`!!document.querySelector('${selector(b)} .react-flow__resize-control.bottom.right')`);const handle=await rect(selector(b)+' .react-flow__resize-control.bottom.right');
   const resizeBefore=(await state()).history.undo;await drag({x:handle.x+handle.width/2,y:handle.y+handle.height/2},100,120);check('resize remains a single undo operation',(await state()).history.undo===resizeBefore+1);await run('ui.navigate',{overview:true});await contained('actual resizer expands frame to cover larger generation desk');
   await run('ui.navigate',{overview:true});await capture('expanded-dark');
   await run('ui.navigate',{nodeId:c});const imageHandle=await rect(selector(c)+' .react-flow__resize-control.bottom.right');await drag({x:imageHandle.x+imageHandle.width/2,y:imageHandle.y+imageHandle.height/2},60,70);
   await run('ui.navigate',{overview:true});const largeImageFrame=await rect('.react-flow__node-group'),smallHandle=await rect(selector(c)+' .react-flow__resize-control.bottom.right');await drag({x:smallHandle.x+smallHandle.width/2,y:smallHandle.y+smallHandle.height/2},-50,-80);const smallImageFrame=await rect('.react-flow__node-group');check('shrinking the outermost image also tightens its group',smallImageFrame.width<largeImageFrame.width-20&&smallImageFrame.height<largeImageFrame.height-20);await run('ui.navigate',{overview:true});await contained('resized smaller image stays inside the tightened frame');
   const member=(await query()).find(n=>n.id===c);await run('canvas.update',{id:c,position:{x:2400,y:member.position.y}});await run('ui.navigate',{overview:true});await contained('MCP child movement expands the displayed frame');
   for(const zoom of [.3,.8,1.4]){await run('canvas.viewport',{x:250,y:200,zoom});await contained('visible frame containment at zoom '+zoom,1);}
   await run('canvas.arrange',{ids:[a,b,c],mode:'grid'});await run('ui.navigate',{overview:true});await contained('group layout keeps all children inside frame');
   await js(`document.querySelector('[aria-label="切换浅色主题"]').click()`);await wait(`document.documentElement.dataset.theme==='light'`);await run('ui.navigate',{overview:true});await capture('group-light');
   await run('project.save');await run('project.create',{name:'切换检查'});await run('project.open',{id:project});await run('page.activate',{kind:'canvas',id:'canvas-main'});await run('ui.navigate',{overview:true});await contained('save and reopen retain complete frame');
   await run('canvas.viewport',{x:60,y:120,zoom:.2});const positions=await bounds();group=(await query()).find(n=>n.type==='group');await run('canvas.ungroup',{id:group.id});await wait(`!document.querySelector('.react-flow__node-group')`);const dissolved=await bounds();check('ungroup restores exact world positions after edits',Object.keys(positions).every(id=>Math.abs(positions[id].x-dissolved[id].x)<1&&Math.abs(positions[id].y-dissolved[id].y)<1));
   check('zero renderer errors',report.errors.length===0);finish(0);
  }catch(e){report.failure=e.stack;console.error(e);try{await capture('failure');}catch{}finish(1);}
 });
});require('../desktop-main.cjs');
