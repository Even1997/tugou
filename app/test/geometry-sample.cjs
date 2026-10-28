const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "tugou-geometry-sample-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(output, "geometry-sample.json"),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 60000);
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
    try {
      await js('console.error("geometry-sample-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("geometry-sample-sentinel"),
      );
      report.errors = [];
      await js(
        fs.readFileSync(path.join(output, "geometry-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      const bytes = fs.readFileSync(
        "C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-139ecd3b-c85b-46fe-a373-5473a30fb0be.png",
      );
      const original = await js(
        `tugou.storeRaster(Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0)),'婚礼原图')`,
      );
      const r = await js(`geometryQA.wedding(${JSON.stringify(original)})`);
      report.result = r;
      for (const d of r.checks)
        check(
          d.operation + " wedding alpha color and outside pixels",
          d.alpha === 0 && d.premultiplied <= 1.01 && d.outside === 0,
        );
      fs.copyFileSync(
        path.join(profile, "workspace/resources", r.review.resource),
        path.join(output, "geometry-wedding.png"),
      );
      check(
        "original resource bytes unchanged",
        fs
          .readFileSync(
            path.join(profile, "workspace/resources", original.resource),
          )
          .equals(bytes),
      );
      check("no renderer errors", report.errors.length === 0);
      check("window remains hidden", !window.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
