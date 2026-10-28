const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const base=require('./qa-paths.cjs').path("local-final"),restart=process.argv.includes('--restart'),baseline=process.argv.includes('--baseline'),packaged=process.argv.includes('--packaged');
const tag=packaged?'large-workspace-packaged':'large-workspace';
const prior=restart?JSON.parse(fs.readFileSync(path.join(base,tag+'.json'))):null;
const profile=prior?.profile||fs.mkdtempSync(path.join(base,'large-workspace-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR=require('./qa-paths.cjs').path("shared-build");
if(packaged)delete process.env.TUGOU_BUILD_DIR;
const report={profile,checks:[],errors:[]};
const finish=code=>{fs.writeFileSync(path.join(base,baseline?'large-workspace-before.json':tag+(restart?'-restart':'')+'.json'),JSON.stringify(report,null,2));app.exit(code)};
setTimeout(()=>{report.failure='timeout';finish(1)},300000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(s,v)=>{assert.ok(v,s);report.checks.push(s)};
    const wait=async s=>{for(let i=0;i<600;i++){if(await js(`(async()=>Boolean(await (${s})))()`))return;await delay(30)}throw Error('timeout '+s)};
    const input=async(label,value,textarea=false)=>{await js(`{const e=document.querySelector('[aria-label="${label}"]');Object.getOwnPropertyDescriptor(${textarea?'HTMLTextAreaElement':'HTMLInputElement'}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))}`);await delay(120)};
    const click=async text=>{await js(`{const b=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)});if(!b||b.disabled)throw Error('missing '+${JSON.stringify(text)});b.click()}`);await delay(120)};
    const load=async workspace=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:${JSON.stringify(workspace)}}))`);const ready=new Promise(r=>w.webContents.once('did-finish-load',r));const start=Date.now();w.webContents.reload();await ready;await wait(workspace==='assets'?'document.querySelector(".asset-card")':'document.querySelector(".react-flow__node")');await delay(150);return Date.now()-start};
    try{
      await js('console.error("large-sentinel")');check('console capture verified',report.errors.includes('large-sentinel'));report.errors=[];
      report.id=prior?.id||(await js('tugou.create("万条素材与千节点验收")')).id;
      if(!restart){
        // All entries share one tiny local file: this isolates metadata/UI scale from image decoding.
        const complex=JSON.parse(fs.readFileSync(path.join(base,'complex.json'))),resource=complex.fixture.asset.resource;
        fs.copyFileSync(path.join(complex.profile,'workspace/resources',resource),path.join(profile,'workspace/resources',resource));
        await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});const assets=Array.from({length:10000},(_,i)=>({id:'asset-'+i,name:'素材'+String(i).padStart(5,'0'),width:96,height:96,resource:${JSON.stringify(JSON.parse(fs.readFileSync(path.join(base,'complex.json'))).fixture.asset.resource)}}));const nodes=Array.from({length:1000},(_,i)=>({id:'node-'+i,type:'text',position:{x:(i%40)*340,y:Math.floor(i/40)*240},data:{name:'节点'+String(i).padStart(4,'0'),text:'可编辑提示词 '+i}}));await tugou.save(r.id,{...r.document,assets,tugouCanvas:{version:1,nodes,edges:[],viewport:{x:20,y:20,zoom:1}},futureLarge:{keep:42}},r.revision)})()`);

      }
      report.libraryLoadMs=await load('assets');
      report.libraryCards=await js('document.querySelectorAll(".asset-card").length');
      report.grid=await js(`(()=>{const e=document.querySelector('.asset-grid'),c=e.querySelector('.asset-card');return {width:e.clientWidth,height:e.clientHeight,scroll:e.scrollHeight,card:c.getBoundingClientRect().toJSON(),columns:getComputedStyle(e).gridTemplateColumns}})()`);
      if(!baseline)check('material grid mounts a bounded visible window',report.libraryCards<100);
      const start=Date.now();await input('搜索素材','素材09999');await wait('document.querySelectorAll(".asset-card").length===1');report.searchMs=Date.now()-start;
      await js(`document.querySelector('input[aria-label="选择 素材09999"]').click()`);
      await input('搜索素材','');await wait('document.querySelectorAll(".asset-card").length>1');
      await js('{const e=document.querySelector(".asset-grid");e.scrollTop=1e8;e.dispatchEvent(new Event("scroll"))}');await delay(200);
      report.endGrid=await js(`(()=>{const e=document.querySelector('.asset-grid');return {top:e.scrollTop,height:e.scrollHeight,cards:[...e.querySelectorAll('strong')].map(x=>x.textContent)}})()`);
      check('last material remains reachable',await js('[...document.querySelectorAll(".asset-card strong")].some(e=>e.textContent==="素材00000")'));
      if(!baseline){
        for(const density of ['small','large','medium']){
          await js(`{const e=document.querySelector('select[aria-label="缩略图大小"]');e.value='${density}';e.dispatchEvent(new Event('change',{bubbles:true}))}`);await delay(150);
          await js(`{const e=document.querySelector('.asset-grid');e.scrollTop=e.scrollHeight/2;e.dispatchEvent(new Event('scroll'))}`);await delay(150);
          check(density+' grid stays bounded and fills viewport',await js(`(()=>{const e=document.querySelector('.asset-grid'),cards=[...e.querySelectorAll('.asset-card')],r=e.getBoundingClientRect();return cards.length<100&&cards.some(c=>{const p=c.getBoundingClientRect();return p.height>150&&p.top<=r.top+48&&p.bottom>=r.top})})()`));
        }
        w.setSize(960,780);await delay(200);
        await js(`{const e=document.querySelector('.asset-grid');e.scrollTop=1e8;e.dispatchEvent(new Event('scroll'))}`);await delay(150);
        check('resized grid reaches final material without horizontal overflow',await js(`(()=>{const e=document.querySelector('.asset-grid');return e.scrollWidth<=e.clientWidth&&[...e.querySelectorAll('strong')].some(x=>x.textContent==='素材00000')})()`));
        await w.capturePage();await delay(50);fs.writeFileSync(path.join(base,'large-library.png'),(await w.capturePage()).toPNG());
        w.setSize(1380,900);await delay(150);
        await click('筛选与排序');await click('选择当前结果');
        check('select all spans unmounted entries',await js('[...document.querySelectorAll("button")].some(b=>b.textContent.includes("处理所选 (10000)"))'));
        await click('清空选择');await click('筛选与排序');
        await input('搜索素材','素材09999');await js(`document.querySelector('input[aria-label="选择 素材09999"]').click()`);
      }
      await input('搜索素材','素材09999');await wait('document.querySelectorAll(".asset-card").length===1');
      check('selection survives filtering and scrolling',await js('document.querySelector(".asset-card input").checked'));
      report.canvasLoadMs=await load('canvas');report.canvasNodes=await js('document.querySelectorAll(".react-flow__node").length');
      if(!baseline)check('canvas mounts only visible nodes',report.canvasNodes<100);
      await input('搜索画布内容','节点0999');await wait('document.querySelectorAll(".palette-item").length===1');await click('节点0999');
      await wait('document.querySelector("textarea[aria-label=画布自由提示词]")');
      if(restart)check('edited far node restored',await js('document.querySelector("textarea[aria-label=画布自由提示词]").value==="千节点末项已编辑"'));
      else await input('画布自由提示词','千节点末项已编辑',true);
      if(await js('[...document.querySelectorAll("button")].some(b=>b.getAttribute("aria-label")==="保存"&&!b.disabled)'))await click('保存');
      await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');
      const r=await js(`tugou.open(${JSON.stringify(report.id)})`);
      check('all metadata survives edit/save',r.document.assets.length===10000&&r.document.tugouCanvas.nodes.length===1000&&r.document.tugouCanvas.nodes[999].data.text==='千节点末项已编辑'&&r.document.futureLarge.keep===42);
      if(!baseline){
        await js(`(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,tugouCanvas:{...r.document.tugouCanvas,viewport:{x:-13000,y:-5700,zoom:1}}},r.revision)})()`);
        await load('canvas');await wait('document.querySelector(\'.react-flow__node[data-id="node-999"]\')');
        check('far viewport mounts the last node',await js('document.querySelector(\'.react-flow__node[data-id="node-999"]\').textContent.includes("千节点末项已编辑")'));
      }
      check('no generation tasks created',!(await js('tugou.tasks()')).length);
      report.memory=app.getAppMetrics().map(p=>({type:p.type,peakKiB:p.memory.peakWorkingSetSize}));
      fs.writeFileSync(path.join(base,restart?'large-workspace-restart.png':'large-workspace.png'),(await w.capturePage()).toPNG());
      check('no renderer errors',!report.errors.length);check('window stays hidden',!w.isVisible());finish(0);
    }catch(e){report.failure=e.stack;fs.writeFileSync(path.join(base,'large-failure.png'),(await w.capturePage()).toPNG());finish(1)}
  });
});
require(packaged?require('./qa-paths.cjs').path("lean-package/win-unpacked/resources/app.asar/desktop-main.cjs"):'../desktop-main.cjs');
