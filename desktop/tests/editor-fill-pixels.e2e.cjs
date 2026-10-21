const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), ts = require("../../web/node_modules/typescript");
const root = path.resolve(__dirname, "../.."), output = fs.mkdtempSync(path.join(root, "web/node_modules/.cache/studio-fill-"));
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "studio-fill-pixels-")));
app.disableHardwareAcceleration();
for (const name of ["coverage-morphology", "tone-schema", "selection-pixels", "selection-raster", "image-limits", "model", "layer-operations", "perspective", "raster-paint", "content-fill-pixels", "content-fill"]) {
    let source = fs.readFileSync(path.join(root, `web/src/app/studio/${name}.${["coverage-morphology", "image-limits", "tone-schema"].includes(name) ? "js" : "ts"}`), "utf8");
    // The production worker URL is separately exercised by the packaged UI test.
    source = source.replace('new URL("./content-fill.worker.ts", import.meta.url)', "globalThis.fillWorkerURL");
    fs.writeFileSync(path.join(output, name + ".js"), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const workerSource = ts.transpileModule(fs.readFileSync(path.join(root, "web/src/app/studio/content-fill-pixels.ts"), "utf8").replace(/export /g, "") + "\n" + fs.readFileSync(path.join(root, "web/src/app/studio/content-fill.worker.ts"), "utf8").replace(/^import .*;\r?\n/, ""), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false, backgroundThrottling: false } });
    win.webContents.on("console-message", ({ message }) => console.log(message));
    try {
        await win.loadURL("data:text/html,<html></html>");
        const result = await win.webContents.executeJavaScript(`(async()=>{
            crypto.randomUUID=require("node:crypto").randomUUID;
            globalThis.fillWorkerURL=URL.createObjectURL(new Blob([${JSON.stringify(workerSource)}],{type:"text/javascript"}));
            const assert=require("node:assert/strict"),{blankProject,createLayer}=require(${JSON.stringify(path.join(output,"model.js"))});
            const {contentAwareFill}=require(${JSON.stringify(path.join(output,"content-fill.js"))});
            const {encodeCanvas,decodeBitmap}=require(${JSON.stringify(path.join(output,"raster-paint.js"))});
            const {layerPixelToWorld,selectionSampler}=require(${JSON.stringify(path.join(output,"selection-raster.js"))});
            const results=[], fixture=Object.assign(document.createElement("canvas"),{width:128,height:128}),c=fixture.getContext("2d",{willReadFrequently:true});
            const p={...blankProject(),width:256,height:256};
            c.fillStyle="#5078a0";c.fillRect(0,0,128,128);c.fillStyle="#ff00ff";c.fillRect(52,52,24,24);
            const bitmap={dataUrl:await encodeCanvas(fixture),width:128,height:128},base={...createLayer("image","填充"),x:32,y:32,width:128,height:128,bitmap};
            const original=c.getImageData(0,0,128,128).data;
            for(const transform of [{},{rotation:18,scaleX:1.1,scaleY:.8},{warp:[0,0,1,.1,.9,1,.1,.9]}]){
                const l={...base,...transform},project={...p,layers:[l]},world=layerPixelToWorld(l,project,128,128);
                const corners=[[52,52],[76,52],[76,76],[52,76]].flatMap(([x,y])=>{const q=world(x,y);return[q.x,q.y]});
                project.selection={paths:[{points:corners,operation:"add"}],feather:3};
                const progress=[],start=performance.now(),out=await contentAwareFill(project,l,new AbortController().signal,v=>progress.push(v));
                c.clearRect(0,0,128,128);c.drawImage(await decodeBitmap(out),0,0);
                const actual=c.getImageData(0,0,128,128).data,sample=await selectionSampler(project.selection,256,256);
                let partial=0,changed=0;
                for(let y=0;y<128;y++)for(let x=0;x<128;x++){
                    const q=world(x+.5,y+.5),a=sample(q.x,q.y)/255,i=(y*128+x)*4;
                    if(!a)assert.deepEqual(actual.slice(i,i+4),original.slice(i,i+4));
                    if(a>0&&a<1&&x>=52&&x<76&&y>=52&&y<76){
                        partial++;for(let k=0;k<3;k++)assert.ok(Math.abs(actual[i+k]-([80,120,160][k]*a+original[i+k]*(1-a)))<=1);
                    }
                    if(actual[i]!==original[i])changed++;
                }
                assert.ok(partial>0&&changed>100);assert.ok(progress.every((v,i)=>!i||v>=progress[i-1]));
                assert.equal(l.bitmap.dataUrl,bitmap.dataUrl);
                results.push({transform,featheredPixels:partial,changedPixels:changed,elapsedMs:Math.round(performance.now()-start),outsideUnchanged:true});
            }
            const hole={...p,layers:[base],selection:{paths:[{operation:"add",points:[84,84,108,84,108,108,84,108]}]}};
            c.fillStyle="#5078a0";c.fillRect(0,0,128,128);c.clearRect(52,52,24,24);
            const transparent={...base,bitmap:{dataUrl:await encodeCanvas(fixture),width:128,height:128}};
            const filled=await contentAwareFill(hole,transparent,new AbortController().signal,()=>{});
            c.clearRect(0,0,128,128);c.drawImage(await decodeBitmap(filled),0,0);assert.deepEqual([...c.getImageData(60,60,1,1).data],[80,120,160,255]);
            results.push("选中透明洞可填实，不产生黑边");
            const controller=new AbortController();let workerReached=false,started=0;
            await assert.rejects(contentAwareFill(hole,base,controller.signal,v=>{if(v>.1){workerReached=true;started=performance.now();controller.abort();}}),e=>e.name==="AbortError");
            assert.ok(workerReached);results.push({workerCancelled:true,cancelMs:Math.round(performance.now()-started)});
            const invalid={...hole,selection:{paths:[{operation:"add",points:[0,0,256,0,256,256,0,256]}]}};
            await assert.rejects(contentAwareFill(invalid,base,new AbortController().signal,()=>{}),/没有足够/);
            results.push("选中全部来源时拒绝填充，原位图保持不变");
            if(process.env.STUDIO_FILL_LARGE==="1"){
                const largeCanvas=Object.assign(document.createElement("canvas"),{width:10000,height:10000}),lc=largeCanvas.getContext("2d");
                lc.fillStyle="#5078a0";lc.fillRect(0,0,10000,10000);lc.fillStyle="#ff00ff";lc.fillRect(5000,5000,16,16);
                const large={...base,x:0,y:0,width:10000,height:10000,bitmap:{dataUrl:await encodeCanvas(largeCanvas),width:10000,height:10000}};
                largeCanvas.width=largeCanvas.height=0;
                const lp={...p,width:10000,height:10000,layers:[large],selection:{paths:[{operation:"add",points:[4996,4996,5020,4996,5020,5020,4996,5020]}]}};
                const start=performance.now(),out=await contentAwareFill(lp,large,new AbortController().signal,()=>{});
                assert.equal(out.width,10000);assert.equal(out.height,10000);const decoded=await decodeBitmap(out);
                c.clearRect(0,0,128,128);c.drawImage(decoded,5000,5000,16,16,0,0,16,16);assert.deepEqual([...c.getImageData(8,8,1,1).data],[80,120,160,255]);
                results.push({resolution:"10000x10000",localHole:"24x24",elapsedMs:Math.round(performance.now()-start),nativeDimensionsPreserved:true});
            }
            URL.revokeObjectURL(globalThis.fillWorkerURL);return results;
        })()`);
        fs.writeFileSync(path.join(root,"docs/studio-evidence/editor-fill-pixel-results.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));app.exit(0);
    } catch(error){console.error(error);app.exit(1);}
});
