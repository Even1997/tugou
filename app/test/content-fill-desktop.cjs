const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  large = process.argv.includes("--large"),
  stem = large ? "content-fill-large" : "content-fill-desktop";
const prior = restart
    ? JSON.parse(fs.readFileSync(path.join(output, stem + ".json"), "utf8"))
    : null,
  profile =
    prior?.profile ||
    fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tugou-fill-ui-"));
process.env.TUGOU_DATA_DIR = profile;
const report = { profile, checks: [], errors: [], platform: process.platform },
  finish = (code) => {
    fs.writeFileSync(
      path.join(output, stem + (restart ? "-restart" : "") + ".json"),
      JSON.stringify(report, null, 2),
    );
    app.exit(code);
  };
const timer = setTimeout(() => {
  report.failure = "Timed out";
  finish(1);
}, 120000);
app.on("browser-window-created", (_e, window) => {
  window.show=()=>{}; window.focus=()=>{}; window.webContents.setBackgroundThrottling(false);
  window.webContents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms)),
      check = (n, ok) => {
        assert.ok(ok, n);
        report.checks.push(n);
      };
    const wait = async (code) => {
      for (let i = 0; i < 400; i++) {
        if (await js(code)) return;
        await delay(30);
      }
      throw new Error("Timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(60);
    };
    const inject = () =>
      js(
        fs.readFileSync(
          path.join(output, "content-fill-engine-qa.js"),
          "utf8",
        ) + ";void 0;",
      );
    const reopen = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'layers'}))`,
      );
      const loaded = new Promise((r) =>
        window.webContents.once("did-finish-load", r),
      );
      window.webContents.reload();
      await loaded;
      await wait('document.querySelector(".layer-stage canvas")?.width>0');
      await inject();
      await js(
        "document.querySelector('.layer-row button[title=\"填充样图\"]').click()",
      );
      await delay(60);
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const pixels = (doc) =>
      js(
        `(async()=>{const d=${JSON.stringify(doc)},e=new fillQA.Compositor(),c=fillQA.surface(d.width,d.height);await e.render(d,c,{transparent:true});const rgba=[...c.getContext('2d').getImageData(0,0,c.width,c.height).data];e.dispose();return rgba})()`,
      );
    const openMenu = async (name) => {
      await js(
        `[...document.querySelectorAll('.layer-menu')].find(m=>m.querySelector('summary').textContent===${JSON.stringify(name)}).open=true`,
      );
      await delay(50);
    };
    const fill = async () => {
      await openMenu("修图");
      await click("内容感知填充");
      await wait(
        '!document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
      );
    };
    try {
      await wait('document.querySelector(".studio-header")');
      await inject();
      if (large) {
        if (restart) {
          report.result = prior.result;
          const restored = await js(
            `(async()=>{const e=new fillQA.Compositor(),i=await e.image(${JSON.stringify(prior.result.bitmap)}),c=fillQA.surface(48,48);c.getContext('2d').drawImage(i,9940,9940,48,48,0,0,48,48);return {width:i.naturalWidth,height:i.naturalHeight,rgba:[...c.getContext('2d').getImageData(0,0,48,48).data]}})()`,
          );
          check(
            "100MP PNG restores original dimensions and exact far-edge pixels",
            restored.width === 10000 &&
              restored.height === 10000 &&
              JSON.stringify(restored.rgba) ===
                JSON.stringify(prior.result.rgba),
          );
        } else {
          report.result = await js("fillQA.verifyLarge()");
          check(
            "100MP uses local sampling ROI under 4MP",
            report.result.width === 10000 &&
              report.result.height === 10000 &&
              report.result.roi.width * report.result.roi.height < 4000000,
          );
          check(
            "100MP far-edge hole filled and surrounding pixels preserved",
            report.result.rgba.every(
              (v, i) => v === [123, 140, 157, 255][i % 4],
            ),
          );
          report.processMemory = app
            .getAppMetrics()
            .map((p) => ({ type: p.type, memory: p.memory }));
        }
      } else if (restart) {
        report.id = prior.id;
        await reopen();
        const saved = await js(`tugou.open(${JSON.stringify(report.id)})`);
        check(
          "new process restores complete document",
          JSON.stringify(saved.document) === JSON.stringify(prior.document),
        );
        check(
          "new process restores every filled pixel",
          JSON.stringify(await pixels(saved.document)) ===
            JSON.stringify(prior.pixels),
        );
      } else {
        const result = await js("fillQA.verify()");
        report.checks.push(...result.checks);
        report.cancelMs = result.cancelMs;
        report.featherMax = result.featherMax;
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(`fillQA.fixture(${JSON.stringify(report.id)})`);
        await reopen();
        await openMenu("选区");
        check(
          "selection menu exposes content-aware fill",
          await js(
            '[...document.querySelectorAll(".layer-menu[open] button")].some(b=>b.textContent==="内容感知填充"&&!b.disabled)',
          ),
        );
        await js('document.querySelector(".layer-menu[open]").open=false');
        await js(
          `{const e=document.querySelector('select[aria-label="当前编辑工具"]');e.value='rect';e.dispatchEvent(new Event('change',{bubbles:true}));}`,
        );
        await delay(40);
        const points = await js(
          `(()=>{const b=document.querySelector('.layer-stage').getBoundingClientRect(),m=document.querySelector('.layer-overlay >g').transform.baseVal.consolidate().matrix;return [[118,86],[138,106]].map(([x,y])=>({x:Math.round(b.x+m.e+x*m.a),y:Math.round(b.y+m.f+y*m.d)}))})()`,
        );
        window.webContents.sendInputEvent({
          type: "mouseDown",
          button: "left",
          clickCount: 1,
          ...points[0],
        });
        window.webContents.sendInputEvent({
          type: "mouseMove",
          ...points[1],
          modifiers: ["leftButtonDown"],
        });
        window.webContents.sendInputEvent({
          type: "mouseUp",
          button: "left",
          clickCount: 1,
          ...points[1],
        });
        await delay(100);
        const baseline = await save(),
          original = await pixels(baseline.document);
        check(
          "native rectangle creates document selection",
          baseline.document.selection.paths[0].points.length === 8,
        );
        fs.writeFileSync(
          path.join(output, "content-fill-before.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        await fill();
        const edited = await save(),
          rgba = await pixels(edited.document);
        check(
          "toolbar fill replaces only image bitmap",
          !!edited.document.layers[0].bitmap &&
            edited.document.layers.length === 1 &&
            edited.document.assets.length === 1,
        );
        check(
          "source, unknown fields and selection preserved",
          JSON.stringify(edited.document.assets) ===
            JSON.stringify(baseline.document.assets) &&
            edited.document.futureField.keep &&
            edited.document.layers[0].futureLayer === "保留" &&
            JSON.stringify(edited.document.selection) ===
              JSON.stringify(baseline.document.selection),
        );
        check(
          "actual fill restores periodic pattern in entire image",
          rgba.every((v, i) => {
            const p = Math.floor(i / 4),
              x = p % 256,
              y = Math.floor(p / 256),
              s = (((x >> 3) + (y >> 3)) % 2) * 180 + 30;
            return Math.abs(v - [s, s * 0.8, s * 0.6, 255][i % 4]) <= 0.5;
          }),
        );
        await click("撤销");
        check(
          "one undo restores exact original bitmap and selection",
          JSON.stringify((await save()).document) ===
            JSON.stringify(baseline.document) &&
            JSON.stringify(await pixels(baseline.document)) ===
              JSON.stringify(original),
        );
        await click("重做");
        check(
          "redo restores exact result",
          JSON.stringify((await save()).document) ===
            JSON.stringify(edited.document),
        );
        const exportPath = path.join(profile, "fill.png");
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: exportPath,
        });
        await click("导出 PNG");
        for (let i = 0; i < 200 && !fs.existsSync(exportPath); i++)
          await delay(30);
        const exported = await js(
          `(async()=>{const b=await createImageBitmap(new Blob([new Uint8Array(${JSON.stringify([...fs.readFileSync(exportPath)])})],{type:'image/png'})),c=fillQA.surface(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data]})()`,
        );
        check(
          "toolbar PNG export matches every result pixel",
          JSON.stringify(exported) === JSON.stringify(rgba),
        );
        fs.writeFileSync(
          path.join(output, "content-fill-after.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        window.setSize(960, 740);
        await delay(100);
        await openMenu("修图");
        check(
          "960px menu and parameter row fit viewport",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".layer-menu[open] .layer-menu-body").getBoundingClientRect().right<=innerWidth',
          ),
        );
        fs.writeFileSync(
          path.join(output, "content-fill-960.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        await js('document.querySelector(".layer-menu[open]").open=false');
        // A noisy, nonrepeating source makes cancellation exercise a running Worker.
        await js(
          `(async()=>{const c=fillQA.surface(1024,1024),ctx=c.getContext('2d'),d=ctx.createImageData(1024,1024);for(let y=0;y<1024;y++)for(let x=0;x<1024;x++)d.data.set([x%251,y%239,(x*y)%253,255],(y*1024+x)*4);ctx.putImageData(d,0,0);const a=await tugou.storeRaster(await fillQA.pngBytes(c),'取消验收'),r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,width:1024,height:1024,assets:[a],layers:[fillQA.createLayer('image',{name:'填充样图',assetId:a.id,x:0,y:0,width:1024,height:1024})],selection:{paths:[{operation:'add',points:[280,280,740,280,740,740,280,740]}]}},r.revision)})()`,
        );
        await reopen();
        const cancelBaseline = await save();
        await openMenu("修图");
        await click("内容感知填充");
        await wait(
          'document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
        );
        await click("取消填充");
        await wait(
          '!document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
        );
        check(
          "cancel button prevents document mutation",
          JSON.stringify((await save()).document) ===
            JSON.stringify(cancelBaseline.document),
        );
        await openMenu("修图");
        await click("内容感知填充");
        await wait(
          'document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
        );
        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
        await wait(
          '!document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
        );
        check(
          "Escape prevents late fill commit",
          JSON.stringify((await save()).document) ===
            JSON.stringify(cancelBaseline.document),
        );
        await openMenu("修图");
        await click("内容感知填充");
        await wait(
          'document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
        );
        await openMenu("添加");
        await click("矩形");
        await wait(
          '!document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
        );
        const changed = await save();
        check(
          "editing during fill cancels Worker and preserves newer edits",
          changed.document.layers.length === 2 &&
            !changed.document.layers[0].bitmap,
        );
        await click("撤销");
        check(
          "canceled fill adds no undo entry",
          JSON.stringify((await save()).document) ===
            JSON.stringify(cancelBaseline.document),
        );
        await js(
          "document.querySelector('.layer-row button[title=\"填充样图\"]').click()",
        );
        await delay(50);
        await openMenu("修图");
        await click("内容感知填充");
        await wait(
          'document.querySelector(".layer-parameter-row").textContent.includes("取消填充")',
        );
        await click("无限画布");
        await delay(100);
        check(
          "leaving editor aborts without overwriting document",
          JSON.stringify((await save()).document) ===
            JSON.stringify(cancelBaseline.document),
        );
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,${JSON.stringify(edited.document)},r.revision)})()`,
        );
        await reopen();
        report.document = (await save()).document;
        report.pixels = await pixels(report.document);
      }
      check("no renderer errors", report.errors.length === 0);
      clearTimeout(timer);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      clearTimeout(timer);
      finish(1);
    }
  });
});
require("../main.cjs");
