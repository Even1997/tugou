const { app, dialog } = require("electron");
const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(__dirname, "../test-results"),
  restart = process.argv.includes("--restart");
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(output, "local-ai-desktop.json")))
  : null;
const profile =
  prior?.profile || fs.mkdtempSync(path.join(os.tmpdir(), "tugou-ai-desktop-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR = path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      output,
      restart ? "local-ai-desktop-restart.json" : "local-ai-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 150000);
dialog.showOpenDialog = async () => ({
  canceled: false,
  filePaths: ["D:/CanvasStudioRuntime"],
});
app.on("browser-window-created", (_, window) => {
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (name, v) => {
      assert.ok(v, name);
      report.checks.push(name);
    };
    const wait = async (code) => {
      for (let i = 0; i < 600; i++) {
        if (await js(`Boolean(${code})`)) return;
        await delay(50);
      }
      throw Error("timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(90);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`,
      );
      await delay(50);
    };
    const reload = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`,
      );
      const ready = new Promise((r) =>
        window.webContents.once("did-finish-load", r),
      );
      window.webContents.reload();
      await ready;
      await wait('document.querySelector(".image-tools")');
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    try {
      if (restart) {
        report.id = prior.id;
        await reload();
        await delay(1700);
        let r = await js(`tugou.open(${JSON.stringify(report.id)})`);
        check(
          "undo receipt persists across a new process without reinserting output",
          r.document.assets.length === 1 &&
            r.document.generationResultIds.length === 1 &&
            (await js(
              'document.querySelectorAll(".processing-item").length===0',
            )),
        );
        const status = await js("tugou.localToolsStatus()");
        check(
          "local component settings survive new process",
          status.configured && status.cutout && status.models.length === 3,
        );
        check(
          "source and unknown data survive",
          r.document.assets[0].resource === prior.sourceResource &&
            r.document.futureLocalAI.keep === true,
        );
        await select("处理方式", "upscale");
        await select("超分模型", "anime");
        await click("开始处理");
        await wait('document.querySelectorAll(".processing-item").length===1');
        r = await save();
        check(
          "manual new task reproduces actual native result after restart",
          r.document.assets.at(-1).resource === prior.resultResource,
        );
        await select("处理方式", "cutout");
        await click("开始处理");
        await wait(
          '[...document.querySelectorAll("button")].some(b=>b.textContent==="取消本地任务")',
        );
        await click("取消本地任务");
        await wait(
          'document.querySelector(".message[role=status]").textContent.includes("已取消本地处理")',
        );
        check(
          "cutout cancellation exposed in unified toolbar",
          (await js("tugou.tasks()")).at(-1).status === "cancelled",
        );
        await delay(300);
        await click("开始处理");
        await wait('document.querySelectorAll(".processing-item").length===2');
        r = await save();
        check(
          "manual retry from same toolbar produces cutout",
          r.document.assets.at(-1).toolResult.operation === "cutout",
        );
        check(
          "cancelled task never inserts a late result",
          r.document.assets.length === 3,
        );
        await click("任务");
        check(
          "task panel identifies completed and cancelled local work",
          await js(
            'document.querySelector(".task-dialog").textContent.includes("已取消") && document.querySelector(".task-dialog").textContent.includes("已入库")',
          ),
        );
        await click("关闭任务");
        const originalId = r.document.assets[0].id;
        await click("素材库");
        await js(
          `window.confirm=()=>true;document.querySelector('input[aria-label="选择 透明人物"]').click()`,
        );
        await delay(80);
        await click("移除 (1)");
        await save();
        await click("图像工具");
        await js(`document.querySelector('.processing-item').click()`);
        await delay(100);
        check(
          "history retains readable original after library removal",
          await js(
            `document.querySelector('select[aria-label="处理来源"]').textContent.includes('历史原图') && document.querySelector('img[alt="处理原图"]').complete`,
          ),
        );
        await click("开始处理");
        await wait('document.querySelectorAll(".processing-item").length===3');
        r = await save();
        check(
          "history snapshot can rerun without restoring removed library entry",
          r.document.assets.length === 3 &&
            !r.document.assets.some((a) => a.id === originalId) &&
            r.document.assets.at(-1).toolResult.source.id === originalId,
        );
      } else {
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        const bytes = [
          ...fs.readFileSync(path.join(output, "local-ai-fixtures/small.png")),
        ];
        const asset = await js(
          `tugou.storeRaster(${JSON.stringify(bytes)},'透明人物')`,
        );
        report.sourceResource = asset.resource;
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,assets:[${JSON.stringify(asset)}],futureLocalAI:{keep:true}},r.revision)})()`,
        );
        await reload();
        await select("处理方式", "upscale");
        await click("开始处理");
        await wait(
          'document.querySelector(".message[role=status]").textContent.includes("请先选择本地组件")',
        );
        check(
          "missing local runtime produces actionable error without a task",
          (await js("tugou.tasks()")).length === 0,
        );
        await click("管理本地组件");
        await wait(
          '[...document.querySelectorAll("button")].some(b=>b.textContent==="选择组件目录"&&!b.disabled)',
        );
        await click("选择组件目录");
        await wait(
          'document.querySelector(".ant-modal-body").textContent.includes("主体抠图：可用")',
        );
        check(
          "component folder chooser validates both installed tools",
          await js(
            'document.querySelector(".ant-modal-body").textContent.includes("超分：可用")',
          ),
        );
        await click("关闭本地组件");
        await select("超分模型", "anime");
        await click("开始处理");
        await click("素材库");
        await wait('document.querySelectorAll(".asset-card").length===2');
        let r = await save();
        check(
          "native job continues after leaving tools and automatically enters library",
          r.document.assets.length === 2,
        );
        check(
          "local result does not create unsolicited canvas node",
          (r.document.tugouCanvas?.nodes || []).length === 0,
        );
        report.resultResource = r.document.assets.at(-1).resource;
        await click("图像工具");
        await wait('document.querySelector(".processing-item")');
        await js('document.querySelector(".processing-item").click()');
        await delay(100);
        check(
          "history restores model and scale",
          await js(
            `document.querySelector('select[aria-label="超分模型"]').value==='anime' && document.querySelector('select[aria-label="AI 超分倍率"]').value==='2'`,
          ),
        );
        check(
          "comparison displays actual result size",
          await js(
            'document.querySelector("img[alt=处理结果]").complete && document.querySelector(".image-comparison").textContent.includes("192 × 288")',
          ),
        );
        await click("撤销");
        await wait('document.querySelectorAll(".processing-item").length===0');
        r = await save();
        check(
          "result insertion is one undo with receipt retained",
          r.document.assets.length === 1 &&
            r.document.generationResultIds.length === 1,
        );
        await click("重做");
        await wait('document.querySelectorAll(".processing-item").length===1');
        await save();
        check(
          "redo restores exact native asset",
          (
            await js(`tugou.open(${JSON.stringify(report.id)})`)
          ).document.assets.at(-1).resource === report.resultResource,
        );
        window.setSize(960, 720);
        await delay(150);
        fs.writeFileSync(
          path.join(output, "local-ai-toolbar-960.png"),
          (
            await window.webContents.capturePage(undefined, {
              stayHidden: true,
            })
          ).toPNG(),
        );
        check(
          "960px toolbar has no horizontal overflow",
          await js("document.documentElement.scrollWidth<=innerWidth"),
        );
        await click("撤销");
        await save();
      }
      check("isolated test window never shown", !window.isVisible());
      check("no renderer errors", report.errors.length === 0);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
