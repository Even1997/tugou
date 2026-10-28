const {app}=require('electron'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict');
const {encode,decode}=require('../core/cloud-pixels.cjs');
const out=path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname,'../test-results')),restart=process.argv.includes('--restart'),prior=restart?JSON.parse(fs.readFileSync(path.join(out,'cloud-mask-desktop.json'))):null;
const profile=prior?.profile||fs.mkdtempSync(path.join(os.tmpdir(),'tugou-mask-ui-'));
process.env.TUGOU_DATA_DIR=profile;process.env.TUGOU_BUILD_DIR ||= path.join(out,'local-tools-build');
const report={profile,checks:[],errors:[],requests:[]};let hold=false,release;
const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const form=await new Request('http://localhost'+req.url,{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();
  const mask=await decode(Buffer.from(await form.get('mask').arrayBuffer()));
  report.requests.push({size:form.get('size'),mask:[...mask.data.filter((_,i)=>i%4===3)]});
  if(hold)await new Promise(r=>release=r);
  const data=Buffer.alloc(128*96*4);for(let i=0;i<data.length;i+=4)data.set([220,10,30,255],i);
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{b64_json:(await encode({width:128,height:96,data})).toString('base64')}]}));
});
const end=(code)=>{fs.writeFileSync(path.join(out,restart?'cloud-mask-restart.json':'cloud-mask-desktop.json'),JSON.stringify(report,null,2));release?.();server.closeAllConnections();server.close();app.exit(code)};
setTimeout(()=>{report.failure='timeout';end(1)},180000);
app.on('web-contents-created',(_,c)=>c.on('console-message',d=>{if(d.level==='error')report.errors.push(d.message)}));
app.on('browser-window-created',(_,w)=>{
  w.show=()=>{};w.focus=()=>{};w.webContents.setBackgroundThrottling(false);
  w.webContents.once('did-finish-load',async()=>{
    const js=s=>w.webContents.executeJavaScript(s,true),delay=ms=>new Promise(r=>setTimeout(r,ms));
    const check=(name,value)=>{assert.ok(value,name);report.checks.push(name)};
    const wait=async(s)=>{for(let i=0;i<1000;i++){if(await js(`Boolean(${s})`))return;await delay(25)}throw Error('timeout '+s)};
    const click=async(label)=>{await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`);await delay(90)};
    const select=async(label,value)=>{await js(`{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`);await delay(90)};
    const reload=async()=>{await js(`sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`);const ready=new Promise(r=>w.webContents.once('did-finish-load',r));w.webContents.reload();await ready;await wait('document.querySelector(".image-tools")')};
    const save=async()=>{await click('保存');await wait('document.querySelector(".statusbar [role=status]").textContent==="已保存"');return js(`tugou.open(${JSON.stringify(report.id)})`)};
    const read=asset=>decode(fs.readFileSync(path.join(profile,'workspace/resources',asset.resource)));
    try{
      await js('console.error("mask-sentinel")');check('console capture verified',report.errors.includes('mask-sentinel'));report.errors=[];
      if(restart){
        report.id=prior.id;await reload();await delay(1400);
        const r=await save();check('mask snapshots, results and unknown data restore',r.document.assets.length===prior.count&&r.document.futureMask.keep);
        await js('document.querySelector(".processing-item").click()');await delay(200);
        check('history restores arbitrary mask and channel',await js('document.querySelector("select[aria-label=修改区域来源]").value==="asset"&&document.querySelector("select[aria-label=修改蒙版素材]").value!==""'));
        await click('蒙版规则');check('history restores luminance and inversion',await js('document.querySelector("select[aria-label=蒙版读取通道]").value==="luminance"&&[...document.querySelectorAll("input[type=checkbox]")].some(e=>e.checked)'));
        check('restart sends no model request',report.requests.length===0);
        check('selection remains in layer document',r.document.selection.paths.length===2);
      }else{
        const data=Buffer.alloc(128*96*4),bw=Buffer.alloc(data.length);
        for(let i=0;i<data.length;i+=4){data.set([20,120,180,Math.floor(i/4)%128<4?0:255],i);const v=Math.floor(i/4)%128<40?0:Math.floor(i/4)%128<80?128:255;bw.set([v,v,v,255],i)}
        const source=await js(`tugou.storeRaster(${JSON.stringify([...await encode({width:128,height:96,data})])},'蒙版原图')`);
        const mask=await js(`tugou.storeRaster(${JSON.stringify([...await encode({width:128,height:96,data:bw})])},'黑白蒙版')`);
        report.source=source;report.bw=mask;
        report.id=await js(`(async()=>{const r=await tugou.create('任意蒙版验收');await tugou.save(r.id,{...r.document,width:128,height:96,futureMask:{keep:true},assets:[${JSON.stringify(source)},${JSON.stringify(mask)}],selection:{paths:[{operation:'add',points:[4,4,110,4,4,85]},{operation:'subtract',points:[20,20,35,20,35,35,20,35]}],feather:2}},r.revision);return r.id})()`);
        await js(`tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'fixture',apiKey:'fixture-secret'})`);
        await reload();await select('处理方式','cloudEdit');
        await click('读取画面选区');await wait('document.querySelector("select[aria-label=修改区域来源]").value==="asset"');
        let r=await save();report.selectionMask=r.document.assets.at(-1);const selection=await read(report.selectionMask);
        check('layer selection snapshot enters shared library at exact dimensions',selection.width===128&&selection.height===96&&r.document.assets.length===3);
        const a=(x,y)=>selection.data[(y*128+x)*4+3];
        check('polygon subtract hole and feather survive handoff',a(12,12)===255&&a(26,26)===0&&a(120,90)===0&&a(4,40)>0&&a(4,40)<255);
        check('reading selection makes no model call',report.requests.length===0);
        await click('撤销');r=await save();check('selection asset insertion is one undo',r.document.assets.length===2);
        await click('重做');r=await save();check('selection asset redo preserves layer selection',r.document.assets.length===3&&r.document.selection.paths.length===2);
        await click('修改要求');await js(`{const e=document.querySelector('textarea[aria-label=云端修改要求]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'更改选区颜色');e.dispatchEvent(new Event('input',{bubbles:true}))}`);
        await delay(100);await click('修改要求 · 已填写');
        hold=true;await click('提交云端');await wait('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="取消云端任务")');
        check('cloud task status reaches toolbar and prevents duplicate submit',await js('[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="处理中"&&b.disabled)'));
        while(!report.requests.length)await delay(20);
        await click('取消云端任务');hold=false;release();await delay(600);
        check('toolbar cancellation recorded without publishing result',(await js('tugou.tasks()')).at(-1).status==='cancelled'&&(await save()).document.assets.length===3);
        await click('提交云端');await wait('document.querySelectorAll(".processing-item").length===1');
        r=await save();const result=r.document.assets.find(a=>a.toolResult),pixels=await read(result);
        for(let i=0;i<128*96;i++)if(selection.data[i*4+3]===0)assert.deepEqual(pixels.data.subarray(i*4,i*4+4),data.subarray(i*4,i*4+4));
        check('every protected RGBA byte survives arbitrary cloud edit',true);
        check('mask transmitted with opposite API alpha and frozen in result',report.requests.at(-1).mask.every((v,i)=>v===255-selection.data[i*4+3])&&result.toolResult.mask.resource===report.selectionMask.resource);
        await select('修改蒙版素材',mask.id);await click('蒙版规则');await select('蒙版读取通道','luminance');
        await js('[...document.querySelectorAll("label")].find(e=>e.textContent.trim()==="反转修改区域").querySelector("input").click()');await delay(80);
        await click('蒙版规则');
        await click('提交云端');await wait('document.querySelectorAll(".processing-item").length===2');r=await save();
        check('luminance inversion affects actual request mask',report.requests.at(-1).mask[10]===0&&report.requests.at(-1).mask[60]===128&&report.requests.at(-1).mask[100]===255);
        report.count=r.document.assets.length;check('results preserve input assets and unknown data',report.count===5&&r.document.futureMask.keep);
        w.setSize(960,720);await delay(500);await w.capturePage();await delay(150);fs.writeFileSync(path.join(out,'cloud-mask-960.png'),(await w.capturePage()).toPNG());
        check('native temporary jobs cleaned',fs.readdirSync(path.join(profile,'workspace/cloud-jobs')).length===0);
      }
      check('no renderer or CSP errors',report.errors.length===0);check('QA window remains hidden',!w.isVisible());end(0);
    }catch(e){report.failure=e.stack;report.status=await js('document.querySelector(".message[role=status]")?.textContent');end(1)}
  });
});
server.listen(0,'127.0.0.1',()=>require('../desktop-main.cjs'));
