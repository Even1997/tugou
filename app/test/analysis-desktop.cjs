const { app, dialog, nativeImage } = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  report = { checks: [], errors: [], platform: process.platform };
const result = {
  summary: "独立分析审阅样例",
  uncertainties: ["文字日期不清晰"],
  modules: [
    { name: "公共画风", kind: "style", text: "简洁细线和平涂阴影" },
    { name: "人物", kind: "character", text: "圆脸和短发" },
    { name: "小狗", kind: "pet", text: "棕白毛色" },
  ],
};
let server,
  release,
  requests = [],
  mode = "wait",
  profile;
const finish = async (code) => {
  await fs.writeFile(
    path.join(output, "analysis-desktop.json"),
    JSON.stringify(report, null, 2),
  );
  server?.closeAllConnections();
  server?.close();
  app.exit(code);
};
const timer = setTimeout(() => {
  report.failure = "Desktop QA timeout";
  finish(1);
}, 60000);
app.on("browser-window-created", (_e, window) => {
  window.show=()=>{};
  window.focus=()=>{};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const wait = async (code) => {
      for (let i = 0; i < 160; i++) {
        if (await js(code)) return;
        await delay(40);
      }
      throw new Error("Timeout: " + code);
    };
    const click = async (label, scope = "document") => {
      await js(
        `Array.from(${scope}.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(60);
    };
    const fill = (label, value, tag = "input") =>
      js(
        `{const e=document.querySelector(${JSON.stringify(tag + '[aria-label="' + label + '"]')});Object.getOwnPropertyDescriptor(${tag === "textarea" ? "HTMLTextAreaElement" : "HTMLInputElement"}.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
    const check = (label, value) => {
      assert.ok(value, label);
      report.checks.push(label);
    };
    try {
      await js('console.error("analysis-ui-sentinel")');
      check("console capture verified",report.errors.includes("analysis-ui-sentinel"));
      report.errors=[];
      await wait('document.querySelector(".studio-header")');
      await click("新建工程");
      await wait('document.querySelector(".prompt-workbench")');
      const id = await js(
        'document.querySelector("select[aria-label=当前工程]").value',
      );
      await js(
        `window.tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'desktop-analysis-secret',model:'images',analysisModel:'vision'})`,
      );
      await click("新建模块");
      await fill("模块名称", "旧模块");
      await fill("模块提示词", "保留原来的内容", "textarea");
      const fixture = path.join(profile, "source.png");
      await fs.writeFile(
        fixture,
        nativeImage
          .createFromBitmap(Buffer.from([0, 0, 255, 255, 0, 255, 0, 255]), {
            width: 2,
            height: 1,
          })
          .toPNG(),
      );
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [fixture],
      });
      check("analysis entry is visible in the top toolbar", await js(`Array.from(document.querySelectorAll(".workflow-toolbar button")).find(b=>b.textContent.trim()==="参考图分析").getBoundingClientRect().height>0`));
    await click("参考图分析");
      await wait('document.querySelector(".analysis-dialog")');
      await click("导入参考图");
      await wait('document.querySelector(".analysis-image")?.naturalWidth>0');
      await fill("分析要求", "画风、人物、宠物分开分析", "textarea");
      await click("开始分析");
      await wait(
        'document.querySelector(".analysis-job")?.textContent.includes("分析中")',
      );
      check(
        "reference import and queued vision request use shared settings",
        requests.length === 1 &&
          requests[0].model === "vision" &&
          requests[0].messages[1].content[0].text ===
            "画风、人物、宠物分开分析",
      );
      await click(
        "关闭参考图分析",
        'document.querySelector(".analysis-dialog")',
      );
      await wait('!document.querySelector(".analysis-dialog")');
      await fill("模块提示词", "分析期间继续编辑", "textarea");
      release();
      await wait(
        '(async()=>{const jobs=await window.tugou.tasks();return jobs.some(t=>t.context.kind==="analysis"&&t.status==="completed");})()',
      );
      await click("参考图分析");
      await wait('document.querySelectorAll(".analysis-module").length===3');
      check(
        "completed draft opens for review without overwriting workbench",
        await js(
          'document.querySelectorAll(".module-list .module").length===1',
        ),
      );
      await fill("分析提示词 1", "人工修订的公共画风", "textarea");
      await js(
        `document.querySelector('input[aria-label="采用分析模块 3"]').click()`,
      );
      await click("保存草稿");
      await wait(
        'document.querySelector(".analysis-review [role=status]")?.textContent==="分析草稿已保存"',
      );
      await click(
        "关闭参考图分析",
        'document.querySelector(".analysis-dialog")',
      );
      await wait('!document.querySelector(".analysis-dialog")');
      await click("参考图分析");
      await wait(
        `document.querySelector('textarea[aria-label="分析提示词 1"]')?.value==="人工修订的公共画风"`,
      );
      check(
        "edited draft and disabled modules survive closing and reopening",
        await js(
          `!document.querySelector('input[aria-label="采用分析模块 3"]').checked`,
        ),
      );
      await wait(
        'document.querySelector(".analysis-job")?.textContent.includes("待审阅")',
      );
      await fs.writeFile(
        path.join(output, "analysis-dark.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await click("加入所选模块");
      await wait(
        'document.querySelector(".analysis-review [role=status]")?.textContent.includes("已加入模块")',
      );
      check(
        "selected modules imported once and repeated apply disabled",
        await js(
          'document.querySelectorAll(".module-list .module").length===3&&Array.from(document.querySelectorAll(".analysis-footer button")).find(b=>b.textContent.trim()==="已加入模块").disabled',
        ),
      );
      await click(
        "关闭参考图分析",
        'document.querySelector(".analysis-dialog")',
      );
      await wait('!document.querySelector(".analysis-dialog")');
      await click("撤销");
      await wait(
        'document.querySelectorAll(".module-list .module").length===1',
      );
      check("analysis import is one undoable document edit", true);
      await click("重做");
      await wait(
        'document.querySelectorAll(".module-list .module").length===3',
      );
      await click("保存");
      await wait(
        'document.querySelector(".statusbar").textContent.includes("已保存")',
      );
      const saved = await js(`window.tugou.open(${JSON.stringify(id)})`);
      check(
        "save retains concurrent edits, selected modules and pinned recipe",
        saved.document.modules[0].text === "分析期间继续编辑" &&
          saved.document.modules[1].text === "人工修订的公共画风" &&
          saved.document.recipes[0].moduleIds.length === 2 &&
          saved.document.tugouAnalysisImports.length === 1,
      );
      await click("参考图分析");
      await wait('document.querySelector(".analysis-dialog")');
      mode = "wait";
      await click("开始分析");
      await wait(
        'Array.from(document.querySelectorAll(".analysis-job")).some(e=>e.textContent.includes("分析中"))',
      );
      await click("取消分析");
      release?.();
      await wait(
        'Array.from(document.querySelectorAll(".analysis-job")).some(e=>e.textContent.includes("已取消"))',
      );
      check(
        "cancelled request creates no additional review result",
        (await js(`window.tugou.analyses(${JSON.stringify(id)})`)).length === 1,
      );
      await click(
        "关闭参考图分析",
        'document.querySelector(".analysis-dialog")',
      );
      await wait('!document.querySelector(".analysis-dialog")');
      await click("切换浅色主题");
      await click("参考图分析");
      await wait('document.querySelectorAll(".analysis-module").length===3');
      window.setSize(960, 720);
      await wait("innerWidth===960");
      check(
        "narrow analysis dialog remains within viewport",
        await js(
          'document.querySelector(".ant-modal").getBoundingClientRect().right<=innerWidth&&document.querySelector(".analysis-content").scrollWidth<=document.querySelector(".analysis-content").clientWidth+1',
        ),
      );
      check("modal close control does not overlap draggable title bar",await js(`document.querySelector(".analysis-dialog .ant-modal-close").getBoundingClientRect().top>=document.querySelector(".studio-header").getBoundingClientRect().bottom`));
      check(
        "review actions remain visible at 960px",
        await js(
          'document.querySelector(".analysis-footer").getBoundingClientRect().bottom<innerHeight',
        ),
      );
      await fs.writeFile(
        path.join(output, "analysis-light-960.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      mode="many";
      await click("开始分析");
      await wait('document.querySelector("select[aria-label=分析记录]")?.options.length===2');
      const many=(await js(`window.tugou.analyses(${JSON.stringify(id)})`)).at(-1);
      report.maxDraftCharacters=Math.max(...many.modules.map(m=>m.text.length));
      assert.equal(report.maxDraftCharacters,4000);
      const renderStarted=Date.now();
      await js(`{const select=document.querySelector('select[aria-label=分析记录]');select.value=${JSON.stringify(many.id)};select.dispatchEvent(new Event('change',{bubbles:true}));}`);
      await wait('document.querySelectorAll(".analysis-module").length===40');
      report.maxDraftRenderMs=Date.now()-renderStarted;
      report.rendererMemoryKB=app.getAppMetrics().find(metric=>metric.pid===window.webContents.getOSProcessId())?.memory;
      check("maximum-size draft renders with accessible review actions",report.maxDraftRenderMs<2500&&await js('document.querySelector(".analysis-footer").getBoundingClientRect().bottom<innerHeight'));
      check(
        "no renderer errors or leaked provider credentials",
        report.errors.length === 0 &&
          !(
            await fs.readFile(
              path.join(profile, "workspace", "tasks.json"),
              "utf8",
            )
          ).includes("desktop-analysis-secret"),
      );
      check("QA window remains hidden",!window.isVisible());
      clearTimeout(timer);
      await finish(0);
    } catch (error) {
      report.failure = error.stack;
      await fs.writeFile(
        path.join(output, "analysis-failure.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      clearTimeout(timer);
      await finish(1);
    }
  });
});
const syncFs = require("node:fs");
syncFs.mkdirSync(output, { recursive: true });
const profileBase=require('./qa-paths.cjs').path("analysis-regression");
syncFs.mkdirSync(profileBase,{recursive:true});
profile = syncFs.mkdtempSync(path.join(profileBase,"profile-"));
report.profile = profile;
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(output,"local-tools-build");
server = http.createServer(async (req, res) => {
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  requests.push(JSON.parse(Buffer.concat(parts)));
  if (mode === "wait")
    await new Promise((r) => {
      release = r;
    });
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(mode==="many"?{...result,modules:Array.from({length:40},(_,i)=>({name:`模块 ${i+1}`,kind:i===0?'style':'other',text:'细线、低饱和色彩。'.repeat(400).padEnd(4000,'色')}))}:result) } }],
    }),
  );
});
server.listen(0, "127.0.0.1");
require("../main.cjs");
