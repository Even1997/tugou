const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart");
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(output, "composition-desktop.json")))
  : null;
const profile =
  prior?.profile ||
  fs.mkdtempSync(path.join(os.tmpdir(), "tugou-composition-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      output,
      restart ? "composition-restart.json" : "composition-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 180000);
app.on("web-contents-created", (_, contents) => {
  contents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
});
app.on("browser-window-created", (_, window) => {
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (name, v) => {
      assert.ok(v, name);
      report.checks.push(name);
    };
    const wait = async (code) => {
      for (let i = 0; i < 700; i++) {
        if (await js(`Boolean(${code})`)) return;
        await delay(30);
      }
      throw Error("timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(70);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`,
      );
      await delay(50);
    };
    const number = async (label, value) => {
      await js(
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
      await delay(30);
      await js(
        `document.querySelector('input[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(50);
    };
    const inject = () =>
      js(
        fs.readFileSync(path.join(output, "composition-engine-qa.js"), "utf8") +
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
    };
    try {
      await js('console.error("composition-qa-console-sentinel")');
      await delay(10);
      check(
        "console error capture is live",
        report.errors.includes("composition-qa-console-sentinel"),
      );
      report.errors = report.errors.filter(
        (s) => s !== "composition-qa-console-sentinel",
      );
      if (restart) {
        report.id = prior.id;
        await reload();
        const r = await js(`tugou.open(${JSON.stringify(report.id)})`);
        check(
          "all composition results and unknown fields survive new process",
          r.document.assets.length === 10 && r.document.compositionFuture.keep,
        );
        check(
          "saved image bytes and settings unchanged",
          JSON.stringify(r.document.assets.map((a) => a.resource)) ===
            JSON.stringify(prior.resources),
        );
        const split = r.document.assets.filter(
          (a) => a.toolResult?.operation === "split",
        );
        const reconstructed = await js(
          `compositionQA.reassemble(${JSON.stringify(r.document.assets.find((a) => a.id === split[0].toolResult.sourceId))},${JSON.stringify(split)})`,
        );
        check(
          "restored islands still reconstruct original visible pixels",
          reconstructed.alphaDiff === 0 && reconstructed.max <= 1,
        );
        await js(
          `[...document.querySelectorAll('.processing-item')].find(b=>b.textContent.includes('选区材质')).click()`,
        );
        await delay(80);
        check(
          "texture history restores secondary source and region",
          await js(
            `document.querySelector('select[aria-label="第二张素材"]').value===${JSON.stringify(prior.fixture.texture.id)}&&document.querySelector('svg.tool-region rect').getAttribute('x')==='10'`,
          ),
        );
        await run(6);
        const next = await save();
        check(
          "restored texture rerun reproduces identical PNG",
          next.document.assets.at(-1).resource === prior.textureResource,
        );
      } else {
        await inject();
        const fixture = await js("compositionQA.fixtures()");
        report.fixture = fixture;
        const engine = await js(
          `compositionQA.verify(${JSON.stringify(fixture)})`,
        );
        report.checks.push(...engine.checks);
        report.pixelMetrics = engine.metrics;
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,assets:${JSON.stringify(Object.values(fixture))},compositionFuture:{keep:true}},r.revision)})()`,
        );
        await reload();
        await select("处理方式", "mattePair");
        await select("第二张素材", fixture.texture.id);
        await click("开始处理");
        await wait(
          'document.querySelector(".message[role=status]").textContent.includes("尺寸必须相同")',
        );
        check(
          "invalid pair leaves project and library unchanged",
          await js('document.querySelectorAll(".processing-item").length===0'),
        );
        await select("第二张素材", fixture.white.id);
        await run(1);
        let r = await save();
        check(
          "paired result stores both image identities",
          r.document.assets.at(-1).toolResult.secondary.id ===
            fixture.white.id &&
            r.document.assets.at(-1).toolResult.source.id === fixture.black.id,
        );
        await select("处理来源", fixture.base.id);
        await select("处理方式", "texture");
        await select("第二张素材", fixture.texture.id);
        await number("强度", 50);
        const points = await js(
          `(()=>{const e=document.querySelector('svg.tool-region'),m=e.getScreenCTM();return [[10,9],[45,37]].map(([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(m);return {x:Math.round(p.x),y:Math.round(p.y)}})})()`,
        );
        window.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...points[0],
        });
        await delay(50);
        window.webContents.sendInputEvent({ type: "mouseMove", ...points[1] });
        await delay(50);
        window.webContents.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          ...points[1],
        });
        await delay(100);
        check(
          "pointer drag sets rectangle in original pixel coordinates",
          await js(
            `(()=>{const r=document.querySelector('svg.tool-region rect');return r.getAttribute('x')==='10'&&r.getAttribute('y')==='9'&&r.getAttribute('width')==='35'&&r.getAttribute('height')==='28'})()`,
          ),
        );
        await click("框选参数");
        await number("选区羽化", 3);
        await click("框选参数");
        await run(2);
        r = await save();
        report.textureResource = r.document.assets.at(-1).resource;
        check(
          "top rectangle controls and pointer share persisted settings",
          r.document.assets.at(-1).toolResult.left === 10 &&
            r.document.assets.at(-1).toolResult.feather === 3 &&
            r.document.assets.at(-1).toolResult.strength === 50,
        );
        window.setSize(960, 720);
        await delay(100);
        fs.writeFileSync(
          path.join(output, "composition-toolbar-960.png"),
          (
            await window.webContents.capturePage(undefined, {
              stayHidden: true,
            })
          ).toPNG(),
        );
        check(
          "composition controls fit 960px window",
          await js("document.documentElement.scrollWidth<=innerWidth"),
        );
        await select("处理来源", fixture.atlas.id);
        await select("处理方式", "split");
        await number("拆分最小面积", 4);
        await run(5);
        r = await save();
        const outputs = r.document.assets.filter(
          (a) => a.toolResult?.operation === "split",
        );
        check(
          "one split publishes a complete group of full-frame assets",
          outputs.length === 3 &&
            new Set(outputs.map((a) => a.toolResult.batchId)).size === 1 &&
            outputs.every((a) => a.width === 65 && a.height === 49),
        );
        await click("撤销");
        await wait('document.querySelectorAll(".processing-item").length===2');
        check(
          "whole split group is one undo",
          (await save()).document.assets.length === 7,
        );
        await click("重做");
        await wait('document.querySelectorAll(".processing-item").length===5');
        await save();
        await click("本组加入画面");
        r = await save();
        check(
          "group insertion aligns all layers at native coordinates",
          r.document.layers.length === 3 &&
            r.document.layers.every(
              (l) =>
                l.x === 0 && l.y === 0 && l.width === 65 && l.height === 49,
            ),
        );
        await click("撤销");
        r = await save();
        check("group insertion is one undo", r.document.layers.length === 0);
        await click("图像工具");
        await select("处理来源", fixture.black.id);
        await select("处理方式", "split");
        await select("拆分方式", "grid");
        await number("拆分行数", 8);
        await number("拆分列数", 8);
        const resourceFolder = path.join(profile, "workspace/resources"),
          before = fs.readdirSync(resourceFolder).length;
        await click("开始处理");
        let staged = false;
        for (let i = 0; i < 200; i++) {
          if (fs.readdirSync(resourceFolder).length > before) {
            staged = true;
            break;
          }
          await delay(10);
        }
        check("split cancellation test reaches staged output", staged);
        await click("取消本地任务");
        await wait(
          'document.querySelector(".message[role=status]").textContent.includes("已取消本地处理")',
        );
        await delay(150);
        r = await save();
        check(
          "cancel after staged output leaves no partial group in document",
          r.document.assets.length === 10 &&
            (await js(
              'document.querySelectorAll(".processing-item").length===5',
            )),
        );
        report.resources = r.document.assets.map((a) => a.resource);
        check(
          "original assets and unknown fields preserved",
          Object.values(fixture).every((a) =>
            r.document.assets.some(
              (b) => a.id === b.id && a.resource === b.resource,
            ),
          ) && r.document.compositionFuture.keep,
        );
      }
      check("test window never shown", !window.isVisible());
      check("no renderer errors", report.errors.length === 0);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      fs.writeFileSync(
        path.join(output, "composition-failure.png"),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true })
        ).toPNG(),
      );
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
