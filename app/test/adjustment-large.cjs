const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(output, "adjustment-large.json"), "utf8"),
      )
    : null;
process.env.TUGOU_DATA_DIR =
  prior?.profile ||
  fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "tugou-adjustment-large-"),
  );
const report = { profile: process.env.TUGOU_DATA_DIR, checks: [], errors: [] },
  finish = (code) => {
    fs.writeFileSync(
      path.join(
        output,
        restart ? "adjustment-large-restart.json" : "adjustment-large.json",
      ),
      JSON.stringify(report, null, 2),
    );
    app.exit(code);
  };
const timer = setTimeout(() => {
  report.failure = "Timed out";
  finish(1);
}, 180000);
app.on("browser-window-created", (_, window) => {
  window.webContents.on("console-message", (_, d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      check = (n, v) => {
        assert.ok(v, n);
        report.checks.push(n);
      };
    try {
      await js(
        fs.readFileSync(path.join(output, "adjustment-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      if (restart) {
        report.id = prior.id;
        report.result = prior.result;
        const r = await js(`tugou.open(${JSON.stringify(prior.id)})`);
        check(
          "100MP document restores exposure and original asset",
          r.document.layers[1].adjustment.exposure === 1 &&
            r.document.assets.length === 2,
        );
      } else Object.assign(report, await js("toneQA.large()"));
      report.sample = await js(
        `toneQA.largePixels(${JSON.stringify(report.result)})`,
      );
      check(
        "100MP adjusted PNG retains dimensions",
        report.sample.width === 10000 && report.sample.height === 10000,
      );
      check(
        "100MP corners and tile boundaries have expected colors",
        report.sample.pixels.every(
          (p) => JSON.stringify(p) === "[64,128,192,255]",
        ),
      );
      check("no renderer errors", report.errors.length === 0);
      report.memory = app
        .getAppMetrics()
        .map((p) => ({ type: p.type, memory: p.memory }));
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
