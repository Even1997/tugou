// Real Chromium pixel acceptance; no user project or network/model service.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const ts = require("../../web/node_modules/typescript");
const root = path.resolve(__dirname, "../..");
const output = fs.mkdtempSync(path.join(root, "web/node_modules/.cache/studio-retouch-"));
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "studio-retouch-")));
app.disableHardwareAcceleration();
for (const name of ["coverage-morphology", "tone-schema", "selection-pixels", "selection-raster", "image-limits", "model", "layer-operations", "perspective", "raster-paint", "raster-retouch", "retouch-pixels"]) {
    fs.writeFileSync(path.join(output, `${name}.js`), ts.transpileModule(fs.readFileSync(path.join(root, `web/src/app/studio/${name}.${["coverage-morphology", "image-limits", "tone-schema"].includes(name) ? "js" : "ts"}`), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
    win.webContents.on("console-message", ({ message }) => console.log(message));
    try {
        await win.loadURL("data:text/html,<html></html>");
        const result = await win.webContents.executeJavaScript(`(async()=>{
            crypto.randomUUID=require("node:crypto").randomUUID;
            const assert=require("node:assert/strict");
            const {blankProject,createLayer}=require(${JSON.stringify(path.join(output,"model.js"))});
            const {prepareRetouch}=require(${JSON.stringify(path.join(output,"raster-retouch.js"))});
            const {encodeCanvas,decodeBitmap,paintPoint}=require(${JSON.stringify(path.join(output,"raster-paint.js"))});
            const {layerPixelToWorld}=require(${JSON.stringify(path.join(output,"selection-raster.js"))});
            const results=[],brush={size:24,hardness:1,opacity:1,color:"#000000",erase:false,blurRadius:4};
            const fixture=document.createElement("canvas");fixture.width=fixture.height=256;const c=fixture.getContext("2d");
            const rgba=(canvas,x,y)=>[...canvas.getContext("2d").getImageData(x,y,1,1).data];
            const p={...blankProject(),width:256,height:256};
            const layer=async()=>({...createLayer("image","样图"),width:256,height:256,bitmap:{dataUrl:await encodeCanvas(fixture),width:256,height:256}});
            c.fillStyle="#ffffff";c.fillRect(0,0,256,256);c.fillStyle="#ff0000";c.fillRect(20,20,30,30);c.fillStyle="#0000ff";c.fillRect(70,20,30,30);
            let l=await layer(),s=await prepareRetouch(p,l,{...brush,tool:"clone",source:{x:30,y:30}});
            s.add({x:80,y:80});s.update();assert.deepEqual(rgba(s.canvas,80,80),[255,0,0,255]);assert.deepEqual(rgba(s.canvas,100,80),[255,255,255,255]);
            s.add({x:130,y:80});assert.deepEqual(rgba(s.canvas,130,80),[0,0,255,255]);assert.equal(l.bitmap.dataUrl,await encodeCanvas(fixture));s.dispose();
            s=await prepareRetouch(p,l,{...brush,tool:"clone",size:10,source:{x:30,y:30}});
            s.add({x:35,y:30});s.add({x:70,y:30});
            assert.deepEqual(rgba(s.canvas,70,30),[255,255,255,255],"overlapping donor must use pre-stroke snapshot");s.dispose();
            s=await prepareRetouch(p,l,{...brush,tool:"clone",opacity:.5,source:{x:30,y:30}});
            s.add({x:80,y:80});s.add({x:85,y:80});s.add({x:80,y:80});assert.deepEqual(rgba(s.canvas,80,80),[255,128,128,255]);s.dispose();
            results.push("仿制来源跟随固定偏移；重叠取样无反馈；每笔强度只叠加一次；素材原图不变");
            c.fillStyle="#b4b4b4";c.fillRect(0,0,256,256);c.fillStyle="#111111";c.fillRect(124,124,8,8);l=await layer();
            s=await prepareRetouch(p,l,{...brush,tool:"heal",size:32,hardness:.5});s.add({x:128,y:128});
            assert.deepEqual(rgba(s.canvas,128,128),[180,180,180,255]);assert.deepEqual(rgba(s.canvas,170,128),[180,180,180,255]);s.dispose();
            // Donor texture differs in tone; healing keeps texture and adapts surrounding color.
            c.fillStyle="#646464";c.fillRect(16,16,40,40);c.fillStyle="#828282";c.fillRect(32,32,4,4);l=await layer();
            s=await prepareRetouch(p,l,{...brush,tool:"heal",source:{x:34,y:34}});s.add({x:128,y:128});
            assert.ok(rgba(s.canvas,128,128)[0]>195&&rgba(s.canvas,128,128)[0]<220);s.dispose();
            results.push("自动修复去除均匀背景黑斑；手动来源保留纹理并匹配目标亮度");
            c.clearRect(0,0,256,256);c.fillStyle="#ff0000";c.fillRect(0,0,128,256);l=await layer();
            s=await prepareRetouch(p,l,{...brush,tool:"blur",size:48});s.add({x:128,y:100});
            const edge=rgba(s.canvas,128,100);assert.ok(edge[0]>=250&&edge[3]>50&&edge[3]<200);assert.equal(rgba(s.canvas,128,20)[3],0);
            const once=await s.bitmap();s.dispose();s=await prepareRetouch(p,{...l,bitmap:once},{...brush,tool:"blur",size:48});s.add({x:128,y:100});
            assert.ok(rgba(s.canvas,134,100)[3]>(await (async()=>{const z=document.createElement("canvas");z.width=z.height=256;z.getContext("2d").drawImage(await decodeBitmap(once),0,0);return rgba(z,134,100)[3]})()));s.dispose();
            results.push("局部高斯模糊跨笔叠加；透明边缘不产生黑边，笔刷外不变");
            c.fillStyle="#0000ff";c.fillRect(128,0,128,256);l=await layer();
            s=await prepareRetouch(p,l,{...brush,tool:"smudge",size:30,opacity:.9});s.add({x:120,y:120});s.add({x:150,y:120});
            assert.ok(rgba(s.canvas,145,120)[0]>10);assert.deepEqual(rgba(s.canvas,145,160),[0,0,255,255]);s.dispose();
            s=await prepareRetouch(p,l,{...brush,tool:"liquify",size:48});s.add({x:124,y:120});s.add({x:140,y:120});
            assert.ok(rgba(s.canvas,136,120)[0]>180);assert.deepEqual(rgba(s.canvas,136,160),[0,0,255,255]);s.dispose();
            results.push("涂抹实际携带红色进入蓝区；液化推移边界；圆形笔刷外不变");
            const selection={paths:[{operation:"add",points:[0,0,.5,0,.5,1,0,1]}]};
            for(const tool of ["clone","heal","blur","smudge","liquify"]){
                s=await prepareRetouch({...p,selection},l,{...brush,tool,size:40,source:tool==="clone"||tool==="heal"?{x:40,y:40}:undefined});
                s.add({x:120,y:120});s.add({x:140,y:120});const data=s.canvas.getContext("2d").getImageData(128,0,128,256).data,expected=c.getImageData(128,0,128,256).data;
                assert.deepEqual(data,expected,tool+" selection leak");s.dispose();
            }
            results.push("五种工具逐像素验证整块选区外 RGBA 完全不变");
            const transformed={...l,x:20,y:10,rotation:20,scaleX:1.2,scaleY:.8,warp:[.05,.1,1,0,.95,1,0,.9]},tp={...p,layers:[transformed]};
            const world=layerPixelToWorld(transformed,tp,256,256),a=world(40,40),b=world(180,100);
            s=await prepareRetouch(tp,transformed,{...brush,tool:"clone",source:paintPoint(transformed,tp,a,256,256)});
            s.add(paintPoint(transformed,tp,b,256,256));assert.deepEqual(rgba(s.canvas,180,100),[255,0,0,255]);s.dispose();
            results.push("旋转、缩放、透视后的取样/落笔仍使用原图像素坐标");
            if(process.env.STUDIO_RETOUCH_LARGE==="1"){
                const file=require("node:fs").readFileSync(${JSON.stringify(path.join(root,".tools/large-image-fixture.png"))});
                const large={...l,width:10000,height:10000,bitmap:{dataUrl:"data:image/png;base64,"+file.toString("base64"),width:10000,height:10000}},lp={...p,width:10000,height:10000,layers:[large]};
                for(const tool of ["clone","heal","blur","smudge","liquify"]){
                    const start=performance.now();s=await prepareRetouch(lp,large,{...brush,tool,size:40,source:tool==="clone"||tool==="heal"?{x:5000,y:5000}:undefined});
                    const loaded=performance.now();s.add({x:5100,y:5100});s.add({x:5120,y:5100});const drawn=performance.now(),stats=s.stats();
                    const encoded=await s.bitmap();assert.equal(encoded.width,10000);assert.equal(encoded.height,10000);assert.ok(encoded.dataUrl.length>1000000);
                    results.push({tool,resolution:"10000x10000",prepareMs:Math.round(loaded-start),strokeMs:Math.round(drawn-loaded),encodeMs:Math.round(performance.now()-drawn),...stats});
                    console.log(tool+" 100MP verified");s.dispose();await new Promise(r=>setTimeout(r,150));
                }
            }
            return results;
        })()`);
        fs.writeFileSync(path.join(root,"docs/studio-evidence/editor-retouch-pixel-results.json"),JSON.stringify(result,null,2));
        console.log(JSON.stringify(result,null,2));app.exit(0);
    } catch(error){console.error(error);app.exit(1);}
});
