const { app } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  assert = require("node:assert/strict");
if (!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR))
  throw new Error("QA profile required");
const output = path.resolve(__dirname, "../test-results"),
  report = { checks: [], errors: [] };
const timer = setTimeout(() => app.exit(1), 120000);
let started = false;
app.on("browser-window-created", (_event, window) => {
  window.webContents.on("console-message", (_e, d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.on("did-finish-load", async () => {
    if (started) return;
    started = true;
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const wait = async (code) => {
      for (let i = 0; i < 200; i++) {
        if (await js(code)) return;
        await delay(50);
      }
      throw new Error(`Timed out: ${code}`);
    };
    const click = async (selector, text) => {
      await js(
        `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`,
      );
      await delay(50);
    };
    const menu = async (name, text) => {
      await js(
        `Array.from(document.querySelectorAll('.layer-menu')).find(e=>e.querySelector('summary').textContent===${JSON.stringify(name)}).open=true`,
      );
      await click(".layer-menu-body button", text);
    };
    const field = async (selector, value, select = false) => {
      await js(
        `{const e=document.querySelector(${JSON.stringify(selector)});if(e.closest('details'))e.closest('details').open=true;e.focus();Object.getOwnPropertyDescriptor(${select ? "HTMLSelectElement" : "HTMLInputElement"}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(${select ? "'change'" : "'input'"},{bubbles:true}));}`,
      );
      await delay(30);
      await js(`document.querySelector(${JSON.stringify(selector)}).blur()`);
    };
    const check = (name, value) => {
      assert.ok(value, name);
      report.checks.push(name);
    };
    let id;
    const save = async () => {
      await click(".toolbar-end button", "保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`window.tugou.open(${JSON.stringify(id)})`);
    };
    const settle = async () => {
      await delay(100);
      await wait(
        '!Array.from(document.querySelectorAll("#canvas-actions button")).some(e=>e.textContent.includes("取消选区处理"))',
      );
    };
    const point = async (x, y) => {
      const p = await js(
        `(()=>{const r=document.querySelector('.layer-overlay > g > rect[fill="none"]').getBoundingClientRect();return{x:Math.round(r.x+${x}*r.width/256),y:Math.round(r.y+${y}*r.height/192)}})()`,
      );
      window.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...p,
      });
      window.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...p,
      });
      await settle();
    };
    const pixels = async (record) =>
      js(
        `(async()=>{const c=new window.layerQA.Compositor(),mask=await window.layerQA.Selection.selectionCanvas(${JSON.stringify(record.document)},c);return [...window.layerQA.Selection.alphaOf(mask)];})()`,
      );
    try {
      await wait('window.tugou&&document.querySelector(".toolbar")');
      await js(
        (await fs.readFile(path.join(output, "layer-engine-qa.js"), "utf8")) +
          ";void 0;",
      );
      id = await js(
        `(async()=>{const {Layers:L,Selection:S}=window.layerQA,c=S.surface(256,192),ctx=c.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,256,192);ctx.fillStyle='#ff0000';ctx.fillRect(20,20,40,40);ctx.fillRect(160,20,40,40);ctx.fillStyle='#0000ff';ctx.fillRect(20,120,40,40);const asset=await window.tugou.storeRaster(await S.pngBytes(c),'测试原图'),r=await window.tugou.create('高级选区验收');await window.tugou.save(r.id,{...r.document,width:256,height:192,background:'transparent',custom:{retained:true},assets:[asset],layers:[L.createLayer('image',{id:'photo',name:'测试原图',assetId:asset.id,x:0,y:0,width:256,height:192}),L.createLayer('group',{id:'g1',name:'旋转组',x:30,y:15,rotation:15,scaleX:1.2,width:180,height:120}),L.createLayer('group',{id:'g2',name:'目标组',x:20,y:10,width:200,height:150})]},r.revision);return r.id;})()`,
      );
      window.webContents.reload();
      await wait(
        `document.querySelector('select[aria-label=当前工程] option[value="${id}"]')`,
      );
      await field("select[aria-label=当前工程]", id, true);
      await wait('document.querySelector(".document-heading")');
      await click("nav button", "图层合成");
      await delay(150);
      await js(
        (await fs.readFile(path.join(output, "layer-engine-qa.js"), "utf8")) +
          ";void 0;",
      );
      await menu("选区", "魔棒选区");
      await field("input[aria-label=容差]", "0");
      await point(30, 30);
      let r = await save(),
        a = await pixels(r);
      check(
        "wand selects only contiguous exact-color region",
        a[30 * 256 + 30] === 255 &&
          a[30 * 256 + 170] === 0 &&
          a[80 * 256 + 80] === 0,
      );
      await menu("选区", "颜色范围");
      await point(30, 30);
      r = await save();
      a = await pixels(r);
      check(
        "color range includes disconnected identical colors",
        a[30 * 256 + 30] === 255 && a[30 * 256 + 170] === 255,
      );
      await field("select[aria-label=选区运算]", "subtract", true);
      await menu("选区", "魔棒选区");
      await point(30, 30);
      r = await save();
      a = await pixels(r);
      check(
        "subtract combines pixel selections correctly",
        a[30 * 256 + 30] === 0 && a[30 * 256 + 170] === 255,
      );
      await menu("选区", "扩展选区");
      await settle();
      r = await save();
      a = await pixels(r);
      check(
        "pixel growth respects disk distance",
        a[30 * 256 + 155] === 255 && a[14 * 256 + 154] === 0,
      );
      await menu("选区", "收缩选区");
      await settle();
      r = await save();
      a = await pixels(r);
      check(
        "shrink preserves center and removes outer expansion",
        a[30 * 256 + 170] === 255 && a[30 * 256 + 155] === 0,
      );
      await field("input[aria-label=羽化像素]", "3");
      r = await save();
      a = await pixels(r);
      check(
        "feather produces partial edge alpha",
        a[30 * 256 + 160] > 0 && a[30 * 256 + 160] < 255,
      );
      await menu("选区", "选区填色（新图层）");
      await settle();
      r = await save();
      check(
        "fill creates shared material without replacing original",
        r.document.layers.length === 4 &&
          r.document.assets.length === 2 &&
          r.document.layers[0].id === "photo",
      );
      await js("document.querySelector('button[aria-label=撤销]').click()");
      await save();
      await js("document.querySelector('[data-layer-id=photo]').click()");
      await menu("选区", "清除图片选区");
      await settle();
      r = await save();
      const imageAlpha = await js(
        `(async()=>{const c=new window.layerQA.Compositor(),img=await c.image(${JSON.stringify(r.document.layers[0].bitmap)}),out=window.layerQA.Selection.surface(256,192);out.getContext('2d').drawImage(img,0,0);return [...out.getContext('2d').getImageData(170,30,1,1).data,...out.getContext('2d').getImageData(30,30,1,1).data];})()`,
      );
      check(
        "clear affects selected image pixels only",
        imageAlpha[3] < 5 && imageAlpha[7] === 255,
      );
      await click("button[aria-label=撤销]", "");
      await save();
      await js(
        "document.querySelector('[aria-label=\"锁定 测试原图\"]').click()",
      );
      check(
        "locked layer cannot receive a selection mask",
        await js(
          "Array.from(document.querySelectorAll('.layer-menu-body button')).find(e=>e.textContent==='选区生成蒙版').disabled",
        ),
      );
      await js(
        "document.querySelector('[aria-label=\"解锁 测试原图\"]').click()",
      );
      await menu("蒙版", "选区生成蒙版");
      await settle();
      r = await save();
      check(
        "pixel selection converts to persistent local mask",
        Boolean(r.document.layers[0].mask.bitmap.resource),
      );
      await click("button[aria-label=撤销]", "");
      await save();
      await field("select[aria-label=移入分组]", "g1", true);
      r = await save();
      const L = require("../core/layers.cjs");
      const wm = L.worldMatrix(
        r.document.layers,
        r.document.layers.find((l) => l.id === "photo"),
      );
      check(
        "reparenting preserves original world transform",
        wm.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) < 1e-7),
      );
      await js(
        "document.querySelector('[aria-label=\"折叠 旋转组\"]').click()",
      );
      check(
        "folded group hides children in layer tree",
        await js("!document.querySelector('[data-layer-id=photo]')"),
      );
      await js(
        "document.querySelector('[aria-label=\"展开 旋转组\"]').click()",
      );
      await js(
        `{const from=document.querySelector('[data-layer-id=photo]'),to=document.querySelector('[data-tree-id=g2]'),r=to.getBoundingClientRect(),dt=new DataTransfer();from.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));to.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,clientX:r.x+50,clientY:r.y+r.height/2}));}`,
      );
      r = await save();
      check(
        "dragging into a group updates hierarchy",
        r.document.layers.find((l) => l.id === "photo").parentId === "g2",
      );
      await field("select[aria-label=移入分组]", "root", true);
      r = await save();
      check(
        "move to root retains transform and unknown fields",
        !r.document.layers.find((l) => l.id === "photo").parentId &&
          r.document.custom.retained,
      );
      await menu("选区", "取消选区");
      await field("select[aria-label=选区运算]", "add", true);
      await menu("选区", "多边形选区");
      await point(20, 20);
      await point(90, 20);
      await point(20, 90);
      await click("#canvas-actions button", "完成多边形");
      r = await save();
      check(
        "polygon stores editable vertices",
        r.document.selection.paths[0].points.length === 6,
      );
      await menu("选区", "颜色范围");
      await point(30, 30);
      await save();
      await field("input[aria-label=工程名称]", "热更新保留未保存修改");
      const oldPid = window.webContents.getOSProcessId();
      await js("document.querySelector('button[aria-label=更多操作]').click()");
      await delay(100);
      await click(".import-menu button", "保存并热更新");
      await wait(
        'document.querySelector(".layer-editor")&&document.querySelector("input[aria-label=工程名称]").value==="热更新保留未保存修改"',
      );
      r = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "hot reload saves dirty edits and restores layer workspace",
        r.document.name === "热更新保留未保存修改" &&
          Boolean(r.document.selection.bitmap),
      );
      report.hotReloadRendererPid = oldPid;
      report.projectId = id;
      report.savedDocument = r.document;
      window.setSize(960, 720);
      await delay(150);
      check(
        "960px toolbar has no document overflow",
        await js("document.documentElement.scrollWidth<=innerWidth"),
      );
      check("project dropdown has explicit readable dark colors", await js("(()=>{const s=getComputedStyle(document.querySelector('.project-menu option'));return s.color==='rgb(232, 236, 244)'&&s.backgroundColor==='rgb(29, 32, 40)';})()"));
      await fs.writeFile(
        path.join(output, "advanced-editor.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      check("no renderer errors", report.errors.length === 0);
      await fs.writeFile(
        path.join(output, "advanced-desktop.json"),
        JSON.stringify(report, null, 2),
      );
      clearTimeout(timer);
      await js('window.tugou.window("close")');
    } catch (error) {
      report.failure = String(error.stack || error);
      await fs.writeFile(
        path.join(output, "advanced-desktop.json"),
        JSON.stringify(report, null, 2),
      );
      await fs.writeFile(
        path.join(output, "advanced-failure.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      clearTimeout(timer);
      app.exit(1);
    }
  });
});
require("../main.cjs");
