const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {encode,decode}=require('../core/cloud-pixels.cjs');
const {createLayer,corners}=require('../core/layers.cjs');
const out=path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname,'../test-results')),restart=process.argv.includes('--restart'),prior=restart?JSON.parse(fs.readFileSync(path.join(out,'semantic-desktop.json'))):null;
const profile=prior?.profile||fs.mkdtempSync(path.join(os.tmpdir(),'tugou-semantic-ui-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR ||= path.join(out,'local-tools-build');
const report={profile,checks:[],errors:[],requests:[]};let invalid=true,hold=false,release;
const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  if(req.url.endsWith('/chat/completions')){
    const body=JSON.parse(Buffer.concat(chunks));report.requests.push({kind:'vision',model:body.model,image:body.messages[1].content[1].image_url.url.startsWith('data:image/png;base64,')});
    if(hold)await new Promise(r=>release=r);
    res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:'{"categories":["左侧人物","花束"]}'}}]}));return;
  }
  const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();
  report.requests.push({kind:'mask',prompt:form.get('prompt'),model:form.get('model'),size:form.get('size')});
  const data=Buffer.alloc(128*96*4);for(let i=0;i<data.length;i+=4){const x=i/4%128,v=x<40?255:x<80?128:0;data.set([v,v,v,255],i)}
  if(invalid&&form.get('prompt').includes('花束'))data.set([255,0,0,255],0);
  res.end(JSON.stringify({data:[{b64_json:(await encode({width:128,height:96,data})).toString('base64')}]}));
});
const end=code=>{fs.writeFileSync(path.join(out,restart?'semantic-restart.json':'semantic-desktop.json'),JSON.stringify(report,null,2));release?.();server.closeAllConnections();server.close();app.exit(code)};
setTimeout(()=>{report.failure='timeout';end(1)},180000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(name,value)=>{assert.ok(value,name);report.checks.push(name)};
    const wait=async(s)=>{for(let i=0;i<1200;i++){if(await js(`Boolean(${s})`))return;await delay(25)}throw Error('timeout '+s)};
    const click=async(label)=>{const labels=await js('[...document.querySelectorAll("button")].map(b=>b.getAttribute("aria-label")||b.textContent.trim())');if(!labels.includes(label))throw Error('Missing '+label+': '+labels.join(' / '));await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);await delay(90)};
    const select=async(label,value)=>{await js(`{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`);await delay(90)};
    const reload=async()=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`);const ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;await wait('document.querySelector(".image-tools")')};
    const save=async()=>{await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return js(`tugou.open(${JSON.stringify(report.id)})`)};
    const tasks=()=>js('tugou.tasks()');
    try{
      await js('console.error("semantic-sentinel")');check('console capture verified',report.errors.includes('semantic-sentinel'));report.errors=[];
      if(restart){
        report.id=prior.id;await reload();await select('处理方式','cloudSplit');await delay(1200);
        const r=await save();check('categories, outputs and unknown fields restore',r.document.assets.length===3&&r.document.imageToolSemanticPlans[prior.source.id]==='左侧人物\n花束'&&r.document.futureSemantic.keep);
        await click('类别方案');check('saved per-source plan loads in controls',await js('document.querySelector("textarea[aria-label=类别方案]").value==="左侧人物\\n花束"'));
        check('restart never calls vision or image model',report.requests.length===0);
        check('cancelled recognition remains cancelled',(await tasks()).at(-1).status==='cancelled');
        check('completed draft remains available',(await js(`tugou.readCategories(${JSON.stringify(report.id)},${JSON.stringify(prior.analysisId)})`)).categories.length===2);
      }else{
        const data=Buffer.alloc(128*96*4);for(let i=0;i<data.length;i+=4)data.set([30+i/4%128,90,180,[0,64,128,255][i/4%4]],i);
        const source=await js(`tugou.storeRaster(${JSON.stringify([...await encode({width:128,height:96,data})])},'拆分原图')`);report.source=source;
        const layers=[createLayer('group',{id:'group',name:'旋转组',x:7,y:9,rotation:10,width:128,height:96}),createLayer('image',{id:'photo',name:'来源人物',assetId:source.id,parentId:'group',x:20,y:12,width:96,height:72,rotation:15,scaleX:1.1,skewX:8,flipX:true,warp:[0.1,0,1,0.15,0.9,1,0,0.85]})];
        report.id=await js(`(async()=>{const r=await tugou.create('类别拆分验收');await tugou.save(r.id,{...r.document,width:128,height:96,futureSemantic:{keep:true},assets:[${JSON.stringify(source)}],layers:${JSON.stringify(layers)}},r.revision);return r.id})()`);
        await js(`tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'image-fixture',analysisModel:'vision-fixture',apiKey:'fixture-secret'})`);
        await reload();await select('处理方式','cloudSplit');await click('识别类别');
        await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="读取识别结果"&&!b.disabled)');
        report.analysisId=(await tasks()).at(-1).id;
        check('shared visual model receives actual reference',report.requests.length===1&&report.requests[0].model==='vision-fixture'&&report.requests[0].image);
        check('recognition does not mutate plan until reviewed',!(await save()).document.imageToolSemanticPlans);
        await click('读取识别结果');await click('类别方案');check('editable per-line proposals visible',await js('document.querySelector("textarea[aria-label=类别方案]").value==="左侧人物\\n花束"'));
        await click('保存方案');let r=await save();check('plan persists as project data',r.document.imageToolSemanticPlans[source.id]==='左侧人物\n花束');
        await click('提交云端');await wait('document.querySelectorAll(".processing-item").length===1');
        for(let i=0;i<800&&!(await tasks()).some(t=>t.status==='review');i++)await delay(25);
        const job=(await tasks()).find(t=>t.status==='review');assert.ok(job);report.reviewId=job.id;
        check('categories run independently and invalid color mask remains in review',report.requests.filter(r=>r.kind==='mask').length===2&&(await tasks()).filter(t=>t.context?.kind==='cloud-tool'&&t.status==='completed').length===1);
        r=await save();check('invalid mask never becomes a split asset',r.document.assets.length===2);
        invalid=false;await click('任务');await wait('document.querySelector(".task-list") || document.querySelector(".task-row")');
        await click('重新请求模型');await click('关闭任务');await wait('document.querySelectorAll(".processing-item").length===2');r=await save();
        check('explicit retry only requests failed category',report.requests.filter(r=>r.kind==='mask').length===3&&report.requests.filter(r=>r.prompt?.includes('左侧人物')).length===1);
        for(const asset of r.document.assets.filter(a=>a.toolResult)){
          const p=await decode(fs.readFileSync(path.join(profile,'workspace/resources',asset.resource)));
          for(let i=0;i<128*96;i++){assert.deepEqual(p.data.subarray(i*4,i*4+3),data.subarray(i*4,i*4+3));assert.equal(p.data[i*4+3],Math.round(data[i*4+3]*(i%128<40?255:i%128<80?128:0)/255));}
        }
        check('every output RGB and source-alpha multiplied coverage verified',true);
        await click('撤销');check('single category result is undoable',(await save()).document.assets.length===2);await click('重做');check('redo preserves both independent results',(await save()).document.assets.length===3);
        await click('对齐入层');await click('对齐：来源人物');r=await save();
        const aligned=r.document.layers.find(l=>l.semanticSourceLayerId==='photo');assert.ok(aligned);
        assert.deepEqual(corners(r.document.layers,aligned),corners(layers,layers[1]));assert.deepEqual(r.document.layers.find(l=>l.id==='photo'),layers[1]);
        check('aligned insertion preserves group, rotated/sheared/flipped source geometry and original layer',true);
        await click('撤销');check('aligned insertion is undoable',(await save()).document.layers.length===2);await click('重做');check('aligned insertion redo restores geometry',(await save()).document.layers.length===3);
        await click('图像工具');await js('document.querySelector(".processing-item").click()');await delay(120);await click('对齐入层');await click('对齐：来源人物');check('aligned result insertion is deduplicated',(await save()).document.layers.length===3);
        await click('图像工具');await select('处理方式','cloudSplit');
        hold=true;await click('识别类别');await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="取消云端任务")');
        while(report.requests.filter(r=>r.kind==='vision').length<2)await delay(20);
        await click('取消云端任务');hold=false;release();await delay(500);
        check('late cancelled recognition leaves reviewed plan untouched',(await tasks()).at(-1).status==='cancelled'&&(await save()).document.imageToolSemanticPlans[source.id]==='左侧人物\n花束');
        check('previous completed proposal remains readable after cancellation',await js('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="读取识别结果"&&!b.disabled)'));
        w.setSize(960,720);await delay(400);await w.capturePage();await delay(150);fs.writeFileSync(path.join(out,'semantic-960.png'),(await w.capturePage()).toPNG());
      }
      check('no renderer or CSP errors',report.errors.length===0);check('QA window remains hidden',!w.isVisible());end(0);
    }catch(e){report.failure=e.stack;report.status=await js('document.querySelector(".message[role=status]")?.textContent');end(1)}
  });
});
server.listen(0,'127.0.0.1',()=>require('../desktop-main.cjs'));
