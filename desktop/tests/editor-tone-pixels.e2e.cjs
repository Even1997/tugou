const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), ts = require("../../web/node_modules/typescript");
const root = path.resolve(__dirname, "../.."), output = fs.mkdtempSync(path.join(root, "web/node_modules/.cache/studio-tone-"));
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "studio-tone-"))); app.disableHardwareAcceleration();
for (const name of ["coverage-morphology", "tone-schema", "tone-pixels", "tone-render", "model", "image-limits", "layer-operations", "perspective", "raster-paint", "selection-raster", "selection-pixels", "editor-renderer", "editor-history", "store"]) {
    fs.writeFileSync(path.join(output, name + ".js"), ts.transpileModule(fs.readFileSync(path.join(root, `web/src/app/studio/${name}.${["coverage-morphology","tone-schema","image-limits"].includes(name)?"js":"ts"}`),"utf8"), { compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true} }).outputText);
}
app.whenReady().then(async()=>{
    const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});
    try {
        await win.loadURL("data:text/html,<html></html>");
        const results=await win.webContents.executeJavaScript(`(async()=>{
            crypto.randomUUID=require("node:crypto").randomUUID;
            const assert=require("node:assert/strict"),{blankProject,createLayer,validateProject}=require(${JSON.stringify(path.join(output,"model.js"))});
            const {defaultAdjustment,defaultEffect}=require(${JSON.stringify(path.join(output,"tone-schema.js"))});
            const {renderProject}=require(${JSON.stringify(path.join(output,"editor-renderer.js"))});
            const {useStudio}=require(${JSON.stringify(path.join(output,"store.js"))});
            const {samplingMargin,effectMargin}=require(${JSON.stringify(path.join(output,"tone-render.js"))});
            const p={...blankProject(),version:5,width:128,height:128,background:"transparent"},results=[];
            const shape=(name,color,x=0,y=0,width=128,height=128)=>({...createLayer("shape",name),shape:"rect",x,y,width,height,color});
            const adj=(kind,values={})=>({...createLayer("adjustment",kind),width:128,height:128,adjustment:{...defaultAdjustment(kind),values:{...defaultAdjustment(kind).values,...values}}});
            const pixel=(c,x,y)=>[...c.getContext("2d").getImageData(x,y,1,1).data];
            const bytes=c=>c.getContext("2d").getImageData(0,0,c.width,c.height).data;
            const close=c=>{c.width=c.height=0};
            const red=shape("red","#ff0000"),blue=shape("blue","#0000ff",80,0,48,128),invert=adj("invert");
            let c=await renderProject({...p,layers:[red,invert,blue]});
            assert.deepEqual(pixel(c,20,20),[0,255,255,255]);assert.deepEqual(pixel(c,100,20),[0,0,255,255]);close(c);
            c=await renderProject({...p,layers:[red,{...invert,opacity:.5}]});assert.deepEqual(pixel(c,20,20),[128,128,128,255]);close(c);
            c=await renderProject({...p,layers:[red,{...invert,visible:false}]});assert.deepEqual(pixel(c,20,20),[255,0,0,255]);close(c);
            results.push("调整只影响下方内容；上方保持原色；强度、停用像素正确");
            const half=shape("half","#5078a0",20,20,40,40),group={...createLayer("group","组"),width:128,height:128};
            c=await renderProject({...p,layers:[red,group,{...half,parentId:group.id},{...invert,parentId:group.id}]});
            assert.deepEqual(pixel(c,30,30),[175,135,95,255]);assert.deepEqual(pixel(c,90,90),[255,0,0,255]);close(c);
            c=await renderProject({...p,layers:[red,half,{...invert,clipping:true}]});
            assert.deepEqual(pixel(c,30,30),[175,135,95,255]);assert.deepEqual(pixel(c,90,90),[255,0,0,255]);close(c);
            c=await renderProject({...p,layers:[red,{...invert,mask:{x:0,y:0,width:.5,height:1}}]});
            assert.deepEqual(pixel(c,20,20),[0,255,255,255]);assert.deepEqual(pixel(c,100,20),[255,0,0,255]);close(c);
            results.push("组内隔离、剪贴单层、蒙版范围正确");
            const translucent={...half,opacity:.5};
            c=await renderProject({...p,layers:[translucent,invert]});assert.equal(pixel(c,30,30)[3],128);assert.equal(pixel(c,90,90)[3],0);close(c);
            c=await renderProject({...p,layers:[translucent,{...invert,blend:"multiply",opacity:.5}]});assert.equal(pixel(c,30,30)[3],128);close(c);
            results.push("调整及混合模式保持半透明 alpha，不重复叠加原内容");
            for(const kind of ["hsv","levels","curves","exposure","gradient","bw","balance","invert","grain","noise","blur","motion"]){
                const a=adj(kind);
                if(kind==="hsv")a.adjustment.values.hue=60;if(kind==="levels")a.adjustment.values.gamma=2;if(kind==="exposure")a.adjustment.values.exposure=1;
                if(kind==="balance")a.adjustment.values.red=30;if(kind==="curves")a.adjustment.curves[0]=[[0,0],[.5,.8],[1,1]];
                c=await renderProject({...p,layers:[half,a]});assert.equal(c.width,128);assert.ok(bytes(c).some(Boolean),kind);close(c);
            }
            results.push("12 类调整通过真实 Chromium 像素合成");
            // Inner effects must never increase alpha, including low-alpha PNG pixels.
            const assetCanvas=Object.assign(document.createElement("canvas"),{width:64,height:64}),ctx=assetCanvas.getContext("2d");ctx.fillStyle="rgba(80,120,160,.5)";ctx.fillRect(8,8,48,48);
            const image={...createLayer("image","半透明"),x:32,y:32,width:64,height:64,bitmap:{dataUrl:assetCanvas.toDataURL(),width:64,height:64}};
            const original=await renderProject({...p,layers:[image]}),base=bytes(original);close(original);
            for(const kind of ["overlay","innerShadow","innerGlow","stroke"]){
                const e=defaultEffect(kind);if(kind==="stroke")e.values.inside=1;
                c=await renderProject({...p,layers:[{...image,effects:[e]}]});const actual=bytes(c);
                for(let i=3;i<actual.length;i+=4)assert.equal(actual[i],base[i],kind+" alpha");
                assert.notDeepEqual(actual,base,kind+" must alter color");close(c);
            }
            results.push("颜色叠加、内阴影、内发光、内描边逐像素保留半透明原 alpha");
            const solid=shape("shape","#5078a0",40,40,48,48);
            const stroke=defaultEffect("stroke");stroke.values.size=6;stroke.opacity=1;stroke.color="#ff0000";
            c=await renderProject({...p,layers:[{...solid,effects:[stroke]}]});assert.deepEqual(pixel(c,37,60),[255,0,0,255]);assert.equal(pixel(c,32,60)[3],0);assert.deepEqual(pixel(c,60,60),[80,120,160,255]);close(c);
            const shadow=defaultEffect("shadow");shadow.values={distance:15,angle:90,blur:0};shadow.opacity=1;
            c=await renderProject({...p,layers:[{...solid,effects:[shadow]}]});assert.deepEqual(pixel(c,60,98),[0,0,0,255]);assert.deepEqual(pixel(c,60,60),[80,120,160,255]);close(c);
            const glow=defaultEffect("outerGlow");glow.values.size=4;
            c=await renderProject({...p,layers:[{...solid,effects:[glow]}]});assert.ok(pixel(c,36,60)[3]>0);assert.equal(pixel(c,10,10)[3],0);close(c);
            results.push("外描边使用圆形距离；投影方向/距离正确；外发光扩展范围未裁切");
            const mixed={...p,layers:[{...solid,effects:[stroke,{...defaultEffect("shadow"),values:{distance:9,angle:42,blur:5}},defaultEffect("innerGlow")]},adj("blur",{radius:3}),adj("blur",{radius:2}),adj("noise",{amount:12,seed:28})]};
            const full=await renderProject(mixed),fullData=bytes(full);let max=0;
            for(let y=0;y<128;y+=19){const h=Math.min(19,128-y),stripe=await renderProject(mixed,{region:{x:0,y,width:128,height:h}}),data=bytes(stripe);for(let i=0;i<data.length;i++)max=Math.max(max,Math.abs(data[i]-fullData[y*128*4+i]));close(stripe);}
            assert.ok(max<=1,"strip seams "+max);close(full);results.push({sequentialBlurAndEffectsStripMaxError:max});
            useStudio.getState().load({...p,layers:[solid]});useStudio.getState().edit(q=>({...q,layers:[{...solid,effects:[shadow]}]}));
            useStudio.getState().undo();assert.ok(!useStudio.getState().project.layers[0].effects);useStudio.getState().redo();assert.deepEqual(useStudio.getState().project.layers[0].effects,[shadow]);
            validateProject(JSON.parse(JSON.stringify(useStudio.getState().project)));results.push("特效参数一次撤销重做与工程校验");
            const start=performance.now(),large={...p,width:2048,height:2048,layers:[shape("large","#5078a0",0,0,2048,2048),adj("exposure",{exposure:1})]};
            c=await renderProject(large);assert.equal(c.width,2048);assert.ok(pixel(c,1800,1800)[0]>80);close(c);results.push({adjustment2048Ms:Math.round(performance.now()-start)});
            const many=Array.from({length:100},(_,i)=>({...shape("card"+i,"#5078a0",20,20,40,40),effects:[defaultEffect("shadow")]}));
            assert.equal(samplingMargin({...p,layers:many}),8+effectMargin(many[0].effects));
            const startMany=performance.now();c=await renderProject({...p,layers:many});assert.ok(pixel(c,40,40)[3]);close(c);
            const hidden={...createLayer("group","hidden"),visible:false};
            assert.equal(samplingMargin({...p,layers:[hidden,...many.map(l=>({...l,parentId:hidden.id}))]}),8);
            results.push({independentEffectLayers:100,margin:samplingMargin({...p,layers:many}),elapsedMs:Math.round(performance.now()-startMany),hiddenGroupIgnored:true});
            const maskRef={...shape("reference","#ffffff",32,32,64,64),visible:false,effects:[defaultEffect("shadow")]};
            const refProject={...p,layers:[maskRef,{...red,maskSourceId:maskRef.id}]};
            const refFull=await renderProject(refProject),refData=bytes(refFull);let refMax=0;
            for(let y=0;y<128;y+=19){const tile=await renderProject(refProject,{region:{x:0,y,width:128,height:Math.min(19,128-y)}}),data=bytes(tile);for(let i=3;i<data.length;i+=4)refMax=Math.max(refMax,Math.abs(data[i]-refData[y*128*4+i]));close(tile);}
            close(refFull);assert.ok(refMax<=1,"hidden mask effect seams "+refMax);results.push({hiddenMaskEffectStripMaxError:refMax});
            return results;
        })()`);
        fs.writeFileSync(path.join(root,"docs/studio-evidence/editor-tone-pixel-results.json"),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));app.exit(0);
    }catch(e){console.error(e);app.exit(1);}
});
