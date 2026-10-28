const { app, dialog } = require("electron"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os"),
  assert = require("node:assert/strict");
const output = path.resolve(process.env.TUGOU_TEST_RESULTS || path.join(__dirname, "../test-results")),
  restart = process.argv.includes("--restart"),
  prior = restart
    ? JSON.parse(
        fs.readFileSync(path.join(output, "local-tools-desktop.json"), "utf8"),
      )
    : null,
  profile =
    prior?.profile ||
    fs.mkdtempSync(path.join(os.tmpdir(), "tugou-local-tools-"));
process.env.TUGOU_DATA_DIR = profile;
process.env.TUGOU_BUILD_DIR ||= path.join(output, "local-tools-build");
const report = { profile, checks: [], errors: [], platform: process.platform },
  finish = (code) => {
    fs.writeFileSync(
      path.join(
        output,
        restart ? "local-tools-restart.json" : "local-tools-desktop.json",
      ),
      JSON.stringify(report, null, 2),
    );
    app.exit(code);
  },
  timer = setTimeout(() => {
    report.failure = "Timed out";
    finish(1);
  }, 180000);
app.on("web-contents-created", (_, contents) => {
  contents.on("console-message", (d) => {
    if (d.level === "error") report.errors.push(d.message);
  });
});
app.on("browser-window-created", (_, window) => {
  // QA owns only this isolated window. Never show/focus it or the user's desktop window.
  window.show = () => {};
  window.focus = () => {};
  window.webContents.setBackgroundThrottling(false);
  window.webContents.once("did-finish-load", async () => {
    const js = (code) => window.webContents.executeJavaScript(code, true),
      delay = (ms) => new Promise((r) => setTimeout(r, ms));
    const check = (name, value) => {
      assert.ok(value, name);
      report.checks.push(name);
    };
    const wait = async (code) => {
      for (let i = 0; i < 500; i++) {
        if (await js(`Boolean(${code})`)) return;
        await delay(30);
      }
      throw Error("Timeout " + code);
    };
    const click = async (label) => {
      await js(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}).click()`,
      );
      await delay(70);
    };
    const select = async (label, value) => {
      await js(
        `{const e=document.querySelector('select[aria-label=${JSON.stringify(label)}]');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('change',{bubbles:true}));}`,
      );
      await delay(50);
    };
    const input = async (label, value) => {
      await js(
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');e.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));}`,
      );
      await delay(30);
      await js(
        `{const e=document.querySelector('input[aria-label=${JSON.stringify(label)}]');e.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));e.blur();}`,
      );
      await delay(50);
    };
    const inject = () =>
      js(
        fs.readFileSync(path.join(output, "local-tools-engine-qa.js"), "utf8") +
          ";void 0;",
      );
    const reopen = async () => {
      await js(
        `sessionStorage.setItem('tugou-reload-view',JSON.stringify({id:${JSON.stringify(report.id)},workspace:'tools'}))`,
      );
      const ready = new Promise((r) =>
        window.webContents.once("did-finish-load", r),
      );
      window.webContents.reload();
      await ready;
      await wait('document.querySelector(".image-tools")');
      await inject();
    };
    const save = async () => {
      await click("保存");
      await wait(
        'document.querySelector(".statusbar [role=status]").textContent==="已保存"',
      );
      return js(`tugou.open(${JSON.stringify(report.id)})`);
    };
    const run = async (count) => {
      await click("开始处理");
      await wait(
        `document.querySelectorAll('.processing-item').length===${count}`,
      );
      await wait(
        'document.querySelector(".message[role=status]").textContent.includes("已完成")',
      );
    };
    const cube =
      'TITLE "Channel swap"\nLUT_3D_SIZE 2\n0 0 0\n0 1 0\n0 0 1\n0 1 1\n1 0 0\n1 1 0\n1 0 1\n1 1 1';
    const upload = async (text) => {
      await js(
        `{const d=new DataTransfer();d.items.add(new File([${JSON.stringify(text)}],'fixture.cube',{type:'text/plain'}));const e=document.querySelector('input[aria-label="导入 Cube LUT"]');e.files=d.files;e.dispatchEvent(new Event('change',{bubbles:true}));}`,
      );
    };
    try {
      await wait('document.querySelector(".studio-header")');
      await inject();
      if (restart) {
        report.id = prior.id;
        await reopen();
        const r = await save();
        check(
          "fresh process restores exact document including LUT and unknown fields",
          JSON.stringify(r.document) === JSON.stringify(prior.document),
        );
        for (const a of r.document.assets.filter((a) => a.toolResult)) {
          const size = await js(
            `toolsQA.pixels(${JSON.stringify(a)}).then(p=>({width:p.width,height:p.height}))`,
          );
          check(
            "restored " +
              a.toolResult.operation +
              " result decodes at saved size",
            size.width === a.width && size.height === a.height,
          );
        }
        const lutResult = r.document.assets.find(
          (a) => a.toolResult?.operation === "lut",
        );
        await js(
          `[...document.querySelectorAll('.processing-item')].find(e=>e.textContent.includes('LUT')).click()`,
        );
        await delay(80);
        check(
          "LUT history restores reusable preset after restart",
          await js(
            `document.querySelector('select[aria-label="LUT 预设"]').value===${JSON.stringify(lutResult.toolResult.lutId)}`,
          ),
        );
        await run(r.document.assets.filter((a) => a.toolResult).length + 1);
        const next = await save();
        check(
          "rerun from restored history reproduces identical PNG",
          next.document.assets.at(-1).resource === lutResult.resource,
        );
      } else {
        const engine = await js("toolsQA.verify()");
        report.checks.push(...engine.checks);
        await click("新建工程");
        report.id = await js(
          'document.querySelector("select[aria-label=当前工程]").value',
        );
        await js(
          `(async()=>{const r=await tugou.open(${JSON.stringify(report.id)});await tugou.save(r.id,{...r.document,assets:[${JSON.stringify(engine.input)},${JSON.stringify(engine.tiny)}],futureTools:{keep:true}},r.revision);})()`,
        );
        await reopen();
        await select("处理方式", "alpha");
        await input("收缩", 1);
        await input("内侧羽化", 2);
        await select("去底色", "white");
        await run(1);
        let r = await save();
        check(
          "alpha result metadata stores exact top-toolbar settings",
          r.document.assets.at(-1).toolResult.shrink === 1 &&
            r.document.assets.at(-1).toolResult.matte === "white",
        );
        await click("撤销");
        await wait('document.querySelectorAll(".processing-item").length===0');
        check(
          "tool result is one undo and original assets remain",
          (await save()).document.assets.length === 2,
        );
        await click("重做");
        await wait('document.querySelectorAll(".processing-item").length===1');
        check("redo restores result", true);
        await select("处理方式", "lut");
        await upload("LUT_3D_SIZE 2\n0 0 0");
        await wait(
          'document.querySelector(".message[role=status]")?.textContent.includes("不完整")',
        );
        check(
          "malformed Cube is rejected without publishing preset",
          !(await save()).document.imageToolLuts,
        );
        await upload(cube);
        await wait(
          'document.querySelector(".message[role=status]").textContent==="LUT 已导入工程"',
        );
        await input("强度", 65);
        await run(2);
        r = await save();
        check(
          "LUT stored once and result uses ID without duplicating table",
          r.document.imageToolLuts.length === 1 &&
            r.document.assets.at(-1).toolResult.lutId ===
              r.document.imageToolLuts[0].id &&
            !JSON.stringify(r.document.assets.at(-1)).includes("LUT_3D_SIZE"),
        );
        await upload(cube);
        await delay(100);
        check(
          "identical LUT import reuses preset",
          (await save()).document.imageToolLuts.length === 1,
        );
        await select("处理方式", "light");
        await input("曝光", 1.5);
        await select("光型", "directional");
        await click("光源位置");
        await input("水平位置", 25);
        await input("光照半径", 30);
        await click("光源位置");
        await run(3);
        r = await save();
        check(
          "light popover parameters persist",
          r.document.assets.at(-1).toolResult.centerX === 25 &&
            r.document.assets.at(-1).toolResult.kind === "directional",
        );
        await select("处理方式", "pattern");
        await select("处理来源", engine.tiny.id);
        await input("输出宽度", 64);
        await input("输出高度", 48);
        await select("图案排列", "mirror");
        await click("图案参数");
        await input("图案倍率", 1);
        await input("间距", 1);
        await click("图案参数");
        await run(4);
        r = await save();
        check(
          "pattern result has requested size and layout",
          r.document.assets.at(-1).width === 64 &&
            r.document.assets.at(-1).height === 48 &&
            r.document.assets.at(-1).toolResult.layout === "mirror",
        );
        const file = path.join(profile, "pattern.png");
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
        await click("导出结果");
        await wait(
          'document.querySelector(".message[role=status]").textContent==="已导出 PNG"',
        );
        check(
          "result PNG export is byte identical to stored PNG",
          fs
            .readFileSync(file)
            .equals(
              fs.readFileSync(
                path.join(
                  profile,
                  "workspace",
                  "resources",
                  r.document.assets.at(-1).resource,
                ),
              ),
            ),
        );
        await input("输出宽度", 10000);
        await input("输出高度", 10000);
        await click("开始处理");
        await click("取消本地任务");
        await wait(
          'document.querySelector(".message[role=status]").textContent.includes("已取消本地处理")',
        );
        await delay(150);
        check(
          "cancelled large tool produces no new library item",
          await js('document.querySelectorAll(".processing-item").length===4'),
        );
        await input("输出宽度", 256);
        await input("输出高度", 512);
        await click("开始处理");
        const background = (await js('tugou.tasks()')).at(-1);
        await click("提示词工作台");
        await wait('document.querySelector(".prompt-workbench")');
        for (let i=0;i<400;i++) {
          if ((await js('tugou.tasks()')).find(t=>t.id===background.id).status==='completed') break;
          await delay(25);
        }
        await click("图像工具");
        await wait('document.querySelectorAll(".processing-item").length===5');
        check(
          "leaving tools keeps background processing and receives complete result",
          (await save()).document.assets.at(-1).width===256,
        );
        await click("撤销");
        await wait('document.querySelectorAll(".processing-item").length===4');
        await js(
          "[...document.querySelectorAll('.processing-item')].find(e=>e.textContent.includes('重复图案')).click()",
        );
        await delay(80);
        check(
          "history selection restores operation and editable parameters",
          await js(
            'document.querySelector("select[aria-label=处理方式]").value==="pattern"&&document.querySelector("input[aria-label=输出宽度]").value==="64"',
          ),
        );
        await click("重置参数");
        check(
          "parameter reset returns defaults",
          await js(
            'document.querySelector("input[aria-label=输出宽度]").value==="2048"',
          ),
        );
        window.setSize(960, 760);
        await delay(200);
        for (const op of ["alpha", "lut", "light", "pattern"]) {
          await select("处理方式", op);
          check(
            op + " toolbar fits 960px and keeps labels horizontal",
            await js(
              `document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('.image-tool-parameters label')].every(e=>e.getBoundingClientRect().height<40)`,
            ),
          );
        }
        await delay(200);
        fs.writeFileSync(
          path.join(output, "local-tools-960.png"),
          (
            await window.webContents.capturePage(undefined, {
              stayHidden: true,
            })
          ).toPNG(),
        );
        await click("切换浅色主题");
        await delay(200);
        fs.writeFileSync(
          path.join(output, "local-tools-light.png"),
          (
            await window.webContents.capturePage(undefined, {
              stayHidden: true,
            })
          ).toPNG(),
        );
        await js(
          "[...document.querySelectorAll('.processing-item')].find(e=>e.textContent.includes('重复图案')).click()",
        );
        await delay(50);
        await click("加入画面");
        await wait('document.querySelector(".layer-editor")');
        check(
          "tool result enters editable layer scene",
          (await save()).document.layers.length === 1,
        );
        await click("图像工具");
        await js(
          "[...document.querySelectorAll('.processing-item')].find(e=>e.textContent.includes('LUT')).click()",
        );
        await delay(50);
        await click("加入画布");
        await wait('document.querySelector(".react-flow")');
        r = await save();
        check(
          "tool result enters shared infinite canvas",
          r.document.tugouCanvas.nodes.some((n) => n.type === "asset"),
        );
        check(
          "original source and unknown fields retained",
          r.document.assets[0].resource === engine.input.resource &&
            r.document.futureTools.keep,
        );
        report.document = r.document;
      }
      check("QA window remained hidden", !window.isVisible());
      check("no renderer errors", report.errors.length === 0);
      clearTimeout(timer);
      finish(0);
    } catch (e) {
      report.failure = e.stack;
      fs.writeFileSync(
        path.join(output, "local-tools-failure.png"),
        (
          await window.webContents.capturePage(undefined, { stayHidden: true })
        ).toPNG(),
      );
      clearTimeout(timer);
      finish(1);
    }
  });
});
require("../main.cjs");
