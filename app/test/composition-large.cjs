const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  mode =
    process.argv.find((a) => a.startsWith("--mode="))?.split("=")[1] || "pair",
  restart = process.argv.includes("--restart");
const prior = restart
  ? JSON.parse(
      fs.readFileSync(path.join(output, `composition-${mode}-large.json`)),
    )
  : null;
const profile =
  prior?.profile ||
  fs.mkdtempSync(path.join(os.tmpdir(), "tugou-composition-large-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, mode, checks: [], errors: [] },
  peaks = new Map();
const finish = (code) => {
  report.memory = [...peaks.values()];
  fs.writeFileSync(
    path.join(
      output,
      `composition-${mode}-${restart ? "large-restart" : "large"}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 240000);
app.on("browser-window-created", (_, window) => {
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      check = (name, v) => {
        assert.ok(v, name);
        report.checks.push(name);
      };
    const sampler = setInterval(() => {
      for (const m of app.getAppMetrics()) {
        const old = peaks.get(m.pid);
        if (!old || m.memory.peakWorkingSetSize > old.peakKiB)
          peaks.set(m.pid, {
            pid: m.pid,
            type: m.type,
            peakKiB: m.memory.peakWorkingSetSize,
          });
      }
    }, 100);
    try {
      await js(
        fs.readFileSync(path.join(output, "composition-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      if (restart) {
        const r = await js(`tugou.open(${JSON.stringify(prior.id)})`);
        check(
          "100MP document and unknown fields restore",
          r.document.largeComposition.keep &&
            r.document.assets.length === prior.result.parts.length + 1,
        );
        const values = await js(
          `Promise.all(${JSON.stringify(prior.result.parts)}.map(a=>compositionQA.samplePixels(a)))`,
        );
        check(
          "all full-frame parts decode in a new process with identical sampled pixels",
          JSON.stringify(values) === JSON.stringify(prior.result.samples),
        );
      } else {
        const result = await js(`compositionQA.large(${JSON.stringify(mode)})`);
        report.result = result;
        check(
          "full 100MP output frames retained",
          result.parts.every((a) => a.width === 10000 && a.height === 10000),
        );
        if (mode === "pair")
          check(
            "100MP alpha and recovered colors exact at sample positions",
            result.samples[0].values.every(
              (p) =>
                p[3] === 128 &&
                p[0] === 64 &&
                p[1] === 128 &&
                Math.abs(p[2] - 191) <= 1,
            ),
          );
        if (mode === "texture") {
          const v = result.samples[0].values;
          check(
            "100MP exterior, empty alpha, center and feather samples correct",
            v[0][3] === 0 &&
              v[2].join() === "64,128,192,255" &&
              v[3].join() === "72,124,182,255" &&
              v[4].join() === "128,96,112,255",
          );
        }
        if (mode === "grid")
          check(
            "100MP grid assigns each sample to exactly one output",
            result.parts.length === 4 &&
              result.samples[0].points.every(([x, y], i) =>
                result.samples.every(
                  (s, j) =>
                    s.values[i].join() ===
                    (j === (y >= 5000 ? 2 : 0) + (x >= 5000 ? 1 : 0)
                      ? "64,128,192,255"
                      : "0,0,0,0"),
                ),
              ),
          );
        if (mode === "alpha")
          check(
            "100MP alpha islands retain main regions and a one-pixel remainder",
            result.parts.length === 3 &&
              result.samples[0].values[2].join() === "64,128,192,255" &&
              result.samples[1].values[5].join() === "64,128,192,255" &&
              result.samples[2].values[6][3] === 64,
          );
        check(
          "main renderer stays responsive during worker processing",
          result.beats > 0 && result.maxHeartbeatGap < 2000,
        );
        const r = await js(
          `(async()=>{const r=await tugou.create('100MP组合工具');return tugou.save(r.id,{...r.document,assets:${JSON.stringify([result.source, ...result.parts])},largeComposition:{keep:true}},r.revision)})()`,
        );
        report.id = r.id;
        check(
          "100MP results persisted without changing source",
          r.document.assets[0].resource === result.source.resource,
        );
      }
      check("window never shown", !window.isVisible());
      check("no renderer errors", report.errors.length === 0);
      clearInterval(sampler);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      clearInterval(sampler);
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
