const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { encode, decode } = require("../core/cloud-pixels.cjs");
const base = process.env.TUGOU_TEST_RESULTS || require('./qa-paths.cjs').path("mapping-batch");
fs.mkdirSync(base, { recursive: true });
const restart = process.argv.includes("--restart"),
  packaged = process.argv.includes("--packaged"),
  tag = packaged ? "packaged" : "desktop";
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(base, tag + ".json")))
  : null;
const profile = prior?.profile || fs.mkdtempSync(path.join(base, "profile-"));
process.env.TUGOU_DATA_DIR = profile;
if (packaged) delete process.env.TUGOU_BUILD_DIR;
else process.env.TUGOU_BUILD_DIR = require('./qa-paths.cjs').path("shared-build");
const report = { profile, checks: [], errors: [], requests: [] };
let hold = false,
  release;
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const form = await new Request("http://localhost" + req.url, {
    method: "POST",
    headers: req.headers,
    body: Buffer.concat(chunks),
  }).formData();
  report.requests.push({ size: form.get("size"), prompt: form.get("prompt") });
  if (hold) await new Promise((r) => (release = r));
  const [width, height] = form.get("size").split("x").map(Number),
    data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([250, 60, 90, 255], i);
  res.setHeader("Content-Type", "application/json");
  res.end(
    JSON.stringify({
      data: [
        {
          b64_json: (await encode({ width, height, data })).toString("base64"),
        },
      ],
    }),
  );
});
function finish(code) {
  fs.writeFileSync(
    path.join(base, tag + (restart ? "-restart" : "") + ".json"),
    JSON.stringify(report, null, 2),
  );
  release?.();
  server.closeAllConnections();
  server.close();
  app.exit(code);
}
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
    const wait = async (expr) => {
      for (let i = 0; i < 600; i++) {
        if (await js(`(async()=>Boolean(await (${expr})))()`)) return;
        await delay(30);
      }
      throw Error("timeout " + expr);
    };
    const click = async (label) => {
      await js(
        `{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('missing enabled '+${JSON.stringify(label)});b.click()}`,
      );
      await delay(90);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      await delay(90);
    };
    const input = async (label, value) => {
      await js(
        `{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))}`,
      );
      await delay(90);
    };
    const load = async (workspace) => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:${JSON.stringify(workspace)}}))`,
      );
      const ready = new Promise((r) =>
        w.webContents.once("did-finish-load", r),
      );
      w.webContents.reload();
      await ready;
      await wait('document.querySelector(".statusbar")');
      await delay(150);
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
    try {
      await js('console.error("mapping-sentinel")');
      check(
        "console errors captured",
        report.errors.includes("mapping-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await load("tools");
        const r = await save();
        check(
          "mapped mask and results persist",
          r.document.assets.length === prior.count &&
            r.document.assets.some((a) => a.id === prior.maskId),
        );
        check(
          "recipe reference order and roles persist",
          r.document.recipes[0].references[0].assetId === prior.secondId &&
            r.document.recipes[0].references[0].role.startsWith("画风"),
        );
        await load("prompts");
        check(
          "reference thumbnail restores",
          await js(
            'document.querySelectorAll(".reference-list img").length===2',
          ),
        );
        check(
          "restart never resubmits model requests",
          report.requests.length === 0,
        );
        check("unknown fields preserved", r.document.futureMapping.keep === 42);
      } else {
        const make = async (name, rgb) => {
          const data = Buffer.alloc(64 * 48 * 4);
          for (let i = 0; i < data.length; i += 4) data.set([...rgb, 255], i);
          return js(
            `tugou.storeRaster(${JSON.stringify([...(await encode({ width: 64, height: 48, data }))])},${JSON.stringify(name)})`,
          );
        };
        const source = await make("映射来源", [20, 120, 180]),
          second = await make("批量第二张", [40, 160, 10]);
        report.secondId = second.id;
        const layer = {
          id: "mapped",
          kind: "image",
          assetId: source.id,
          name: "旋转图层",
          x: 110,
          y: 20,
          width: 64,
          height: 48,
          rotation: 90,
          scaleX: 1.5,
          scaleY: 1.5,
          opacity: 1,
          visible: true,
        };
        report.id = await js(
          `(async()=>{const r=await tugou.create('选区与批量验收');await tugou.save(r.id,{...r.document,width:192,height:144,futureMapping:{keep:42},assets:${JSON.stringify([source, second])},layers:[${JSON.stringify(layer)}],modules:[{id:'m',name:'公共画风',kind:'style',text:'柔和线条',global:true}],recipes:[{id:'recipe',name:'参考顺序',moduleIds:[],references:[{assetId:${JSON.stringify(source.id)},role:'主体身份'},{assetId:${JSON.stringify(second.id)},role:'背景'}],output:'完整全身',size:'64x48'}],selection:{paths:[{operation:'add',points:[38,20,110,20,110,68,38,68]},{operation:'subtract',points:[65,29,80,29,80,44,65,44]}]}},r.revision);return r.id})()`,
        );
        await js(
          `tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'fixture',apiKey:'fixture-only'})`,
        );
        await load("tools");
        await select("处理方式", "cloudEdit");
        check(
          "different document dimensions require explicit layer mapping",
          await js(
            '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="读取画面选区").disabled',
          ),
        );
        await click("选区映射");
        await select("选区映射图层", "mapped");
        await click("选区映射");
        await click("读取画面选区");
        await wait(
          'document.querySelector("select[aria-label=修改区域来源]").value==="asset"',
        );
        let r = await save();
        const mask = r.document.assets.find((a) => a.name === "画面选区");
        report.maskId = mask.id;
        const decoded = await decode(
          fs.readFileSync(
            path.join(profile, "workspace/resources", mask.resource),
          ),
        );
        check(
          "mapped mask uses source pixel dimensions",
          decoded.width === 64 && decoded.height === 48,
        );
        const alpha = (x, y) => decoded.data[(y * 64 + x) * 4 + 3];
        check(
          "rotation and scale map selected half",
          alpha(8, 8) === 255 && alpha(44, 8) === 0,
        );
        check(
          "subtracted hole remains protected",
          alpha(10, 25) === 0 && alpha(20, 25) === 255,
        );
        await click("修改要求");
        await input("云端修改要求", "仅将选区换成红色");
        await click("修改要求 · 已填写");
        await click("提交云端");
        await wait('(await tugou.tasks()).some(t=>t.status==="completed")');
        await delay(1200);
        r = await save();
        const edited = r.document.assets.find(
            (a) => a.toolResult?.operation === "cloudEdit",
          ),
          pix = await decode(
            fs.readFileSync(
              path.join(profile, "workspace/resources", edited.resource),
            ),
          );
        check(
          "cloud result protects pixels outside mapped selection",
          pix.data[(8 * 64 + 44) * 4] === 20 &&
            pix.data[(8 * 64 + 8) * 4] === 250,
        );
        await select("处理方式", "cloudEnhance");
        await click("批量处理");
        check(
          "cloud batch explains per-item calls",
          await js(
            'document.querySelector("[role=dialog]").textContent.includes("逐张请求模型")',
          ),
        );
        await js(
          `document.querySelector('input[aria-label="批量选择 批量第二张"]').click()`,
        );
        await delay(90);
        await click("提交 2 张");
        await wait(
          '(await tugou.tasks()).filter(t=>t.context?.batchCount===2&&t.status==="completed").length===2',
        );
        await delay(1200);
        r = await save();
        const group = r.document.assets.filter((a) => a.toolResult?.batchId);
        check(
          "batch results merge without losing source or mask",
          group.length === 2 &&
            r.document.assets.some((a) => a.id === source.id) &&
            r.document.assets.some((a) => a.id === mask.id),
        );
        check(
          "group has ordered item metadata",
          new Set(group.map((a) => a.toolResult.batchIndex)).size === 2,
        );
        await click('本组加入画布');r=await save();
        check('cloud group enters canvas together',r.document.tugouCanvas.nodes.length===2&&r.document.tugouCanvas.nodes.every(n=>group.some(a=>a.id===n.data.assetId)));
        await click('撤销');r=await save();
        check('one undo removes canvas group but retains batch assets',r.document.tugouCanvas.nodes.length===0&&r.document.assets.filter(a=>a.toolResult?.batchId).length===2);
        await load('tools');await select('处理方式','cloudEnhance');
        hold = true;
        await click("批量处理");
        await js(
          `document.querySelector('input[aria-label="批量选择 批量第二张"]').click()`,
        );
        await delay(90);
        await click("提交 2 张");
        for (let i = 0; i < 300 && report.requests.length < 4; i++)
          await delay(20);
        await wait(
          '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="取消云端批次")',
        );
        await click("取消云端批次");
        release?.();
        hold = false;
        await delay(350);
        check(
          "batch cancel leaves no queued provider request",
          report.requests.length === 4 &&
            (await js("tugou.tasks()")).filter((t) => t.status === "cancelled")
              .length === 2,
        );
        await load("prompts");
        check(
          "recipe thumbnails and role presets present",
          await js(
            'document.querySelectorAll(".reference-list img").length===2&&document.querySelectorAll("#reference-roles option").length===7',
          ),
        );
        await click("下移参考图1");
        await input("参考图1职责", "画风参考：只参考配色");
        r = await save();
        check(
          "reference order and custom role saved",
          r.document.recipes[0].references[0].assetId === second.id &&
            r.document.recipes[0].references[0].role === "画风参考：只参考配色",
        );
        await js(
          '[...document.querySelectorAll(".recipe-footer button")].find(b=>b.textContent.trim()==="加入画布").click()',
        );
        await delay(180);
        r = await save();
        const node = r.document.tugouCanvas.nodes.find(
          (n) => n.type === "recipe",
        );
        check(
          "canvas receives reordered references and global style snapshot",
          node.data.snapshot.references[0].assetId === second.id &&
            node.data.snapshot.moduleBindings[0].snapshot.text === "柔和线条",
        );
        await load("prompts");
        await w.capturePage();
        fs.writeFileSync(
          path.join(base, tag + "-recipe.png"),
          (await w.capturePage()).toPNG(),
        );
        await load("tools");
        await select("处理方式", "cloudEdit");
        await click("选区映射");
        await select("选区映射图层", "mapped");
        await w.capturePage();
        fs.writeFileSync(
          path.join(base, tag + "-mapping.png"),
          (await w.capturePage()).toPNG(),
        );
        await click('选区映射');
        await click('切换浅色主题');
        w.setSize(960,720);await delay(250);
        for(const workspace of ['tools','prompts']) {
          await load(workspace);
          if(workspace==='tools') {await select('处理方式','cloudEdit');await click('选区映射');}
          check(workspace+' fits 960px light theme',await js('document.documentElement.scrollWidth<=innerWidth && document.documentElement.dataset.theme==="light"'));
          await w.capturePage();
          fs.writeFileSync(path.join(base,tag+'-'+workspace+'-light-960.png'),(await w.capturePage()).toPNG());
        }
        r = await save();
        report.count = r.document.assets.length;
        check(
          "original selection and unknown fields unchanged",
          r.document.selection.paths.length === 2 &&
            r.document.futureMapping.keep === 42,
        );
        check(
          "temporary cloud pixel jobs cleaned",
          fs.readdirSync(path.join(profile, "workspace/cloud-jobs")).length ===
            0,
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("QA window stays hidden", !w.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.status = await js(
        'document.querySelector(".image-tools [role=status]")?.textContent',
      );
      finish(1);
    }
  });
});
server.listen(0, "127.0.0.1", () =>
  require(
    packaged
      ? require('./qa-paths.cjs').path("lean-package/win-unpacked/resources/app.asar/desktop-main.cjs")
      : "../desktop-main.cjs",
  ),
);
