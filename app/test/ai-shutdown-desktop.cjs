const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const cancelledClose = process.argv.includes("--cancel-close"),
  prefix = cancelledClose ? "ai-cancel-close" : "ai-shutdown";
const out = path.resolve(__dirname, "../test-results"),
  restart = process.argv.includes("--restart");
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(out, `${prefix}-desktop.json`)))
  : null;
const profile =
  prior?.profile ||
  fs.mkdtempSync(path.join(os.tmpdir(), "tugou-ai-shutdown-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const childProcess = require("node:child_process"),
  launch = childProcess.spawn,
  children = [];
childProcess.spawn = (...args) => {
  const child = launch(...args);
  if (
    String(args[0]).replaceAll("\\", "/").startsWith("D:/CanvasStudioRuntime/")
  ) {
    const item = { child, closed: false };
    children.push(item);
    child.once("close", () => {
      item.closed = true;
    });
  }
  return child;
};
const cleaned = () =>
  children.length > 0 &&
  children.every((c) => c.closed) &&
  fs.readdirSync(path.join(profile, "workspace/local-jobs")).length === 0;
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      out,
      restart ? `${prefix}-restart.json` : `${prefix}-desktop.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
const check = (name, value) => {
  assert.ok(value, name);
  report.checks.push(name);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 120000);
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
    const tasks = () => js("tugou.tasks()");
    try {
      await js('console.error("shutdown-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("shutdown-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        let list = await tasks();
        check(
          "stopped batch status persists",
          list.length === 1 &&
            list[0].id === prior.taskId &&
            list[0].status === (cancelledClose ? "cancelled" : "interrupted"),
        );
        check("no automatic retry after restart", children.length === 0);
        check(
          "partial outputs are not published",
          (await js(`tugou.results(${JSON.stringify(prior.id)})`)).length === 0,
        );
        const saved = await js(`tugou.open(${JSON.stringify(prior.id)})`);
        check(
          "original project and unknown fields retained",
          saved.document.assets.length === 2 &&
            saved.document.shutdownFuture.keep,
        );
        await js(
          `tugou.save(${JSON.stringify(prior.id)},{...${JSON.stringify(saved.document)},assets:[]},${saved.revision})`,
        );
        const retry = await js(
          `tugou.retryImageTool(${JSON.stringify(prior.taskId)})`,
        );
        let completed;
        for (let i = 0; i < 1600; i++) {
          completed = (await tasks()).find((t) => t.id === retry.id);
          if (["failed", "completed", "cancelled"].includes(completed.status))
            break;
          await delay(20);
        }
        check(
          "manual retry succeeds after originals removed from project",
          completed.status === "completed" &&
            completed.context.retriedFrom === prior.taskId,
        );
        const results = await js(`tugou.results(${JSON.stringify(prior.id)})`);
        check(
          "only complete retried batch published",
          results.length === 1 &&
            results[0].assets.length === 2 &&
            results[0].assets.every(
              (a) =>
                a.toolResult.scale === 4 &&
                a.width === 1024 &&
                a.height === 1024,
            ),
        );
        await js(
          fs.readFileSync(path.join(out, "geometry-engine-qa.js"), "utf8") +
            ";void 0;",
        );
        const samples = await js(
          `Promise.all(${JSON.stringify(results[0].assets)}.map(a=>geometryQA.sample(a)))`,
        );
        check(
          "retried bytes preserve transparent pixels",
          samples.every((s) => s.values[0][3] === 0),
        );
        await delay(50);
        check(
          "retry native children exited and temporary files removed",
          cleaned(),
        );
        check("no runtime errors", report.errors.length === 0);
        check("QA window hidden", !w.isVisible());
        finish(0);
      } else {
        await js("tugou.configureLocalTools()");
        const record = await js('tugou.create("中断任务验收")');
        report.id = record.id;
        await js(
          fs.readFileSync(path.join(out, "geometry-engine-qa.js"), "utf8") +
            ";void 0;",
        );
        const assets = await js(
          `(async()=>{const a=[];for(const col of ['#4080c0','#c08040'])a.push(await compositionQA.asset(col,256,256,(ctx,c)=>{ctx.fillStyle=col;ctx.fillRect(0,0,c.width,c.height);ctx.clearRect(0,0,64,64)}));return a})()`,
        );
        const doc = {
          ...record.document,
          assets,
          shutdownFuture: { keep: true },
        };
        await js(
          `tugou.save(${JSON.stringify(record.id)},${JSON.stringify(doc)},${record.revision})`,
        );
        const folder = path.join(profile, "workspace/resources"),
          before = new Set(fs.readdirSync(folder));
        const task = await js(
          `tugou.startRasterTool(${JSON.stringify(record.id)},${JSON.stringify(doc)},${JSON.stringify(assets.map((a) => a.id))},{operation:'upscale',model:'general',scale:4})`,
        );
        report.taskId = task.id;
        let staged = false;
        for (let i = 0; i < 1600; i++) {
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
        check(
          "normal close begins after a partial output is staged",
          staged &&
            (await tasks()).find((t) => t.id === task.id).status === "running",
        );
        check("QA window hidden before close", !w.isVisible());
        for (let i = 0; i < 300 && !children.some((c) => !c.closed); i++)
          await delay(10);
        check(
          "native child is running when close begins",
          children.some((c) => !c.closed),
        );
        w.once("closed", () => {
          try {
            const list = JSON.parse(
              fs.readFileSync(path.join(profile, "workspace/tasks.json")),
            );
            check(
              "desktop close records interrupted or explicitly cancelled status",
              list.find((t) => t.id === task.id).status ===
                (cancelledClose ? "cancelled" : "interrupted"),
            );
            check(
              "normal close leaves no complete result journal",
              !fs.existsSync(
                path.join(profile, "workspace/results", task.id + ".json"),
              ),
            );
            check(
              "normal close waits for native child exit and temporary cleanup",
              cleaned(),
            );
            check(
              "no runtime errors during shutdown",
              report.errors.length === 0,
            );
            finish(0);
          } catch (e) {
            report.failure = e.stack;
            finish(1);
          }
        });
        if (cancelledClose)
          await js(`tugou.cancelTask(${JSON.stringify(task.id)})`);
        w.close();
      }
    } catch (e) {
      report.failure = e.stack;
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
