const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  mode = process.argv.find((s) => s.startsWith("--mode="))?.slice(7) || "patch",
  restart = process.argv.includes("--restart");
const prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(output, `geometry-${mode}-large.json`)),
      )
    : null,
  profile =
    prior?.profile ||
    fs.mkdtempSync(path.join(os.tmpdir(), "tugou-geometry-large-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, mode, checks: [], errors: [] },
  peaks = new Map();
const finish = (code) => {
  report.memory = [...peaks.values()];
  fs.writeFileSync(
    path.join(
      output,
      `geometry-${mode}-large${restart ? "-restart" : ""}.json`,
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 180000);
app.on("browser-window-created", (_, window) => {
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (s) => window.webContents.executeJavaScript(s, true),
      check = (n, v) => {
        assert.ok(v, n);
        report.checks.push(n);
      };
    const sampler = setInterval(() => {
      for (const p of app.getAppMetrics()) {
        if ((peaks.get(p.pid)?.peakKiB || 0) < p.memory.peakWorkingSetSize)
          peaks.set(p.pid, {
            type: p.type,
            pid: p.pid,
            peakKiB: p.memory.peakWorkingSetSize,
          });
      }
    }, 100);
    try {
      await js('console.error("large-geometry-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("large-geometry-sentinel"),
      );
      report.errors = [];
      await js(
        fs.readFileSync(path.join(output, "geometry-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      if (restart) {
        report.id = prior.id;
        const r = await js(`tugou.open(${JSON.stringify(prior.id)})`);
        check(
          "large source and result resources survive new process",
          r.document.futureGeometry.keep &&
            JSON.stringify(r.document.assets.map((a) => a.resource)) ===
              JSON.stringify([
                prior.result.source.resource,
                prior.result.result.resource,
              ]),
        );
        check(
          "large output decodes with identical coordinate samples",
          JSON.stringify(
            await js(
              `geometryQA.sample(${JSON.stringify(prior.result.result)})`,
            ),
          ) === JSON.stringify(prior.result.sample),
        );
      } else {
        const r = await js(`geometryQA.large(${JSON.stringify(mode)})`);
        report.result = r;
        const size = mode === "crop" ? 9998 : 10000;
        check(
          "full output dimensions retained",
          r.result.width === size && r.result.height === size,
        );
        const values = r.sample.values;
        check("original transparent corner survives", values[0][3] === 0);
        if (mode === "patch")
          check(
            "replacement center and untouched region correct",
            values[2].join() === "64,128,192,255" &&
              values[4].join() === "224,32,64,255" &&
              values[5].join() === "64,128,192,255",
          );
        else if (mode === "extract")
          check(
            "extraction full-frame outside center and feather correct",
            values[2][3] === 0 &&
              values[3][3] === 32 &&
              values[4].join() === "64,128,192,255" &&
              values[5][3] === 0,
          );
        else
          check(
            "center pixels and final boundary correct",
            values[4].join() === "64,128,192,255" &&
              (mode === "extend"
                ? values[5][3] === 0
                : values[5].join() === "64,128,192,255"),
          );
        check(
          "renderer heartbeat during large worker",
          r.beats > 0 && r.maxHeartbeatGap < 2000,
        );
        const saved = await js(
          `(async()=>{const p=await tugou.create('大图尺寸区域');return tugou.save(p.id,{...p.document,assets:${JSON.stringify([r.source, r.result])},futureGeometry:{keep:true}},p.revision)})()`,
        );
        report.id = saved.id;
        check(
          "large result saves without replacing source",
          saved.document.assets[0].resource === r.source.resource,
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("test stays hidden", !window.isVisible());
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
