const {app,dialog}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {workflowNode,compileWorkflow}=require('../core/workflow-nodes.cjs');
const {createLayer}=require('../core/layers.cjs');
const http=require('node:http');
const requests=[];let png;
const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);requests.push(Buffer.concat(chunks).toString());res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:png},{b64_json:png},{b64_json:png}]}));});
const base=process.env.TUGOU_STYLE_QA||path.resolve(__dirname,'../test-results/platform-style');fs.mkdirSync(base,{recursive:true});
const profile=fs.mkdtempSync(path.join(base,'desktop-'));process.env.TUGOU_DATA_DIR=profile;
process.env.TUGOU_BUILD_DIR=path.join(base,'build');if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;
const report={profile,checks:[],errors:[]};let finished=false;
const finish=code=>{if(finished)return;finished=true;server.closeAllConnections();server.close();fs.writeFileSync(path.join(base,process.env.TUGOU_TEST_APP?'packaged.json':'desktop.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},180000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
    const wait=async s=>{for(let i=0;i<300;i++){if(await js(`Boolean(${s})`))return;await delay(40);}throw Error('timeout '+s);};
    const click=async(label,selector='button')=>{await js(`{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw Error('missing '+${JSON.stringify(label)});e.click()}`);await delay(160);};
    const set=async(label,value)=>{await js(`{const e=document.querySelector('[aria-label="${label}"]');if(!e)throw Error('missing field ${label}');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}))}`);await delay(180);};
    const shot=async name=>{await w.capturePage();await delay(250);fs.writeFileSync(path.join(base,name+'.png'),(await w.capturePage()).toPNG());};
    const save=async()=>{if(await js('!document.querySelector("button[aria-label=保存]").disabled'))await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return(await js(`tugou.open(${JSON.stringify(report.id)})`)).document;};
    const closePopover=async()=>{await js(`document.querySelector('.ant-popover:not(.ant-popover-hidden) .tool-popover')?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);await delay(100);};
    const load=async(workspace='canvas')=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:${JSON.stringify(workspace)}}))`);const ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;await wait('document.querySelector(".workspace-content")');await delay(350);};
    try{
      w.setSize(1440,960);
      png=(await require('sharp')({create:{width:64,height:96,channels:4,background:'#c9d5c8'}}).png().toBuffer()).toString('base64');
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      const files=['01-paper.png','02-scene.png','03-couple.png','04-flowers.png'].map(n=>path.resolve(__dirname,'../../assets/studio-demo',n));
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:files});
      const assets=await js('tugou.importImage()');const names=['纸张纹理','花园拱门','人物 · 手绘','花卉装饰'];assets.forEach((a,i)=>a.name=names[i]);
      const desk=workflowNode('config',{x:520,y:80});desk.id='desk';desk.data.prompt='自然光，画面明亮而柔和';
      const nodes=[{id:'person',type:'asset',position:{x:0,y:60},width:220,height:310,data:{assetId:assets[2].id,role:'主体身份'}},{id:'scene',type:'asset',position:{x:240,y:420},width:220,height:300,data:{assetId:assets[1].id,role:'场景构图'}},desk];
      const modules=[['style','统一画风','style','细腻手绘插画，柔和水彩。'],['person','人物要求','subject','保留人物五官与发型，人物全身构图。'],['scene','花园背景','background','花卉拱门，春日自然光。']].map(([id,name,kind,text])=>({id,name,kind,text,revision:1,global:id==='style'}));
      const layers=assets.slice(0,3).map((a,i)=>createLayer('image',{name:names[i],assetId:a.id,x:0,y:0,width:1024,height:1536}));
      const fixture={assets,modules,layers,width:1024,height:1536,recipes:[{id:'recipe',name:'主视觉 · 花园婚礼',moduleIds:['person','scene'],references:[{assetId:assets[2].id,role:'主体身份'},{assetId:assets[1].id,role:'场景构图'}],output:'人物位于花园拱门中央，保留留白。',size:'1024x1536'}],tugouCanvas:{version:1,nodes,edges:[{id:'e1',source:'person',target:'desk'},{id:'e2',source:'scene',target:'desk'}],viewport:{x:30,y:20,zoom:.8}}};
      report.id=await js(`(async()=>{const r=await tugou.create('婚礼请柬 · 样式验收');await tugou.save(r.id,{...r.document,...${JSON.stringify(fixture)}},r.revision);await tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'gpt-image-1',analysisModel:'vision-test',apiKey:'test-local-only'});return r.id})()`);
      await load();await wait('document.querySelector(".generation-model")');
      check('five workspaces are in the left navigation rail',await js('document.querySelectorAll(".workspace-rail > button").length===5&&document.querySelector(".workspace-rail").getBoundingClientRect().width===72'));
      check('generation desk removes its inline supplemental prompt',!await js('document.querySelector("[aria-label=生成台补充要求]")'));
      let saved=await save();const extracted=saved.tugouCanvas.nodes.find(n=>n.data.name==='生成要求');
      check('old prompt becomes a connected visible text node',extracted&&extracted.data.text===desk.data.prompt&&saved.tugouCanvas.edges.some(e=>e.source===extracted.id&&e.target==='desk'));
      check('prompt conversion preserves the effective request',compileWorkflow(saved,'desk').prompt===compileWorkflow({...fixture},'desk').prompt);
      check('reference tiles are rounded squares',await js('[...document.querySelectorAll(".node-input-item")].every(e=>{const r=e.getBoundingClientRect();return Math.abs(r.width-r.height)<1&&parseFloat(getComputedStyle(e).borderRadius)===10})'));
      check('model, output and generate controls occupy separate rows',await js('(()=>{const m=document.querySelector(".generation-model").getBoundingClientRect(),o=document.querySelector(".desk-output-row").getBoundingClientRect(),b=document.querySelector(".desk-run").getBoundingClientRect();return o.top>=m.bottom&&b.top>=o.bottom&&b.width>250})()'));
      await js(`document.querySelector('[data-input-node="${extracted.id}"] .node-input-grip').focus()`);w.webContents.sendInputEvent({type:'keyDown',keyCode:'Left'});w.webContents.sendInputEvent({type:'keyUp',keyCode:'Left'});await delay(180);
      saved=await save();check('keyboard reorders square references',saved.tugouCanvas.nodes.find(n=>n.id==='desk').data.inputOrder[1]===extracted.id);await click('撤销');await save();
      await click('移除引入 生成要求','.node-input-actions button');saved=await save();check('removing a reference keeps its original node but excludes its text',saved.tugouCanvas.nodes.some(n=>n.id===extracted.id)&&!compileWorkflow(saved,'desk').prompt.includes(desk.data.prompt));await click('撤销');await save();
      // Place the migrated text in the review fixture; production migration leaves existing nodes untouched.
      await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});r.document.tugouCanvas.nodes.find(n=>n.id===${JSON.stringify(extracted.id)}).position={x:180,y:-100};r.document.tugouCanvas.nodes.find(n=>n.id==='person').position={x:-100,y:180};r.document.tugouCanvas.viewport={x:120,y:110,zoom:.8};await tugou.save(r.id,r.document,r.revision)})()`);await load();
      await shot('canvas-dark');
      await click('gpt-image-1','.generation-desk button');await shot('model-picker');await click('单独指定');await set('生成台模型','image-custom');await click('应用模型');saved=await save();check('custom model applies and persists',saved.tugouCanvas.nodes.find(n=>n.id==='desk').data.model==='image-custom');
      await click('image-custom','.generation-desk button');await click('沿用共享');await click('应用模型');saved=await save();check('shared model clears only the node override',saved.tugouCanvas.nodes.find(n=>n.id==='desk').data.model==='');
      await click('2:3 · 竖图','.generation-desk button');await shot('size-picker');await click('1:1','.ratio-choices button');await set('生成台尺寸','4096x4096');await set('生成台质量','high');await closePopover();saved=await save();check('ratio preset, large dimensions and quality persist',saved.tugouCanvas.nodes.find(n=>n.id==='desk').data.size==='4096x4096'&&saved.tugouCanvas.nodes.find(n=>n.id==='desk').data.quality==='high');
      await click('1:1 · 方图','.generation-desk button');await set('生成台尺寸','custom');await set('生成台尺寸（自定义）','2304x3072');await closePopover();saved=await save();check('custom dimensions are preserved',compileWorkflow(saved,'desk').size==='2304x3072');
      await click('1 张','.generation-desk button');await set('生成台数量',3);await closePopover();saved=await save();check('separate quantity control persists',compileWorkflow(saved,'desk').count===3);
      await click('切换浅色主题');await shot('canvas-light');check('light theme reaches canvas and shell',await js('document.documentElement.dataset.theme==="light"&&getComputedStyle(document.querySelector(".workspace-rail")).backgroundColor==="rgb(250, 251, 253)"'));await click('切换深色主题');
      for(const [label,selector,name] of [['提示词工作台','.workbench','prompts'],['图层合成','.layer-editor','layers'],['图像工具','.image-tools','tools'],['素材库','.asset-library','assets']]){
        await click(label,'.workspace-rail button');await wait(`document.querySelector('${selector}')`);await shot(name+'-dark');
        check(name+' workspace has no horizontal overflow at 1440',await js(`document.querySelector('${selector}').scrollWidth<=document.querySelector('${selector}').clientWidth+1`));
        await click('切换浅色主题');await shot(name+'-light');await click('切换深色主题');
      }
      check('asset detail preview preserves original proportions',await js('getComputedStyle(document.querySelector(".library-details img")).objectFit==="contain"'));
      await click('生成结果','.library-filters button');check('asset filter reports empty results',await js('document.body.innerText.includes("没有匹配的素材")'));await click('全部','.library-filters button');
      await click('图像工具','.workspace-rail button');await set('搜索工具','分辨率');check('tool search narrows navigation',await js('document.querySelectorAll(".tools-navigation section button").length>=1&&document.querySelectorAll(".tools-navigation section button").length<5'));await set('搜索工具','');await set('处理方式','resize');await set('尺寸方式','size');await shot('tools-size');
      check('tool parameters are inside the output sidebar',await js('Boolean(document.querySelector(".tools-settings [aria-label=输出宽度]"))'));
      await click('图层合成','.workspace-rail button');check('layer tree and properties are in opposite sidebars',await js('Boolean(document.querySelector(".layer-assets .layer-list"))&&Boolean(document.querySelector(".layer-sidebar .layer-properties"))'));
      await click('模型连接');await shot('connection');check('advanced connection options are collapsed',await js('document.querySelector(".connection-extra").open===false'));await click('关闭模型连接');await click('任务','.toolbar-end button');await shot('tasks');await click('关闭任务');
      w.setSize(940,640);await delay(250);
      for(const [label,selector,name] of [['提示词工作台','.workbench','prompts'],['图层合成','.layer-editor','layers'],['图像工具','.image-tools','tools'],['素材库','.asset-library','assets']]){await click(label,'.workspace-rail button');await shot(name+'-940');check(name+' remains within the minimum window',await js(`document.querySelector('${selector}').getBoundingClientRect().right<=innerWidth+1&&document.querySelector('.studio-header').scrollWidth<=innerWidth`));}
      w.setSize(1440,960);await click('无限画布','.workspace-rail button');await delay(250);
      await click('开始生成','.generation-desk button');await wait('document.querySelector(".node-result-preview img")');
      check('generation controls reach the actual local mock request',requests.length===1&&requests[0].includes('2304x3072')&&requests[0].includes('gpt-image-1')&&requests[0].includes('high'));
      check('completed result returns to the node and asset library',await js('document.querySelectorAll(".node-result-picker button").length===3'));await shot('generation-result');
      await save();
      await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});r.document.assets.push(...Array.from({length:10000},(_,i)=>({...r.document.assets[0],id:'scale-'+i,name:'性能素材 '+i})));await tugou.save(r.id,r.document,r.revision)})()`);
      const started=Date.now();await load('assets');report.library10000LoadMs=Date.now()-started;
      check('ten thousand materials keep bounded mounted cards',await js('document.querySelectorAll(".asset-card").length<100'));
      w.setSize(940,640);await delay(180);
      for(const density of ['small','medium','large']){await set('缩略图大小',density);await js(`{const e=document.querySelector('.asset-grid');e.scrollTop=e.scrollHeight;e.dispatchEvent(new Event('scroll'))}`);await delay(180);check(density+' density reaches the last original without overflow',await js(`(()=>{const e=document.querySelector('.asset-grid');return e.scrollWidth<=e.clientWidth+1&&[...e.querySelectorAll('strong')].some(x=>x.textContent==='纸张纹理')})()`));}
      check('no renderer errors',report.errors.length===0);finish(0);
    }catch(e){report.failure=e.stack;await shot('failure');finish(1);}
  });
});
require(process.env.TUGOU_TEST_APP||'../main.cjs');
