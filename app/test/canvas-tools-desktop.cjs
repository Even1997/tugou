const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { encode, decode } = require("../core/cloud-pixels.cjs");
const out = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(fs.readFileSync(path.join(out, "canvas-tools-desktop.json")))
    : null;
const base = require('./qa-paths.cjs').path("canvas-tools");
fs.mkdirSync(base, { recursive: true });
const profile = prior?.profile || fs.mkdtempSync(path.join(base, "profile-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [] };
let releaseRequest;
const server=require('node:http').createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c);
  const form=await new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,body:Buffer.concat(chunks)}).formData();
  report.cloudRequest={url:req.url,model:form.get('model'),hasMask:Boolean(form.get('mask')),images:[...form.keys()].filter(k=>k.startsWith('image')).length};
  await new Promise(r=>releaseRequest=r);
  res.end(JSON.stringify({data:[{b64_json:(await encode({width:32,height:24,data:Buffer.alloc(32*24*4,255)})).toString('base64')}]}));
});
const end = (code) => {
  fs.writeFileSync(
    path.join(
      out,
      restart ? "canvas-tools-restart.json" : "canvas-tools-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
  releaseRequest?.();server.closeAllConnections();server.close();app.exit(code);
};
setTimeout(() => {
  report.failure = "timeout";
  end(1);
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
    const check = (name, v) => {
      assert.ok(v, name);
      report.checks.push(name);
    };
    const wait = async (s) => {
      for (let i = 0; i < 800; i++) {
        if (await js(`(async()=>Boolean(await (${s})))()`)) return;
        await delay(30);
      }
      throw Error("timeout " + s);
    };
    const click = async (label, scope = "button") => {
      await js(
        `{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing/enabled '+${JSON.stringify(label)});b.click()}`,
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
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}))}`,
      );
      await delay(70);
      await js(
        `document.querySelector('input[aria-label=${JSON.stringify(label)}]').dispatchEvent(new FocusEvent('focusout',{bubbles:true}))`,
      );
      await delay(70);
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
    try {
      await js('console.error("canvas-tools-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("canvas-tools-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload();
        const r = await save();
        check(
          "results, nodes and unknown fields restore",
          r.document.assets.length === 6 &&
            r.document.tugouCanvas.nodes.length === 8 &&
            r.document.unknownCanvasTools.keep &&
            r.document.tugouCanvas.futureGraph === 42,
        );
        check(
          "completed processing tasks do not resubmit",
          (await js("tugou.tasks()")).map(t=>t.status).join(',') === 'completed,completed,cancelled' && !report.cloudRequest,
        );
        await click("原图A", ".palette-item");
        await click("图片工具");
        await click("主体抠图");
        check(
          "reopened node resolves shared original source",
          await js(
            `document.querySelector('select[aria-label="处理来源"]').value===${JSON.stringify(prior.sources[0].id)}`,
          ),
        );
        await click("关闭图片处理");
      } else {
        const data = Buffer.alloc(32 * 24 * 4);
        for (let i = 0; i < 32 * 24; i++)
          data.set(
            i % 2
              ? [255, 0, 0, [64, 128, 255][i % 3]]
              : [0, 255, 0, [64, 128, 255][i % 3]],
            i * 4,
          );
        const a = await js(
            `tugou.storeRaster(${JSON.stringify([...(await encode({ width: 32, height: 24, data }))])},'原图A')`,
          ),
          b = await js(
            `tugou.storeRaster(${JSON.stringify([...(await encode({ width: 24, height: 48, data: Buffer.from(Array.from({ length: 24 * 48 }, () => [0, 0, 255, 128]).flat()) }))])},'原图B')`,
          );
        report.sources = [a, b];
        const nodes = [
          {
            id: "source-a",
            type: "asset",
            position: { x: 100, y: 100 },
            data: { assetId: a.id, role: "主体身份", futureNode: "keep" },
          },
          {
            id: "source-b",
            type: "asset",
            position: { x: 500, y: 100 },
            data: { assetId: b.id, role: "主体身份" },
          },
          {
            id: "duplicate-a",
            type: "asset",
            position: { x: 900, y: 100 },
            data: { assetId: a.id, role: "主体身份" },
          },
          {
            id: "text",
            type: "text",
            position: { x: 100, y: 400 },
            data: { name: "说明", text: "不参与图片处理" },
          },
        ];
        report.id = await js(
          `(async()=>{const r=await tugou.create('画布图片工具验收');await tugou.save(r.id,{...r.document,assets:${JSON.stringify([a, b])},tugouCanvas:{version:1,nodes:${JSON.stringify(nodes)},edges:[],viewport:{x:0,y:0,zoom:0.7},futureGraph:42},unknownCanvasTools:{keep:true}},r.revision);return r.id})()`,
        );
        await reload();
        await click("原图A", ".palette-item");
        await click("裁剪", "#canvas-actions button");
        await wait('document.querySelector(".image-processing-dialog")');
        check(
          "image processing opens inside canvas with exact selected source",
          await js(
            `!!document.querySelector('.canvas-workspace')&&document.querySelector('select[aria-label="处理方式"]').value==='crop'&&document.querySelector('select[aria-label="处理来源"]').value===${JSON.stringify(a.id)}`,
          ),
        );
        check(
          "available cloud tools have no stale unavailable placeholder",
          await js(
            '![...document.querySelectorAll("select[aria-label=处理方式] option")].some(o=>o.disabled)',
          ),
        );
        check(
          "crop parameters start from original dimensions",
          await js(
            'document.querySelector(".image-tool-parameters").textContent.includes("32")',
          ),
        );
        await click("框选参数");
        await fill("选区左侧", 8);
        await fill("选区顶部", 4);
        await fill("选区宽度", 16);
        await fill("选区高度", 12);
        await click("框选参数");
        await click("开始处理");
        await click("关闭图片处理");
        await wait(
          '(async()=>{const ts=await tugou.tasks();return ts.some(t=>t.status==="completed")})()',
        );
        // Wait for the shared result poll, not only the persisted task status.
        await delay(1500);
        await click("裁剪", "#canvas-actions button");
        await wait(
          '[...document.querySelectorAll(".image-tools-footer button")].some(b=>b.textContent.trim()==="加入画布"&&!b.disabled)',
        );
        await click("加入画布", ".image-tools-footer button");
        let r = await save();
        const crop = r.document.assets.find(
          (a) => a.toolResult?.operation === "crop",
        );
        assert.ok(crop);
        report.crop = crop.id;
        const p = await decode(
          fs.readFileSync(
            path.join(profile, "workspace/resources", crop.resource),
          ),
        );
        assert.equal(p.width, 16);
        assert.equal(p.height, 12);
        for (let y = 0; y < 12; y++)
          assert.deepEqual(
            p.data.subarray(y * 16 * 4, (y + 1) * 16 * 4),
            data.subarray(((y + 4) * 32 + 8) * 4, ((y + 4) * 32 + 24) * 4),
          );
        check("crop output preserves every selected RGBA pixel", true);
        assert.deepEqual(r.document.tugouCanvas.nodes.slice(0, 4), nodes);
        assert.equal(r.document.tugouCanvas.nodes[4].position.x, 430);
        check(
          "new result placed beside source without changing original nodes",
          true,
        );
        await click("撤销");
        check(
          "canvas result insertion is undoable",
          (await save()).document.tugouCanvas.nodes.length === 4,
        );
        await click("重做");
        check(
          "redo restores result node",
          (await save()).document.tugouCanvas.nodes.length === 5,
        );
        await js(
          'document.querySelector(".canvas-workspace").dispatchEvent(new KeyboardEvent("keydown",{key:"a",ctrlKey:true,bubbles:true}))',
        );
        await delay(120);
        await click("放大", "#canvas-actions button");
        await select("处理方式", "mirror");
        await click("批量处理");
        check(
          "batch receives unique selected image assets and ignores text nodes",
          await js(
            'document.querySelectorAll(".batch-asset input:checked").length===3',
          ),
        );
        await click("提交 3 张");
        await wait('document.querySelectorAll(".processing-item").length===4');
        await click("本组加入画布");
        r = await save();
        check(
          "whole batch enters canvas in one operation",
          r.document.assets.length === 6 &&
            r.document.tugouCanvas.nodes.length === 8,
        );
        // Offscreen nodes are intentionally unmounted; frame the outputs before measuring them.
        await click("适应画布");
        await wait(`${JSON.stringify(r.document.tugouCanvas.nodes.slice(5).map(n=>n.id))}.every(id=>document.querySelector('.react-flow__node[data-id="'+id+'"]'))`);
        const rects = await js(
          `[${r.document.tugouCanvas.nodes
            .slice(5)
            .map((n) => JSON.stringify(n.id))
            .join(
              ",",
            )}].map(id=>{const r=document.querySelector('.react-flow__node[data-id="'+id+'"]').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})`,
        );
        check(
          "landscape and portrait result nodes do not overlap",
          rects.every((a, i) =>
            rects
              .slice(i + 1)
              .every(
                (b) =>
                  a.x + a.width <= b.x ||
                  b.x + b.width <= a.x ||
                  a.y + a.height <= b.y ||
                  b.y + b.height <= a.y,
              ),
          ),
        );
        const batch = r.document.assets.filter(
          (a) => a.toolResult?.operation === "mirror",
        );
        assert.equal(batch.length, 3);
        for (const result of batch) {
          const src = r.document.assets.find(
              (a) => a.id === result.toolResult.sourceId,
            ),
            raw = await decode(
              fs.readFileSync(
                path.join(profile, "workspace/resources", src.resource),
              ),
            ),
            mirrored = await decode(
              fs.readFileSync(
                path.join(profile, "workspace/resources", result.resource),
              ),
            );
          for (let y = 0; y < raw.height; y++)
            for (let x = 0; x < raw.width; x++)
              assert.deepEqual(
                mirrored.data.subarray(
                  (y * raw.width + x) * 4,
                  (y * raw.width + x + 1) * 4,
                ),
                raw.data.subarray(
                  (y * raw.width + raw.width - 1 - x) * 4,
                  (y * raw.width + raw.width - x) * 4,
                ),
              );
        }
        check("all batch output RGBA pixels match mirrored original", true);
        await click("撤销");
        check(
          "whole group node insertion undoes together",
          (await save()).document.tugouCanvas.nodes.length === 5,
        );
        await click("重做");
        await save();
        await click("素材库", "nav button");
        await click("预览 原图B");
        await click("处理图片");
        check(
          "material detail shares tool with selected source",
          await js(
            `document.querySelector('select[aria-label="处理来源"]').value===${JSON.stringify(b.id)}&&!!document.querySelector('.asset-library')`,
          ),
        );
        await click("关闭图片处理");
        await js(
          `[${JSON.stringify(a.name)},${JSON.stringify(b.name)}].forEach(name=>document.querySelector('input[aria-label="选择 '+name+'"]').click())`,
        );
        await delay(100);
        await click("处理所选 (2)");
        await click("批量处理");
        check(
          "library selection carries into batch editor",
          await js(
            'document.querySelectorAll(".batch-asset input:checked").length===2',
          ),
        );
        await click("返回");
        w.setSize(960, 720);
        await delay(300);
        await w.capturePage();
        await delay(150);
        fs.writeFileSync(
          path.join(out, "canvas-tools-960.png"),
          (await w.capturePage()).toPNG(),
        );
        check(
          "narrow dialog actions remain within window",
          await js(
            '[...document.querySelectorAll(".image-processing-dialog .image-tools-footer button")].every(b=>{const r=b.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})',
          ),
        );
        await click("关闭图片处理");
        await click("无限画布", "nav button");
        await click("原图A", ".palette-item");
        await click("图片工具");
        await click("局部修改");
        check(
          "cloud tool uses same selected original and shared controls",
          await js(
            `document.querySelector('select[aria-label="处理方式"]').value==='cloudEdit'&&document.querySelector('select[aria-label="处理来源"]').value===${JSON.stringify(a.id)}`,
          ),
        );
        await js(`tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',model:'canvas-fixture',apiKey:'fixture-secret'})`);
        await click('修改要求');await js(`{const e=document.querySelector('textarea[aria-label="云端修改要求"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'换成蓝色');e.dispatchEvent(new Event('input',{bubbles:true}))}`);await delay(100);await click('修改要求 · 已填写');
        await click('提交云端');for(let i=0;i<400&&!report.cloudRequest;i++)await delay(25);
        check('canvas cloud entry sends original and mask through shared connection',report.cloudRequest?.model==='canvas-fixture'&&report.cloudRequest.images===1&&report.cloudRequest.hasMask);
        await click('取消云端任务');releaseRequest();await delay(600);
        check('cancel from nested tool dialog rejects late provider result',(await js('tugou.tasks()')).at(-1).status==='cancelled');
        await click("关闭图片处理");
        await click("图片工具");
        await click("AI 超分辨率");
        check(
          "AI upscale uses existing model controls",
          await js('!!document.querySelector("select[aria-label=超分模型]")'),
        );
        await click("关闭图片处理");
        await click("切换浅色主题");
        await click("裁剪", "#canvas-actions button");
        await delay(250);
        await w.capturePage();
        await delay(100);
        fs.writeFileSync(
          path.join(out, "canvas-tools-light-960.png"),
          (await w.capturePage()).toPNG(),
        );
        check(
          "shared tool dialog follows light theme",
          await js('document.documentElement.dataset.theme==="light"'),
        );
        await click("关闭图片处理");
        await click("切换深色主题");
        check(
          "only explicit jobs submitted; cancelled cloud output is not published",
          (await js("tugou.tasks()")).length === 3,
        );
        r = await save();
        assert.equal(r.document.assets.length,6);
        check(
          "unknown data and all original references preserved",
          r.document.unknownCanvasTools.keep &&
            r.document.tugouCanvas.futureGraph === 42 &&
            r.document.tugouCanvas.nodes[0].data.futureNode === "keep",
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("QA window stays hidden", !w.isVisible());
      end(0);
    } catch (e) {
      report.failure = e.stack;
      report.text = await js("document.body.innerText");
      end(1);
    }
  });
});
server.listen(0,'127.0.0.1',()=>require("../desktop-main.cjs"));
