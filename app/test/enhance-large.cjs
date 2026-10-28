const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  mode =
    process.argv.find((s) => s.startsWith("--mode="))?.slice(7) || "enhance",
  restart = process.argv.includes("--restart");
const prior = restart
    ? JSON.parse(fs.readFileSync(path.join(output, `${mode}-large.json`)))
    : null,
  profile =
    prior?.profile ||
    fs.mkdtempSync(path.join(os.tmpdir(), "tugou-enhance-large-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, mode, checks: [], errors: [] },
  peaks = new Map();
const finish = (code) => {
  report.memory = [...peaks.values()];
  fs.writeFileSync(
    path.join(output, `${mode}-large${restart ? "-restart" : ""}.json`),
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
      for (const p of app.getAppMetrics())
        if ((peaks.get(p.pid)?.peakKiB || 0) < p.memory.peakWorkingSetSize)
          peaks.set(p.pid, {
            type: p.type,
            pid: p.pid,
            peakKiB: p.memory.peakWorkingSetSize,
          });
    }, 100);
    try {
      await js('console.error("enhance-large-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("enhance-large-sentinel"),
      );
      report.errors = [];
      await js(
        fs.readFileSync(path.join(output, "enhance-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      if (restart) {
        const r = await js(`tugou.open(${JSON.stringify(prior.id)})`);
        report.id = prior.id;
        check(
          "large resources and unknown fields restore",
          r.document.futureEnhance.keep &&
            JSON.stringify(r.document.assets.map((a) => a.resource)) ===
              JSON.stringify([
                prior.result.source.resource,
                prior.result.result.resource,
              ]),
        );
        check(
          "new process samples exact persisted pixels",
          JSON.stringify(
            await js(
              `geometryQA.sample(${JSON.stringify(prior.result.result)})`,
            ),
          ) === JSON.stringify(prior.result.sample),
        );
      } else {
        const r = await js(`enhanceQA.large(${JSON.stringify(mode)})`);
        report.result = r;
        check(
          "full 100MP output retained",
          r.result.width === 10000 && r.result.height === 10000,
        );
        const v = r.sample.values;
        if (mode === "tile")
          check(
            "100MP repeated alpha and phase correct",
            v.every(
              (p, i) =>
                p.join() ===
                (r.sample.points[i][0] % 2 === 0 &&
                r.sample.points[i][1] % 2 === 0
                  ? "0,0,0,0"
                  : "64,128,192,255"),
            ),
          );
        else
          check(
            "100MP neutral exterior color interior and transparent corner correct",
            v[0][3] === 0 &&
              v[2].join() === "128,128,128,255" &&
              v[4].join() === "56,129,203,255" &&
              v[5].join() === "128,128,128,255",
          );
        check(
          "main renderer heartbeat while processing",
          r.beats > 0 && r.maxHeartbeatGap < 2000,
        );
        const saved = await js(
          `(async()=>{const p=await tugou.create('100MP质感平铺');return tugou.save(p.id,{...p.document,assets:${JSON.stringify([r.source, r.result])},futureEnhance:{keep:true}},p.revision)})()`,
        );
        report.id = saved.id;
        check(
          "result persists alongside original",
          saved.document.assets[0].resource === r.source.resource,
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("test window remains hidden", !window.isVisible());
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
