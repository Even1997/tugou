const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(output, "effect-large.json"), "utf8"),
      )
    : null;
process.env.TUGOU_DATA_DIR =
  prior?.profile ||
  fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "tugou-effect-large-"),
  );
const report = { profile: process.env.TUGOU_DATA_DIR, checks: [], errors: [] },
  finish = (code) => {
    fs.writeFileSync(
      path.join(
        output,
        restart ? "effect-large-restart.json" : "effect-large.json",
      ),
      JSON.stringify(report, null, 2),
    );
    app.exit(code);
  },
  timer = setTimeout(() => {
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
        fs.readFileSync(path.join(output, "effect-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      if (restart) {
        report.id = prior.id;
        report.result = prior.result;
        const r = await js(`tugou.open(${JSON.stringify(prior.id)})`);
        check(
          "100MP project restores all effects and original asset",
          r.document.layers[0].effects.length === 3 &&
            r.document.assets.length === 2,
        );
      } else Object.assign(report, await js("fxQA.large()"));
      report.sample = await js(
        `fxQA.largePixels(${JSON.stringify(report.result)})`,
      );
      const p = report.sample.pixels;
      check(
        "100MP PNG keeps full dimensions",
        report.sample.width === 10000 && report.sample.height === 10000,
      );
      check(
        "tile boundaries and far-edge interior preserve source color",
        p.slice(0, 3).every((v) => v.join() === "51,102,153,255"),
      );
      check(
        "far-edge stroke glow and untouched transparent area are correct",
        p[3][0] === 255 && p[3][1] === 0 && p[4][3] > 0 && p[5][3] === 0,
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
