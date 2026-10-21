// Dedicated large-image acceptance. Run serially against the isolated QA server.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const ts = require("../../web/node_modules/typescript"), sharp = require("../../web/node_modules/sharp");
const root = path.resolve(__dirname, "../.."), base = process.env.STUDIO_TEST_URL;
if (base !== "http://127.0.0.1:3437") throw Error("Isolated QA frontend required");
const output = fs.mkdtempSync(path.join(root, "web/node_modules/.cache/studio-large-"));
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "studio-large-")));
app.disableHardwareAcceleration();
for (const name of ["coverage-morphology", "tone-schema", "tone-pixels", "tone-render", "selection-color", "selection-pixels", "selection-raster", "selection-edit", "selection-preview", "image-limits", "model", "layer-operations", "editor-renderer", "editor-history", "perspective", "store", "raster-paint", "client-api", "image-export"]) {
    const source = path.join(root, `web/src/app/studio/${name}.${["coverage-morphology", "image-limits", "tone-schema"].includes(name) ? "js" : "ts"}`);
    fs.writeFileSync(path.join(output, `${name}.js`), ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
fs.appendFileSync(path.join(output, "client-api.js"), `exports.studioRequest=(action,payload)=>require("electron").ipcRenderer.invoke("qa-api",action,payload);`);
ipcMain.handle("qa-api", async (_, action, payload) => {
    const response = await fetch(`${base}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1" }, body: JSON.stringify({ action, payload }) });
    const data = await response.json(); if (!response.ok) throw Error(data.error); return data;
});
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
    win.webContents.on("console-message", ({message})=>console.log(message));
    try {
        await win.loadURL("data:text/html,<html></html>");
        const result = await win.webContents.executeJavaScript(`(async()=>{
            crypto.randomUUID=require("node:crypto").randomUUID;
            const assert=require("node:assert/strict");
            const {blankProject,createLayer,validateProject}=require(${JSON.stringify(path.join(output, "model.js"))});
            const {preparePaint,encodeCanvas}=require(${JSON.stringify(path.join(output, "raster-paint.js"))});
            const {renderProject}=require(${JSON.stringify(path.join(output, "editor-renderer.js"))});
            const {exportImageStrips}=require(${JSON.stringify(path.join(output, "image-export.js"))});
            const {studioRequest,readAsset}=require(${JSON.stringify(path.join(output, "client-api.js"))});
            const {useStudio}=require(${JSON.stringify(path.join(output, "store.js"))});
            const {sampleColorSelection}=require(${JSON.stringify(path.join(output, "selection-color.js"))});
            const started=performance.now(),width=10000,height=10000;
            const importStart=performance.now();let asset;
            {const file=require("node:fs").readFileSync(${JSON.stringify(path.join(root, ".tools/large-image-fixture.png"))});asset={...await readAsset(new Blob([file],{type:"image/png"}),"原尺寸测试"),id:"large-source"};}
            console.log("LARGE imported "+asset.width+"x"+asset.height);
            const importMs=Math.round(performance.now()-importStart);assert.equal(asset.width,10000);assert.equal(asset.height,10000);assert.equal(asset.hasAlpha,true);
            const original={...blankProject(),id:"editor-large-qa",name:"100MP 原尺寸验收",width,height,background:"transparent",assets:[asset]};
            original.layers=[{...createLayer("image","大图"),assetId:asset.id,width,height}];
            const selectionStart=performance.now(),picked=await sampleColorSelection(original,4500,4500,0,false,original.layers[0].id);
            assert.deepEqual([...picked.getContext("2d").getImageData(4500,4500,1,1).data],[255,255,255,255]);
            assert.equal(picked.getContext("2d").getImageData(4501,4500,1,1).data[3],0);
            const selectionMs=Math.round(performance.now()-selectionStart);picked.width=picked.height=0;
            console.log("LARGE original-resolution selection "+selectionMs+"ms");
            original.selection={paths:[{points:[0,0,5100,0,5100,10000,0,10000],operation:"add"}]};
            validateProject(original);useStudio.getState().load(original);
            const paintStart=performance.now();
            const stroke=await preparePaint(original,original.layers[0],"image",{size:120,hardness:1,opacity:.5,color:"#ff0000",erase:false});
            for(let i=0;i<80;i++)stroke.add({x:5000+i*2,y:5000+i});
            console.log("LARGE painting ready");
            stroke.update();
            const working=stroke.stats(),pixel=[...stroke.canvas.getContext("2d").getImageData(5000,5000,1,1).data];
            assert.deepEqual(pixel,[255,0,0,128]);
            assert.equal(stroke.canvas.getContext("2d").getImageData(5150,5075,1,1).data[3],0);
            assert.ok(working.workingBytes<420*1024*1024);
            const live=await renderProject(original,{region:{x:4950,y:4950,width:200,height:200},raster:{layerId:original.layers[0].id,target:"image",canvas:stroke.canvas}});
            assert.deepEqual([...live.getContext("2d").getImageData(50,50,1,1).data],[255,0,0,128]);live.width=live.height=0;
            const bitmap=await stroke.bitmap();console.log("LARGE encoded stroke "+bitmap.width+"x"+bitmap.height);stroke.dispose();
            useStudio.getState().edit(p=>({...p,layers:[{...p.layers[0],bitmap}]}));
            const paintMs=Math.round(performance.now()-paintStart);
            useStudio.getState().undo();assert.equal(useStudio.getState().project.layers[0].bitmap,undefined);
            useStudio.getState().redo();assert.equal(useStudio.getState().project.layers[0].bitmap.dataUrl,bitmap.dataUrl);
            const p=useStudio.getState().project;await studioRequest("save",p);
            const reopened=await studioRequest("open",{id:p.id});assert.equal(reopened.layers[0].bitmap.dataUrl,bitmap.dataUrl);assert.equal(reopened.assets[0].dataUrl,asset.dataUrl);
            console.log("LARGE saved reopened");
            const preview=await renderProject(p,{scale:.12});assert.equal(preview.width,1200);preview.width=preview.height=0;
            const detail=await renderProject(p,{region:{x:4498,y:4498,width:8,height:8}});assert.deepEqual([...detail.getContext("2d").getImageData(2,2,1,1).data],[0,255,0,255]);assert.equal(detail.getContext("2d").getImageData(3,2,1,1).data[3],0);detail.width=detail.height=0;
            const exportStart=performance.now(),png=await exportImageStrips(p,"png",()=>{});
            const pngMs=Math.round(performance.now()-exportStart),jpegStart=performance.now(),jpg=await exportImageStrips(p,"jpg",()=>{});
            return {fixture:"100MP gradient, 1000 patches, transparent areas and one-pixel detail",sourceBytes:Math.round(asset.dataUrl.length*.75),paintedBytes:Math.round(bitmap.dataUrl.length*.75),dimensions:[width,height],importMs,selectionMs,paintMs,working,pngMs,jpegMs:Math.round(performance.now()-jpegStart),totalMs:Math.round(performance.now()-started),png:png.path,jpg:jpg.path,checks:["100MP import source preserved","original-resolution single-pixel color selection","paint cannot cross selection boundary","undo and redo","save and reopen","bounded live-paint viewport", "100% viewport preserves a one-pixel detail","PNG and JPEG strip export"]};
        })().catch(e=>{throw Error(e?.stack||e?.message||String(e))})`);
        for (const key of ["png", "jpg"]) {
            const meta = await sharp(result[key]).metadata();
            assert.equal(meta.width, 10000); assert.equal(meta.height, 10000);
        }
        const pixel = async (file, x, y) => [...await sharp(file).extract({ left: x, top: y, width: 1, height: 1 }).ensureAlpha().raw().toBuffer()];
        assert.deepEqual(await pixel(result.png, 20, 20), [18, 52, 86, 255]);
        assert.deepEqual(await pixel(result.png, 9900, 9900), [254, 220, 186, 255]);
        assert.deepEqual(await pixel(result.png, 5000, 5000), [255, 0, 0, 128]);
        assert.deepEqual(await pixel(result.png, 3000, 3000), [0, 0, 0, 0]);
        assert.deepEqual(await pixel(result.png, 4500, 4500), [0, 255, 0, 255]);
        const jpeg = await pixel(result.jpg, 3000, 3000);
        assert.ok(jpeg.slice(0, 3).every((v) => v >= 254));
        result.checks.push("export corners/brush/transparent pixels", "JPEG white flatten");
        fs.writeFileSync(path.join(root, "docs/studio-evidence/editor-large-image-results.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result, null, 2));
        app.exit(0);
    } catch (error) { console.error(error?.stack||error?.message||String(error)); app.exit(1); }
});
