const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(output, "effect-desktop.json"), "utf8"),
      )
    : null,
  profile =
    prior?.profile ||
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tugou-effect-"));
process.env.TUGOU_DATA_DIR = profile;
const report = { profile, checks: [], errors: [], platform: process.platform },
  finish = (code) => {
    fs.writeFileSync(
      path.join(
        output,
        restart ? "effect-restart.json" : "effect-desktop.json",
      ),
      JSON.stringify(report, null, 2),
    );
    app.exit(code);
  },
  timer = setTimeout(() => {
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
      },
      inject = () =>
        js(
          fs.readFileSync(path.join(output, "effect-engine-qa.js"), "utf8") +
            ";void 0;",
        );
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
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`,
      );
      await delay(100);
    };
    const input = async (label, value) => {
      await js(
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
      await delay(50);
      await js(
        `document.querySelector('input[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(100);
    };
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
        "document.querySelector('.layer-row button[title=\"特效样图\"]').click()",
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
        `(async()=>{const e=new fxQA.Compositor(),c=fxQA.surface(256,192);await e.render(${JSON.stringify(doc)},c,{transparent:true});const p=[...c.getContext('2d').getImageData(0,0,256,192).data];e.dispose();return p})()`,
      );
    try {
      await wait('document.querySelector(".studio-header")');
      await inject();
      if (restart) {
        report.id = prior.id;
        await reopen();
        const r = await save();
        check(
          "new process restores full effects and unknown data",
          JSON.stringify(r.document) === JSON.stringify(prior.document),
        );
        check(
          "new process restores exact effect pixels",
          JSON.stringify(await pixels(r.document)) ===
            JSON.stringify(prior.pixels),
        );
      } else {
        report.engine = await js("fxQA.verify()");
        report.checks.push(...report.engine.checks);
        if(process.env.TUGOU_EFFECT_SAMPLE){
          const dataUrl='data:image/png;base64,'+fs.readFileSync(process.env.TUGOU_EFFECT_SAMPLE).toString('base64');
          const sample=await js(`fxQA.sample(${JSON.stringify(dataUrl)})`);
          fs.writeFileSync(path.join(output,'effect-wedding-comparison.png'),Buffer.from(sample.bytes));delete sample.bytes;report.sample=sample;
          check('real wedding image retains every translucent alpha under inner effect',sample.alphaDiff===0&&sample.soft>0);
        }
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(`fxQA.fixture(${JSON.stringify(report.id)})`);
        await reopen();
        const types = await js(
          "Object.fromEntries(Object.entries(fxQA.types).map(([k,v])=>[k,v.label]))",
        );
        for (const [type, label] of Object.entries(types)) {
          await js(
            '[...document.querySelectorAll(".layer-menu")].find(m=>m.querySelector("summary").textContent==="特效").open=true',
          );
          await click(label);
          const r = await save();
          check(
            "top menu adds " + type,
            r.document.layers[0].effects.at(-1).type === type,
          );
        }
        let r = await save(),
          baseline = r.document,
          original = await pixels(r.document),
          lastId = r.document.layers[0].effects.at(-1).id;
        check(
          "six effects coexist without rasterizing source",
          r.document.layers[0].effects.length === 6 &&
            r.document.layers[0].kind === "shape" &&
            r.document.futureField.keep &&
            r.document.layers[0].futureLayer === "keep",
        );
        await input("特效强度", 35);
        r = await save();
        check(
          "effect strength commits",
          r.document.layers[0].effects.at(-1).opacity === 35,
        );
        await click("撤销");
        r = await save();
        check(
          "effect edit is one undo",
          JSON.stringify(r.document) === JSON.stringify(baseline),
        );
        await click("重做");
        await click("停用特效");
        r = await save();
        check(
          "disable retains editable effect and changes output",
          r.document.layers[0].effects.at(-1).enabled === false &&
            JSON.stringify(await pixels(r.document)) !==
              JSON.stringify(original),
        );
        await click("启用特效");
        await click("特效选项");
        await click("重置特效");
        r = await save();
        check(
          "reset keeps identity and restores defaults",
          r.document.layers[0].effects.at(-1).id === lastId &&
            r.document.layers[0].effects.at(-1).opacity === 100,
        );
        await click("撤销");
        r = await save();
        check(
          "reset is one undo",
          r.document.layers[0].effects.at(-1).opacity === 35,
        );
        await click("特效选项");
        await click("移除特效");
        r = await save();
        check(
          "remove keeps other effects",
          r.document.layers[0].effects.length === 5,
        );
        await click("撤销");
        r = await save();
        check(
          "remove is one undo",
          r.document.layers[0].effects.length === 6 &&
            r.document.layers[0].effects.at(-1).id === lastId,
        );
        await select("当前图层特效", r.document.layers[0].effects[0].id);
        await click("特效选项");
        await select("描边位置", "inside");
        await select("特效混合", "multiply");
        await click("特效选项");
        r = await save();
        check(
          "stroke position and blend remain editable",
          r.document.layers[0].effects[0].position === "inside" &&
            r.document.layers[0].effects[0].blend === "multiply",
        );
        await click("锁定 特效样图");
        check(
          "locked layer blocks effect parameters",
          await js(
            'document.querySelector("input[aria-label=特效强度]").matches(":disabled")',
          ),
        );
        await click("解锁 特效样图");
        window.setSize(960, 740);
        await delay(200);
        check(
          "effects toolbar fits 960px without horizontal overflow",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(".layer-parameter-row button,.layer-parameter-row input,.layer-parameter-row select")].every(e=>{const b=e.getBoundingClientRect();return !b.width||b.right<=innerWidth})',
          ),
        );
        check(
          "top tools and effect labels stay on single rows",
          await js(
            'document.querySelector("#canvas-actions").getBoundingClientRect().height<=40&&[...document.querySelectorAll(".layer-parameter-row label")].every(e=>e.getBoundingClientRect().height<=32)',
          ),
        );
        fs.writeFileSync(
          path.join(output, "effect-960.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        await click("完成");
        check(
          "done exits effect controls",
          await js(
            '!document.querySelector("select[aria-label=当前图层特效]")',
          ),
        );
        await js(
          "document.querySelector('.layer-row button[title=\"特效样图\"]').click()",
        );
        await delay(80);
        check(
          "reselect opens saved effect controls",
          await js(
            '!!document.querySelector("select[aria-label=当前图层特效]")',
          ),
        );
        r = await save();
        report.document = r.document;
        report.pixels = await pixels(r.document);
        const file = path.join(profile, "effects.png");
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
        await click("导出 PNG");
        for (let i = 0; i < 300 && !fs.existsSync(file); i++) await delay(30);
        check("PNG button writes effect output", fs.existsSync(file));
        const url =
            "data:image/png;base64," + fs.readFileSync(file).toString("base64"),
          exported = await js(
            `(async()=>{const img=new Image();img.src=${JSON.stringify(url)};await img.decode();const c=fxQA.surface(img.naturalWidth,img.naturalHeight),ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0);return [...ctx.getImageData(0,0,c.width,c.height).data]})()`,
          );
        let max = 0;
        for (let i = 0; i < exported.length; i++)
          max = Math.max(max, Math.abs(exported[i] - report.pixels[i]));
        report.exportMax = max;
        check("UI exported pixels match composition", max === 0);
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
