const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(output, "adjustment-desktop.json"), "utf8"),
      )
    : null;
const profile =
  prior?.profile ||
  fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tugou-adjustment-"));
process.env.TUGOU_DATA_DIR = profile;
const report = { profile, checks: [], errors: [], platform: process.platform };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      output,
      restart ? "adjustment-restart.json" : "adjustment-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
const timer = setTimeout(() => {
  report.failure = "Timed out";
  finish(1);
}, 120000);
app.on("browser-window-created", (_, window) => {
  window.show=()=>{}; window.focus=()=>{}; window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms)),
      check = (n, v) => {
        assert.ok(v, n);
        report.checks.push(n);
      };
    const wait = async (code) => {
      for (let i = 0; i < 400; i++) {
        if (await js(`Boolean(${code})`)) return;
        await delay(30);
      }
      throw new Error("Timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(100);
    };
    const menu = async (name) => {
      await js(
        `[...document.querySelectorAll('.layer-menu')].find(m=>m.querySelector('summary').textContent===${JSON.stringify(name)}).open=true`,
      );
    };
    const inject = () =>
      js(
        fs.readFileSync(path.join(output, "adjustment-engine-qa.js"), "utf8") +
          ";void 0;",
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
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const input = async (label, value) => {
      await js(
        `{const el=document.querySelector('input[aria-label=${JSON.stringify(label)}]');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
      await delay(50);
      await js(
        `document.querySelector('input[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(100);
    };
    const pixels = (doc) =>
      js(
        `(async()=>{const e=new toneQA.Compositor(),c=toneQA.surface(256,192);await e.render(${JSON.stringify(doc)},c,{transparent:true});const data=[...c.getContext('2d').getImageData(0,0,256,192).data];e.dispose();return data})()`,
      );
    try {
      await wait('document.querySelector("select[aria-label=当前工程]")');
      await inject();
      if (restart) {
        report.id = prior.id;
        await reopen();
        const r = await save();
        check(
          "new process restores full adjustment document",
          JSON.stringify(r.document) === JSON.stringify(prior.document),
        );
        check(
          "new process restores exact pixels",
          JSON.stringify(await pixels(r.document)) ===
            JSON.stringify(prior.pixels),
        );
      } else {
        const engine = await js("toneQA.verify()");
        report.checks.push(...engine.checks);
        report.engine = engine;
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(`toneQA.fixture(${JSON.stringify(report.id)})`);
        await reopen();
        await js(
          "document.querySelector('.layer-row button[title=\"调整样图\"]').click()",
        );
        await delay(80);
        await menu("调整");
        await click("反相");
        await wait('document.querySelector("input[aria-label=调整强度]")');
        let r = await save();
        check(
          "adjustment creation carries selection mask",
          r.document.layers.length === 2 &&
            r.document.layers[1].mask.paths.length === 1,
        );
        let p = await pixels(r.document);
        check(
          "selection bounds constrain adjustment pixels",
          p[(10 * 256 + 10) * 4] === 223 && p[(10 * 256 + 200) * 4] === 32,
        );
        check(
          "original layer and unknown fields preserved",
          r.document.future.keep &&
            r.document.layers[0].futureLayer === "keep" &&
            !r.document.layers[0].bitmap,
        );
        await input("调整强度", 50);
        r = await save();
        check("top strength commits", r.document.layers[1].opacity === 0.5);
        await click("撤销");
        r = await save();
        check("strength is one undo", r.document.layers[1].opacity === 1);
        await click("重做");
        await click("停用调整");
        r = await save();
        p = await pixels(r.document);
        check(
          "disable restores original pixels",
          p[(10 * 256 + 10) * 4] === 32,
        );
        await click("启用调整");
        await click("调整选项");
        await delay(80);
        await click("重置调整");
        for (const [type, label] of Object.entries(
          await js(
            "Object.fromEntries(Object.entries(toneQA.fields).map(([k,v])=>[k,v.label]))",
          ),
        )) {
          if (type === "invert") continue;
          await menu("调整");
          await click(label);
          await delay(80);
          r = await save();
          check(
            "UI creates " + type,
            r.document.layers.at(-1).adjustment.type === type,
          );
        }
        await js(
          '[...document.querySelectorAll(".layer-row button")].find(b=>b.title==="曲线").click()',
        );
        await delay(80);
        await click("编辑曲线");
        await wait(
          'document.querySelector("svg[aria-label=曲线控制点编辑器]")',
        );
        const rect = await js(
          '(()=>{const r=document.querySelector("svg[aria-label=曲线控制点编辑器]").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
        );
        for (const type of ["mouseDown", "mouseUp"])
          window.webContents.sendInputEvent({
            type,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            button: "left",
            clickCount: 2,
          });
        await delay(130);
        r = await save();
        let curve = r.document.layers.find(
          (l) => l.adjustment?.type === "curves",
        );
        check(
          "curve double click adds point",
          curve.adjustment.channels.rgb.length === 3,
        );
        await js(
          'document.querySelector("svg[aria-label=曲线控制点编辑器]").focus()',
        );
        window.webContents.sendInputEvent({
          type: "mouseDown",
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          button: "left",
          clickCount: 1,
        });
        window.webContents.sendInputEvent({
          type: "mouseUp",
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          button: "left",
          clickCount: 1,
        });
        await delay(60);
        const before = curve.adjustment.channels.rgb[1][1];
        for (let i = 0; i < 2; i++) {
          window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Up" });
          window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Up" });
          await delay(70);
        }
        r = await save();
        curve = r.document.layers.find((l) => l.adjustment?.type === "curves");
        check(
          "curve arrows preserve selected control and do not move layer",
          curve.adjustment.channels.rgb[1][1] === before + 2 && curve.y === 0,
        );
        report.curveLayout=await js('(()=>{const e=document.querySelector(".curve-popover");return {width:e.clientWidth,scroll:e.scrollWidth}})()');
        check('curve popover has no horizontal overflow',report.curveLayout.scroll<=report.curveLayout.width);
        fs.writeFileSync(path.join(output,'adjustment-curve.png'),(await window.webContents.capturePage()).toPNG());
        await js('document.querySelector("svg[aria-label=曲线控制点编辑器]").focus()');
        window.webContents.sendInputEvent({type:'keyDown',keyCode:'Delete'});window.webContents.sendInputEvent({type:'keyUp',keyCode:'Delete'});await delay(90);
        r=await save();check('Delete removes curve point without deleting layer',r.document.layers.length===13&&r.document.layers.find(l=>l.adjustment?.type==='curves').adjustment.channels.rgb.length===2);
        await click('撤销');r=await save();check('curve deletion is one undo',r.document.layers.find(l=>l.adjustment?.type==='curves').adjustment.channels.rgb.length===3);
        await click("编辑曲线");
        await js(
          '[...document.querySelectorAll(".layer-row button")].find(b=>b.title==="曝光").click()',
        );
        await delay(80);
        await input("曝光补偿", 1);
        await click('调整选项');await click('重置调整');r=await save();check('reset restores default exposure',r.document.layers.find(l=>l.adjustment?.type==='exposure').adjustment.exposure===0);
        await click('撤销');r=await save();check('reset is one undo',r.document.layers.find(l=>l.adjustment?.type==='exposure').adjustment.exposure===1);
        window.setSize(960, 740);
        await delay(200);
        check(
          "adjustment controls fit 960px top row",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(".layer-parameter-row button,.layer-parameter-row input")].every(e=>{const b=e.getBoundingClientRect();return !b.width||b.right<=innerWidth})',
          ),
        );
        fs.writeFileSync(
          path.join(output, "adjustment-960.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        r = await save();
        report.document = r.document;
        report.pixels = await pixels(r.document);
        const exportPath = path.join(profile, "adjustments.png");
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: exportPath,
        });
        await click("导出 PNG");
        for(let i=0;i<300&&!fs.existsSync(exportPath);i++)await delay(30);
        report.exportMessage=await js('document.querySelector(".layer-editor>.message")?.textContent');
        check("PNG button exports file", fs.existsSync(exportPath));
        const url='data:image/png;base64,'+fs.readFileSync(exportPath).toString('base64');
        const exported=await js(`(async()=>{const i=new Image();i.src=${JSON.stringify(url)};await i.decode();const c=toneQA.surface(i.naturalWidth,i.naturalHeight),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(i,0,0);return [...ctx.getImageData(0,0,c.width,c.height).data]})()`);
        check('UI PNG matches saved composition pixels',JSON.stringify(exported)===JSON.stringify(report.pixels));
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
