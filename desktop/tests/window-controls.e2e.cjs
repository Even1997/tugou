// Run against an isolated local frontend: STUDIO_DEV_URL=http://127.0.0.1:<port>.
// Uses the real main process, sandboxed preload and renderer window controls.
const { app, BrowserWindow, dialog } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");



if (!process.env.STUDIO_DEV_URL) throw new Error("Set STUDIO_DEV_URL to the isolated test frontend");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-window-test-"));
app.setPath("userData", temp);
app.disableHardwareAcceleration();
const evidence = path.resolve(__dirname, "../../docs/studio-evidence");
const results = [];
const captureFailures = [];
let closeChoice = 0;
let closePrompts = 0;
dialog.showMessageBoxSync = (_win, options) => {
  assert.equal(options.title, "还有未完成的保存或生成");
  closePrompts++;
  return closeChoice;
};
const waitFor = async (check, label) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
};
app.once("browser-window-created", (_event, win) => {
  win.webContents.once("did-finish-load", () => {
    void (async () => {
      const run = code => win.webContents.executeJavaScript(code, true);
      const button = label => `document.querySelector('button[aria-label="${label}"]')`;
      const click = label => run(`${button(label)}.click()`);
      const capture = async name => {
        try {
          fs.writeFileSync(path.join(evidence, name), (await win.webContents.capturePage()).toPNG());
        } catch (error) {
          captureFailures.push({ name, error: error.message });
        }
      };
      await waitFor(() => run(`Boolean(${button("关闭窗口")})`), "window controls");
      await waitFor(() => run(`document.body.innerText.includes("已保存")`), "project loaded");
      win.show();
      win.focus();
      await new Promise(resolve => setTimeout(resolve, 500));
      const regions = await run(`(() => {
        const header = document.querySelector('header');
        const close = document.querySelector('button[aria-label="关闭窗口"]');
        const rect = close.getBoundingClientRect();
        return { header: getComputedStyle(header).webkitAppRegion, button: getComputedStyle(close).webkitAppRegion,
          dragPoint: {x: 12, y: 20}, buttonPoint: {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2} };
      })()`);
      fs.writeFileSync(path.join(evidence, "frameless-regions.json"), JSON.stringify({ regions, bounds: win.getBounds(), contentBounds: win.getContentBounds() }, null, 2));
      await capture("frameless-dark.png");
      assert.equal(regions.header, "drag");
      assert.equal(regions.button, "no-drag");
      results.push("Header drag region and button no-drag styles verified");

      const [x, y] = win.getPosition();
      win.setPosition(x + 20, y + 20);
      assert.deepEqual(win.getPosition(), [x + 20, y + 20]);
      win.setPosition(x, y);
      results.push("Native window movement remains available");

      await click("最小化窗口");
      await waitFor(() => win.isMinimized(), "minimized");
      win.restore();
      await waitFor(() => !win.isMinimized(), "restored from taskbar");
      await click("最大化窗口");
      await waitFor(() => win.isMaximized(), "maximized");
      await waitFor(() => run(`Boolean(${button("还原窗口")})`), "restore icon");
      await click("还原窗口");
      await waitFor(() => !win.isMaximized(), "unmaximized");
      win.maximize();
      await waitFor(() => run(`Boolean(${button("还原窗口")})`), "external maximize event");
      win.unmaximize();
      await waitFor(() => run(`Boolean(${button("最大化窗口")})`), "external restore event");
      results.push("Minimize, restore, maximize buttons and external state updates passed");

      assert.equal(await run(`window.studioDesktop.windowAction("destroy").then(() => false, () => true)`), true);
      results.push("Unknown IPC action rejected");
      await click("切换主题");
      await new Promise(resolve => setTimeout(resolve, 1000));
      await capture("frameless-light.png");
      await click("切换主题");
      await new Promise(resolve => setTimeout(resolve, 1000));
      win.setSize(1100, 800);
      await new Promise(resolve => setTimeout(resolve, 250));
      const controls = await run(`(() => {
        const controls = document.querySelector('[aria-label="窗口控制"]').getBoundingClientRect();
        const nav = document.querySelector('nav[aria-label="工作区"]').getBoundingClientRect();
        return {width: innerWidth, right: controls.right, navTop: nav.top, controlsBottom: controls.bottom};
      })()`);
      assert.ok(controls.right <= controls.width);
      assert.ok(controls.navTop >= controls.controlsBottom);
      await capture("frameless-narrow.png");
      results.push("Narrow window wraps navigation below controls without overlap");

      await run(`window.addEventListener("beforeunload", event => { event.preventDefault(); event.returnValue = ""; });`);
      await click("关闭窗口");
      await waitFor(() => closePrompts === 1, "close guard");
      assert.equal(win.isDestroyed(), false);
      closeChoice = 1;
      await click("关闭窗口");
      await waitFor(() => win.isDestroyed(), "confirmed close");
      assert.equal(closePrompts, 2);
      results.push("Close honors beforeunload: cancel keeps window; confirm closes");
      fs.writeFileSync(path.join(evidence, "frameless-e2e.json"), JSON.stringify({ passed: true, results, regions, controls, captureFailures }, null, 2));
      console.log(JSON.stringify({ passed: true, results }));
      app.exit(0);
    })().catch(error => {
      console.error(error);
      fs.writeFileSync(path.join(evidence, "frameless-e2e.json"), JSON.stringify({ passed: false, results, error: error.message }, null, 2));
      for (const target of BrowserWindow.getAllWindows()) target.destroy();
      app.exit(1);
    });
  });
});
// Keep the test process alive long enough to record the final close result.
app.on("window-all-closed", () => {});
app.on("before-quit", event => event.preventDefault());
require("../main.cjs");
