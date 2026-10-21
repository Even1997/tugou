const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict"), sharp = require("../../web/node_modules/sharp");
const base = process.env.STUDIO_TEST_URL;
if (base !== "http://127.0.0.1:3437") throw Error("Isolated QA server required");
const root = path.resolve(__dirname, "../.."), evidence = path.join(root, "docs/studio-evidence"), results = [];
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "studio-tone-ui-")));
app.disableHardwareAcceleration();
const request = async (action, payload) => {
    const r = await fetch(`${base}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1" }, body: JSON.stringify({ action, payload }) });
    if (!r.ok) throw Error(await r.text()); return r.json();
};
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1500, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, offscreen: true, backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code, true);
    const until = async (fn, label) => { for (let i = 0; i < 300; i++) { if (await fn()) return; await wait(100); } throw Error(`Timeout ${label}`); };
    const click = label => run(`(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.getAttribute("aria-label")===${JSON.stringify(label)}||e.textContent.replace(/\\s/g,"")===${JSON.stringify(label.replace(/\s/g,""))});if(!b)throw Error(${JSON.stringify(label)});b.click()})()`);
    const menu = async (trigger, item) => { await click(trigger); await wait(150); await run(`[...document.querySelectorAll("[role=menuitem]")].find(e=>e.getBoundingClientRect().height&&e.textContent.trim().replace(/^✓ /,"")===${JSON.stringify(item)}).click()`); await wait(150); };
    const input = async (label, value) => { await run(`(()=>{const e=document.querySelector('[aria-label=${JSON.stringify(label)}]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event("input",{bubbles:true}));e.blur()})()`); await wait(100); };
    const choose = name => run(`[...document.querySelectorAll(".layer-name")].find(e=>e.textContent.trim()===${JSON.stringify(name)}).click()`);
    const id = "editor-tone-qa", open = () => request("open", { id }), saved = fn => until(async () => fn(await open()), "save");
    const key = (key, extra = {}) => run(`document.activeElement?.blur();document.body.dispatchEvent(new KeyboardEvent("keydown",{key:${JSON.stringify(key)},bubbles:true,...${JSON.stringify(extra)}}))`);
    const layout = async name => {
        for (const width of [1500, 1100, 900]) {
            win.setSize(width, 900); await wait(350);
            const b = await run(`(()=>{const bar=document.querySelector('[aria-label="调整与特效参数"]'),r=bar.getBoundingClientRect();return {width:innerWidth,body:document.documentElement.scrollWidth,height:r.height,right:Math.max(...[...bar.querySelectorAll("button,input")].filter(e=>e.getBoundingClientRect().height).map(e=>e.getBoundingClientRect().right)),topRight:Math.max(...[...document.querySelectorAll(".compose-toolbar>.editor-controls button")].filter(e=>e.getBoundingClientRect().height).map(e=>e.getBoundingClientRect().right))}})()`);
            assert.ok(b.body <= b.width && b.height <= 44 && b.right <= b.width && b.topRight <= b.width, JSON.stringify(b));
            fs.writeFileSync(path.join(evidence, `editor-tone-${name}-${width}.png`), (await win.webContents.capturePage()).toPNG()); results.push({ name, layout: b });
        }
        win.setSize(1500, 1000); await wait(200);
    };
    try {
        const layer = { id: "sample", name: "色彩样图", kind: "shape", shape: "rect", color: "#5078a0", x: 160, y: 128, width: 704, height: 512, rotation: 0, opacity: 1, visible: true, locked: false, flipX: false, flipY: false, blend: "source-over" };
        await request("save", { format: "canvas-studio", version: 4, id, name: "调整与特效验收", updatedAt: new Date().toISOString(), width: 1024, height: 768, background: "transparent", modules: [], recipes: [], jobs: [], assets: [], layers: [layer],
            selection: { paths: [{ points: [0, 0, 512, 0, 512, 768, 0, 768], operation: "add" }] } });
        await win.loadURL(`${base}/studio`); await until(() => run('document.body.innerText.includes("调整与特效验收")'), "ready"); await click("图层合成");
        await until(() => run('!!document.querySelector(".editor-stage canvas")'), "stage"); await choose("色彩样图");
        await menu("添加调整图层", "反相"); await saved(p => p.layers.length === 2);
        assert.equal((await open()).version, 5); assert.deepEqual((await open()).layers[1].mask.paths[0].points, [0,0,.5,0,.5,1,0,1]);
        await click("蒙版"); assert.ok(await run('!!document.querySelector(\'[aria-label="蒙版工具"]\')')); await click("完成");
        await input("调整特效强度", 50); await saved(p => p.layers[1].opacity === .5);
        await key("z", { ctrlKey: true }); await saved(p => p.layers[1].opacity === 1);
        await key("y", { ctrlKey: true }); await saved(p => p.layers[1].opacity === .5);
        await choose("反相"); await input("调整特效强度", 100); await saved(p => p.layers[1].opacity === 1);
        const exports = path.join(root, ".tools/editor-foundation-qa/exports"), previous = new Set(fs.readdirSync(exports)); await click("导出画面"); let file;
        await until(async () => { file = fs.readdirSync(exports).find(f => !previous.has(f) && f.startsWith("调整与特效验收-") && f.endsWith(".png")); return !!file; }, "export");
        const image = sharp(fs.readFileSync(path.join(exports, file))), meta = await image.metadata(), pixels = await image.ensureAlpha().raw().toBuffer();
        assert.equal(meta.width, 1024); assert.equal(meta.height, 768);
        const pixel = (x, y) => [...pixels.subarray((y * 1024 + x) * 4, (y * 1024 + x) * 4 + 4)];
        assert.deepEqual(pixel(300,300), [175,135,95,255]); assert.deepEqual(pixel(700,300), [80,120,160,255]); assert.equal(pixel(30,30)[3], 0);
        results.push("选区转调整蒙版；顶部编辑蒙版；强度一次撤销重做；真实 PNG 导出范围与透明度正确");
        await key("d", { ctrlKey: true }); await saved(p => !p.selection); await choose("反相"); await key("Delete"); await saved(p => p.layers.length === 1 && !p.selection);
        for (const label of ["色相 / 饱和度","色阶","曝光","渐变映射","黑白","色彩平衡","反相","颗粒","添加杂色","高斯模糊","动感模糊"]) {
            await choose("色彩样图"); await menu("添加调整图层", label); await saved(p => p.layers.length === 2);
            if (label === "色阶") { await layout("levels"); await click("更多参数"); await input("输出黑场", 12); await saved(p => p.layers[1].adjustment.values.low === 12); await click("更多参数"); }
            if (label === "色彩平衡") await layout("balance");
            await key("Delete"); await saved(p => p.layers.length === 1);
        }
        await choose("色彩样图"); await menu("创建选区", "矩形选区"); await menu("选区操作", "全选"); await saved(p => !!p.selection); await menu("添加调整图层", "曲线"); await saved(p => p.layers.length === 2); await click("编辑曲线"); await wait(200);
        const b = await run(`(()=>{const s=document.querySelector('[aria-label="曲线编辑区"]'),r=s.getBoundingClientRect();return{x:r.x+r.width*.5,y:r.y+r.height*.35,accent:getComputedStyle(s).getPropertyValue("--studio-accent")}})()`);
        assert.ok(b.accent.trim(), "curve inherits theme");
        win.webContents.sendInputEvent({type:"mouseDown",x:Math.round(b.x),y:Math.round(b.y),button:"left",clickCount:1}); win.webContents.sendInputEvent({type:"mouseUp",x:Math.round(b.x),y:Math.round(b.y),button:"left",clickCount:1});
        await saved(p => p.layers[1].adjustment.curves[0].length === 3);
        await run(`(()=>{const p=document.querySelector('[aria-label="曲线控制点 2"]');p.focus();p.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowUp",bubbles:true}));})()`);
        await wait(900); assert.equal((await open()).layers.length, 2);
        fs.writeFileSync(path.join(evidence,"editor-tone-curve.png"),(await win.webContents.capturePage()).toPNG());
        await run(`document.querySelector('[aria-label="曲线控制点 2"]').dispatchEvent(new KeyboardEvent("keydown",{key:"Delete",bubbles:true}))`); await saved(p => p.layers[1].adjustment.curves[0].length === 2);
        assert.equal((await open()).layers.length,2); assert.ok((await open()).selection);
        await run(`document.querySelector('[aria-label="曲线控制点 2"]').dispatchEvent(new KeyboardEvent("keydown",{key:"z",ctrlKey:true,bubbles:true}))`); await saved(p => p.layers[1].adjustment.curves[0].length === 3);
        await key("y", {ctrlKey:true}); await saved(p => p.layers[1].adjustment.curves[0].length === 2);
        await key("d", {ctrlKey:true}); await saved(p => !p.selection); await choose("曲线"); await key("Delete"); await saved(p => p.layers.length===1);
        results.push("12 个调整入口可添加删除；色阶扩展参数落盘；曲线加点、键盘调点/删点不误操作图层，主题正确");
        await choose("色彩样图");
        for (const label of ["描边","投影","颜色叠加","内阴影","外发光","内发光"]) await menu("图层特效", label);
        await saved(p => p.layers[0].effects?.length===6);
        await menu("图层特效","投影"); await input("距离",35.4); await saved(p=>p.layers[0].effects.find(e=>e.kind==="shadow").values.distance===35); await layout("shadow"); await click("完成特效编辑"); assert.ok(await run(`!!document.querySelector('[aria-label="对象工具"]')`)); await menu("图层特效","投影");
        await click("切换调整特效"); await saved(p=>!p.layers[0].effects.find(e=>e.kind==="shadow").enabled);
        await click("切换调整特效"); await saved(p=>p.layers[0].effects.find(e=>e.kind==="shadow").enabled);
        const before = (await open()).layers[0].effects; win.webContents.reload(); await until(()=>run('!!document.querySelector(".editor-stage canvas")'),"reload"); await choose("色彩样图"); await menu("图层特效","投影");
        assert.deepEqual((await open()).layers[0].effects,before); assert.equal(await run('document.querySelector(\'[aria-label="距离"]\').value'),"35");
        await click("重置"); await saved(p=>p.layers[0].effects.find(e=>e.kind==="shadow").values.distance===20);
        await key("z",{ctrlKey:true}); await saved(p=>p.layers[0].effects.find(e=>e.kind==="shadow").values.distance===35); await choose("色彩样图"); await menu("图层特效","投影");
        await click("移除当前特效"); await saved(p=>p.layers[0].effects.length===5);
        await key("z",{ctrlKey:true}); await saved(p=>p.layers[0].effects.length===6);
        await choose("色彩样图"); await run('document.querySelector(\'button[title="锁定图层"]\').click()'); await saved(p=>p.layers[0].locked);
        assert.ok(await run('document.querySelector(\'[aria-label="图层特效"]\').disabled'));
        results.push("小数输入归整后可保存；曲线在选区存在时可删点/撤销重做；特效完成返回对象工具；重置可独立撤销；6 个图层特效并存；重选重开保留参数；停用、重置、移除及撤销正确；锁定禁止编辑；900/1100/1500 顶部工具栏无溢出");
        fs.writeFileSync(path.join(evidence,"editor-tone-ui-results.json"),JSON.stringify(results,null,2)); console.log(JSON.stringify(results,null,2)); app.exit(0);
    } catch (error) {
        fs.writeFileSync(path.join(evidence,"editor-tone-ui-failure.png"),(await win.webContents.capturePage()).toPNG()); console.error(error); app.exit(1);
    }
});
