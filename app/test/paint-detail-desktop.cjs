const { app, dialog, BrowserWindow } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(output, "paint-detail-desktop.json"), "utf8"),
      )
    : null,
  profile =
    prior?.profile ||
    fs.mkdtempSync(
      path.join(fs.realpathSync(os.tmpdir()), "tugou-paint-detail-"),
    );
process.env.TUGOU_DATA_DIR = profile;
const report = { profile, checks: [], errors: [], platform: process.platform },
  finish = (code) => {
    fs.writeFileSync(
      path.join(
        output,
        restart ? "paint-detail-restart.json" : "paint-detail-desktop.json",
      ),
      JSON.stringify(report, null, 2),
    );
    app.exit(code);
  },
  timer = setTimeout(() => {
    report.failure = "Timed out";
    finish(1);
  }, 120000);
let started=false;
app.on("browser-window-created", (_e, window) => {
  if(started)return;started=true;
  window.webContents.on("console-message", (_e, d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms)),
      check = (n, ok) => {
        assert.ok(ok, n);
        report.checks.push(n);
      };
    const wait = async (code) => {
      for (let i = 0; i < 300; i++) {
        if (await js(code)) return;
        await delay(30);
      }
      throw new Error("Timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(80);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label="${label}"]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`,
      );
      await delay(60);
    };
    const inject = () =>
      js(
        fs.readFileSync(
          path.join(output, "paint-detail-engine-qa.js"),
          "utf8",
        ) + ";void 0;",
      );
    const reopen = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'layers'}))`,
      );
      const loaded = new Promise((r) =>
        window.webContents.once("did-finish-load", r),
      );
      window.webContents.reload();
      await loaded;
      await wait('document.querySelector(".layer-stage canvas")?.width>0');
      await inject();
      await js(
        "document.querySelector('.layer-row button[title=\"绘画交互样图\"]').click()",
      );
      await delay(80);
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const pixels = (doc) =>
        js(
          `(async()=>{const d=${JSON.stringify(doc)},e=new detailQA.Compositor(),c=detailQA.surface(d.width,d.height);await e.render(d,c,{transparent:true});const p=[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];e.dispose();return p})()`,
        ),
      at = (rgba, x, y) => rgba.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 4);
    const location = (x, y) =>
      js(
        `(()=>{const b=document.querySelector('.layer-stage').getBoundingClientRect(),m=document.querySelector('.layer-overlay>g').transform.baseVal.consolidate().matrix;return {x:Math.round(b.x+m.e+${x}*m.a),y:Math.round(b.y+m.f+${y}*m.d)}})()`,
      );
    const mouse = async (type, x, y, shift = false) => {
      const p = await location(x, y);
      window.webContents.sendInputEvent({
        type,
        ...p,
        ...(type === "mouseMove" ? {} : { button: "left", clickCount: 1 }),
        modifiers: [
          ...(shift ? ["shift"] : []),
          ...(type === "mouseMove" ? ["leftButtonDown"] : []),
        ],
      });
      await delay(80);
    };
    const stroke = async (from, to, shift = false) => {
      await mouse("mouseDown", ...from, shift);
      await mouse("mouseMove", ...to, shift);
      await mouse("mouseUp", ...to, shift);
      await wait(
        '!document.querySelector(".layer-parameter-row").textContent.includes("正在保存")',
      );
    };
    try {
      await wait('document.querySelector(".studio-header")');
      await inject();
      if (restart) {
        report.id = prior.id;
        await reopen();
        const d = (await save()).document;
        check(
          "new process restores painted mask and all document fields",
          JSON.stringify(d) === JSON.stringify(prior.document),
        );
        check(
          "new process restores exact masked pixels",
          JSON.stringify(await pixels(d)) === JSON.stringify(prior.pixels),
        );
      } else {
        report.checks.push(...(await js("detailQA.verify()")).checks);
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(`detailQA.fixture(${JSON.stringify(report.id)})`);
        await reopen();
        const baseline = await save();
        await js(
          '[...document.querySelectorAll(".layer-menu")].find(m=>m.querySelector("summary").textContent==="蒙版").open=true',
        );
        await click("绘制蒙版");
        check(
          "mask command uses common top paint controls",
          await js(
            'document.querySelector(\'[aria-label="绘制目标"]\').closest(".studio-select").dataset.value==="mask"&&document.querySelector(\'[aria-label="蒙版黑色 · 隐藏"]\').getAttribute("aria-pressed")==="true"',
          ),
        );
        await mouse("mouseDown", 40, 40);
        await mouse("mouseMove", 80, 40);
        await delay(120);
        check(
          "mask preview hides content before committing",
          await js(
            '(()=>{const c=document.querySelector(".layer-stage canvas"),m=document.querySelector(".layer-overlay>g").transform.baseVal.consolidate().matrix;return c.getContext("2d").getImageData(Math.round(m.e+40*m.a),Math.round(m.f+40*m.d),1,1).data[3]<10})()',
          ),
        );
        check(
          "active mask preview does not modify saved project",
          JSON.stringify(
            (await js(`tugou.open(${JSON.stringify(report.id)})`)).document,
          ) === JSON.stringify(baseline.document),
        );
        await mouse("mouseUp", 80, 40);
        await wait(
          '!document.querySelector(".layer-parameter-row").textContent.includes("正在保存")',
        );
        const hidden = await save(),
          hp = await pixels(hidden.document);
        check(
          "mask hides both smoothed endpoint and starting point",
          at(hp, 40, 40)[3] === 0 && at(hp, 80, 40)[3] === 0,
        );
        check(
          "mask edit preserves image resource and opaque data",
          !hidden.document.layers[0].bitmap &&
            JSON.stringify(hidden.document.assets) ===
              JSON.stringify(baseline.document.assets) &&
            hidden.document.futureField.keep &&
            hidden.document.layers[0].futureLayer === "保留",
        );
        await click("撤销");
        check(
          "mask creation is one undo",
          JSON.stringify((await save()).document) ===
            JSON.stringify(baseline.document),
        );
        await click("重做");
        check(
          "mask redo is exact",
          JSON.stringify((await save()).document) ===
            JSON.stringify(hidden.document),
        );
        await click("蒙版白色 · 恢复");
        await stroke([40, 40], [80, 40]);
        const revealed = await save();
        check(
          "mask reveal restores original opaque pixels",
          at(await pixels(revealed.document), 60, 40)[3] === 255,
        );
        await select("绘制目标", "image");
        await stroke([200, 80], [200, 80], true);
        let p = await pixels((await save()).document);
        check(
          "Shift click cannot connect across mask and image targets",
          JSON.stringify(at(p, 140, 60)) === "[51,102,153,255]",
        );
        await stroke([200, 140], [200, 140], true);
        p = await pixels((await save()).document);
        check(
          "Shift click connects previous endpoint after saving",
          JSON.stringify(at(p, 200, 110)) !== "[51,102,153,255]",
        );
        await click("笔刷设置");
        await js(
          '[...document.querySelectorAll(".tool-popover label")].find(l=>l.textContent.includes("直线")).querySelector("input").click()',
        );
        await click("笔刷设置");
        const beforeLine = await save();
        await mouse("mouseDown", 40, 100);
        await mouse("mouseMove", 100, 150);
        await mouse("mouseMove", 140, 100);
        await wait('!!document.querySelector("[aria-label=直线绘画引导]")');
        check(
          "line drag displays guide without raster preview",
          await js(
            '(()=>{const c=document.querySelector(".layer-stage canvas"),m=document.querySelector(".layer-overlay>g").transform.baseVal.consolidate().matrix;return [...c.getContext("2d").getImageData(Math.round(m.e+80*m.a),Math.round(m.f+100*m.d),1,1).data].join()==="51,102,153,255"})()',
          ),
        );
        fs.writeFileSync(
          path.join(output, "paint-detail-guide.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        await mouse("mouseUp", 140, 100);
        await wait(
          '!document.querySelector(".layer-parameter-row").textContent.includes("正在保存")',
        );
        const lined = await save(),
          lp = await pixels(lined.document);
        report.lineDiagnostic={line:at(lp,80,100),bend:at(lp,100,150),before:beforeLine.document.layers[0].bitmap?.resource,after:lined.document.layers[0].bitmap?.resource,focused:await js('document.hasFocus()'),message:await js('document.querySelector(".layer-editor>.message")?.textContent')};
        check(
          "line release writes straight segment and ignores bent drag",
          JSON.stringify(at(lp, 80, 100)) !== "[51,102,153,255]" &&
            JSON.stringify(at(lp, 100, 150)) === "[51,102,153,255]",
        );
        await click("撤销");
        check(
          "straight line is one undo",
          JSON.stringify((await save()).document) ===
            JSON.stringify(beforeLine.document),
        );
        await click("重做");
        await save();
        await select("绘制目标", "mask");
        await click("蒙版黑色 · 隐藏");
        await click("笔刷设置");
        await js(
          '[...document.querySelectorAll(".tool-popover label")].find(l=>l.textContent.includes("直线")).querySelector("input").click()',
        );
        await click("笔刷设置");
        const beforeCancel = await save();
        await mouse("mouseDown", 130, 160);
        await mouse("mouseMove", 170, 160);
        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        await mouse("mouseUp", 170, 160);
        check(
          "Escape cancels mask raster preview",
          JSON.stringify((await save()).document) ===
            JSON.stringify(beforeCancel.document),
        );
        await click('画笔');
        await mouse("mouseDown", 130, 160);
        await mouse("mouseMove", 170, 160);
        const focusWindow=new BrowserWindow({width:300,height:120,show:true});
        await focusWindow.loadURL('data:text/html,<title>Focus QA</title>Focus check');
        focusWindow.focus();
        await delay(200);
        check('native window lost focus during active stroke',!window.isFocused());
        focusWindow.destroy();
        window.focus();
        await mouse("mouseUp", 170, 160);
        check(
          "window blur cancels active mask stroke",
          JSON.stringify((await save()).document) ===
            JSON.stringify(beforeCancel.document),
        );
        await click("画笔");
        await stroke([40, 150], [90, 150]);
        report.document = (await save()).document;
        report.pixels = await pixels(report.document);
        check(
          "completed mask stroke remains available after canceled strokes",
          at(report.pixels, 65, 150)[3] === 0,
        );
        const filePath = path.join(profile, "mask-export.png");
        dialog.showSaveDialog = async () => ({ canceled: false, filePath });
        await click("导出 PNG");
        for (let i = 0; i < 200 && !fs.existsSync(filePath); i++)
          await delay(30);
        const exported = await js(
          `(async()=>{const b=await createImageBitmap(new Blob([new Uint8Array(${JSON.stringify([...fs.readFileSync(filePath)])})],{type:'image/png'})),c=detailQA.surface(b.width,b.height);c.getContext('2d',{willReadFrequently:true}).drawImage(b,0,0);return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data]})()`,
        );
        report.exportDiff={max:exported.reduce((m,v,i)=>Math.max(m,Math.abs(v-report.pixels[i])),0),samples:exported.map((v,i)=>v===report.pixels[i]?null:{i,actual:v,expected:report.pixels[i]}).filter(Boolean).slice(0,10)};
        check(
          "PNG export preserves every painted mask pixel",
          JSON.stringify(exported) === JSON.stringify(report.pixels),
        );
        window.setSize(960, 740);
        await delay(150);
        check(
          "mask controls stay inside 960px top row",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(".layer-parameter-row button,.layer-parameter-row select,.layer-parameter-row input")].every(e=>{const r=e.getBoundingClientRect();return !r.width||r.right<=innerWidth})',
          ),
        );
        fs.writeFileSync(
          path.join(output, "paint-detail-960.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
      }
      check("no renderer errors", report.errors.length === 0);
      clearTimeout(timer);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      clearTimeout(timer);
      finish(1);
    }
  });
});
require("../main.cjs");

