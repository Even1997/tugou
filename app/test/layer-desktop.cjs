const { app, dialog, nativeImage } = require("electron");
const fs = require("node:fs/promises"),
  { createHash } = require("node:crypto"),
  path = require("node:path"),
  assert = require("node:assert/strict");
if (!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR))
  throw new Error("QA profile required");
const output = path.resolve(__dirname, "../test-results"),
  report = { checks: [], errors: [] };
const timeout = setTimeout(() => app.exit(1), 120000);
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", (_event, d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true);
    const wait = async (expression) => {
      for (let i = 0; i < 160; i++) {
        if (await js(expression)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`Timed out: ${expression}`);
    };
    const click = async (selector, text) => {
      await wait(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>${text ? `e.textContent.trim()===${JSON.stringify(text)}` : "true"})`,
      );
      await js(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>${text ? `e.textContent.trim()===${JSON.stringify(text)}` : "true"}).click()`,
      );
    };
    const fill = async (selector, value, textarea = false) => {
      await js(
        `{const e=document.querySelector(${JSON.stringify(selector)});e.focus();Object.getOwnPropertyDescriptor(${textarea ? "HTMLTextAreaElement" : "HTMLInputElement"}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
      await new Promise((r) => setTimeout(r, 30));
      await js(`document.querySelector(${JSON.stringify(selector)}).blur()`);
    };
    const check = (name, result) => {
      assert.ok(result, name);
      report.checks.push(name);
    };
    const save = async () => {
      await click(".toolbar-end button", "保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
    };
    const drag = async (from, to) => {
      window.webContents.sendInputEvent({ type: "mouseMove", ...from });
      window.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...from,
      });
      for (let i = 1; i <= 6; i++) {
        window.webContents.sendInputEvent({
          type: "mouseMove",
          x: Math.round(from.x + ((to.x - from.x) * i) / 6),
          y: Math.round(from.y + ((to.y - from.y) * i) / 6),
          modifiers: ["leftButtonDown"],
        });
        await new Promise((r) => setTimeout(r, 25));
      }
      window.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...to,
      });
      await new Promise((r) => setTimeout(r, 100));
    };
    const menu = async (name, command) => {
      await js(
        `{const el=[...document.querySelectorAll('.layer-menu')].find(e=>e.querySelector('summary').textContent===${JSON.stringify(name)});el.open=true;}`,
      );
      await click(".layer-menu-body button", command);
    };
    try {
      await wait('document.querySelector(".toolbar")');
      const original = path.join(
        app.getPath("appData"),
        "CanvasStudio/projects/67ca1e15-a70e-432a-9f15-6a26cfba9eb4.json",
      );
      const originalBytes = await fs.readFile(original);
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [original],
      });
      await click(".project-menu button", "导入");
      await wait('document.querySelector(".document-heading")');
      const id = await js(
        'document.querySelector("select[aria-label=当前工程]").value',
      );
      await click("nav button", "图层合成");
      await wait('document.querySelectorAll(".layer-row").length===5');
      await new Promise((r) => setTimeout(r, 500));
      check(
        "legacy image and text layers open in independent editor",
        await js(
          'document.querySelector(".layer-stage canvas").width>0&&!document.querySelector(".layer-editor .message.error")',
        ),
      );
      await fs.writeFile(
        path.join(output, "layers-legacy.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await js(
        (await fs.readFile(path.join(output, "layer-engine-qa.js"), "utf8")) +
          ";void 0;",
      );
      const source = await js(`window.tugou.open(${JSON.stringify(id)})`);
      const renderReport = await js(`(async()=>{
        const {Compositor,Layers:L}=window.layerQA,c=new Compositor(),surface=(w,h)=>{const e=document.createElement('canvas');e.width=w;e.height=h;return e;},pixel=(e,x,y)=>[...e.getContext('2d').getImageData(x,y,1,1).data];
        const doc=(layers,w=128,h=128)=>({width:w,height:h,background:'transparent',assets:[],layers});
        const shape=(id,extra={})=>L.createLayer('shape',{id,x:0,y:0,width:80,height:80,shape:'rect',color:'#ff0000',...extra});
        const result={};const out=surface(128,128);
        const g=L.createLayer('group',{id:'g',x:0,y:0,width:128,height:128,opacity:.5});
        await c.render(doc([g,shape('a',{parentId:'g'}),shape('b',{parentId:'g',x:30,color:'#0000ff'})]),out);result.group=pixel(out,50,30);
        await c.render(doc([shape('a',{mask:{x:0,y:0,width:.5,height:1}})]),out);result.mask=[pixel(out,10,20),pixel(out,65,20)];
        await c.render(doc([shape('a',{mask:{x:0,y:0,width:.5,height:1,inverted:true}})]),out);result.invert=[pixel(out,10,20),pixel(out,65,20)];
        await c.render(doc([shape('a',{width:40}),shape('b',{color:'#0000ff',clipping:true})]),out);result.clip=[pixel(out,20,20),pixel(out,65,20)];
        const q=[.1,.2,.9,0,1,1,0,.9],w=shape('warp',{width:100,height:100,warp:q});await c.render(doc([w]),out);const mid=L.project(L.homography(q),.5,.5);result.warp=pixel(out,Math.round(mid.x*100),Math.round(mid.y*100));result.warpOutside=pixel(out,99,0);
        const complex=doc([shape('large',{width:1500,height:250,color:'#00aa55',mask:{x:.05,y:0,width:.7,height:1,feather:12}}),L.createLayer('text',{id:'text',x:980,y:20,width:250,height:100,text:'图构 ABC',fontSize:35,color:'#123456'})],1600,300);
        const full=surface(1600,300);await c.render(complex,full);const bytes=await c.export(complex);const decoded=await createImageBitmap(new Blob([bytes],{type:'image/png'}));const exported=surface(1600,300);exported.getContext('2d').drawImage(decoded,0,0);decoded.close();const a=full.getContext('2d').getImageData(0,0,1600,300).data,b=exported.getContext('2d').getImageData(0,0,1600,300).data;let max=0,differing=0;for(let i=0;i<a.length;i++){max=Math.max(max,Math.abs(a[i]-b[i]));if(Math.abs(a[i]-b[i])>3)differing++;}let alphaMax=0,premultMax=0;const samples=[];for(let i=0;i<a.length;i+=4){alphaMax=Math.max(alphaMax,Math.abs(a[i+3]-b[i+3]));for(let j=0;j<3;j++)premultMax=Math.max(premultMax,Math.abs(a[i+j]*a[i+3]/255-b[i+j]*b[i+3]/255));if(Math.abs(a[i+3]-b[i+3])>3&&samples.length<5)samples.push({x:i/4%1600,y:Math.floor(i/4/1600),a:[...a.slice(i,i+4)],b:[...b.slice(i,i+4)]});}result.tiled={max,differing,alphaMax,premultMax,samples,pixels:480000};
        const legacy=${JSON.stringify(source.document)};const native=surface(legacy.width,legacy.height),oracle=surface(legacy.width,legacy.height),ctx=oracle.getContext('2d',{willReadFrequently:true});ctx.imageSmoothingQuality='high';ctx.fillStyle=legacy.background;ctx.fillRect(0,0,legacy.width,legacy.height);for(const l of legacy.layers){if(!l.visible||l.kind!=='image')continue;ctx.globalAlpha=l.opacity;ctx.drawImage(await c.image(legacy.assets.find(a=>a.id===l.assetId)),l.x,l.y,l.width,l.height);}await c.render(legacy,native);const aa=native.getContext('2d').getImageData(0,0,legacy.width,legacy.height).data,bb=oracle.getContext('2d').getImageData(0,0,legacy.width,legacy.height).data;let error=0;for(let i=0;i<aa.length;i++)error=Math.max(error,Math.abs(aa[i]-bb[i]));result.legacyPixelMaxError=error;
        const controller=new AbortController();controller.abort();try{await c.export(complex,{signal:controller.signal});result.cancel=false;}catch(e){result.cancel=e.name==='AbortError';}
        const large=doc([shape('big',{width:4096,height:4096,color:'#aabbcc'})],4096,4096),started=performance.now(),largeBytes=await c.export(large);result.large={width:4096,height:4096,bytes:largeBytes.length,ms:Math.round(performance.now()-started)};
        const abortDuring=new AbortController();let tiles=0;try{await c.export(large,{signal:abortDuring.signal,progress:()=>{tiles++;abortDuring.abort();}});result.midCancel=false;}catch(e){result.midCancel=e.name==='AbortError'&&tiles===1;}
        c.dispose();return result;
      })().catch(e=>({testError:e.message||String(e),stack:e.stack,name:e.name}))`);
      report.render = renderReport;
      if (renderReport.testError) throw new Error(JSON.stringify(renderReport));
      check(
        "isolated group opacity composites once",
        renderReport.group[2] === 255 &&
          Math.abs(renderReport.group[3] - 128) <= 1,
      );
      check(
        "mask and inversion preserve alpha",
        renderReport.mask[0][3] === 255 &&
          renderReport.mask[1][3] === 0 &&
          renderReport.invert[0][3] === 0 &&
          renderReport.invert[1][3] === 255,
      );
      check(
        "clipping and perspective render correctly",
        renderReport.clip[0][2] === 255 &&
          renderReport.clip[1][3] === 0 &&
          renderReport.warp[0] === 255 &&
          renderReport.warpOutside[3] === 0,
      );
      check(
        "tiled export matches full composite across feathered mask and text",
        renderReport.tiled.alphaMax <= 3 && renderReport.tiled.premultMax <= 3,
      );
      check(
        "real legacy composite matches all original image pixels",
        renderReport.legacyPixelMaxError <= 1,
      );
      check(
        "4K export and cancellation work",
        renderReport.large.bytes > 0 &&
          renderReport.cancel &&
          renderReport.midCancel,
      );
      await click(".layer-name", "双人人物");
      await wait('document.querySelector("input[aria-label=X]").value==="218"');
      await fill("input[aria-label=X]", "240");
      await save();
      let record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "position property saves without losing legacy fields",
        record.document.layers.find((l) => l.name === "双人人物").x === 240 &&
          record.document.assets.length === 4 &&
          record.document.modules.length === source.document.modules.length,
      );
      await menu("添加", "文字");
      await fill("textarea[aria-label=图层文字]", "我们结婚啦", true);
      await fill("input[aria-label=字号]", "54");
      await menu("添加", "矩形");
      await fill("input[aria-label=宽度]", "200");
      await fill("input[aria-label=高度]", "100");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "text and shape creation work",
        record.document.layers.some(
          (l) => l.text === "我们结婚啦" && l.fontSize === 54,
        ) &&
          record.document.layers.some(
            (l) => l.shape === "rect" && l.width === 200,
          ),
      );
      const rectLayer = record.document.layers.at(-1);
      await js(
        `document.querySelector('[data-layer-id="${rectLayer.id}"]').click()`,
      );
      const before = await js(
        `(()=>{const e=document.querySelector('.layer-overlay polygon').getBoundingClientRect();return{x:Math.round(e.x+e.width/2),y:Math.round(e.y+e.height/2)}})()`,
      );
      await drag(before, { x: before.x + 35, y: before.y + 20 });
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "native pointer drag moves layer",
        record.document.layers.find((l) => l.id === rectLayer.id).x >
          rectLayer.x + 20,
      );
      const moved = record.document.layers.find((l) => l.id === rectLayer.id);
      for (const handle of ["resize", "rotate"]) {
        const start = await js(
          `(()=>{const e=document.querySelector('[data-handle=${handle}]').getBoundingClientRect();return{x:Math.round(e.x+e.width/2),y:Math.round(e.y+e.height/2)}})()`,
        );
        await drag(start, { x: start.x + 20, y: start.y + 15 });
        await save();
        const changed = (
          await js(`window.tugou.open(${JSON.stringify(id)})`)
        ).document.layers.find((l) => l.id === rectLayer.id);
        check(
          `native ${handle} handle updates geometry`,
          handle === "resize"
            ? changed.width > moved.width
            : Math.abs(changed.rotation - moved.rotation) > 1,
        );
        await js("document.querySelector('button[aria-label=撤销]').click()");
        await save();
      }
      await menu("图层", "复制");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      const copy = record.document.layers.at(-1);
      await js(
        `document.querySelector('[data-layer-id="${rectLayer.id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`,
      );
      await menu("图层", "编组");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      const group = record.document.layers.find((l) => l.kind === "group");
      check(
        "multi-selection group preserves children",
        record.document.layers.filter((l) => l.parentId === group.id).length ===
          2,
      );
      await menu("图层", "取消编组");
      await save();
      await click("button[aria-label=撤销]", "");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "undo restores grouping",
        record.document.layers.some((l) => l.kind === "group"),
      );
      await js("document.querySelector('button[aria-label=重做]').click()");
      await save();
      await js(
        `document.querySelector('[data-layer-id="${copy.id}"]').click()`,
      );
      await menu("变换", "四角透视");
      await wait('document.querySelector("[data-handle=warp-0]")');
      const corner = await js(
        `(()=>{const e=document.querySelector('[data-handle=warp-0]').getBoundingClientRect();return{x:Math.round(e.x+e.width/2),y:Math.round(e.y+e.height/2)}})()`,
      );
      await drag(corner, { x: corner.x + 8, y: corner.y + 5 });
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "native perspective corner writes valid quad",
        record.document.layers.find((l) => l.id === copy.id).warp?.length === 8,
      );
      await menu("变换", "退出透视");
      await menu("选区", "矩形选区");
      const stage = await js(
        `(()=>{const e=document.querySelector('.layer-overlay > g > rect[fill="none"]').getBoundingClientRect();return{x:Math.round(e.x+30),y:Math.round(e.y+30)}})()`,
      );
      await drag(stage, { x: stage.x + 150, y: stage.y + 120 });
      await menu("蒙版", "选区生成蒙版");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "selection becomes persisted editable mask",
        record.document.selection.paths.length === 1 &&
          record.document.layers.find((l) => l.id === copy.id).mask.paths
            .length === 1,
      );
      const beforeCrop = record.document;
      await menu("选区", "按选区裁切画布");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "crop reduces canvas without deleting source layers",
        record.document.width < beforeCrop.width &&
          record.document.height < beforeCrop.height &&
          record.document.layers.length === beforeCrop.layers.length,
      );
      await click("button[aria-label=撤销]", "");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "undo crop restores full document geometry",
        JSON.stringify(record.document.layers) ===
          JSON.stringify(beforeCrop.layers) &&
          record.document.width === beforeCrop.width,
      );
      const exportPath = path.join(output, "layers-ui-export.png");
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: exportPath,
      });
      await click("#canvas-actions button", "导出 PNG");
      await wait(
        'document.querySelector(".layer-editor [role=status]")?.textContent.includes("已导出")',
      );
      const exported = nativeImage.createFromPath(exportPath);
      check(
        "top-toolbar PNG export retains original dimensions",
        exported.getSize().width === 1024 && exported.getSize().height === 1536,
      );
      await menu("选区", "取消选区");
      await click("#canvas-actions button", "选择");
      await js(
        `document.querySelector('[data-layer-id="${rectLayer.id}"]').click();document.querySelector('[data-layer-id="${copy.id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true,shiftKey:true}))`,
      );
      await menu("图层", "合并所选");
      await wait(
        'Array.from(document.querySelectorAll(".layer-name")).some(e=>e.textContent==="合并图层")',
      );
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "merge creates raster material and replaces selected layers",
        record.document.assets.length === 5 &&
          record.document.layers.at(-1).kind === "image" &&
          !record.document.layers.some((l) => l.id === copy.id),
      );
      const mergeError = await js(
        `(async()=>{const c=new window.layerQA.Compositor(),a=document.createElement('canvas'),b=document.createElement('canvas');await c.render(${JSON.stringify(beforeCrop)},a);await c.render(${JSON.stringify(record.document)},b);const aa=a.getContext('2d').getImageData(0,0,a.width,a.height).data,bb=b.getContext('2d').getImageData(0,0,b.width,b.height).data;let max=0;for(let i=0;i<aa.length;i++)max=Math.max(max,Math.abs(aa[i]-bb[i]));c.dispose();return max;})()`,
      );
      check("merged pixels match editable source composition", mergeError <= 3);
      report.mergePixelMaxError = mergeError;
      await click("button[aria-label=撤销]", "");
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "undo merge restores editable source layers and masks",
        record.document.layers.find((l) => l.id === copy.id)?.mask.paths
          .length === 1 && record.document.assets.length === 4,
      );
      await menu("排版", "添加垂直参考线");
      await wait('document.querySelector("[data-handle=guide-0]")');
      const guide = await js(
        `(()=>{const e=document.querySelector('[data-handle=guide-0]').getBoundingClientRect();return{x:Math.round(e.x),y:Math.round(e.y+35)}})()`,
      );
      await drag(guide, { x: guide.x + 30, y: guide.y });
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "native guide drag persists document coordinate",
        record.document.layout.guides[0].position > 512,
      );
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [exportPath],
      });
      await menu("添加", "导入图片");
      await wait('document.querySelectorAll(".layer-asset").length===5');
      await save();
      record = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "image import enters shared material library and layer list",
        record.document.assets.length === 5 &&
          record.document.layers.at(-1).kind === "image",
      );
      check(
        "original legacy project remains byte-identical",
        (await fs.readFile(original)).equals(originalBytes),
      );
      window.setSize(960, 720);
      await new Promise((r) => setTimeout(r, 300));
      await click("#canvas-actions button", "适应");
      await new Promise((r) => setTimeout(r, 300));
      check(
        "editor remains usable at 960px",
        await js(
          'document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".layer-stage").clientWidth>250',
        ),
      );
      await fs.writeFile(
        path.join(output, "layers-editor-960.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      report.projectId = id;
      report.savedLayerCount = record.document.layers.length;
      report.savedDocument = record.document;
      const savedPixels = await js(
        `(async()=>{const c=new window.layerQA.Compositor(),out=document.createElement('canvas');await c.render(${JSON.stringify(record.document)},out,{scale:.25});const data=[...out.getContext('2d').getImageData(0,0,out.width,out.height).data];c.dispose();return data;})()`,
      );
      report.savedPixelHash = createHash("sha256")
        .update(Buffer.from(savedPixels))
        .digest("hex");
      await fs.writeFile(
        path.join(output, "layers-saved.rgba"),
        Buffer.from(savedPixels),
      );
      const security = await js(
        `(async()=>{let denied=0;try{await window.tugou.writeExport('unknown',new Uint8Array([1]));}catch{denied++;}const chosen=await window.tugou.chooseExport('invalid');try{await window.tugou.writeExport(chosen.token,new Uint8Array([1]));}catch{denied++;}await window.tugou.cancelExport(chosen.token);try{await window.tugou.writeExport(chosen.token,new Uint8Array([1]));}catch{denied++;}return denied===3;})()`,
      );
      check(
        "export rejects unknown or cancelled capabilities and malformed data",
        security,
      );
      report.processMemory = app
        .getAppMetrics()
        .map((m) => ({ type: m.type, workingSetKiB: m.memory.workingSetSize }));
      check("no renderer errors", report.errors.length === 0);
      await fs.writeFile(
        path.join(output, "layers-desktop.json"),
        JSON.stringify(report, null, 2),
      );
      clearTimeout(timeout);
      await js('window.tugou.window("close")');
    } catch (error) {
      report.failure = String(error?.stack || error?.message || error);
      report.errorObject = JSON.stringify(
        error,
        Object.getOwnPropertyNames(error),
      );
      await fs.writeFile(
        path.join(output, "layers-desktop.json"),
        JSON.stringify(report, null, 2),
      );
      await fs.writeFile(
        path.join(output, "layers-failure.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      clearTimeout(timeout);
      app.exit(1);
    }
  });
});
require("../main.cjs");
