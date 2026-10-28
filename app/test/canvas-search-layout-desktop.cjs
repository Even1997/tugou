const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {workflowNode}=require('../core/workflow-nodes.cjs');
const base=path.resolve(__dirname,'../test-results/canvas-search-layout'),kind=process.env.TUGOU_TEST_APP?'packaged':'source';
fs.mkdirSync(base,{recursive:true});
process.env.TUGOU_DATA_DIR=fs.mkdtempSync(path.join(base,kind+'-profile-'));
process.env.TUGOU_BUILD_DIR=process.env.TUGOU_BUILD_DIR||path.join(base,'build');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;
const report={checks:[],errors:[]},finish=code=>{fs.writeFileSync(path.join(base,kind+'.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},150000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push({message:d.message,after:report.checks.at(-1)});}));
app.on('browser-window-created',(_,w)=>{w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);w.webContents.once('did-finish-load',async()=>{
  const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async s=>{for(let i=0;i<400;i++){if(await js(`Boolean(${s})`))return;await delay(40);}throw Error('timeout '+s);};
  const check=(name,v)=>{assert.ok(v,name);report.checks.push(name);};
  const click=async(label,selector='button')=>{await js(`{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!e||e.disabled)throw Error('missing '+${JSON.stringify(label)});e.focus();e.click()}`);await delay(180);};
  const key=async(keyCode,modifiers=[])=>{w.webContents.sendInputEvent({type:'keyDown',keyCode,modifiers});w.webContents.sendInputEvent({type:'keyUp',keyCode,modifiers});await delay(140);};
  const search=async value=>{await js(`{const e=document.querySelector('[aria-label="搜索节点类型"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.focus()}`);await delay(140);};
  const labels=()=>js('[...document.querySelectorAll(".canvas-node-picker [role=menuitem]")].map(e=>e.textContent.trim())');
  const save=async()=>{await delay(200);if(await js('[...document.querySelectorAll("button")].some(e=>e.getAttribute("aria-label")==="保存"&&!e.disabled)'))await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return(await js(`tugou.open(${JSON.stringify(report.id)})`)).document;};
  const graph=async()=>(await save()).tugouCanvas;
  const reload=async()=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'canvas'}))`);const loaded=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await loaded;await wait('document.querySelector(".react-flow__pane")');await delay(250);};
  const fixture=async nodes=>{await save();await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,tugouCanvas:${JSON.stringify({version:1,nodes,edges:[],viewport:{x:30,y:30,zoom:.6}})}},r.revision)})()`);await reload();};
  const point=selector=>js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
  const drag=async(a,b)=>{await w.capturePage();await delay(50);w.webContents.sendInputEvent({type:'mouseMove',...a});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...a});await delay(50);for(let i=1;i<=15;i++){w.webContents.sendInputEvent({type:'mouseMove',x:Math.round(a.x+(b.x-a.x)*i/15),y:Math.round(a.y+(b.y-a.y)*i/15),button:'left'});await delay(30);if(i===7)await w.capturePage();}w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...b});await delay(200);};
  const select=async ids=>{
    const p=await js('(()=>{const r=document.querySelector(".react-flow__pane").getBoundingClientRect();return{x:Math.round(r.left+15),y:Math.round(r.bottom-20)}})()');
    await w.capturePage();w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...p});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...p});await delay(100);
    for(let i=0;i<ids.length;i++){if(i===1){w.webContents.sendInputEvent({type:'keyDown',keyCode:'Shift'});await delay(80);}await js(`document.querySelector('[data-id="${ids[i]}"]').click()`);await delay(80);}
    w.webContents.sendInputEvent({type:'keyUp',keyCode:'Shift'});await delay(80);check('selected '+ids.join(', '),await js(`document.querySelectorAll('.react-flow__node.selected').length===${ids.length}`));
  };
  const arrange=async label=>{await click('整理选中节点');await click(label,'.canvas-arrange-menu button');};
  const snapshot=async name=>{await w.capturePage();await delay(140);fs.writeFileSync(path.join(base,kind+'-'+name+'.png'),(await w.capturePage()).toPNG());};
  const pos=g=>g.nodes.map(n=>({id:n.id,position:n.position,parentId:n.parentId,width:n.width,height:n.height}));
  const node=(id,x,y,extra={})=>({id,type:'text',position:{x,y},width:300,height:220,style:{width:300,height:220},data:{name:'提示词 '+id,text:'婚礼场景，柔和光线 '+id},...extra});
  try{
    w.setSize(1600,1000);
    const nodes=[node('a',60,80),node('b',470,130),node('c',940,70),{...workflowNode('config',{x:1180,y:450}),id:'outside'}];
    const initial={version:1,nodes,edges:[{id:'keep-edge',source:'a',target:'outside',userNote:'保留连线'}],viewport:{x:30,y:30,zoom:.6}};
    report.id=await js(`(async()=>{const r=await tugou.create('搜索与整理验收');await tugou.save(r.id,{...r.document,tugouCanvas:${JSON.stringify(initial)}},r.revision);return r.id})()`);await reload();
    await click('添加节点');await wait('document.activeElement.getAttribute("aria-label")==="搜索节点类型"');
    check('common node types lead the searchable menu',JSON.stringify((await labels()).slice(0,3))===JSON.stringify(['文字提示词','图片节点','生成台']));
    check('removed panorama stays absent',!(await labels()).some(s=>s.includes('全景')));
    await search('生图');check('Chinese keyword filters node types',JSON.stringify(await labels())===JSON.stringify(['生成台','图片生成']));
    await search('TEXT');check('English search is case insensitive',JSON.stringify(await labels())===JSON.stringify(['文字提示词','文本生成']));
    await search('xyz-no-result');await key('Enter');check('empty results are explained and Enter creates nothing',await js('Boolean(document.querySelector(".node-search-empty"))')&&(await graph()).nodes.length===4);
    await key('Escape');await wait('!document.querySelector(".canvas-node-picker")&&document.activeElement.getAttribute("aria-label")==="添加节点"');check('Escape closes menu and restores focus',true);
    await js('document.querySelector(".canvas-workspace").focus()');await key('a',['control']);await key('Tab');await wait('document.activeElement.getAttribute("aria-label")==="搜索节点类型"');
    await search('生成台');await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",isComposing:true,bubbles:true}))');await delay(100);
    check('IME confirmation does not add a node',(await graph()).nodes.length===4&&await js('Boolean(document.querySelector(".canvas-node-picker"))'));
    await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",isComposing:true,bubbles:true}))');await key('g',['control']);await key('Delete');
    check('search input shields selected nodes from canvas shortcuts',await js('Boolean(document.querySelector(".canvas-node-picker"))')&&(await graph()).nodes.length===4&&!(await graph()).nodes.some(n=>n.type==='group'));
    await search('');await key('Up');check('Up focuses and scrolls the last result into view',await js('document.activeElement.textContent.trim()==="导入视频或音频"&&document.querySelector(".canvas-node-picker [role=menu]").scrollTop>0'));
    await search('');await key('Down');check('Down moves from search to the first result',await js('document.activeElement.getAttribute("role")==="menuitem"&&document.activeElement.textContent.trim()==="文字提示词"'));
    await key('Down');await snapshot('search-keyboard');await key('Enter');await wait('!document.querySelector(".canvas-node-picker")');
    check('keyboard result navigation creates the highlighted image node',(await graph()).nodes.at(-1).type==='asset');await click('撤销');check('one undo removes the newly created node',(await graph()).nodes.length===4);
    await js('document.querySelector(".canvas-palette input").focus()');await key('Tab');check('Tab in an editor retains normal focus traversal',!await js('Boolean(document.querySelector(".canvas-node-picker"))'));
    await js('(()=>{const e=document.querySelector(".react-flow__pane"),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent("dblclick",{bubbles:true,clientX:r.right-10,clientY:r.bottom-10}))})()');await wait('document.querySelector(".canvas-node-picker")');await delay(250);
    check('double click popup remains inside window',await js('(()=>{const r=document.querySelector(".canvas-node-picker").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'));
    await snapshot('search-dark');await key('Escape');
    const blank=await js('(()=>{const r=document.querySelector(".react-flow__pane").getBoundingClientRect();return{x:Math.round(r.left+260),y:Math.round(r.bottom-130)}})()');
    await drag(await point('[data-id="a"] .react-flow__handle.source'),blank);await wait(`document.querySelector('[aria-label="搜索节点类型"]')?.placeholder.includes('可连接')`);
    check('drag connection menu filters incompatible node types',!(await labels()).includes('文字提示词')&&!(await labels()).includes('图片节点')&&(await labels()).includes('生成台'));
    await search('生成台');await key('Enter');let linked=await graph();
    check('search from a dragged connection creates and connects in one action',linked.nodes.length===5&&linked.edges.length===2&&linked.edges.some(e=>e.source==='a'&&e.target===linked.nodes.at(-1).id));
    await click('撤销');check('one undo removes linked creation and edge',(await graph()).nodes.length===4&&(await graph()).edges.length===1);
    await drag(await point('[data-id="a"] .react-flow__handle.source'),blank);await wait('document.querySelector(".canvas-node-picker")');await key('Escape');
    await js('document.querySelector(".canvas-workspace").focus()');await key('Tab');await search('生成台');await key('Enter');
    check('cancelled connection is not reused by the next ordinary creation',(await graph()).nodes.length===5&&(await graph()).edges.length===1);await click('撤销');
    await select(['a','b','c']);const before=await graph();
    for(const [label,axis] of [['左对齐','x'],['顶部对齐','y']]){
      await arrange(label);const after=await graph(),expected=Math.min(...before.nodes.slice(0,3).map(n=>n.position[axis]));
      check(label+' moves only selected coordinate',after.nodes.slice(0,3).every((n,i)=>n.position[axis]===expected&&n.position[axis==='x'?'y':'x']===before.nodes[i].position[axis==='x'?'y':'x']));
      check(label+' preserves unrelated node and edge',JSON.stringify(after.nodes[3])===JSON.stringify(before.nodes[3])&&JSON.stringify(after.edges)===JSON.stringify(before.edges));
      await click('撤销');check(label+' undoes in one step',JSON.stringify(pos(await graph()))===JSON.stringify(pos(before)));
      await click('重做');check(label+' redoes in one step',JSON.stringify(pos(await graph()))===JSON.stringify(pos(after)));await click('撤销');
    }
    for(const [label,axis,size] of [['水平等间距','x','width'],['垂直等间距','y','height']]){
      await arrange(label);const ordered=(await graph()).nodes.slice(0,3).sort((a,b)=>a.position[axis]-b.position[axis]),gaps=ordered.slice(1).map((n,i)=>n.position[axis]-ordered[i].position[axis]-ordered[i][size]);
      check(label+' uses equal nonnegative edge gaps',gaps.every(g=>g>=40)&&Math.abs(gaps[0]-gaps[1])<.01);await click('撤销');
    }
    await arrange('按行整理');const grid=await graph();
    const disjoint=(a,b)=>a.position.x+a.width<=b.position.x||b.position.x+b.width<=a.position.x||a.position.y+a.height<=b.position.y||b.position.y+b.height<=a.position.y;
    check('grid arrangement avoids card overlap',grid.nodes.slice(0,3).every((a,i)=>grid.nodes.slice(i+1,3).every(b=>disjoint(a,b))));
    await snapshot('arranged-dark');await reload();check('save and reload preserve all layout positions and edges',JSON.stringify(pos(await graph()))===JSON.stringify(pos(grid))&&JSON.stringify((await graph()).edges)===JSON.stringify(grid.edges));
    await click('整理选中节点');check('no selection disables arrangement',await js('[...document.querySelectorAll(".canvas-arrange-menu button")].every(b=>b.disabled)'));await key('Escape');
    await select(['a','b']);await click('整理选中节点');check('two nodes cannot distribute spacing',await js('[...document.querySelectorAll(".canvas-arrange-menu button")].filter(b=>b.textContent.includes("等间距")).every(b=>b.disabled)'));await key('Escape');
    await click('切换浅色主题');await select(['a','b','c']);await click('整理选中节点');await snapshot('arrange-light');await key('Escape');
    w.setSize(960,800);await delay(250);await js('document.querySelector(".canvas-workspace").focus()');await key('Tab');await search('图片');await snapshot('search-compact-light');
    check('search popup fits a compact window',await js('(()=>{const r=document.querySelector(".canvas-node-picker").getBoundingClientRect();return r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()'));await key('Escape');w.setSize(1600,1000);
    const groups=[node('g',100,80,{type:'group',width:664,height:544,style:{width:664,height:544},data:{name:'婚礼素材组'}}),node('ga',24,48,{parentId:'g'}),node('gb',340,48,{parentId:'g'}),node('gc',24,300,{parentId:'g'}),node('root',1000,100)];
    await fixture(groups);await js('document.querySelector(".canvas-workspace").focus()');await key('a',['control']);await arrange('按行整理');let grouped=await graph();
    check('selected group and children count as one movable unit',grouped.nodes.filter(n=>n.parentId).every(n=>JSON.stringify(n.position)===JSON.stringify(groups.find(g=>g.id===n.id).position)));await click('撤销');
    await select(['ga','gb','gc']);await arrange('按行整理');grouped=await graph();
    check('arranging group children retains membership and expands border',grouped.nodes[0].width===712&&grouped.nodes[0].height===576&&grouped.nodes.slice(1,4).every(n=>n.parentId==='g'));
    check('child layout preserves parent and unrelated node positions',JSON.stringify(grouped.nodes[0].position)===JSON.stringify(groups[0].position)&&JSON.stringify(grouped.nodes[4].position)===JSON.stringify(groups[4].position));
    await snapshot('grouped-light');await click('撤销');check('undo restores group border and child positions together',JSON.stringify(pos(await graph()))===JSON.stringify(pos({nodes:groups})));
    await select(['ga','root']);await click('整理选中节点');check('mixed containers explain why arrangement is disabled',await js('document.querySelector(".canvas-arrange-menu").textContent.includes("请选择同组节点")&&[...document.querySelectorAll(".canvas-arrange-menu button")].every(b=>b.disabled)'));
    check('no renderer errors',report.errors.length===0);check('test window remains hidden',!w.isVisible());finish(0);
  }catch(e){report.failure=e.stack;report.text=await js('document.body.innerText');await snapshot('failure');finish(1);}
});});require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
