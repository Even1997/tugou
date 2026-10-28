const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { encode, decode } = require("../core/cloud-pixels.cjs");
const out = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(fs.readFileSync(path.join(out, "cloud-desktop.json")))
    : null;
const profile =
  prior?.profile ||
  fs.mkdtempSync(path.join(os.tmpdir(), "tugou-cloud-desktop-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [], requests: [] };
let behavior = "ok",
  release;
const finish = (code) => {
  fs.writeFileSync(
    path.join(out, restart ? "cloud-restart.json" : "cloud-desktop.json"),
    JSON.stringify(report, null, 2),
  );
  server.closeAllConnections();
  server.close();
  app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  finish(1);
}, 240000);
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const f = await new Request("http://localhost" + req.url, {
    method: "POST",
    headers: req.headers,
    body: Buffer.concat(chunks),
  }).formData();
  const [w, h] = f.get("size").split("x").map(Number),
    width = behavior === "large" ? w * 2 : w,
    height = behavior === "large" ? h * 2 : h;
  report.requests.push({
    url: req.url,
    size: f.get("size"),
    mask: Boolean(f.get("mask")),
    prompt: f.get("prompt"),
  });
  if (behavior === "wait") await new Promise((r) => (release = r));
  const bytes = await encode({
    width,
    height,
    data: Buffer.from(
      Array.from({ length: width * height }, () => [220, 20, 60, 255]).flat(),
    ),
  });
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }));
});
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
    const check = (name, v) => {
      assert.ok(v, name);
      report.checks.push(name);
    };
    const wait = async (s) => {
      for (let i = 0; i < 1200; i++) {
        if (await js(`Boolean(${s})`)) return;
        await delay(25);
      }
      throw Error("timeout " + s);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(70);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`,
      );
      await delay(50);
    };
    const input = async (label, value, textarea = false) => {
      await js(
        `{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(${textarea ? "HTMLTextAreaElement" : "HTMLInputElement"}.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
      await delay(40);
      await js(
        `document.querySelector('[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(40);
    };
    const reload = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`,
      );
      const ready = new Promise((r) =>
        w.webContents.once("did-finish-load", r),
      );
      w.webContents.reload();
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
    const tasks = () => js("tugou.tasks()");
    const done = async (id) => {
      for (let i = 0; i < 1400; i++) {
        const t = (await tasks()).find((t) => t.id === id);
        if (["completed", "review", "failed", "cancelled"].includes(t.status))
          return t;
        await delay(25);
      }
      throw Error("task timeout");
    };
    const submit = async () => {
      const count = (await tasks()).length;
      await click("提交云端");
      let task;
      for (let i = 0; i < 700; i++) {
        const list = await tasks();
        if (list.length > count) {
          task = list.at(-1);
          break;
        }
        await delay(25);
      }
      if (!task)
        throw Error(
          await js(
            'document.querySelector(".message[role=status]").textContent',
          ),
        );
      return task;
    };
    try {
      await js('console.error("cloud-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("cloud-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload();
        await delay(1400);
        let r = await save();
        check(
          "saved cloud results and unknown fields restore",
          r.document.assets.length === prior.count &&
            r.document.futureCloud.keep,
        );
        check(
          "review snapshot and raw resource restore",
          (await js(`tugou.cloudReview(${JSON.stringify(prior.reviewId)})`))
            .asset.resource === prior.rawResource,
        );
        check("restart never requests model", report.requests.length === 0);
        check(
          "completed local fit survives without rerun",
          (await tasks()).find((t) => t.id === prior.fitId).status ===
            "completed",
        );
        await js(`document.querySelector('.processing-item').click()`);
        await delay(80);
        check(
          "cloud history restores operation",
          await js(
            'document.querySelector("select[aria-label=处理方式]").value==="cloudEnhance"',
          ),
        );
      } else {
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        const data = Buffer.from(
            Array.from({ length: 64 * 48 }, (_, i) => [
              20,
              120,
              180,
              [0, 64, 128, 255][i % 4],
            ]).flat(),
          ),
          bytes = await encode({ width: 64, height: 48, data });
        const source = await js(
          `tugou.storeRaster(${JSON.stringify([...bytes])},'云端原图')`,
        );
        report.source = source;
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});return tugou.save(r.id,{...r.document,assets:[${JSON.stringify(source)}],futureCloud:{keep:true}},r.revision)})()`,
        );
        await reload();
        await js(
          `tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'fixture-model',apiKey:'dummy-cloud-key'})`,
        );
        for (const op of [
          "cloudEnhance",
          "cloudUpscale",
          "cloudEdit",
          "cloudExtend",
        ]) {
          await select("处理方式", op);
          if (op === "cloudEdit") {
            await click("修改区域");
            await input("选区左侧", 8);
            await input("选区顶部", 6);
            await input("选区宽度", 16);
            await input("选区高度", 12);
            await click("修改区域");
            await click("修改要求");
            await input("云端修改要求", "把选区改成红色", true);
            await click("修改要求 · 已填写");
          }
          if (op === "cloudExtend") {
            await input("扩图宽度", 80);
            await input("扩图高度", 60);
            await click("原图位置");
            await input("原图左侧", 8);
            await input("原图顶部", 6);
            await click("原图位置");
          }
          const task = await submit();
          const result = await done(task.id);
          check(
            op + " actual UI and local native processing complete",
            result.status === "completed",
          );
          await delay(1350);
          await save();
        }
        let r = await save();
        check(
          "four results join shared library without canvas pollution",
          r.document.assets.length === 5 &&
            r.document.tugouCanvas.nodes.length === 0,
        );
        const edit = r.document.assets.find(
            (a) => a.toolResult?.operation === "cloudEdit",
          ),
          pixels = (
            await decode(
              fs.readFileSync(
                path.join(profile, "workspace/resources", edit.resource),
              ),
            )
          ).data;
        let equal = true;
        for (let y = 0; y < 48; y++)
          for (let x = 0; x < 64; x++)
            if (x < 8 || x >= 24 || y < 6 || y >= 18) {
              const i = (y * 64 + x) * 4;
              if (!pixels.subarray(i, i + 4).equals(data.subarray(i, i + 4)))
                equal = false;
            }
        check("desktop output protects every outside RGBA pixel", equal);
        check(
          "mask protocol used only for edit and extend",
          report.requests.map((r) => r.mask).join() === "false,false,true,true",
        );
        await select("处理方式", "cloudEnhance");
        behavior = "large";
        const review = await submit();
        report.reviewId = review.id;
        check(
          "wrong size becomes review instead of silent scaling",
          (await done(review.id)).status === "review",
        );
        await delay(1350);
        check(
          "review does not insert unfinished result",
          (await save()).document.assets.length === 5,
        );
        const raw = await js(`tugou.cloudReview(${JSON.stringify(review.id)})`);
        report.rawResource = raw.asset.resource;
        await js("tugou.saveConnection({clearKey:true})");
        await click("任务");
        await js(
          `document.querySelector('.task-row').querySelectorAll('button')[0].click()`,
        );
        await wait('document.querySelector("img[alt=模型原始返回图]")');
        check(
          "fit requires explicit checkbox",
          await js(
            '[...document.querySelectorAll("button")].find(b=>b.textContent==="缩小并合成").disabled',
          ),
        );
        await click("原始图入库");
        await delay(1400);
        await click("关闭模型原始返回");
        await click("关闭任务");
        r = await save();
        check(
          "raw image separately enters library",
          r.document.assets.length === 6 &&
            r.document.assets.at(-1).resource === raw.asset.resource,
        );
        await click("撤销");
        r = await save();
        check("raw collection is undoable", r.document.assets.length === 5);
        await click("重做");
        await save();
        await click("任务");
        await js(
          `[...document.querySelectorAll('.task-row')].find(e=>e.textContent.includes('待确认')).querySelector('button').click()`,
        );
        await wait('document.querySelector("img[alt=模型原始返回图]")');
        w.setSize(960, 720);
        await delay(100);
        await w.webContents.capturePage(undefined, { stayHidden: true });
        await delay(100);
        fs.writeFileSync(
          path.join(out, "cloud-review-960.png"),
          (
            await w.webContents.capturePage(undefined, { stayHidden: true })
          ).toPNG(),
        );
        await js(
          'document.querySelector("input[aria-label=确认缩小返回图]").click()',
        );
        await delay(50);
        await click("缩小并合成");
        const fit = (await tasks()).at(-1);
        report.fitId = fit.id;
        check(
          "offline fit completes",
          (await done(fit.id)).status === "completed",
        );
        await click("关闭任务");
        await delay(1400);
        r = await save();
        check(
          "aligned image joins separately and model request count unchanged",
          r.document.assets.length === 7 && report.requests.length === 5,
        );
        report.count = r.document.assets.length;
        check(
          "no native temporary job residue",
          fs.readdirSync(path.join(profile, "workspace/cloud-jobs")).length ===
            0,
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("QA window hidden", !w.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.tasks = await tasks();
      report.status = await js(
        'document.querySelector(".message[role=status]")?.textContent',
      );
      finish(1);
    }
  });
});
server.listen(0, "127.0.0.1", () => require("../desktop-main.cjs"));
