const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart");
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(output, "geometry-desktop.json")))
  : null;
const profile =
  prior?.profile || fs.mkdtempSync(path.join(os.tmpdir(), "tugou-geometry-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      output,
      restart ? "geometry-restart.json" : "geometry-desktop.json",
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
      for (let i = 0; i < 500; i++) {
        if (await js(`Boolean(${s})`)) return;
        await delay(30);
      }
      throw Error("timeout " + s);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(70);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      await delay(70);
    };
    const number = async (label, value) => {
      await js(
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))}`,
      );
      await delay(30);
      await js(
        `document.querySelector('input[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(40);
    };
    const inject = () =>
      js(
        fs.readFileSync(path.join(output, "geometry-engine-qa.js"), "utf8") +
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
    try {
      await js('console.error("geometry-console-sentinel")');
      await delay(10);
      check(
        "console capture verified",
        report.errors.includes("geometry-console-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload();
        let r = await js(`tugou.open(${JSON.stringify(report.id)})`);
        check(
          "new process preserves all assets and unknown fields",
          r.document.assets.length === 7 && r.document.futureGeometry.keep,
        );
        check(
          "saved resources and tool parameters survive restart",
          JSON.stringify(r.document.assets) === JSON.stringify(prior.assets),
        );
        await js(
          `[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('选区替换')).click()`,
        );
        await delay(60);
        check(
          "history restores rectangle and replacement source",
          await js(
            `document.querySelector('svg.tool-region rect').getAttribute('x')==='10'&&document.querySelector('select[aria-label="第二张素材"]').value===${JSON.stringify(prior.fixture.secondary.id)}`,
          ),
        );
        r = await run(6);
        check(
          "manual patch rerun is byte-identical after restart",
          r.document.assets.at(-1).resource === prior.assets.at(-1).resource,
        );
        await js(
          `[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('分辨率调整')).click()`,
        );
        await delay(50);
        check(
          "history restores exact size mode and dimensions",
          await js(
            `document.querySelector('select[aria-label="尺寸方式"]').value==='size'&&document.querySelector('input[aria-label="输出宽度"]').value==='130'&&document.querySelector('input[aria-label="输出高度"]').value==='77'`,
          ),
        );
        await click("切换浅色主题");
        window.setSize(960, 720);
        await delay(100);
        check(
          "exact-size controls fit narrow light theme",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".image-tool-parameters").scrollWidth<=document.querySelector(".image-tool-parameters").clientWidth+1',
          ),
        );
        await window.webContents.capturePage(undefined, { stayHidden: true });
        await delay(120);
        fs.writeFileSync(
          path.join(output, "geometry-size-light.png"),
          (
            await window.webContents.capturePage(undefined, {
              stayHidden: true,
            })
          ).toPNG(),
        );
        await click("素材库");
        await js(
          "window.confirm=()=>true;document.querySelector('input[aria-label=\"选择 像素原图\"]').click()",
        );
        await delay(50);
        await click("移除 (1)");
        await save();
        await click("图像工具");
        await js(
          `[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('分辨率调整')).click()`,
        );
        await delay(60);
        check(
          "history exposes preserved original after library removal",
          await js(
            `document.querySelector('select[aria-label="处理来源"]').textContent.includes('历史原图')`,
          ),
        );
        r = await run(7);
        check(
          "historical original reruns without restoring removed library item",
          r.document.assets.length === 8 &&
            !r.document.assets.some((a) => a.id === prior.fixture.source.id) &&
            r.document.assets.at(-1).resource ===
              prior.assets.find((a) => a.toolResult?.operation === "resize")
                .resource,
        );
      } else {
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await inject();
        const engine = await js("geometryQA.verify()");
        report.engine = engine;
        report.fixture = engine.fixture;
        for (const r of engine.results)
          check(
            r.settings.operation +
              " worker matches full-frame sampling and scalar alpha reference " +
              r.width +
              "x" +
              r.height,
            r.alpha === 0 && r.premultiplied <= 1.01 && r.outside === 0,
          );
        check(
          "geometry worker cancellation rejects without result",
          engine.cancelled,
        );
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,assets:${JSON.stringify(Object.values(engine.fixture))},futureGeometry:{keep:true}},r.revision)})()`,
        );
        await reload();
        await select("尺寸方式", "size");
        await number("输出宽度", 130);
        check(
          "locked ratio follows original dimensions",
          await js(
            `document.querySelector('input[aria-label="输出高度"]').value==='98'`,
          ),
        );
        await js(
          `document.querySelector('input[aria-label="锁定原图比例"]').click()`,
        );
        await delay(40);
        await number("输出高度", 77);
        let r = await run(1);
        check(
          "exact independent dimensions enter shared library",
          r.document.assets.at(-1).width === 130 &&
            r.document.assets.at(-1).height === 77,
        );
        await click("撤销");
        await wait('document.querySelectorAll(".processing-item").length===0');
        check(
          "geometry result is a single undo",
          (await save()).document.assets.length === 2,
        );
        await click("重做");
        await wait('document.querySelectorAll(".processing-item").length===1');
        await select("处理方式", "extend");
        await select("尺寸方式", "size");
        await number("输出宽度", 81);
        await number("输出高度", 63);
        await click("原图位置");
        await number("原图左侧", 11);
        await number("原图顶部", 3);
        await click("原图位置");
        r = await run(2);
        let a = r.document.assets.at(-1);
        check(
          "exact extension size and offset saved",
          a.width === 81 &&
            a.height === 63 &&
            a.toolResult.left === 11 &&
            a.toolResult.top === 3,
        );
        let diff = await js(
          `geometryQA.compare(${JSON.stringify(engine.fixture.source)},${JSON.stringify(a)},${JSON.stringify(a.toolResult)})`,
        );
        check(
          "extension preserves all original pixels at offset",
          diff.alpha === 0 && diff.premultiplied <= 1,
        );
        await number("输出宽度", 65);
        await click("开始处理");
        await wait(
          'document.querySelector(".message[role=status]")?.textContent.includes("容纳")',
        );
        check(
          "invalid extension does not add a result",
          (await save()).document.assets.length === 4,
        );
        await select("处理方式", "crop");
        await wait('document.querySelector("svg.tool-region")');
        const coords = await js(
          `(()=>{const m=document.querySelector('svg.tool-region').getScreenCTM();return [[10,8],[45,36]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(m);return {x:Math.round(p.x),y:Math.round(p.y)}})})()`,
        );
        window.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...coords[0],
        });
        window.webContents.sendInputEvent({ type: "mouseMove", ...coords[1] });
        window.webContents.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          ...coords[1],
        });
        await delay(80);
        check(
          "pointer drag selects original-pixel crop rectangle",
          await js(
            `document.querySelector('svg.tool-region rect').getAttribute('x')==='10'&&document.querySelector('svg.tool-region rect').getAttribute('width')==='35'`,
          ),
        );
        r = await run(3);
        a = r.document.assets.at(-1);
        check(
          "crop reduces canvas to selection dimensions",
          a.width === 35 && a.height === 28,
        );
        for (const [op, count] of [
          ["extract", 4],
          ["patch", 5],
        ]) {
          await select("处理方式", op);
          if (op === "patch")
            await select("第二张素材", engine.fixture.secondary.id);
          await click("框选参数");
          await number("选区左侧", 10);
          await number("选区顶部", 8);
          await number("选区宽度", 35);
          await number("选区高度", 28);
          await number("选区羽化", 4);
          await click("框选参数");
          r = await run(count);
          a = r.document.assets.at(-1);
          diff = await js(
            `geometryQA.compare(${JSON.stringify(engine.fixture.source)},${JSON.stringify(a)},${JSON.stringify(a.toolResult)},${JSON.stringify(engine.fixture.secondary)})`,
          );
          check(
            op + " UI output preserves frame and matches pixels",
            a.width === 65 &&
              a.height === 49 &&
              diff.alpha === 0 &&
              diff.premultiplied <= 1.01 &&
              diff.outside === 0,
          );
        }
        await click("加入画面");
        r = await save();
        check(
          "region output inserts at original dimensions",
          r.document.layers.length === 1 &&
            r.document.layers[0].width === 65 &&
            r.document.layers[0].height === 49,
        );
        await click("撤销");
        r = await save();
        check(
          "layer insertion undoes without deleting asset",
          r.document.layers.length === 0 && r.document.assets.length === 7,
        );
        await click("图像工具");
        await js(
          `[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('选区替换')).click()`,
        );
        await delay(50);
        window.setSize(960, 720);
        await delay(100);
        check(
          "960px toolbars fit without horizontal overflow",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll(".image-tools-toolbar,.image-tool-parameters")].every(e=>e.scrollWidth<=e.clientWidth+1)',
          ),
        );
        await window.webContents.capturePage(undefined, { stayHidden: true });
        await delay(100);
        fs.writeFileSync(
          path.join(output, "geometry-toolbar-960.png"),
          (
            await window.webContents.capturePage(undefined, {
              stayHidden: true,
            })
          ).toPNG(),
        );
        report.assets = (await save()).document.assets;
        check(
          "sources and unknown fields retained",
          report.assets[0].resource === engine.fixture.source.resource &&
            report.assets[1].resource === engine.fixture.secondary.resource &&
            (await save()).document.futureGeometry.keep,
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("test window remains hidden", !window.isVisible());
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
