const { app } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
const { encode } = require("../core/cloud-pixels.cjs");
const base =
  process.env.TUGOU_TEST_RESULTS || require('./qa-paths.cjs').path("file-drop");
fs.mkdirSync(base, { recursive: true });
const packaged = process.argv.includes("--packaged"),
  restart = process.argv.includes("--restart"),
  tag = packaged ? "file-drop-packaged" : "file-drop-desktop";
const prior = restart
  ? JSON.parse(fs.readFileSync(path.join(base, tag + ".json")))
  : null;
const profile = prior?.profile || fs.mkdtempSync(path.join(base, "profile-"));
process.env.TUGOU_DATA_DIR = profile;
if (packaged) delete process.env.TUGOU_BUILD_DIR;
else process.env.TUGOU_BUILD_DIR ||= require('./qa-paths.cjs').path("shared-build");
const report = { profile, packaged, checks: [], errors: [] };
const finish = (code) => {
  fs.writeFileSync(
    path.join(base, tag + (restart ? "-restart" : "") + ".json"),
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
    const click = async (label, scope = "button") => {
      await js(
        `{const b=[...document.querySelectorAll(${JSON.stringify(scope)})].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}||b.getAttribute('title')===${JSON.stringify(label)});if(!b||b.disabled)throw Error('missing enabled '+${JSON.stringify(label)});b.click()}`,
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
      await delay(100);
    };
    const files = async (paths) => {
      await js(
        `document.querySelector('#native-files')?.remove();{const i=document.createElement('input');i.type='file';i.multiple=true;i.id='native-files';i.style.display='none';document.body.append(i);}`,
      );
      const { root } =
        await w.webContents.debugger.sendCommand("DOM.getDocument");
      const { nodeId } = await w.webContents.debugger.sendCommand(
        "DOM.querySelector",
        { nodeId: root.nodeId, selector: "#native-files" },
      );
      await w.webContents.debugger.sendCommand("DOM.setFileInputFiles", {
        nodeId,
        files: paths,
      });
      await js(
        `window.dropFiles=new DataTransfer();for(const f of document.querySelector('#native-files').files)dropFiles.items.add(f);`,
      );
    };
    const drop = async (selector, x = 90, y = 90) => {
      await js(
        `{const t=document.querySelector(${JSON.stringify(selector)}),r=t.getBoundingClientRect();t.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dropFiles}));t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dropFiles,clientX:r.x+${x},clientY:r.y+${y}}));}`,
      );
      await delay(200);
    };
    const snapshot = async (name) => {
      await delay(120);
      await w.webContents.capturePage();
      await delay(120);
      fs.writeFileSync(
        path.join(base, name + ".png"),
        (await w.webContents.capturePage()).toPNG(),
      );
    };
    try {
      w.webContents.debugger.attach("1.3");
      await js('console.error("file-drop-observer")');
      check(
        "console observer active",
        report.errors.includes("file-drop-observer"),
      );
      report.errors = [];
      if (packaged) {
        const archive =
          require('./qa-paths.cjs').path("lean-package/win-unpacked/resources/app.asar");
        check(
          "frontend source dependencies excluded from package",
          !fs.existsSync(path.join(archive, "node_modules/antd")) &&
            !fs.existsSync(path.join(archive, "node_modules/react")),
        );
        const notices = fs.readFileSync(
          path.join(archive, "dist/THIRD_PARTY_NOTICES.txt"),
          "utf8",
        );
        check(
          "bundled frontend and runtime license texts retained",
          notices.includes("react 19.2.5") &&
            notices.includes("antd 6.6.6") &&
            notices.includes("sharp 0.35.5"),
        );
        const sharp = require(path.join(archive, "node_modules/sharp")),
          input = await encode({
            width: 2,
            height: 2,
            data: Buffer.alloc(16, 255),
          });
        const output = await sharp(input).resize(4, 4).png().toBuffer(),
          meta = await sharp(output).metadata();
        check(
          "packaged native raster dependency executes",
          meta.width === 4 && meta.height === 4,
        );
        check(
          "packaged archive dependencies load",
          typeof require(path.join(archive, "node_modules/tar")).x ===
            "function" &&
            typeof require(path.join(archive, "node_modules/yauzl"))
              .fromBuffer === "function",
        );
      }
      if (restart) {
        report.id = prior.id;
        await load("assets");
        const r = await save();
        check(
          "all dropped assets, layers and canvas nodes restore",
          r.document.assets.length === 4 &&
            r.document.layers.length === 1 &&
            r.document.tugouCanvas.nodes.length === 1,
        );
        check(
          "unknown fields and source pixels restore",
          r.document.keep === 42 &&
            fs
              .readFileSync(
                path.join(
                  profile,
                  "workspace/resources",
                  r.document.assets[0].resource,
                ),
              )
              .equals(fs.readFileSync(path.join(profile, "红色.png"))),
        );
        check(
          "no model tasks on restore",
          (await js("tugou.tasks()")).length === 0,
        );
      } else {
        const red = await encode({
            width: 40,
            height: 30,
            data: Buffer.from(
              Array.from({ length: 1200 }, () => [210, 40, 30, 180]).flat(),
            ),
          }),
          blue = await encode({
            width: 20,
            height: 60,
            data: Buffer.from(
              Array.from({ length: 1200 }, () => [30, 70, 220, 255]).flat(),
            ),
          });
        const a = path.join(profile, "红色.png"),
          b = path.join(profile, "蓝色.png"),
          bad = path.join(profile, "损坏.png");
        fs.writeFileSync(a, red);
        fs.writeFileSync(b, blue);
        fs.writeFileSync(bad, "not an image");
        report.id = await js(
          `(async()=>{const r=await tugou.create('系统图片拖入验收');await tugou.save(r.id,{...r.document,width:320,height:240,keep:42},r.revision);return r.id})()`,
        );
        await load("assets");
        await files([a, b, a]);
        await drop(".asset-library");
        await wait('document.querySelectorAll(".asset-card").length===2');
        let r = await save();
        check(
          "native-backed File objects import a deduplicated batch into library",
          r.document.assets.length === 2,
        );
        check(
          "all source bytes preserved",
          r.document.assets.every((asset, i) =>
            fs
              .readFileSync(
                path.join(profile, "workspace/resources", asset.resource),
              )
              .equals(i ? blue : red),
          ),
        );
        await click("撤销");
        r = await save();
        check(
          "whole file batch is one undo step",
          r.document.assets.length === 0,
        );
        await click("重做");
        r = await save();
        check("redo restores complete batch", r.document.assets.length === 2);
        await files([a, bad]);
        await drop(".asset-library");
        await wait('document.querySelector(".asset-library [role=alert]")');
        r = await save();
        check("bad member rejects whole batch", r.document.assets.length === 2);
        check(
          "invalid batch leaves no staged or orphan images",
          fs.readdirSync(path.join(profile, "workspace/resources")).length ===
            2 &&
            fs.readdirSync(path.join(profile, "workspace/imports")).length ===
              0,
        );
        const virtual = await js(
          `(async()=>{try{await tugou.importDroppedImages([new File(['x'],'虚拟.png',{type:'image/png'})]);return '';}catch(e){return e.message;}})()`,
        );
        check(
          "virtual files cannot forge a native path",
          virtual.includes("本机"),
        );
        await files([a]);
        await js(
          `{const b=[...document.querySelectorAll('nav button')].find(b=>b.title==='无限画布');b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dropFiles}));}`,
        );
        await wait('document.querySelector(".flow-surface")');
        await drop(".flow-surface", 120, 100);
        await wait(
          'document.querySelectorAll(".react-flow__node-asset").length===1',
        );
        r = await save();
        check(
          "file drag hover switches to canvas and inserts at drop position",
          r.document.assets.length === 3 &&
            r.document.tugouCanvas.nodes.length === 1 &&
            Math.abs(r.document.tugouCanvas.nodes[0].position.x - 120) < 1 &&
            Math.abs(r.document.tugouCanvas.nodes[0].position.y - 100) < 1,
        );
        await click("撤销");
        r = await save();
        check(
          "canvas drop undo removes node and its new asset together",
          r.document.assets.length === 2 &&
            (r.document.tugouCanvas?.nodes.length || 0) === 0,
        );
        await click("重做");
        await click("图层合成", "nav button");
        await files([b]);
        await drop(".layer-stage", 85, 85);
        await wait(
          'document.querySelectorAll("button[data-layer-id]").length===1',
        );
        r = await save();
        check(
          "file drop into composition creates shared material and image layer",
          r.document.assets.length === 4 &&
            r.document.layers.length === 1 &&
            r.document.layers[0].assetId === r.document.assets[3].id,
        );
        const l = r.document.layers[0];
        check(
          "layer coordinates follow canvas zoom and drop center",
          Math.abs(l.x + l.width / 2 - 100) < 1 &&
            Math.abs(l.y + l.height / 2 - 100) < 1,
        );
        await click("撤销");
        r = await save();
        check(
          "composition drop is one undo step",
          r.document.assets.length === 3 && r.document.layers.length === 0,
        );
        await click("重做");
        await save();
        await click("提示词工作台", "nav button");
        await files([a]);
        const before = w.webContents.getURL();
        await drop(".prompt-workbench");
        check(
          "unsupported drop target never navigates away",
          w.webContents.getURL() === before,
        );
        r = await save();
        check(
          "unsupported target does not silently import",
          r.document.assets.length === 4,
        );
        w.setSize(960, 760);
        await click("素材库", "nav button");
        await snapshot(tag + "-dark-960");
        await click("切换浅色主题");
        await snapshot(tag + "-light-960");
        check(
          "no AI task or credential setup required",
          (await js("tugou.tasks()")).length === 0,
        );
        check(
          "unknown project fields preserved",
          (await save()).document.keep === 42,
        );
      }
      check("no renderer errors", report.errors.length === 0);
      check("QA window remains hidden", !w.isVisible());
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      report.text = await js("document.body.innerText");
      await snapshot(tag + "-failure");
      finish(1);
    }
  });
});
require(
  packaged
    ? require('./qa-paths.cjs').path("lean-package/win-unpacked/resources/app.asar/desktop-main.cjs")
    : "../desktop-main.cjs",
);
