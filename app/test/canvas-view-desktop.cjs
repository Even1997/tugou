const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { encode } = require("../core/cloud-pixels.cjs");
const out = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  base = require('./qa-paths.cjs').path("canvas-view");
fs.mkdirSync(base, { recursive: true });
const restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(fs.readFileSync(path.join(out, "canvas-view-desktop.json")))
    : null;
const profile = prior?.profile || fs.mkdtempSync(path.join(base, "profile-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [] },
  requests = [];
let hold = false,
  release,
  output;
const server = require("node:http").createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  requests.push(Buffer.concat(chunks));
  if (hold) await new Promise((r) => (release = r));
  res.end(JSON.stringify({ data: [{ b64_json: output.toString("base64") }] }));
});
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      out,
      restart ? "canvas-view-restart.json" : "canvas-view-desktop.json",
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
  finish(1);
}, 120000);
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
      for (let i = 0; i < 600; i++) {
        if (await js(`(async()=>Boolean(await (${expression})))()`)) return;
        await delay(30);
      }
      throw Error("timeout " + expression);
    };
    const click = async (label, scope = "button") => {
      await js(
        `{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('missing enabled '+${JSON.stringify(label)});b.click()}`,
      );
      await delay(100);
    };
    const number = async (label, n) => {
      await js(
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(n))});e.dispatchEvent(new Event('input',{bubbles:true}))}`,
      );
      await delay(80);
      await js(
        `document.querySelector('input[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(100);
    };
    const save = async () => {
      if (
        await js(
          '[...document.querySelectorAll("button")].some(b=>b.getAttribute("aria-label")==="保存"&&!b.disabled)',
        )
      )
        await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const load = async () => {
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
    const snapshot = async (name) => {
      await delay(200);
      await w.webContents.capturePage();
      await delay(150);
      fs.writeFileSync(
        path.join(out, name + ".png"),
        (await w.webContents.capturePage()).toPNG(),
      );
    };
    const angle = async () => {
      await click("测试主体", ".palette-item");
      await click("图片工具");
      await click("AI 多角度");
    };
    try {
      await js('console.error("view-sentinel")');
      check("console observer active", report.errors.includes("view-sentinel"));
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await load();
        const r = await save();
        check(
          "display size and free ratio restore",
          JSON.stringify(r.document.tugouCanvas.nodes[0]) ===
            JSON.stringify(prior.savedNode),
        );
        check(
          "original resource and unknown fields restore",
          r.document.assets[0].resource === prior.sourceResource &&
            r.document.keep === "unknown",
        );
        check(
          "one result and cancelled task restore without resubmission",
          r.document.assets.length === 2 &&
            (await js("tugou.tasks()")).map((t) => t.status).join(",") ===
              "completed,cancelled" &&
            requests.length === 0,
        );
        const details = await js(
          `tugou.assetDetails(${JSON.stringify(report.id)},${JSON.stringify(r.document)},${JSON.stringify(r.document.assets[1].id)})`,
        );
        check(
          "saved angle prompt available after restart",
          details.prompt.includes("右侧 30°"),
        );
      } else {
        const input = await encode({
          width: 120,
          height: 80,
          data: Buffer.alloc(120 * 80 * 4, 170),
        });
        output = await encode({
          width: 80,
          height: 120,
          data: Buffer.alloc(80 * 120 * 4, 210),
        });
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        const asset = await js(
          `tugou.storeRaster(${JSON.stringify([...input])},'测试主体')`,
        );
        report.sourceResource = asset.resource;
        report.id = await js(
          `(async()=>{const r=await tugou.create('画布视角验收');await tugou.save(r.id,{...r.document,assets:[${JSON.stringify(asset)}],keep:'unknown',tugouCanvas:{version:1,nodes:[{id:'image',type:'asset',position:{x:70,y:60},data:{assetId:${JSON.stringify(asset.id)},role:'主体',future:42},future:99}],edges:[],viewport:{x:0,y:0,zoom:1},future:88}},r.revision);return r.id})()`,
        );
        await js(
          `tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'view-fixture-secret',model:'fixture-view'})`,
        );
        await load();
        await click("测试主体", ".palette-item");
        const before = (await save()).document;
        await click("节点尺寸");
        const ratio = await js(
          `(()=>{const e=document.querySelector('.react-flow__node-asset');return e.offsetHeight/e.offsetWidth})()`,
        );
        await number("显示宽度", 400);
        let r = await save();
        check(
          "locked numeric resize keeps node ratio",
          Math.abs(r.document.tugouCanvas.nodes[0].height / 400 - ratio) < 0.01,
        );
        check(
          "original pixels and metadata unchanged",
          JSON.stringify(r.document.assets) === JSON.stringify(before.assets) &&
            r.document.tugouCanvas.nodes[0].data.future === 42,
        );
        await click("节点尺寸");
        await click("撤销");
        r = await save();
        check(
          "resize is one undo step",
          r.document.tugouCanvas.nodes[0].width === undefined,
        );
        await click("重做");
        await click("节点尺寸");
        await js(
          `[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='自由比例').querySelector('input').click()`,
        );
        await number("显示高度", 180);
        r = await save();
        check(
          "free resize persists independent dimensions",
          r.document.tugouCanvas.nodes[0].width === 400 &&
            r.document.tugouCanvas.nodes[0].height === 180 &&
            r.document.tugouCanvas.nodes[0].data.freeResize,
        );
        await click("节点尺寸");
        const dragBefore = r.document.tugouCanvas.nodes[0];
        const p = await js(
          `(()=>{const e=document.querySelector('.react-flow__node-asset .react-flow__resize-control.bottom.right');const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
        );
        w.webContents.sendInputEvent({ type: "mouseMove", ...p });
        w.webContents.sendInputEvent({
          type: "mouseDown",
          ...p,
          button: "left",
          clickCount: 1,
        });
        for (let i = 1; i <= 5; i++) {
          w.webContents.sendInputEvent({
            type: "mouseMove",
            x: p.x + i * 12,
            y: p.y + i * 6,
            button: "left",
          });
          await delay(35);
        }
        w.webContents.sendInputEvent({
          type: "mouseUp",
          x: p.x + 60,
          y: p.y + 30,
          button: "left",
          clickCount: 1,
        });
        await delay(250);
        r = await save();
        check(
          "real resizer pointer sequence changes width and height",
          r.document.tugouCanvas.nodes[0].width > 450 &&
            r.document.tugouCanvas.nodes[0].height > 200,
        );
        await click("撤销");
        r = await save();
        check(
          "whole resize gesture undoes once",
          r.document.tugouCanvas.nodes[0].width === dragBefore.width &&
            r.document.tugouCanvas.nodes[0].height === dragBefore.height,
        );
        await click("重做");
        await angle();
        await number("水平角度", 30);
        await number("俯仰角度", -20);
        await number("镜头距离", 2.5);
        await js(
          `[...document.querySelectorAll('label')].find(e=>e.textContent.trim()==='广角镜头').querySelector('input').click()`,
        );
        await snapshot("canvas-view-angle-dark");
        await click("生成新视角");
        await wait('(await tugou.tasks()).some(t=>t.status==="completed")');
        await delay(1600);
        r = await save();
        check(
          "generated output lands in canvas and library once",
          r.document.assets.length === 2 &&
            r.document.tugouCanvas.nodes.length === 2 &&
            r.document.assets[0].resource === asset.resource,
        );
        check(
          "request uses original image bytes and shared model",
          requests.length === 1 &&
            requests[0].includes(input) &&
            requests[0].toString().includes("fixture-view"),
        );
        check(
          "request reflects all explicit camera controls",
          requests[0].toString().includes("右侧 30°") &&
            requests[0].toString().includes("仰视 20°") &&
            requests[0].toString().includes("2.5 / 10") &&
            requests[0].toString().includes("广角镜头"),
        );
        check(
          "result pixel bytes are preserved",
          fs
            .readFileSync(
              path.join(
                profile,
                "workspace/resources",
                r.document.assets[1].resource,
              ),
            )
            .equals(output),
        );
        check(
          "camera parameters recorded",
          r.document.assets[1].generation.angle.horizontalAngle === 30,
        );
        const details = await js(
          `tugou.assetDetails(${JSON.stringify(report.id)},${JSON.stringify(r.document)},${JSON.stringify(r.document.assets[1].id)})`,
        );
        check(
          "new output exposes exact prompt",
          details.prompt.includes("右侧 30°") &&
            details.model === "fixture-view",
        );
        hold = true;
        await angle();
        await click("生成新视角");
        await wait('(await tugou.tasks()).some(t=>t.status==="running")');
        for (let i = 0; i < 100 && requests.length < 2; i++) await delay(30);
        await js(
          `[...document.querySelectorAll('.statusbar button')].find(b=>b.textContent.includes('任务')).click()`,
        );
        await wait(
          '[...document.querySelectorAll(".task-row button")].some(b=>b.textContent.trim()==="取消任务")',
        );
        await click("取消任务");
        await wait('(await tugou.tasks()).some(t=>t.status==="cancelled")');
        release?.();
        await click("关闭任务");
        await delay(1400);
        r = await save();
        check(
          "cancel discards late provider response",
          r.document.assets.length === 2 &&
            (await js("tugou.results(" + JSON.stringify(report.id) + ")"))
              .length === 1,
        );
        w.setSize(960, 760);
        await delay(250);
        await click("切换浅色主题");
        await angle();
        await snapshot("canvas-view-angle-light-960");
        check(
          "dialog fits 960 viewport",
          await js(
            `(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.x>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`,
          ),
        );
        await click("关闭AI 多角度");
        await click("节点尺寸");
        await snapshot("canvas-view-size-light-960");
        await click("节点尺寸");
        r = await save();
        report.savedNode = r.document.tugouCanvas.nodes[0];
        check(
          "unknown document and graph fields retained",
          r.document.keep === "unknown" &&
            r.document.tugouCanvas.future === 88 &&
            report.savedNode.future === 99,
        );
        check(
          "secrets excluded from saved generation journal",
          !fs
            .readFileSync(
              path.join(
                profile,
                "workspace/requests",
                (await js("tugou.tasks()"))[0].id + ".json",
              ),
              "utf8",
            )
            .includes("view-fixture-secret"),
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("window remained hidden", !w.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.text = await js("document.body.innerText");
      await snapshot("canvas-view-failure");
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
