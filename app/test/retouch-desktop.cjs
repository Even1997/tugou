const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  large = process.argv.includes("--large");
const prior = restart
  ? JSON.parse(
      fs.readFileSync(
        path.join(
          output,
          large ? "retouch-large.json" : "retouch-desktop.json",
        ),
        "utf8",
      ),
    )
  : null;
const profile =
  prior?.profile ||
  fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "tugou-retouch-ui-"));
process.env.TUGOU_DATA_DIR = profile;
const report = { profile, checks: [], errors: [], platform: process.platform };
const finish = (code) => {
  fs.writeFileSync(
    path.join(
      output,
      large
        ? restart
          ? "retouch-large-restart.json"
          : "retouch-large.json"
        : restart
          ? "retouch-restart.json"
          : "retouch-desktop.json",
    ),
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
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (name, ok) => {
      assert.ok(ok, name);
      report.checks.push(name);
    };
    const wait = async (code) => {
      for (let i = 0; i < 300; i++) {
        if (await js(code)) return;
        await delay(40);
      }
      throw new Error("Timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(75);
    };
    const inject = () =>
      js(
        fs.readFileSync(path.join(output, "retouch-engine-qa.js"), "utf8") +
          ";void 0;",
      );
    const reopen = async (id) => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(id)},workspace:'layers'}))`,
      );
      const loaded = new Promise((r) =>
        window.webContents.once("did-finish-load", r),
      );
      window.webContents.reload();
      await loaded;
      await wait('document.querySelector(".layer-stage canvas")?.width>0');
      await inject();
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`window.tugou.open(${JSON.stringify(report.id)})`);
    };
    const pixels = (doc) =>
      js(
        `(async()=>{const d=${JSON.stringify(doc)},e=new retouchQA.Compositor(),c=retouchQA.surface(d.width,d.height);await e.render(d,c,{transparent:true});return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data]})()`,
      );
    const location = async (x, y) =>
      js(
        `(()=>{const b=document.querySelector('.layer-stage').getBoundingClientRect(),m=document.querySelector('.layer-overlay >g').transform.baseVal.consolidate().matrix;return {x:Math.round(b.x+m.e+${x}*m.a),y:Math.round(b.y+m.f+${y}*m.d)}})()`,
      );
    const sample = async (button = false) => {
      if (button) await click("设置来源");
      const p = await location(48, 96);
      window.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...p,
        modifiers: button ? [] : ["alt"],
      });
      window.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...p,
      });
      await delay(80);
    };
    const drag = async (cancel = false) => {
      const from = await location(128, 96),
        to = await location(150, 96);
      window.webContents.sendInputEvent({ type: "mouseMove", ...from });
      window.webContents.sendInputEvent({
        type: "mouseDown",
        button: "left",
        clickCount: 1,
        ...from,
      });
      await delay(50);
      for (let i = 1; i <= 6; i++) {
        window.webContents.sendInputEvent({
          type: "mouseMove",
          x: Math.round(from.x + ((to.x - from.x) * i) / 6),
          y: from.y,
          modifiers: ["leftButtonDown"],
        });
        await delay(20);
      }
      if (cancel) {
        window.webContents.sendInputEvent({
          type: "keyDown",
          keyCode: "Escape",
        });
        window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
      }
      window.webContents.sendInputEvent({
        type: "mouseUp",
        button: "left",
        clickCount: 1,
        ...to,
      });
      await delay(80);
      await wait(
        '!document.querySelector(".layer-parameter-row").textContent.includes("正在保存")',
      );
    };
    const tool = async (id) => {
      await js(
        `{const e=document.querySelector('select[aria-label="当前编辑工具"]');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));}`,
      );
      await delay(60);
    };
    try {
      await wait('document.querySelector(".studio-header")');
      await inject();
      if (large) {
        if (restart) {
          for (const result of prior.results) {
            const restored = await js(
              `(async()=>{const e=new retouchQA.Compositor(),image=await e.image(${JSON.stringify(result.bitmap)}),c=retouchQA.surface(64,64);c.getContext('2d').drawImage(image,9920,9920,64,64,0,0,64,64);const rgba=[...c.getContext('2d').getImageData(0,0,64,64).data];e.dispose();return {width:image.naturalWidth,height:image.naturalHeight,rgba}})()`,
            );
            check(
              `${result.tool} 100MP PNG restores exact far-edge pixels in a fresh process`,
              restored.width === 10000 &&
                restored.height === 10000 &&
                JSON.stringify(restored.rgba) === JSON.stringify(result.rgba),
            );
          }
        } else {
          report.results = await js("retouchQA.verifyLarge()");
          for (const r of report.results)
            check(
              `${r.tool} processes and stores 100MP at original resolution`,
              r.bitmap.width === 10000 && r.bitmap.height === 10000,
            );
          report.processMemory = app
            .getAppMetrics()
            .map((p) => ({ type: p.type, memory: p.memory }));
        }
      } else if (restart) {
        report.id = prior.id;
        await reopen(report.id);
        const saved = await js(
          `window.tugou.open(${JSON.stringify(report.id)})`,
        );
        check(
          "fresh process restores all retouch document fields",
          JSON.stringify(saved.document) === JSON.stringify(prior.document),
        );
        check(
          "fresh process renders identical retouched pixels",
          JSON.stringify(await pixels(saved.document)) ===
            JSON.stringify(prior.pixels),
        );
      } else {
        const result = await js("retouchQA.verify()");
        report.checks.push(...result.checks);
        report.cancelMs = result.cancelMs;
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(
          `(async()=>{const c=retouchQA.surface(256,192),ctx=c.getContext('2d'),data=ctx.createImageData(256,192);for(let y=0;y<192;y++)for(let x=0;x<256;x++){const n=(y*256+x)*4;data.data.set([100+(x%16)*5,100+(y%16)*5,150,255],n);}ctx.putImageData(data,0,0);ctx.fillStyle='#050505';ctx.fillRect(123,91,10,10);const asset=await tugou.storeRaster(await retouchQA.pngBytes(c),'修图样图'),r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,width:256,height:192,futureField:{keep:true},assets:[asset],layers:[retouchQA.createLayer('image',{name:'修图样图',x:0,y:0,width:256,height:192,assetId:asset.id,futureLayer:'保留'})]},r.revision)})()`,
        );
        await reopen(report.id);
        await js(
          `document.querySelector('.layer-row button[title="修图样图"]').click()`,
        );
        await delay(60);
        const baseline = await save(),
          original = await pixels(baseline.document);
        const stageTop = await js(
          'document.querySelector(".layer-stage").getBoundingClientRect().top',
        );
        await tool("clone");
        await drag();
        check(
          "missing-source error leaves document and stage geometry unchanged",
          JSON.stringify((await save()).document) ===
            JSON.stringify(baseline.document) &&
            (await js(
              'document.querySelector(".layer-stage").getBoundingClientRect().top',
            )) === stageTop,
        );
        const previews = [];
        for (const id of ["clone", "heal", "blur", "smudge", "liquify"]) {
          await tool(id);
          if (id === "clone" || id === "heal") await sample(id === "heal");
          if (id === "clone")
            check(
              "Alt sample creates visible source marker",
              await js('!!document.querySelector("[aria-label=修图来源]")'),
            );
          if (id === "heal")
            check(
              "sample button resets source without a stroke",
              !(await js(
                'document.querySelector(".statusbar").textContent.includes("未保存")',
              )),
            );
          await drag();
          const edited = await save(),
            rgba = await pixels(edited.document);
          check(
            `${id} native drag changes original-resolution pixels`,
            JSON.stringify(rgba) !== JSON.stringify(original),
          );
          check(
            `${id} retains source asset and unknown fields`,
            edited.document.assets[0].resource ===
              baseline.document.assets[0].resource &&
              edited.document.futureField.keep &&
              edited.document.layers[0].futureLayer === "保留",
          );
          await click("撤销");
          check(
            `${id} undo restores original pixels`,
            JSON.stringify(await pixels((await save()).document)) ===
              JSON.stringify(original),
          );
          await click("重做");
          const redone = await save();
          check(
            `${id} redo restores exact edited pixels`,
            JSON.stringify(await pixels(redone.document)) ===
              JSON.stringify(rgba),
          );
          const exportPath = path.join(profile, `${id}.png`);
          dialog.showSaveDialog = async () => ({
            canceled: false,
            filePath: exportPath,
          });
          await click("导出 PNG");
          for (let i = 0; i < 200 && !fs.existsSync(exportPath); i++)
            await delay(30);
          const png = fs.readFileSync(exportPath),
            exported = await js(
              `(async()=>{const b=await createImageBitmap(new Blob([new Uint8Array(${JSON.stringify([...png])})],{type:'image/png'})),c=retouchQA.surface(b.width,b.height);c.getContext('2d').drawImage(b,0,0);b.close();return [...c.getContext('2d').getImageData(0,0,c.width,c.height).data]})()`,
            );
          check(
            `${id} top-toolbar PNG export matches every rendered pixel`,
            JSON.stringify(exported) === JSON.stringify(rgba),
          );
          previews.push({ tool: id, png: png.toString("base64") });
          await drag(true);
          check(
            `${id} Escape cancels without changing document`,
            JSON.stringify((await save()).document) ===
              JSON.stringify(redone.document),
          );
          if (id === "liquify") {
            report.document = redone.document;
            report.pixels = rgba;
          } else {
            await click("撤销");
            await save();
          }
        }
        await tool("clone");
        await sample();
        await click("笔刷设置");
        await delay(100);
        check(
          "aligned-source setting uses shared toolbar popover",
          await js(
            'document.querySelector(".tool-popover").textContent.includes("跨笔对齐")',
          ),
        );
        await click("笔刷设置");
        await fs.promises.writeFile(
          path.join(output, "retouch-dark.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        window.setSize(960, 740);
        await delay(150);
        check(
          "960px top tools and parameters stay within viewport",
          await js(
            'document.documentElement.scrollWidth<=innerWidth&&document.querySelector(".layer-parameter-row").getBoundingClientRect().height<65',
          ),
        );
        await fs.promises.writeFile(
          path.join(output, "retouch-960.png"),
          (await window.webContents.capturePage()).toPNG(),
        );
        const gallery = await js(
          `(async()=>{const c=retouchQA.surface(1280,232),x=c.getContext('2d');x.fillStyle='#f2f2f2';x.fillRect(0,0,1280,232);x.font='16px sans-serif';for(const [i,a] of ${JSON.stringify(previews)}.entries()){const img=new Image();img.src='data:image/png;base64,'+a.png;await img.decode();x.fillStyle='#222';x.fillText(a.tool,i*256+12,24);x.drawImage(img,i*256,40);}return c.toDataURL().split(',')[1]})()`,
        );
        fs.writeFileSync(
          path.join(output, "retouch-pixel-gallery.png"),
          Buffer.from(gallery, "base64"),
        );
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
