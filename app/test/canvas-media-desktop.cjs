const { app, dialog, clipboard } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { encode } = require("../core/cloud-pixels.cjs");
const { compileNode } = require("../core/prompts.cjs");
const out = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  base = require('./qa-paths.cjs').path("canvas-media");
fs.mkdirSync(base, { recursive: true });
const restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(fs.readFileSync(path.join(out, "canvas-media-desktop.json")))
    : null;
const profile = prior?.profile || fs.mkdtempSync(path.join(base, "profile-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [] },
  requests = [];
let copied = "",
  importFile,
  hold = false,
  release;
// Capture only this isolated process's copy operation; never touch the OS clipboard.
clipboard.writeText = (text) => {
  copied = text;
};
dialog.showOpenDialog = async (_window, options) => {
  report.importProperties = options.properties;
  return { canceled: false, filePaths: [importFile] };
};
const server = require("node:http").createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks));
    requests.push({ url: req.url, body });
    if (hold) await new Promise((r) => (release = r));
    const content = {
      summary: "可替换的画风、人物和宠物",
      uncertainties: [],
      modules: [
        { name: "公共画风", kind: "style", text: "细线平涂" },
        { name: "人物", kind: "character", text: "短发、圆脸" },
        { name: "宠物", kind: "pet", text: "白猫" },
      ],
    };
    res.end(
      JSON.stringify(
        req.url.endsWith("/chat/completions")
          ? { choices: [{ message: { content: JSON.stringify(content) } }] }
          : {
              data: [
                {
                  b64_json: (
                    await encode({
                      width: 32,
                      height: 24,
                      data: Buffer.alloc(32 * 24 * 4, 255),
                    })
                  ).toString("base64"),
                },
              ],
            },
      ),
    );
  } catch (e) {
    report.serverError = e.stack;
    res.statusCode = 500;
    res.end("{}");
  }
});
const end = (code) => {
  fs.writeFileSync(
    path.join(
      out,
      restart ? "canvas-media-restart.json" : "canvas-media-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
  release?.();
  server.closeAllConnections();
  server.close();
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  end(1);
}, 160000);
app.on("web-contents-created", (_, c) =>
  c.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  }),
);
app.on("browser-window-created", (_, w) => {
  w.show = () => {};
  w.focus = () => {};
  w.webContents.setBackgroundThrottling(false);
  w.webContents.once("did-finish-load", async () => {
    const js = (s) => w.webContents.executeJavaScript(s, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (name, value) => {
      assert.ok(value, name);
      report.checks.push(name);
    };
    const wait = async (expression) => {
      for (let i = 0; i < 800; i++) {
        if (await js(`(async()=>Boolean(await (${expression})))()`)) return;
        await delay(30);
      }
      throw Error("timeout " + expression);
    };
    const click = async (label, scope = "button") => {
      await js(
        `{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing enabled '+${JSON.stringify(label)});b.click()}`,
      );
      await delay(100);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      await delay(100);
    };
    const fill = async (label, value) => {
      await js(
        `{const e=document.querySelector('textarea[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))}`,
      );
      await delay(100);
    };
    const save = async () => {
      if (
        await js(
          '[...document.querySelectorAll("button")].some(b=>(b.textContent.trim()==="保存"||b.getAttribute("aria-label")==="保存")&&!b.disabled)',
        )
      )
        await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const reload = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'canvas'}))`,
      );
      const ready = new Promise((r) =>
        w.webContents.once("did-finish-load", r),
      );
      w.webContents.reload();
      await ready;
      await wait('document.querySelector(".canvas-workspace")');
    };
    const imageAction = async (name, action) => {
      await click(name, ".palette-item");
      await click("图片工具");
      await click(action);
    };
    const snapshot = async (name) => {
      await delay(150);
      await w.webContents.capturePage();
      await delay(100);
      fs.writeFileSync(
        path.join(out, name + ".png"),
        (await w.webContents.capturePage()).toPNG(),
      );
    };
    try {
      await js('console.error("canvas-media-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("canvas-media-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload();
        const r = await save();
        check(
          "replacement, reviewed module graph and unknown data restore",
          r.document.assets.length === 4 &&
            r.document.tugouCanvas.nodes.some((n) =>
              n.id.startsWith("analysis-recipe-"),
            ) &&
            r.document.unknownMedia.keep &&
            r.document.tugouCanvas.futureGraph === 42,
        );
        await imageAction("原图A", "原图与提示词");
        await wait(
          'document.querySelector("textarea[aria-label=素材提示词]").value',
        );
        check(
          "saved prompt available after restart",
          await js(
            'document.querySelector("textarea[aria-label=素材提示词]").value==="原始人物提示词\\n完整第二行"',
          ),
        );
        await click("关闭素材详情");
        await imageAction("原图A", "图片反推");
        await wait('document.querySelector(".analysis-modules")');
        check(
          "review edits and imported state restore",
          await js(
            `document.querySelector('textarea[aria-label="分析提示词 1"]').value==="审阅修订后的画风"&&document.querySelector('.analysis-modules').closest('fieldset').disabled&&[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="送入画布")`,
          ),
        );
        await click("关闭参考图分析");
        check(
          "restart never resubmits jobs",
          requests.length === 0 && (await js("tugou.tasks()")).length === 4,
        );
      } else {
        const originalPng = await encode({
          width: 32,
          height: 24,
          data: Buffer.from(
            Array.from({ length: 32 * 24 }, () => [210, 110, 70, 180]).flat(),
          ),
        });
        const replacementPng = await encode({
          width: 24,
          height: 48,
          data: Buffer.from(
            Array.from({ length: 24 * 48 }, () => [10, 70, 230, 128]).flat(),
          ),
        });
        importFile = path.join(profile, "imported.png");
        fs.writeFileSync(importFile, replacementPng);
        const a = await js(
            `tugou.storeRaster(${JSON.stringify([...originalPng])},'原图A')`,
          ),
          b = await js(
            `tugou.storeRaster(${JSON.stringify([...replacementPng])},'原图B')`,
          );
        a.prompt = "原始人物提示词\n完整第二行";
        const recipe = {
          id: "recipe",
          name: "生成样例",
          moduleIds: [],
          moduleBindings: [],
          references: [],
          output: "生成时的固定提示词",
          size: "auto",
        };
        const nodes = [
          {
            id: "source-a",
            type: "asset",
            position: { x: 50, y: 30 },
            data: { assetId: a.id, role: "仅身份", futureNode: "keep" },
          },
          {
            id: "duplicate-a",
            type: "asset",
            position: { x: 400, y: 30 },
            data: { assetId: a.id, role: "仅画风" },
          },
          {
            id: "source-b",
            type: "asset",
            position: { x: 750, y: 30 },
            data: { assetId: b.id, role: "构图" },
          },
          {
            id: "recipe-node",
            type: "recipe",
            position: { x: 1100, y: 30 },
            data: { recipeId: recipe.id, snapshot: recipe },
          },
        ];
        report.id = await js(
          `(async()=>{const r=await tugou.create('图片替换与反推验收');await tugou.save(r.id,{...r.document,assets:${JSON.stringify([a, b])},recipes:[${JSON.stringify(recipe)}],tugouCanvas:{version:1,nodes:${JSON.stringify(nodes)},edges:[{id:'source-link',source:'source-a',target:'recipe-node',futureEdge:'keep'}],viewport:{x:0,y:0,zoom:.65},futureGraph:42},unknownMedia:{keep:true}},r.revision);return r.id})()`,
        );
        await js(
          `tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'canvas-media-fixture-secret',model:'fixture-image',analysisModel:'fixture-vision'})`,
        );
        // Remove the image edge only for this generation request to use the JSON endpoint fixture.
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});return tugou.generate(r.id,{...r.document,tugouCanvas:{...r.document.tugouCanvas,edges:[]}},'recipe-node')})()`,
        );
        await wait(
          '(async()=>{const t=await tugou.tasks();return t[0]?.status==="completed"})()',
        );
        await reload();
        await wait('document.querySelectorAll(".canvas-card img").length===4');
        let r = await save();
        const generated = r.document.assets.find((x) => x.generation);
        report.generated = generated.id;
        const expected = requests[0].body.prompt;
        r.document.recipes[0].output = "生成后修改的配方";
        r.document.tugouCanvas.nodes.find(
          (n) => n.id === "recipe-node",
        ).data.snapshot.output = "生成后修改的配方";
        await js(
          `tugou.save(${JSON.stringify(report.id)},${JSON.stringify(r.document)},${r.revision})`,
        );
        await reload();
        await imageAction(generated.name, "原图与提示词");
        await wait(
          'document.querySelector("textarea[aria-label=素材提示词]").value',
        );
        check(
          "detail uses immutable generation prompt rather than current recipe",
          await js(
            `document.querySelector('textarea[aria-label="素材提示词"]').value===${JSON.stringify(expected)}`,
          ),
        );
        await click("复制提示词");
        check(
          "copy preserves exact original text without touching OS clipboard",
          copied === expected,
        );
        await click("关闭素材详情");
        await imageAction("原图A", "复制提示词");
        check("top menu copies full recorded prompt", copied === a.prompt);
        await imageAction("原图B", "原图与提示词");
        await wait(
          'document.querySelector("textarea[aria-label=素材提示词]").placeholder.includes("没有可读取")',
        );
        check(
          "missing prompt is explicit and copy is disabled",
          await js(
            '[...document.querySelectorAll(".ant-modal button")].find(b=>b.textContent.trim()==="复制提示词").disabled',
          ),
        );
        await click("关闭素材详情");
        await click("原图A", ".palette-item");
        await click("替换图片");
        await select("替换素材", b.id);
        await click("取消");
        r = await save();
        check(
          "cancelled library replacement leaves node and assets intact",
          r.document.tugouCanvas.nodes[0].data.assetId === a.id &&
            r.document.assets.length === 3,
        );
        await click("替换图片");
        await select("替换素材", b.id);
        await click("确认替换");
        r = await save();
        check(
          "replacement only changes selected reference and preserves graph metadata",
          r.document.tugouCanvas.nodes[0].data.assetId === b.id &&
            r.document.tugouCanvas.nodes[1].data.assetId === a.id &&
            r.document.tugouCanvas.nodes[0].data.role === "仅身份" &&
            r.document.tugouCanvas.nodes[0].data.futureNode === "keep" &&
            r.document.tugouCanvas.edges[0].futureEdge === "keep" &&
            r.document.assets.length === 3,
        );
        check(
          "replacement preserves original pixel resources",
          r.document.assets.find((x) => x.id === a.id).resource ===
            a.resource &&
            r.document.assets.find((x) => x.id === b.id).resource ===
              b.resource,
        );
        await click("撤销");
        r = await save();
        check(
          "one undo restores original image",
          r.document.tugouCanvas.nodes[0].data.assetId === a.id,
        );
        await click("重做");
        r = await save();
        check(
          "redo reapplies only replacement",
          r.document.tugouCanvas.nodes[0].data.assetId === b.id,
        );
        await click("替换图片");
        await click("导入替换图片");
        await wait('document.querySelector("img[alt=替换图片预览]")');
        await click("取消");
        r = await save();
        check(
          "cancelled file import publishes no asset or node edit",
          r.document.assets.length === 3 &&
            r.document.tugouCanvas.nodes[0].data.assetId === b.id,
        );
        await click("替换图片");
        await click("导入替换图片");
        await wait('document.querySelector("img[alt=替换图片预览]")');
        w.setSize(960, 800);
        await snapshot("canvas-media-replace-960");
        await click("确认替换");
        r = await save();
        const imported = r.document.assets.at(-1);
        report.imported = imported.id;
        check(
          "single file import and replacement form one history step",
          r.document.assets.length === 4 &&
            r.document.tugouCanvas.nodes[0].data.assetId === imported.id &&
            report.importProperties.join(",") === "openFile",
        );
        await click("撤销");
        r = await save();
        check(
          "undo removes staged import and restores prior node",
          r.document.assets.length === 3 &&
            r.document.tugouCanvas.nodes[0].data.assetId === b.id,
        );
        await click("重做");
        r = await save();
        check(
          "redo restores imported resource reference",
          r.document.assets.length === 4 &&
            r.document.tugouCanvas.nodes[0].data.assetId === imported.id,
        );
        // Make a different image's newer history first. It must not appear when A is selected.
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});return tugou.analyze(r.id,r.document,${JSON.stringify(b.id)},'先分析另一张图')})()`,
        );
        await wait(
          '(async()=>{const t=await tugou.tasks();return t.at(-1)?.status==="completed"})()',
        );
        await imageAction("原图A", "图片反推");
        await delay(200);
        check(
          "reverse opens exact selected image without unrelated latest draft",
          await js(
            `document.querySelector('select[aria-label="分析参考图"]').value===${JSON.stringify(a.id)}&&!document.querySelector('.analysis-modules')`,
          ),
        );
        await fill("分析要求", "画风、人物、宠物分别拆分");
        await click("开始分析");
        await wait('document.querySelector(".analysis-modules")');
        const request = requests.at(-1);
        check(
          "reverse uses shared vision model and selected original image",
          request.url === "/v1/chat/completions" &&
            request.body.model === "fixture-vision" &&
            JSON.stringify(request.body).includes(
              originalPng.toString("base64"),
            ) &&
            JSON.stringify(request.body).includes("画风、人物、宠物分别拆分"),
        );
        await fill("分析提示词 1", "审阅修订后的画风");
        await js(
          `document.querySelector('input[aria-label="采用分析模块 3"]').click()`,
        );
        await delay(100);
        await snapshot("canvas-media-analysis-960");
        await click("加入所选模块");
        await wait(
          '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="送入画布")',
        );
        await click("送入画布");
        r = await save();
        const analysisId = r.document.tugouAnalysisImports[0].id,
          analysisRecipe = "analysis-recipe-" + analysisId;
        check(
          "reviewed selected modules and linked recipe enter canvas without auto-generation",
          r.document.modules.length === 2 &&
            r.document.recipes.length === 2 &&
            r.document.tugouCanvas.nodes.length === 8 &&
            requests.length === 3,
        );
        const compiled = compileNode(r.document, analysisRecipe);
        check(
          "canvas uses reviewed prompt once, global style last, no implicit reference",
          compiled.prompt.includes("审阅修订后的画风") &&
            !compiled.prompt.includes("白猫") &&
            compiled.prompt.indexOf("短发") <
              compiled.prompt.indexOf("审阅修订后的画风") &&
            compiled.references.length === 0,
        );
        await click("撤销");
        r = await save();
        check(
          "send to canvas undoes without losing reviewed modules",
          r.document.tugouCanvas.nodes.length === 5 &&
            r.document.modules.length === 2,
        );
        await click("重做");
        r = await save();
        check(
          "send to canvas redo restores linked nodes",
          r.document.tugouCanvas.nodes.length === 8,
        );
        await imageAction("原图A", "图片反推");
        await wait('document.querySelector(".analysis-modules")');
        await click("送入画布");
        r = await save();
        check(
          "repeat send is idempotent",
          r.document.tugouCanvas.nodes.length === 8,
        );
        await imageAction("原图A", "图片反推");
        await wait('document.querySelector(".analysis-modules")');
        hold = true;
        await click("开始分析");
        await wait(
          '(async()=>{const t=await tugou.tasks();return t.at(-1)?.status==="running"})()',
        );
        check(
          "new analysis waits for its own response instead of showing old draft",
          await js('!document.querySelector(".analysis-modules")'),
        );
        await click("取消分析");
        release?.();
        hold = false;
        await wait(
          '(async()=>{const t=await tugou.tasks();return t.at(-1)?.status==="cancelled"})()',
        );
        await wait('document.querySelector(".analysis-modules")');
        check(
          "cancelled reverse preserves last reviewed result",
          await js(
            `document.querySelector('textarea[aria-label="分析提示词 1"]').value==="审阅修订后的画风"`,
          ),
        );
        await click("关闭参考图分析");
        await imageAction("原图A", "原图与提示词");
        await wait(
          'document.querySelector("textarea[aria-label=素材提示词]").value',
        );
        await snapshot("canvas-media-details-dark-960");
        check(
          "detail actions and prompt fit narrow desktop",
          await js(
            'document.querySelector(".ant-modal").getBoundingClientRect().right<=innerWidth&&document.querySelector("textarea[aria-label=素材提示词]").getBoundingClientRect().bottom<innerHeight',
          ),
        );
        await click("关闭素材详情");
        await click("切换浅色主题");
        await click("素材库", "nav button");
        await click("预览 原图A");
        await wait(
          'document.querySelector("textarea[aria-label=素材提示词]").value',
        );
        await snapshot("canvas-media-details-light-960");
        check(
          "library reuses same detail and copy actions in light theme",
          await js(
            'document.documentElement.dataset.theme==="light"&&document.querySelector("textarea[aria-label=素材提示词]").value==="原始人物提示词\\n完整第二行"',
          ),
        );
        await click("图片反推");
        check(
          "library reverse shares source-selected analysis",
          await js(
            `document.querySelector('select[aria-label="分析参考图"]').value===${JSON.stringify(a.id)}`,
          ),
        );
        await click("关闭参考图分析");
        await click("无限画布", "nav button");
        r = await save();
        check(
          "all original sources and opaque project fields retained",
          r.document.assets.some((x) => x.id === a.id) &&
            r.document.assets.some((x) => x.id === b.id) &&
            r.document.unknownMedia.keep &&
            r.document.tugouCanvas.futureGraph === 42,
        );
        check(
          "provider secret absent from task and result logs",
          !fs
            .readFileSync(path.join(profile, "workspace", "tasks.json"), "utf8")
            .includes("canvas-media-fixture-secret"),
        );
        report.requests = requests.map((x) => ({
          url: x.url,
          model: x.body.model,
        }));
      }
      check("no renderer errors", report.errors.length === 0);
      check("QA window remains hidden", !w.isVisible());
      end(0);
    } catch (e) {
      report.failure = e.stack;
      report.text = await js("document.body.innerText");
      await snapshot("canvas-media-failure");
      end(1);
    }
  });
});
server.listen(0, "127.0.0.1", () => require("../desktop-main.cjs"));
