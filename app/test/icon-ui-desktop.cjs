const {app,dialog}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {workflowNode}=require('../core/workflow-nodes.cjs');
const base=path.resolve(__dirname,'../test-results/icon-ui');fs.mkdirSync(base,{recursive:true});
process.env.TUGOU_DATA_DIR=fs.mkdtempSync(path.join(base,'desktop-'));
process.env.TUGOU_BUILD_DIR=path.resolve(__dirname,'../test-results/workflow-build');
if(process.env.TUGOU_TEST_APP)delete process.env.TUGOU_BUILD_DIR;
const prefix=process.env.TUGOU_TEST_APP?'packaged-':'';
const report={profile:process.env.TUGOU_DATA_DIR,checks:[],errors:[],screens:[],audit:{}};
const finish=code=>{fs.writeFileSync(path.join(base,prefix+'desktop.json'),JSON.stringify(report,null,2));app.exit(code);};
setTimeout(()=>{report.failure='timeout';finish(1);},120000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message);}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(name,value)=>{assert.ok(value,name);report.checks.push(name);};
    const wait=async s=>{for(let i=0;i<300;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await delay(40);}throw Error('timeout '+s);};
    const click=async(label,selector='button')=>{await js(`{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}||e.textContent.trim()===${JSON.stringify(label)});if(!e||e.disabled)throw Error('missing '+${JSON.stringify(label)});e.click()}`);await delay(180);};
    const snapshot=async name=>{await w.capturePage();await delay(150);fs.writeFileSync(path.join(base,prefix+name+'.png'),(await w.capturePage()).toPNG());report.screens.push(prefix+name+'.png');};
    const save=async()=>{if(await js('!document.querySelector("[aria-label=保存]").disabled'))await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return(await js(`tugou.open(${JSON.stringify(report.id)})`)).document;};
    const audit=async name=>{
      const result=await js(`(()=>{const buttons=[...document.querySelectorAll('.icon-button')].filter(e=>e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');return {count:buttons.length,invalid:buttons.filter(e=>!e.getAttribute('aria-label')?.trim()||!e.querySelector('svg')||e.innerText.trim()||e.offsetWidth<24||e.offsetHeight<24).map(e=>({label:e.getAttribute('aria-label'),width:e.offsetWidth,height:e.offsetHeight,text:e.innerText})),overflow:document.documentElement.scrollWidth>innerWidth}})()`);
      report.audit[name]=result;check(name+' has labeled SVG controls, no action text, and unscaled targets >= 24px',result.count>12&&result.invalid.length===0);check(name+' stays inside viewport',!result.overflow);
      check(name+' keeps all header controls visible',await js('[...document.querySelectorAll(".studio-header button")].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1})'));
    };
    try{
      w.webContents.debugger.attach('1.3');
      await w.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true});
      w.setSize(1440,960);
      dialog.showOpenDialog=async()=>({canceled:false,filePaths:['couple.png','result-a.png','panorama.png'].map(n=>path.resolve(__dirname,'../../../node-comparison-prototype/public/assets',n))});
      const assets=await js('tugou.importImage()');assets.forEach((a,i)=>a.name=['人物参考','花园合影','花园全景'][i]);
      const desk=workflowNode('config',{x:380,y:80});Object.assign(desk.data,{prompt:'保留人物特征，布置春日花园婚礼场景',outputAssetId:assets[1].id,outputAssetIds:[assets[1].id],model:'gpt-image-1'});
      const graph={version:1,nodes:[{id:'picture',type:'asset',position:{x:10,y:80},data:{assetId:assets[0].id,role:'人物身份'}},desk],edges:[{id:'reference',source:'picture',target:desk.id}],viewport:{x:60,y:10,zoom:.9}};
      report.id=await js(`(async()=>{const r=await tugou.create('图构 · 图标界面验收');await tugou.save(r.id,{...r.document,assets:${JSON.stringify(assets)},modules:[{id:'style',kind:'style',name:'春日花园',text:'柔和自然光，清新花境',global:true}],recipes:[{id:'recipe',name:'婚礼合影',moduleIds:['style'],references:[],output:'人物合影',size:'1024x1536'}],tugouCanvas:${JSON.stringify(graph)}},r.revision);return r.id})()`);
      await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'canvas'}))`);
      const ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;
      await wait('document.querySelector(".react-flow")');await delay(400);
      if(await js('document.documentElement.dataset.theme!=="dark"'))await click('切换深色主题');
      const original=await save();
      for(const theme of ['dark','light']){
        if(theme==='light')await click('切换浅色主题');
        for(const [label,name] of [['无限画布','canvas'],['图层合成','layers'],['素材库','materials'],['图像工具','tools'],['提示词工作台','prompts']]){
          await click(label,'nav button');await delay(250);await audit(name+'-'+theme);await snapshot(name+'-'+theme);
        }
      }
      check('navigation and themes preserve project content',JSON.stringify((await js(`tugou.open(${JSON.stringify(report.id)})`)).document)===JSON.stringify(original));
      check('five navigation icons are distinct and selection is announced',await js('new Set([...document.querySelectorAll("nav .anticon")].map(e=>e.getAttribute("aria-label"))).size===5&&document.querySelectorAll("nav [aria-current=page]").length===1'));
      await js('document.querySelector("nav [aria-label=无限画布]").focus()');
      await wait('[...document.querySelectorAll(".ant-tooltip-container")].some(e=>e.textContent==="无限画布")');
      check('keyboard focus reveals the full navigation label',true);await snapshot('keyboard-tooltip');
      await click('无限画布','nav button');await click('小地图');
      check('minimap toggle announces the active state',await js('document.querySelector("[aria-label=小地图]").getAttribute("aria-pressed")==="true"&&!!document.querySelector(".react-flow__minimap")'));await click('小地图');
      const beforeZoom=await js('document.querySelector(".react-flow__viewport").style.transform');await click('放大画布');await delay(400);
      check('zoom icon still changes the viewport',await js('document.querySelector(".react-flow__viewport").style.transform')!==beforeZoom);await click('缩小画布');
      await click('添加节点');await wait('document.querySelector(".ant-dropdown:not(.ant-dropdown-hidden)")');await click('文字提示词','.ant-dropdown:not(.ant-dropdown-hidden) [role=menuitem]');
      check('icon menu still creates nodes',(await save()).tugouCanvas.nodes.length===3);await click('撤销');check('undo works through the shared icon control',(await save()).tugouCanvas.nodes.length===2);await click('重做');check('redo restores the node',(await save()).tugouCanvas.nodes.length===3);
      await click('图层合成','nav button');
      for(const label of ['画笔','橡皮','平移','选择']){await click(label,'#canvas-actions button');check(label+' still selects its tool',await js(`document.querySelector('#canvas-actions [aria-label="${label}"]').getAttribute('aria-pressed')==='true'`));}
      for(const label of ['修图','添加','调整','特效','图层','排版','变换','选区','蒙版']){await click(label,'.layer-menu summary');check(label+' opens its original commands',await js(`document.querySelector('.layer-menu summary[aria-label="${label}"]').parentElement.open`));await click(label,'.layer-menu summary');}
      await click('添加','.layer-menu summary');await click('文字','.layer-menu[open] button');check('layer add menu still adds editable text',(await save()).layers.some(l=>l.kind==='text'));
      await click('素材库','nav button');await js('document.querySelector(".asset-image input[type=checkbox]").click()');await delay(150);
      check('material selection enables the icon actions and updates their names',await js(`!document.querySelector('[aria-label="移除 (1)"]').disabled&&!document.querySelector('[aria-label="处理所选 (1)"]').disabled`));
      await click('筛选与排序');await wait('document.querySelector("[aria-label=素材来源]")');check('filter icon opens filtering and sorting',true);await click('筛选与排序');
      await click('图像工具','nav button');check('processing action is available for the imported source',await js('!document.querySelector("[aria-label=开始处理]").disabled'));
      await click('开始处理');await wait('(await tugou.tasks()).some(t=>t.status==="completed")');await wait('!document.querySelector("[aria-label=导出结果]").disabled');
      check('icon processing action completes a real local image task',true);await save();
      await click('模型连接','.toolbar-end button');await wait('document.querySelector(".ant-modal input[type=password]")');check('model dialog opens without exposing secrets',await js('document.querySelector(".ant-modal input[type=password]").value===""'));await click('关闭模型连接');
      await click('任务','.statusbar button');await wait('document.querySelector(".task-dialog")');check('task icon opens the task center',true);await click('关闭任务');
      w.setSize(960,720);
      for(const zoom of [1,1.25]){w.webContents.setZoomFactor(zoom);for(const [label,name] of [['无限画布','canvas'],['图层合成','layers'],['素材库','materials'],['图像工具','tools'],['提示词工作台','prompts']]){await click(label,'nav button');await audit(name+'-compact-'+zoom);}}
      await click('图层合成','nav button');await snapshot('layers-compact-125');w.webContents.setZoomFactor(1);
      check('no renderer or CSP errors',report.errors.length===0);check('test window stayed hidden',!w.isVisible());
      report.bundleBytes=fs.statSync(path.join(process.env.TUGOU_BUILD_DIR||path.join(path.dirname(process.env.TUGOU_TEST_APP),'dist'),'ui.js')).size;finish(0);
    }catch(e){report.failure=e.stack;report.text=await js('document.body.innerText');await snapshot('failure');finish(1);}
  });
});
require(process.env.TUGOU_TEST_APP||'../desktop-main.cjs');
