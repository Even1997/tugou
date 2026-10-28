const { app, webContents } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const out = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(fs.readFileSync(path.join(out, "raster-tasks-desktop.json")))
    : null,
  profile =
    prior?.profile ||
    fs.mkdtempSync(path.join(os.tmpdir(), "tugou-raster-tasks-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [], windows: 0 };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      out,
      restart ? "raster-tasks-restart.json" : "raster-tasks-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 240000);
app.on("web-contents-created", (_, c) => {
  c.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
});
app.on("browser-window-created", (_, window) => {
  report.windows++;
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once("did-finish-load", async () => {
    const js = (s) => window.webContents.executeJavaScript(s, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms)),
      check = (n, v) => {
        assert.ok(v, n);
        report.checks.push(n);
      };
    const wait = async (s) => {
      for (let i = 0; i < 900; i++) {
        if (await js(`(async()=>Boolean(await (${s})))()`)) return;
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
      await delay(60);
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
        fs.readFileSync(path.join(out, "geometry-engine-qa.js"), "utf8") +
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
    const task = async (id) =>
      (await js("tugou.tasks()")).find((t) => t.id === id);
    const done = async (id) => {
      for (let i = 0; i < 1200; i++) {
        const t = await task(id);
        if (
          ["completed", "cancelled", "failed", "interrupted"].includes(t.status)
        )
          return t;
        await delay(30);
      }
      throw Error("task timeout " + id);
    };
    try {
      await js('console.error("raster-task-sentinel")');
      check(
        "all renderer console capture verified",
        report.errors.includes("raster-task-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload();
        let r = await js(`tugou.open(${JSON.stringify(report.id)})`);
        check(
          "new process restores saved project and unknown fields",
          r.document.futureRaster.keep &&
            r.document.assets.length === prior.savedCount,
        );
        await delay(1500);
        r = await save();
        check(
          "undo receipts survive restart without reinserting complete batch",
          r.document.assets.length === prior.savedCount,
        );
        const tasks = await js("tugou.tasks()");
        check(
          "cancelled batch remains cancelled after restart",
          tasks.find((t) => t.id === prior.cancelId).status === "cancelled",
        );
        check(
          "complete task journals remain available without re-execution",
          tasks.length === prior.taskCount &&
            tasks.filter((t) => t.status === "completed").length ===
              prior.completedCount,
        );
        const result = await js(`tugou.results(${JSON.stringify(report.id)})`);
        check(
          "all durable result resources unchanged",
          JSON.stringify(result.map((r) => r.assets.map((a) => a.resource))) ===
            JSON.stringify(prior.resources),
        );
      } else {
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await inject();
        const sources = await js(
          `(async()=>{const r=[];for(const [name,col]of [['批量 A','#4080c0'],['批量 B','#c08040']])r.push(await compositionQA.asset(name,4096,4096,(ctx,c)=>{ctx.fillStyle=col;ctx.fillRect(0,0,c.width,c.height);ctx.clearRect(0,0,64,64)}));return r})()`,
        );
        report.sources = sources;
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,assets:${JSON.stringify(sources)},futureRaster:{keep:true}},r.revision)})()`,
        );
        await reload();
        await select("处理方式", "enhance");
        await number("质感强度", 100);
        await click("批量处理");
        await js(
          `document.querySelector('input[aria-label="批量选择 批量 B"]').click()`,
        );
        await delay(50);
        window.setSize(960, 720);
        await delay(100);
        await window.webContents.capturePage(undefined, { stayHidden: true });
        await delay(100);
        fs.writeFileSync(
          path.join(out, "raster-batch-dialog.png"),
          (
            await window.webContents.capturePage(undefined, {
              stayHidden: true,
            })
          ).toPNG(),
        );
        check(
          "batch dialog uses shared components and two selected sources",
          await js(
            `document.querySelectorAll('.batch-assets input:checked').length===2&&Boolean(document.querySelector('#dialogs .ant-modal'))`,
          ),
        );
        await click("提交 2 张");
        await wait('(await tugou.tasks()).length > 0');
        const first = (await js("tugou.tasks()")).at(-1);
        report.firstId = first.id;
        await wait(
          'window.tugou && document.querySelector(".image-tool-parameters")',
        );
        await number("质感强度", 0);
        await click("提示词工作台");
        check(
          "batch remains running after leaving tool page",
          (await task(first.id)).status === "running",
        );
        check(
          "compute host has no extra native window",
          report.windows === 1 &&
            webContents
              .getAllWebContents()
              .some(
                (c) =>
                  c.id !== window.webContents.id &&
                  c.getURL().endsWith("/tool-host.html"),
              ),
        );
        check(
          "editor cannot access private worker bridge",
          await js('typeof window.toolHost==="undefined"'),
        );
        check(
          "batch completes in background",
          (await done(first.id)).status === "completed",
        );
        await wait(
          'document.querySelector(".statusbar [role=status]").textContent!=="正在保存"',
        );
        await delay(1400);
        let r = await save();
        check(
          "whole batch enters library and preserves unrelated document data",
          r.document.assets.length === 4 &&
            r.document.futureRaster.keep &&
            r.document.tugouCanvas.nodes.length === 0,
        );
        check(
          "submission freezes parameters before further edits",
          r.document.assets
            .slice(2)
            .every(
              (a) =>
                a.toolResult.strength === 100 &&
                a.toolResult.taskId === first.id,
            ),
        );
        const samples = await js(
          `Promise.all(${JSON.stringify(r.document.assets.slice(2))}.map(a=>geometryQA.sample(a)))`,
        );
        check(
          "background worker output preserves alpha and actual effect",
          samples[0].values[0][3] === 0 &&
            samples[0].values[2].join() === "56,129,203,255",
        );
        await click("撤销");
        r = await save();
        check(
          "whole batch is one undo",
          r.document.assets.length === 2 &&
            r.document.generationResultIds.includes(first.id),
        );
        await click("重做");
        r = await save();
        check("redo restores both outputs", r.document.assets.length === 4);
        await click("新建工程");
        const other = { id: await js('document.querySelector("select[aria-label=当前工程]").value') };
        check("second project created through UI", other.id !== report.id);
        report.otherId = other.id;
        await select("当前工程", report.id);
        r = await save();
        const cross = await js(
          `tugou.startRasterTool(${JSON.stringify(report.id)},${JSON.stringify(r.document)},${JSON.stringify(sources.map((a) => a.id))},{operation:'enhance',strength:50})`,
        );
        report.crossId = cross.id;
        await select("当前工程", other.id);
        check("other project is actually selected", await js(`document.querySelector('select[aria-label=当前工程]').value===${JSON.stringify(other.id)}`));
        check(
          "cross-project task is still active",
          (await task(cross.id)).status === "running",
        );
        check(
          "cross-project batch completes",
          (await done(cross.id)).status === "completed",
        );
        await delay(1400);
        check(
          "background results never enter wrong project",
          (await js(`tugou.open(${JSON.stringify(other.id)})`)).document.assets
            .length === 0,
        );
        await select("当前工程", report.id);
        await delay(1400);
        r = await save();
        check(
          "returning to owning project receives complete results",
          r.document.assets.length === 6,
        );
        // Cancel only after the first output file has been staged, while the second input remains active.
        const folder = path.join(profile, "workspace/resources"),
          before = new Set(fs.readdirSync(folder));
        await click("图像工具");
        await select("处理来源", sources[0].id);
        await select("处理方式", "enhance");
        await number("质感强度", 75);
        await click("批量处理");
        await js(`document.querySelector('input[aria-label="批量选择 批量 B"]').click()`);
        const beforeCancel = (await js("tugou.tasks()")).length;
        await click("提交 2 张");
        await wait(`(async()=> (await tugou.tasks()).length>${beforeCancel})()`);
        const cancel = (await js("tugou.tasks()")).at(-1);
        report.cancelId = cancel.id;
        let staged = false;
        for (let i = 0; i < 500; i++) {
          if (
            fs
              .readdirSync(folder)
              .some((n) => !before.has(n) && n.endsWith(".png"))
          ) {
            staged = true;
            break;
          }
          await delay(10);
        }
        check("cancellation reaches staged first result", staged);
        await wait(
          '[...document.querySelectorAll("button")].some(b=>b.textContent==="取消本地任务")',
        );
        await click("取消本地任务");
        check(
          "active batch cancellation persists",
          (await done(cancel.id)).status === "cancelled",
        );
        await delay(1400);
        r = await save();
        check(
          "cancelled partial batch never enters library",
          r.document.assets.length === 6,
        );
        await click("任务");
        await click("按原参数重试");
        await wait(`(async()=> (await tugou.tasks()).at(-1).id!==${JSON.stringify(cancel.id)})()`);
        const retry = (await js("tugou.tasks()")).at(-1);
        check(
          "retry links to immutable cancelled task",
          retry.context.retriedFrom === cancel.id,
        );
        await click("关闭任务");
        await select("处理来源", sources[1].id);
        check(
          "retry completes from same snapshot",
          (await done(retry.id)).status === "completed",
        );
        await delay(1400);
        r = await save();
        check(
          "retry publishes exactly one complete new batch",
          r.document.assets.length === 8 &&
            r.document.assets
              .slice(-2)
              .every((a) => a.toolResult.strength === 75),
        );
        check("batch preview follows selected second source", await js(`document.querySelector('img[alt="处理结果"]').src.endsWith(${JSON.stringify(r.document.assets.at(-1).resource)})`));
        await click("撤销");
        r = await save();
        check(
          "retry undo keeps its receipt and no duplicate results",
          r.document.assets.length === 6 &&
            r.document.generationResultIds.includes(retry.id),
        );
        report.savedCount = r.document.assets.length;
        const tasks = await js("tugou.tasks()");
        report.taskCount = tasks.length;
        report.completedCount = tasks.filter(
          (t) => t.status === "completed",
        ).length;
        report.resources = (
          await js(`tugou.results(${JSON.stringify(report.id)})`)
        ).map((r) => r.assets.map((a) => a.resource));
        await delay(100);
        check(
          "detached computation hosts are released",
          webContents
            .getAllWebContents()
            .filter((c) => c.getURL().endsWith("/tool-host.html")).length === 0,
        );
      }
      check("no errors in editor or compute host", report.errors.length === 0);
      check("test window remains hidden", !window.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.tasks = await js("tugou.tasks()");
      report.status = await js(
        'document.querySelector(".message[role=status]")?.textContent',
      );
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
