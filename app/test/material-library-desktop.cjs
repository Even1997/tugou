const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { encode } = require("../core/cloud-pixels.cjs"),
  { createLayer } = require("../core/layers.cjs");
const out = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  base = require('./qa-paths.cjs').path("material-library");
fs.mkdirSync(base, { recursive: true });
const restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(out, "material-library-desktop.json")),
      )
    : null;
const profile = prior?.profile || fs.mkdtempSync(path.join(base, "profile-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(out, "local-tools-build");
const report = { profile, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      out,
      restart
        ? "material-library-restart.json"
        : "material-library-desktop.json",
    ),
    JSON.stringify(report, null, 2),
  );
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
      delay = (ms) => new Promise((r) => setTimeout(r, ms)),
      check = (n, v) => {
        assert.ok(v, n);
        report.checks.push(n);
      };
    const wait = async (s) => {
      for (let i = 0; i < 600; i++) {
        if (await js(`(async()=>Boolean(await (${s})))()`)) return;
        await delay(30);
      }
      throw Error("timeout " + s);
    };
    const click = async (label, scope = "button") => {
      await js(
        `{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Missing enabled '+${JSON.stringify(label)});b.click()}`,
      );
      await delay(100);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}))}`,
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
    const reload = async (workspace) => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:${JSON.stringify(workspace)}}))`,
      );
      const ready = new Promise((r) =>
        w.webContents.once("did-finish-load", r),
      );
      w.webContents.reload();
      await ready;
      await wait(
        workspace === "layers"
          ? 'document.querySelector(".layer-stage")'
          : 'document.querySelector(".asset-library")',
      );
    };
    const snapshot = async (name) => {
      await delay(120);
      await w.webContents.capturePage();
      fs.writeFileSync(
        path.join(out, name + ".png"),
        (await w.webContents.capturePage()).toPNG(),
      );
    };
    const selectLayer = async () => {
      await js(
        'document.querySelector("button[data-layer-id=subject]").click()',
      );
      await delay(100);
    };
    const pixels = async (doc) => {
      await js(
        fs.readFileSync(path.join(out, "material-engine-qa.js"), "utf8"),
      );
      return js(
        `(async()=>{const e=new fxQA.Compositor(),c=fxQA.surface(100,100);await e.render(${JSON.stringify(doc)},c,{transparent:true});const p=[...c.getContext('2d').getImageData(0,0,100,100).data];e.dispose();return p})()`,
      );
    };
    try {
      await js('console.error("material-library-sentinel")');
      check(
        "console capture verified",
        report.errors.includes("material-library-sentinel"),
      );
      report.errors = [];
      if (restart) {
        report.id = prior.id;
        await reload("layers");
        const r = await save();
        check(
          "replaced content and dropped assets restore",
          r.document.layers.length === 3 &&
            r.document.layers.find((l) => l.id === "subject").assetId ===
              prior.b.id &&
            r.document.assets.length === 4 &&
            r.document.tugouCanvas.nodes.length === 2 &&
            r.document.unknownLibrary.keep,
        );
        await selectLayer();
        await click("素材库", "nav button");
        check(
          "layer selection remains available across workspaces after restart",
          await js(
            '[...document.querySelectorAll("button")].some(b=>b.textContent.trim()==="替换图层")',
          ),
        );
        check(
          "restart never creates model jobs",
          (await js("tugou.tasks()")).length === 0,
        );
      } else {
        const store = async (name, width, height, color) =>
          js(
            `tugou.storeRaster(${JSON.stringify([...(await encode({ width, height, data: Buffer.from(Array.from({ length: width * height }, () => color).flat()) }))])},${JSON.stringify(name)})`,
          );
        const a = await store("原图10", 20, 10, [255, 0, 0, 255]),
          b = await store("原图2", 10, 20, [0, 0, 255, 255]),
          c = await store("处理1", 12, 12, [90, 90, 90, 255]),
          paint = await store("笔刷原稿", 20, 10, [0, 255, 0, 255]);
        b.generation = { model: "fixture" };
        c.toolResult = { source: a, sourceId: a.id, operation: "fixture" };
        report.b = b;
        const group = createLayer("group", {
            id: "group",
            name: "组",
            x: 0,
            y: 0,
          }),
          subject = createLayer("image", {
            id: "subject",
            name: "主体",
            parentId: "group",
            assetId: a.id,
            bitmap: paint,
            x: 30,
            y: 40,
            width: 40,
            height: 20,
            mask: { x: 0, y: 0, width: 0.5, height: 1 },
            effects: [],
            futureLayer: 42,
          });
        report.id = await js(
          `(async()=>{const r=await tugou.create('素材流转验收');await tugou.save(r.id,{...r.document,width:100,height:100,background:'transparent',modules:[{id:'palette-module',name:'模块拖放回归',kind:'action',text:'并肩站立',global:false}],assets:${JSON.stringify([a, b, c])},layers:${JSON.stringify([group, subject])},tugouCanvas:{version:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}},unknownLibrary:{keep:true}},r.revision);return r.id})()`,
        );
        await reload("assets");
        check(
          "newest view does not reorder stored assets",
          await js(
            '[...document.querySelectorAll(".asset-caption strong")].map(x=>x.textContent).join(",")==="处理1,原图2,原图10"',
          ),
        );
        await click("筛选与排序");
        await select("素材来源", "generated");
        await select("素材比例", "portrait");
        check(
          "source and aspect filters combine",
          await js(
            'document.querySelectorAll(".asset-card").length===1&&document.querySelector(".asset-caption strong").textContent==="原图2"',
          ),
        );
        await select("素材比例", "square");
        check(
          "empty filter has actionable state",
          await js('document.body.innerText.includes("没有匹配的素材")'),
        );
        await click("重置筛选");
        await click("筛选与排序");
        await select("素材排序", "name");
        check(
          "natural name sort is stable",
          await js(
            '[...document.querySelectorAll(".asset-caption strong")].map(x=>x.textContent).join(",")==="处理1,原图2,原图10"',
          ),
        );
        await click("筛选与排序");
        await click("图层合成", "nav button");
        await selectLayer();
        let r = await save(),
          before = await pixels(r.document);
        check(
          "existing brush pixels are rendered before replacement",
          before[(50 * 100 + 40) * 4 + 1] === 255,
        );
        await click("素材库", "nav button");
        await js(
          `document.querySelector('input[aria-label="选择 原图2"]').click()`,
        );
        await delay(100);
        await click("替换图层");
        r = await save();
        const layer = r.document.layers.find((l) => l.id === "subject");
        check(
          "library replaces selected layer across workspaces without losing metadata",
          layer.assetId === b.id &&
            layer.width === 40 &&
            layer.height === 80 &&
            layer.x === 30 &&
            layer.y === 10 &&
            layer.futureLayer === 42 &&
            layer.parentId === "group" &&
            !layer.bitmap &&
            r.document.assets.at(-1).id === paint.id &&
            r.document.assets[0].id === a.id,
        );
        const rendered = await pixels(r.document);
        for (let y = 0; y < 100; y++)
          for (let x = 0; x < 100; x++) {
            const i = (y * 100 + x) * 4,
              inside = x >= 30 && x < 50 && y >= 10 && y < 90;
            assert.deepEqual(
              rendered.slice(i, i + 4),
              inside ? [0, 0, 255, 255] : [0, 0, 0, 0],
            );
          }
        check(
          "every output pixel matches new image geometry and preserved mask",
          true,
        );
        await click("撤销");
        r = await save();
        check(
          "one undo restores brush pixels and removes recovery material",
          r.document.layers[1].bitmap.id === paint.id &&
            r.document.assets.length === 3,
        );
        assert.deepEqual(await pixels(r.document), before);
        await click("重做");
        r = await save();
        check(
          "redo restores replacement and original brush material",
          r.document.layers[1].assetId === b.id &&
            r.document.assets.length === 4,
        );
        await click("替换图片", "#canvas-actions button");
        await select("替换素材", c.id);
        await click("确认替换");
        r = await save();
        check(
          "top toolbar reuses replacement dialog",
          r.document.layers[1].assetId === c.id &&
            r.document.layers[1].height === 40,
        );
        await click("撤销");
        await save();
        await click("锁定 组");
        check(
          "group lock disables layer replacement",
          await js(
            '[...document.querySelectorAll("#canvas-actions button")].find(b=>b.textContent.trim()==="替换图片").disabled',
          ),
        );
        await click("素材库", "nav button");
        await js(
          `document.querySelector('input[aria-label="选择 原图10"]').click()`,
        );
        await delay(50);
        check(
          "library respects inherited group lock",
          await js(
            '[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="替换图层").disabled',
          ),
        );
        await click("图层合成", "nav button");
        await click("解锁 组");
        await save();
        await click("素材库", "nav button");
        const begin = async (name) => {
          await js(
            `window.dragQA=new DataTransfer();document.querySelector('button[aria-label="预览 ${name}"]').dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dragQA}))`,
          );
        };
        const hover = async (label) => {
          await js(
            `{const b=[...document.querySelectorAll('nav button')].find(b=>b.getAttribute('title')===${JSON.stringify(label)});b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dragQA}))}`,
          );
          await delay(550);
        };
        await begin("原图2");
        await hover("无限画布");
        await wait('document.querySelector(".flow-surface")');
        await js(
          `{const t=document.querySelector('.flow-surface'),r=t.getBoundingClientRect();t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dragQA,clientX:r.x+80,clientY:r.y+100}))}`,
        );
        await delay(100);
        r = await save();
        check(
          "material drag switches workspace then inserts one positioned canvas reference",
          r.document.tugouCanvas.nodes.length === 1 &&
            r.document.tugouCanvas.nodes[0].data.assetId === b.id &&
            Math.abs(r.document.tugouCanvas.nodes[0].position.x - 80) < 1,
        );
        await click('模块','.palette-tabs button');
        await js(`{const item=document.querySelector('.palette-item'),target=document.querySelector('.flow-surface'),r=target.getBoundingClientRect(),transfer=new DataTransfer();item.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer,clientX:r.x+300,clientY:r.y+100}));}`);
        await delay(100);r=await save();
        check('existing module palette uses the same scoped drag contract',r.document.tugouCanvas.nodes.length===2&&r.document.tugouCanvas.nodes[1].data.binding.moduleId==='palette-module');
        await js(
          `{const t=document.querySelector('.flow-surface');dragQA.setData('application/x-tugou',JSON.stringify({type:'asset',id:${JSON.stringify(b.id)},projectId:'another-project'}));t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dragQA}))}`,
        );
        await delay(100);
        r = await save();
        check(
          "cross-project payload cannot insert an unrelated reference",
          r.document.tugouCanvas.nodes.length === 2,
        );
        await click("素材库", "nav button");
        await begin("原图10");
        await hover("图层合成");
        await wait('document.querySelector(".layer-stage")');
        await js(
          `{const t=document.querySelector('.layer-stage'),r=t.getBoundingClientRect();t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dragQA,clientX:r.x+62.5,clientY:r.y+62.5}))}`,
        );
        await delay(100);
        r = await save();
        check(
          "material drop into composition creates one new image layer",
          r.document.layers.length === 3 &&
            r.document.layers.at(-1).assetId === a.id &&
            r.document.assets.length === 4,
        );
        await click("撤销");
        r = await save();
        check("drop is one undoable edit", r.document.layers.length === 2);
        await click("重做");
        r = await save();
        check(
          "drop redo restores exact asset reference",
          r.document.layers.at(-1).assetId === a.id,
        );
        await click("素材库", "nav button");
        w.setSize(960, 800);
        await snapshot("material-library-dark-960");
        check(
          "top toolbar wraps within narrow desktop",
          await js(
            'document.querySelector(".library-toolbar").scrollWidth<=innerWidth&&document.querySelector(".asset-grid").getBoundingClientRect().height>200',
          ),
        );
        await click("切换浅色主题");
        await click("筛选与排序");
        await snapshot("material-library-light-960");
        check(
          "filters follow light theme",
          await js('document.documentElement.dataset.theme==="light"'),
        );
        await click("筛选与排序");
        r = await save();
        check(
          "all sources, unknown data and no model calls preserved",
          r.document.unknownLibrary.keep &&
            r.document.assets
              .slice(0, 3)
              .map((a) => a.id)
              .join(",") === [a, b, c].map((a) => a.id).join(",") &&
            (await js("tugou.tasks()")).length === 0,
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("QA window stays hidden", !w.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.text = await js("document.body.innerText");
      await snapshot("material-library-failure");
      finish(1);
    }
  });
});
require("../desktop-main.cjs");
