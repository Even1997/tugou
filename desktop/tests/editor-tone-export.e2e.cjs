const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), sharp = require("../../web/node_modules/sharp");
const base = process.env.STUDIO_TEST_URL;
if (base !== "http://127.0.0.1:3437") throw Error("Isolated QA server required");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(),"studio-tone-export-"))); app.disableHardwareAcceleration();
const wait = ms => new Promise(r=>setTimeout(r,ms)), root = path.resolve(__dirname,"../..");
app.whenReady().then(async()=>{
    const win = new BrowserWindow({width:1200,height:900,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    const run = code=>win.webContents.executeJavaScript(code,true);
    const until = async(fn,label)=>{for(let i=0;i<1800;i++){if(await fn())return;await wait(100);}throw Error("Timeout "+label)};
    const click = label=>run(`[...document.querySelectorAll("button")].find(b=>b.getAttribute("aria-label")===${JSON.stringify(label)}||b.textContent.trim()===${JSON.stringify(label)}).click()`);
    try {
        const common={x:0,y:0,width:10000,height:10000,rotation:0,opacity:1,visible:true,locked:false,flipX:false,flipY:false,blend:"source-over"};
        const p={format:"canvas-studio",version:5,id:"editor-tone-export-qa",name:"100MP 调整导出验收",updatedAt:new Date().toISOString(),width:10000,height:10000,background:"transparent",assets:[],modules:[],recipes:[],jobs:[],layers:[
            {...common,id:"base",kind:"shape",name:"底色",shape:"rect",color:"#5078a0"},
            {...common,id:"invert",kind:"adjustment",name:"反相",adjustment:{kind:"invert",values:{}}}
        ]};
        const r=await fetch(base+"/api/studio",{method:"POST",headers:{"Content-Type":"application/json","X-Studio-Request":"1"},body:JSON.stringify({action:"save",payload:p})}); assert.equal(r.status,200);
        await win.loadURL(base+"/studio");await until(()=>run('document.body.innerText.includes("100MP 调整导出验收")'),"ready");await click("图层合成");await until(()=>run('!!document.querySelector(".editor-stage canvas")'),"stage");
        const folder=path.join(root,".tools/editor-foundation-qa/exports"),before=new Set(fs.readdirSync(folder)),start=Date.now();await click("导出画面");let file;
        await until(async()=>{file=fs.readdirSync(folder).find(f=>!before.has(f)&&f.startsWith("100MP 调整导出验收-")&&f.endsWith(".png"));return !!file},"100MP export");
        const source=path.join(folder,file),meta=await sharp(source).metadata();assert.equal(meta.width,10000);assert.equal(meta.height,10000);
        for(const [x,y] of [[0,0],[5000,5000],[9999,9999],[300,383],[300,384]]) {
            const data=await sharp(source).extract({left:x,top:y,width:1,height:1}).ensureAlpha().raw().toBuffer();assert.deepEqual([...data],[175,135,95,255]);
        }
        const result={width:meta.width,height:meta.height,elapsedMs:Date.now()-start,checks:"100MP 活动调整图层经真实导出按钮输出原尺寸 PNG；角点、中心和条带边界像素正确"};
        fs.writeFileSync(path.join(root,"docs/studio-evidence/editor-tone-export-results.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));app.exit(0);
    }catch(e){console.error(e);app.exit(1);}
});
