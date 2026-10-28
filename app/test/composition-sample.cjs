const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "tugou-composition-sample-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(output, "composition-sample.json"),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
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
    try {
      await js(
        fs.readFileSync(path.join(output, "composition-engine-qa.js"), "utf8") +
          ";void 0;",
      );
      const bytes = fs.readFileSync(
        "C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-139ecd3b-c85b-46fe-a373-5473a30fb0be.png",
      );
      // Store the exact supplied PNG, without changing the user's file.
      const original = await js(
        `tugou.storeRaster(Uint8Array.from(atob(${JSON.stringify(bytes.toString("base64"))}),c=>c.charCodeAt(0)),'婚礼人物')`,
      );
      const result = await js(
        `compositionQA.sample(${JSON.stringify(original)})`,
      );
      report.metrics = result;
      check(
        "wedding paired alpha differs by at most one level",
        result.alphaError <= 1,
      );
      check(
        "wedding premultiplied color reconstructed within 1.5 levels",
        result.colorError <= 1.5,
      );
      check(
        "wedding texture preserves all exterior pixels and alpha",
        result.outside === 0 && result.textureAlpha === 0,
      );
      fs.copyFileSync(
        path.join(profile, "workspace/resources", result.review.resource),
        path.join(output, "composition-wedding.png"),
      );
      check("test window never shown", !window.isVisible());
      check("no renderer errors", !report.errors.length);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
