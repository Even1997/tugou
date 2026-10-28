const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "tugou-dialogs-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(output, "dialogs-isolated.json"),
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
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms)),
      check = (name, v) => {
        assert.ok(v, name);
        report.checks.push(name);
      };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(120);
    };
    const inspect = async (title) => {
      await delay(120);
      check(
        title + " uses fixed shared modal root",
        await js(
          `Boolean(document.querySelector('#dialogs .ant-modal-container'))`,
        ),
      );
      check(
        title + " fits viewport and is painted",
        await js(
          `(()=>{const e=document.querySelector('.ant-modal'),r=e.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&getComputedStyle(e).opacity==='1'})()`,
        ),
      );
      await click("关闭" + title);
    };
    try {
      await js('console.error("dialog-capture-check")');
      await delay(10);
      check(
        "CSP and console capture verified",
        report.errors.includes("dialog-capture-check"),
      );
      report.errors = [];
      await click("新建工程");
      await click("模型连接");
      await inspect("模型连接");
      await click("任务");
      await inspect("任务");
      await click("更多操作");
      await click("重命名工程");
      await inspect("重命名工程");
      await click("图像工具");
      await js(
        `{const e=document.querySelector('select[aria-label="处理方式"]');e.value='upscale';e.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      await delay(60);
      await click("本地组件");
      await inspect("本地组件");
      await click("切换浅色主题");
      window.setSize(960, 720);
      await delay(100);
      await click("本地组件");
      check(
        "modal receives pointer hits above workspace",
        await js(
          `(()=>{const e=document.querySelector('.ant-modal'),r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
        ),
      );
      // Hidden windows can retain the previous compositor frame; resize only this QA window.
      window.setSize(962, 722);
      await delay(200);
      window.setSize(960, 720);
      await delay(200);
      window.webContents.invalidate();
      await window.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      await delay(150);
      fs.writeFileSync(
        path.join(output, "composition-dialog-light.png"),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true })
        ).toPNG(),
      );
      await inspect("本地组件");
      check(
        "strict CSP retained without unsafe-inline",
        await js(
          `document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("style-src 'self' 'nonce-tugou-ui'")&&!document.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes('unsafe-inline')`,
        ),
      );
      check(
        "dialog transitions produce no CSP or renderer errors",
        report.errors.length === 0,
      );
      check("test window stays hidden", !window.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.dom = await js(
        `({text:document.body.textContent.slice(0,1500),dialog:document.getElementById('dialogs')?.innerHTML.slice(0,2000)})`,
      );
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
