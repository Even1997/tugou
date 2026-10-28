const { app } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  restart = process.argv.includes("--restart");
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(output, "paint-desktop.json"), "utf8"))
  : null;
const profile =
  prior?.profile ||
  fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tugou-paint-ui-"));
process.env.TUGOU_DATA_DIR = profile;
const report = { profile, checks: [], errors: [], platform: process.platform };
const finish = (code) => {
  fs.writeFileSync(
    path.join(output, restart ? "paint-restart.json" : "paint-desktop.json"),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
const timer = setTimeout(() => {
  report.failure = "Timed out";
  finish(1);
}, 90000);
app.on("browser-window-created", (_e, window) => {
  window.webContents.on("console-message", (_e, d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (label, ok) => {
      assert.ok(ok, label);
      report.checks.push(label);
    };
    const wait = async (code) => {
      for (let i = 0; i < 180; i++) {
        if (await js(code)) return;
        await delay(40);
      }
      throw new Error("Timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(80);
    };
    const inject = () =>
      js(
        fs.readFileSync(path.join(output, "paint-engine-qa.js"), "utf8") +
          ";void 0;",
      );
    const reopen = async (id) => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:'layers'}))`,
      );
      const loaded = new Promise((r) =>
        window.webContents.once("did-finish-load", r),
      );
      window.webContents.reload();
      await loaded;
      await wait('document.querySelector(".layer-stage canvas")?.width>0');
      await inject();
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`window.tugou.open(${JSON.stringify(report.id)})`);
    };
    const bitmapPixels = (doc) =>
      js(
        `(async()=>{const d=${JSON.stringify(doc)},e=new paintQA.Compositor(),c=paintQA.surface(d.width,d.height);await e.render(d,c,{transparent:true});const pixels=[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];e.dispose();return pixels;})()`,
      );
    const stroke = async (cancel = false) => {
      const box = await js(
        `(()=>{const b=document.querySelector('.layer-stage').getBoundingClientRect();return {x:Math.round(b.x+b.width*.4),y:Math.round(b.y+b.height*.45)}})()`,
      );
      window.webContents.sendInputEvent({ type: "mouseMove", ...box });
      window.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...box,
      });
      await delay(100);
      for (let i = 1; i <= 8; i++) {
        window.webContents.sendInputEvent({
          type: "mouseMove",
          x: box.x + i * 6,
          y: box.y,
          modifiers: ["leftButtonDown"],
        });
        await delay(16);
      }
      if (cancel) {
        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      }
      window.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        x: box.x + 48,
        y: box.y,
      });
      await delay(400);
      await wait(
        '!document.querySelector(".layer-parameter-row").textContent.includes("正在保存")',
      );
    };
    try {
      await wait('document.querySelector(".studio-header")');
      if (restart) {
        report.id = prior.id;
        await reopen(prior.id);
        const saved = await js(
          `window.tugou.open(${JSON.stringify(prior.id)})`,
        );
        check(
          "new process restores full saved document and unknown fields",
          JSON.stringify(saved.document) === JSON.stringify(prior.document),
        );
        check(
          "new process renders identical original-resolution pixels",
          JSON.stringify(await bitmapPixels(saved.document)) ===
            JSON.stringify(prior.pixels),
        );
        const large=await js(`(async()=>{const a=${JSON.stringify(prior.largeStroke.bitmap)},e=new paintQA.Compositor(),img=await e.image(a),c=paintQA.surface(1,1);c.getContext('2d').drawImage(img,9985,9980,1,1,0,0,1,1);return {width:img.naturalWidth,height:img.naturalHeight,pixel:[...c.getContext('2d').getImageData(0,0,1,1).data]}})()`);
        check('100MP PNG survives fresh-process decode with exact far-edge color',large.width===10000&&large.height===10000&&JSON.stringify(large.pixel)==='[255,0,0,255]');
      } else {
        await inject();
        const pixels = await js("paintQA.verify()");
        report.checks.push(...pixels.checks);
        report.stroke4KMs = pixels.elapsed;
        report.stroke4KWorkingBytes = pixels.workingBytes;
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(
          `(async()=>{const r=await window.tugou.open(${JSON.stringify(report.id)});await window.tugou.save(r.id,{...r.document,width:192,height:128,background:'transparent',futureField:{keep:'完整保留'}},r.revision)})()`,
        );
        await reopen(report.id);
        await click("画笔");
        await click("新建绘画图层");
        await wait('document.querySelectorAll(".layer-row").length===1');
        const blank = await save();
        check(
          "new transparent paint layer uses document dimensions",
          (await bitmapPixels(blank.document)).every((n) => n === 0),
        );
        check(
          "paint parameters are visible in top row",
          await js(
            `['画笔颜色','笔刷大小','笔刷不透明度'].every(label=>document.querySelector('[aria-label="'+label+'"]').getBoundingClientRect().width>0)`,
          ),
        );
        await stroke();
        const painted = await save();
        const rgba = await bitmapPixels(painted.document);
        check(
          "native mouse stroke writes nonempty original pixels",
          rgba.some((n, i) => i % 4 === 3 && n > 0) &&
            painted.document.layers[0].bitmap.resource !==
              blank.document.layers[0].bitmap.resource,
        );
        await click("撤销");
        const undone = await save();
        check(
          "one undo restores original bitmap",
          undone.document.layers[0].bitmap.resource ===
            blank.document.layers[0].bitmap.resource,
        );
        await click("重做");
        const redone = await save();
        check(
          "redo restores exact brush pixels",
          JSON.stringify(await bitmapPixels(redone.document)) ===
            JSON.stringify(rgba),
        );
        await stroke(true);
        const cancelled = await save();
        check(
          "Escape cancels pending stroke with no document change",
          JSON.stringify(cancelled.document) ===
            JSON.stringify(redone.document),
        );
        await click("橡皮");
        await stroke();
        const erased = await save();
        const erasedRgba = await bitmapPixels(erased.document);
        check(
          "native eraser reduces painted alpha",
          erasedRgba.reduce((a, n, i) => a + (i % 4 === 3 ? n : 0), 0) <
            rgba.reduce((a, n, i) => a + (i % 4 === 3 ? n : 0), 0),
        );
        await click("撤销");
        report.document = (await save()).document;
        report.pixels = await bitmapPixels(report.document);
        check(
          "unknown fields survive all painting operations",
          report.document.futureField.keep === "完整保留",
        );
        await click("画笔");
        await click("笔刷设置");
        await wait('document.querySelector(".ant-popover")');
        check(
          "advanced brush settings use shared popover",
          await js(
            '!!document.querySelector(\'input[aria-label="平滑（屏幕像素）"]\')&&!!document.querySelector("input[aria-label=硬度]")',
          ),
        );
        await click("笔刷设置");
        await fs.promises.writeFile(
          path.join(output, "paint-dark.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        window.setSize(960, 740);
        await delay(200);
        check(
          "960px window has no horizontal page overflow",
          await js("document.documentElement.scrollWidth<=innerWidth"),
        );
        await fs.promises.writeFile(
          path.join(output, "paint-960.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        report.largeStroke = await js("paintQA.verifyLarge()");
        check(
          "100MP far-edge stroke keeps dimensions and bounded working surfaces",
          report.largeStroke.width === 10000 &&
            report.largeStroke.height === 10000 &&
            report.largeStroke.pixel[0] === 255 &&
            report.largeStroke.pixel[3] === 255 &&
            report.largeStroke.workingBytes < 401 * 1024 * 1024,
        );
        report.processMemory = app
          .getAppMetrics()
          .map((p) => ({ type: p.type, memory: p.memory }));
        report.rendererMemory = await js(
          "performance.memory?{used:performance.memory.usedJSHeapSize}:null",
        );
      }
      check("no renderer errors", report.errors.length === 0);
      clearTimeout(timer);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.ui = await js('({message:document.querySelector(".layer-editor>.message")?.textContent,tool:document.querySelector("select[aria-label=当前编辑工具]")?.value,view:document.querySelector(".layer-overlay>g")?.getAttribute("transform"),focused:document.hasFocus()})');
      fs.writeFileSync(path.join(output,'paint-failure.png'),(await window.webContents.capturePage()).toPNG());
      clearTimeout(timer);
      finish(1);
    }
  });
});
require("../main.cjs");
