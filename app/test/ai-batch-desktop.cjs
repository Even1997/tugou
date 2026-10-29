const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const out = path.resolve(__dirname, "../test-results"),
  restart = process.argv.includes("--restart");
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(out, "ai-batch-desktop.json")))
  : null;
const profile =
  prior?.profile || fs.mkdtempSync(path.join(os.tmpdir(), "tugou-ai-batch-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(out, restart ? "ai-batch-restart.json" : "ai-batch-desktop.json"),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 180000);
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: ["D:/CanvasStudioRuntime"],
});
app.on("web-contents-created", (_, c) =>
  c.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  }),
);
app.on("browser-window-created", (_, w) => {
  w.show = () => {};
  w.focus = () => {};
  w.webContents.setBackgroundThrottling(false);
  w.webContents.once("did-finish-load", async () => {
    const js = (s) => w.webContents.executeJavaScript(s, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (name, v) => {
      assert.ok(v, name);
      report.checks.push(name);
    };
    const wait = async (s) => {
      for (let i = 0; i < 1200; i++) {
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
      await delay(45);
    };
    const reload = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`,
      );
      const ready = new Promise((r) =>
        w.webContents.once("did-finish-load", r),
      );
      w.webContents.reload();
      await ready;
      await wait('document.querySelector(".image-tools")');
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const tasks = () => js("tugou.tasks()");
    const done = async (id) => {
      for (let i = 0; i < 1800; i++) {
        const t = (await tasks()).find((t) => t.id === id);
        if (["completed", "failed", "cancelled"].includes(t.status)) return t;
        await delay(30);
      }
      throw Error("task timeout");
    };
    const batch = async () => {
      const count = (await tasks()).length;
      await click("批量处理");
      await js(
        "document.querySelector('input[aria-label=\"批量选择 B 色块\"]').click()",
      );
      await click("提交 2 张");
      for (let i = 0; i < 600; i++) {
        const list = await tasks();
        if (list.length > count) {
          await wait(
            "!document.querySelector('fieldset[aria-label=\"本地 AI 参数\"]').disabled",
          );
          return list.at(-1);
        }
        await delay(30);
      }
      throw Error(
        "submission failed: " +
          (await js(
            'document.querySelector(".message[role=status]")?.textContent',
          )),
      );
    };
    try {
      await js('console.error("ai-batch-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("ai-batch-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload();
        await delay(1400);
        const r = await save();
        check(
          "AI batch undo receipts survive new process",
          r.document.assets.length === 4 &&
            r.document.generationResultIds.includes(prior.retryId),
        );
        check(
          "original data and unknown fields survive",
          r.document.futureBatch.keep &&
            r.document.assets
              .slice(0, 2)
              .every((a, i) => a.resource === prior.sources[i].resource),
        );
        const list = await tasks();
        check(
          "no automatic model rerun",
          list.length === 3 &&
            list.filter((t) => t.status === "completed").length === 2 &&
            list.find((t) => t.id === prior.cancelId).status === "cancelled",
        );
        const results = await js(`tugou.results(${JSON.stringify(report.id)})`);
        check(
          "persisted AI result bytes unchanged",
          JSON.stringify(
            results.map((r) => r.assets.map((a) => a.resource)),
          ) === JSON.stringify(prior.resources),
        );
        check(
          "component configuration restored",
          (await js("tugou.localToolsStatus()")).configured,
        );
      } else {
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(
          fs.readFileSync(path.join(out, "geometry-engine-qa.js"), "utf8") +
            ";void 0;",
        );
        const a = await js(
          `tugou.storeRaster(${JSON.stringify([...fs.readFileSync(path.join(out, "local-ai-fixtures/small.png"))])},'A 人物')`,
        );
        const b = await js(
          `compositionQA.asset('B 色块',64,96,(ctx,c)=>{ctx.fillStyle='#4080c0';ctx.fillRect(0,0,c.width,c.height);ctx.clearRect(0,0,8,8)})`,
        );
        report.sources = [a, b];
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});return tugou.save(r.id,{...r.document,assets:${JSON.stringify([a, b])},futureBatch:{keep:true}},r.revision)})()`,
        );
        await reload();
        await select("处理方式", "upscale");
        await click("管理本地组件");
        await wait(
          '[...document.querySelectorAll("button")].some(b=>b.textContent==="选择组件目录"&&!b.disabled)',
        );
        await click("选择组件目录");
        await wait(
          'document.querySelector(".ant-modal-body").textContent.includes("超分：可用")',
        );
        await click("关闭本地组件");
        await select("超分模型", "anime");
        const first = await batch();
        report.firstId = first.id;
        await select("AI 超分倍率", "3");
        await click("提示词工作台");
        check(
          "native AI batch continues after leaving tools",
          ["running", "queued"].includes(
            (await tasks()).find((t) => t.id === first.id).status,
          ),
        );
        const firstDone = await done(first.id);
        report.firstTask = firstDone;
        check(
          "two actual native AI inputs complete",
          firstDone.status === "completed",
        );
        await delay(1400);
        let r = await save();
        check(
          "all results enter library without unsolicited canvas nodes",
          r.document.assets.length === 4 &&
            r.document.tugouCanvas.nodes.length === 0 &&
            r.document.futureBatch.keep,
        );
        check(
          "model and multiplier frozen at submission",
          r.document.assets
            .slice(-2)
            .every(
              (x) => x.toolResult.model === "anime" && x.toolResult.scale === 2,
            ),
        );
        check(
          "each result keeps actual input dimensions and identity",
          r.document.assets
            .slice(-2)
            .every(
              (x, i) =>
                x.width === [a, b][i].width * 2 &&
                x.height === [a, b][i].height * 2 &&
                x.toolResult.sourceId === [a, b][i].id,
            ),
        );
        report.firstOutputs = r.document.assets.slice(-2);
        await click("撤销");
        r = await save();
        check(
          "whole AI batch is one undo",
          r.document.assets.length === 2 &&
            r.document.generationResultIds.includes(first.id),
        );
        await click("重做");
        r = await save();
        check("redo restores whole batch", r.document.assets.length === 4);
        await click("图像工具");
        await select("处理方式", "upscale");
        await select("超分模型", "general");
        const folder = path.join(profile, "workspace/resources"),
          before = new Set(fs.readdirSync(folder)),
          cancel = await batch();
        report.cancelId = cancel.id;
        let staged = false;
        for (let i = 0; i < 1500; i++) {
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
        check("AI cancellation reaches a staged first result", staged);
        await click("取消本地任务");
        check(
          "AI batch cancellation persists",
          (await done(cancel.id)).status === "cancelled",
        );
        await delay(1400);
        r = await save();
        check(
          "partial AI batch never enters library",
          r.document.assets.length === 4,
        );
        await click("任务");
        await click("按原参数重试");
        let retry;
        for (let i = 0; i < 600; i++) {
          retry = (await tasks()).find(
            (t) => t.context.retriedFrom === cancel.id,
          );
          if (retry) break;
          await delay(30);
        }
        if (!retry) throw Error("retry did not queue");
        report.retryId = retry.id;
        check(
          "task panel retry links to original snapshot",
          retry.context.retriedFrom === cancel.id,
        );
        await click("关闭任务");
        const retryDone = await done(retry.id);
        report.retryTask = retryDone;
        check("native model retry completes", retryDone.status === "completed");
        await delay(1400);
        r = await save();
        check(
          "retry publishes exactly two frozen 4x results",
          r.document.assets.length === 6 &&
            r.document.assets
              .slice(-2)
              .every(
                (x) =>
                  x.toolResult.model === "general" && x.toolResult.scale === 4,
              ),
        );
        report.retryOutputs = r.document.assets.slice(-2);
        await click("撤销");
        r = await save();
        check(
          "retried AI batch undo retains receipt",
          r.document.assets.length === 4 &&
            r.document.generationResultIds.includes(retry.id),
        );
        report.resources = (
          await js(`tugou.results(${JSON.stringify(report.id)})`)
        ).map((r) => r.assets.map((a) => a.resource));
        for (
          let i = 0;
          i < 200 &&
          fs.readdirSync(path.join(profile, "workspace/local-jobs")).length;
          i++
        )
          await delay(25);
        check(
          "native temporary jobs cleaned after completion and cancellation",
          fs.readdirSync(path.join(profile, "workspace/local-jobs")).length ===
            0,
        );
        w.setSize(960, 720);
        await click("批量处理");
        await delay(100);
        await w.webContents.capturePage(undefined, { stayHidden: true });
        await delay(100);
        fs.writeFileSync(
          path.join(out, "ai-batch-dialog.png"),
          (
            await w.webContents.capturePage(undefined, { stayHidden: true })
          ).toPNG(),
        );
      }
      check("no runtime errors", report.errors.length === 0);
      check("QA window hidden", !w.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.tasks = await tasks();
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
