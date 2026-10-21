const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), sharp = require("../../web/node_modules/sharp");
const base = process.env.STUDIO_TEST_URL;
if (base !== "http://127.0.0.1:3437") throw Error("Isolated QA server required");
const root = path.resolve(__dirname, "../.."), evidence = path.join(root, "docs/studio-evidence"), results = [];
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "studio-retouch-ui-")));
app.disableHardwareAcceleration();
const request = async (action, payload) => {
    const r = await fetch(`${base}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1" }, body: JSON.stringify({ action, payload }) });
    if (!r.ok) throw Error(await r.text()); return r.json();
};
const wait = ms => new Promise(r => setTimeout(r, ms));
const pixel = async (data, x, y) => [...await sharp(Buffer.from(data.split(",")[1], "base64")).extract({ left: x, top: y, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()];
app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1500, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code, true);
    const until = async (fn, label) => { for (let i=0;i<200;i++){if(await fn())return;await wait(100);}throw Error(`Timeout ${label}`); };
    const click = label => run(`(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")===${JSON.stringify(label)}||e.textContent.replace(/\\s/g,"")===${JSON.stringify(label.replace(/\s/g,""))});if(!b)throw Error(${JSON.stringify(label)});b.click()})()`);
    const menu = async item => { await click("修图工具");await wait(100);await run(`[...document.querySelectorAll("[role=menuitem]")].find(e=>e.textContent.trim()===${JSON.stringify(item)}).click()`);await wait(150); };
    const input = (label,value) => run(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event("input",{bubbles:true}));e.blur()})()`);
    const choose = () => run(`[...document.querySelectorAll(".layer-name")].find(e=>e.textContent.trim()==="修图样图").click()`);
    const id="editor-retouch-qa",open=()=>request("open",{id}),saved=fn=>until(async()=>fn(await open()),"save");
    const key = (key, extra={}) => run(`document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(key)},bubbles:true,...${JSON.stringify(extra)}}))`);
    let origin,scale;
    const mouse=(type,x,y,extra={})=>win.webContents.sendInputEvent({type,x:Math.round(origin.x+(x+128)*scale),y:Math.round(origin.y+(y+128)*scale),...extra});
    const stroke=async(x,y,x2=x,y2=y,extra={})=>{mouse("mouseMove",x,y);mouse("mouseDown",x,y,{button:"left",clickCount:1,...extra});await wait(100);mouse("mouseMove",x2,y2,{button:"left",...extra});await wait(100);mouse("mouseUp",x2,y2,{button:"left",clickCount:1,...extra});};
    const ready=async()=>{await until(()=>run('!!document.querySelector(".editor-stage canvas")'),"stage");await choose();await wait(200);const b=await run('(()=>{const b=document.querySelector(".editor-stage").getBoundingClientRect();return{x:b.x,y:b.y,width:b.width,height:b.height}})()');scale=Math.min((b.width-100)/512,(b.height-80)/512,1);origin={x:b.x+(b.width-512*scale)/2,y:b.y+(b.height-512*scale)/2};};
    try {
        const image=await sharp(Buffer.from('<svg width="256" height="256"><rect width="256" height="256" fill="blue"/><rect width="128" height="256" fill="red"/><rect x="188" y="196" width="8" height="8" fill="black"/></svg>')).png().toBuffer();
        const dataUrl=`data:image/png;base64,${image.toString("base64")}`;
        const layer={id:"sample",name:"修图样图",kind:"image",assetId:"sample-image",x:128,y:128,width:256,height:256,rotation:0,opacity:1,visible:true,locked:false,flipX:false,flipY:false,blend:"source-over"};
        await request("save",{format:"canvas-studio",version:4,id,name:"五种修图工具验收",updatedAt:new Date().toISOString(),width:512,height:512,background:"transparent",modules:[],recipes:[],jobs:[],
            assets:[{id:"sample-image",name:"红蓝样图",dataUrl,width:256,height:256,hasAlpha:false,createdAt:new Date().toISOString()}],layers:[layer]});
        await win.loadURL(`${base}/studio`);await until(()=>run('document.body.innerText.includes("五种修图工具验收")'),"ready");await click("图层合成");await ready();
        const checks=[
            ["仿制图章",async()=>{await stroke(32,32,32,32,{modifiers:["alt"]});assert.ok(await run('!!document.querySelector(\'[aria-label="对齐取样"]\')'));assert.ok(!(await open()).layers[0].bitmap);await stroke(180,32);},180,32,p=>p[0]===255&&p[2]===0],
            ["修复",async()=>{await click("自动修复取样");await input("画笔直径",32);await stroke(192,200);},192,200,p=>p[2]>245&&p[0]<10],
            ["模糊",async()=>{await input("模糊半径",5);await stroke(128,100);},128,100,p=>p[0]>30&&p[2]>30],
            ["涂抹",async()=>{await stroke(120,60,145,60);},140,60,p=>p[0]>40],
            ["液化",async()=>{await input("画笔直径",48);await stroke(124,140,140,140);},136,140,p=>p[0]>100],
        ];
        for(const [name,draw,x,y,check] of checks){
            await menu(name);await draw();await saved(p=>!!p.layers[0].bitmap);
            const p=await open(),bitmap=p.layers[0].bitmap;assert.equal(bitmap.width,256);assert.equal(bitmap.height,256);assert.ok(check(await pixel(bitmap.dataUrl,x,y)),name);
            assert.equal(p.assets[0].dataUrl,dataUrl);
            await key("z",{ctrlKey:true});await saved(p=>!p.layers[0].bitmap);
            await key("y",{ctrlKey:true});await saved(p=>p.layers[0].bitmap?.dataUrl===bitmap.dataUrl);
            win.webContents.reload();await ready();assert.deepEqual((await open()).layers[0].bitmap,bitmap);
            const exports=path.join(root,".tools/editor-foundation-qa/exports"),before=new Set(fs.readdirSync(exports));await click("导出画面");let file;
            await until(async()=>{file=fs.readdirSync(exports).find(f=>!before.has(f)&&f.startsWith("五种修图工具验收-")&&f.endsWith(".png"));return !!file;},"export");
            const png=fs.readFileSync(path.join(exports,file)),actual=await sharp(png).extract({left:128,top:128,width:256,height:256}).ensureAlpha().raw().toBuffer(),expected=await sharp(Buffer.from(bitmap.dataUrl.split(",")[1],"base64")).ensureAlpha().raw().toBuffer();
            assert.deepEqual(actual,expected,name+" exported pixels");
            results.push(name+"：顶部菜单、原生笔触、一次撤销重做、保存重开、PNG 全图像素一致");
            // Restore the fixture for the next independent tool test.
            await click("还原素材原图");await saved(p=>!p.layers[0].bitmap);win.webContents.reload();await ready();
        }
        await menu("模糊");mouse("mouseDown",128,100,{button:"left",clickCount:1});await wait(150);await key("Escape");mouse("mouseUp",128,100,{button:"left",clickCount:1});await wait(600);assert.ok(!(await open()).layers[0].bitmap);
        results.push("Escape 中途取消不产生笔画或历史提交");
        await choose();await menu("涂抹");await input("画笔直径",1000);
        mouse("mouseDown",120,120,{button:"left",clickCount:1});await wait(80);mouse("mouseMove",240,120,{button:"left"});
        await until(()=>run(`(()=>{const c=document.querySelector(".editor-stage canvas"),b=c.getBoundingClientRect();return c.getContext("2d").getImageData(Math.round((${origin.x+(140+128)*scale}-b.x)*c.width/b.width),Math.round((${origin.y+(120+128)*scale}-b.y)*c.height/b.height),1,1).data[0]>50})()`),"large brush live pixels");
        const cancelStart=Date.now();await key("Escape");mouse("mouseUp",240,120,{button:"left",clickCount:1});const cancelMs=Date.now()-cancelStart;
        await wait(500);assert.ok(!(await open()).layers[0].bitmap);assert.ok(cancelMs<2000,"large brush must remain cancellable");results.push({largeBrush:1000,cancelMs,unchanged:true});
        await run('document.querySelector(\'button[title="锁定图层"]\').click()');await saved(p=>p.layers[0].locked);
        await menu("模糊");await stroke(128,100);await wait(500);assert.ok(!(await open()).layers[0].bitmap);
        await run('document.querySelector(\'button[title="解锁图层"]\').click()');await saved(p=>!p.layers[0].locked);await choose();await menu("模糊");await input("画笔直径",32);
        results.push("锁定图层拒绝修图，不产生位图副本");
        await menu("仿制图章");await click("设置取样来源");await stroke(32,32);assert.ok(!(await open()).layers[0].bitmap);
        await stroke(180,32);await saved(p=>!!p.layers[0].bitmap);const firstAligned=(await open()).layers[0].bitmap.dataUrl;await stroke(180,64);await saved(p=>p.layers[0].bitmap?.dataUrl!==firstAligned);
        assert.deepEqual(await pixel((await open()).layers[0].bitmap.dataUrl,180,64),[255,0,0,255]);
        results.push("顶部取样按钮可替代 Alt；对齐取样跨笔画生效");
        for(const width of [1100,900]){
            win.setSize(width,800);await wait(400);
            const layout=await run('(()=>{const b=document.querySelector(\'[aria-label="绘画选项"]\').getBoundingClientRect(),bar=document.querySelector(\'[aria-label="编辑工具栏"]\');return {width:innerWidth,body:document.documentElement.scrollWidth,toolbarHeight:bar.getBoundingClientRect().height,topRight:Math.max(...[...bar.querySelectorAll("button,select")].map(e=>e.getBoundingClientRect().right)),controls:[...document.querySelectorAll(\'[aria-label="绘画选项"] input,[aria-label="绘画选项"] select,[aria-label="绘画选项"] button\')].map(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,right:r.right,barTop:b.top,barBottom:b.bottom}})}})()');
            assert.ok(layout.body<=layout.width&&layout.topRight<=layout.width,"main toolbar fits");
            assert.ok(layout.toolbarHeight<=55,"main toolbar remains one row");
            assert.ok(layout.controls.every(r=>r.top>=r.barTop&&r.bottom<=r.barBottom+1&&r.right<=layout.width),"retouch row fits");
            fs.writeFileSync(path.join(evidence,`editor-retouch-${width}.png`),(await win.webContents.capturePage()).toPNG());results.push({toolbar:layout});
        }
        fs.writeFileSync(path.join(evidence,"editor-retouch-ui-results.json"),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));app.exit(0);
    }catch(error){fs.writeFileSync(path.join(evidence,"editor-retouch-ui-failure.png"),(await win.webContents.capturePage()).toPNG());console.error(error);app.exit(1);}
});
