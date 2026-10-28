const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(fs.readFileSync(path.join(output, "enhance-desktop.json")))
    : null;
const profile =
  prior?.profile || fs.mkdtempSync(path.join(os.tmpdir(), "tugou-enhance-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      output,
      restart ? "enhance-restart.json" : "enhance-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 120000);
app.on("browser-window-created", (_, window) => {
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (s) => window.webContents.executeJavaScript(s, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms)),
      check = (n, v) => {
        assert.ok(v, n);
        report.checks.push(n);
      };
    const wait = async (s) => {
      for (let i = 0; i < 600; i++) {
        if (await js(`Boolean(${s})`)) return;
        await delay(30);
      }
      throw Error("timeout " + s);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(60);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      await delay(50);
    };
    const number = async (label, value) => {
      await js(
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))}`,
      );
      await delay(25);
      await js(
        `document.querySelector('input[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(35);
    };
    const inject = () =>
      js(
        fs.readFileSync(path.join(output, "enhance-engine-qa.js"), "utf8") +
          ";void 0;",
      );
    const reload = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`,
      );
      const ready = new Promise((r) =>
        window.webContents.once("did-finish-load", r),
      );
      window.webContents.reload();
      await ready;
      await wait('document.querySelector(".image-tools")');
      await inject();
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const run = async (count) => {
      await click("开始处理");
      await wait(
        `document.querySelectorAll('.processing-item').length===${count}`,
      );
      await wait(
        '[...document.querySelectorAll("button")].some(b=>b.textContent==="开始处理"&&!b.disabled)',
      );
      return save();
    };
    const capture = async (name) => {
      window.setSize(962, 722);
      await delay(80);
      window.setSize(960, 720);
      await delay(80);
      await window.webContents.capturePage(undefined, { stayHidden: true });
      await delay(100);
      fs.writeFileSync(
        path.join(output, name),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true })
        ).toPNG(),
      );
    };
    try {
      await js('console.error("enhance-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("enhance-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload();
        let r = await js(`tugou.open(${JSON.stringify(report.id)})`);
        check(
          "new process preserves source results and unknown fields",
          r.document.futureEnhance.keep &&
            JSON.stringify(r.document.assets) === JSON.stringify(prior.assets),
        );
        await js(
          `[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('质感调整')).click()`,
        );
        await delay(60);
        check(
          "history restores enhancement strength",
          await js(
            `document.querySelector('input[aria-label="质感强度"]').value==='65'`,
          ),
        );
        r = await run(3);
        check(
          "enhancement reruns to identical PNG",
          r.document.assets.at(-1).resource === prior.assets[1].resource,
        );
        await js(
          `[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('图片平铺')).click()`,
        );
        await delay(60);
        check(
          "history restores tile dimensions",
          await js(
            `document.querySelector('input[aria-label="输出宽度"]').value==='1037'&&document.querySelector('input[aria-label="输出高度"]').value==='1531'`,
          ),
        );
        r = await run(4);
        check(
          "tile reruns to identical PNG",
          r.document.assets.at(-1).resource === prior.assets[2].resource,
        );
      } else {
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await inject();
        const v = await js("enhanceQA.verify()");
        report.engine = v;
        for (const r of v.results)
          check(
            r.settings.operation +
              " alpha and reference pixels " +
              r.width +
              "x" +
              r.height,
            r.alpha === 0 && r.premultiplied <= 1.01,
          );
        check(
          "zero strength is an exact decoded no-op",
          v.results[0].changed === 0,
        );
        check(
          "enhancement changes visible detail",
          v.results[1].changed > 0 && v.results[2].changed > 0,
        );
        check("enhancement worker aborts without output", v.cancelled);
        const bytes = fs.readFileSync(
          "C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-139ecd3b-c85b-46fe-a373-5473a30fb0be.png",
        );
        const source = await js(
          `tugou.storeRaster(Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0)),'婚礼人物')`,
        );
        report.source = source;
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,assets:[${JSON.stringify(source)}],futureEnhance:{keep:true}},r.revision)})()`,
        );
        await reload();
        await select("处理方式", "enhance");
        await number("质感强度", 100);
        await click("重置参数");
        check(
          "enhancement reset restores default strength",
          await js(
            `document.querySelector('input[aria-label="质感强度"]').value==='50'`,
          ),
        );
        await number("质感强度", 65);
        let r = await run(1),
          a = r.document.assets.at(-1),
          d = await js(
            `enhanceQA.compare(${JSON.stringify(source)},${JSON.stringify(a)},${JSON.stringify(a.toolResult)})`,
          );
        report.wedding = d;
        check(
          "wedding enhancement preserves every alpha value and matches reference",
          d.alpha === 0 && d.premultiplied <= 1.01 && d.changed > 0,
        );
        await click("撤销");
        await wait('document.querySelectorAll(".processing-item").length===0');
        check(
          "enhancement result is one undo",
          (await save()).document.assets.length === 1,
        );
        await click("重做");
        await wait('document.querySelectorAll(".processing-item").length===1');
        await capture("enhance-wedding-dark.png");
        check(
          "enhance toolbar fits 960px",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".image-tool-parameters").scrollWidth<=document.querySelector(".image-tool-parameters").clientWidth+1',
          ),
        );
        await select("处理方式", "tile");
        await number("输出宽度", 1037);
        await number("输出高度", 1531);
        r = await run(2);
        a = r.document.assets.at(-1);
        d = await js(
          `enhanceQA.compare(${JSON.stringify(source)},${JSON.stringify(a)},${JSON.stringify(a.toolResult)})`,
        );
        check(
          "wedding tiles retain exact pixel phase and alpha at clipped last row and column",
          a.width === 1037 &&
            a.height === 1531 &&
            d.alpha === 0 &&
            d.premultiplied <= 1.01,
        );
        await click("切换浅色主题");
        await capture("tile-wedding-light.png");
        check(
          "tile toolbar fits narrow light theme",
          await js("document.documentElement.scrollWidth<=innerWidth"),
        );
        await click("加入画面");
        r = await save();
        check(
          "tile output enters editable layer at full size",
          r.document.layers.length === 1 &&
            r.document.layers[0].width === 1037 &&
            r.document.layers[0].height === 1531,
        );
        await click("撤销");
        r = await save();
        check(
          "layer insertion undo retains tool result",
          r.document.layers.length === 0 && r.document.assets.length === 3,
        );
        report.assets = r.document.assets;
        check(
          "original bytes and unknown fields preserved",
          report.assets[0].resource === source.resource &&
            r.document.futureEnhance.keep &&
            fs
              .readFileSync(
                path.join(profile, "workspace/resources", source.resource),
              )
              .equals(bytes),
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("test remains hidden", !window.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.status = await js(
        'document.querySelector(".message[role=status]")?.textContent',
      );
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
