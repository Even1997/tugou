// Review the packaged UI with the existing C sample; benchmark the real export button.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs"), path = require("node:path"), os = require("node:os"), assert = require("node:assert/strict");
const base = process.env.STUDIO_TEST_URL;
if (base !== "http://127.0.0.1:3437") throw Error("Isolated QA frontend required");
app.setPath("userData", fs.mkdtempSync(path.join(os.tmpdir(), "studio-visual-")));
app.disableHardwareAcceleration();
const root = path.resolve(__dirname, "../.."), evidence = path.join(root, "docs/studio-evidence");
const request = async (action, payload) => {
    const r = await fetch(`${base}/api/studio`, { method: "POST", headers: { "Content-Type": "application/json", "X-Studio-Request": "1" }, body: JSON.stringify({ action, payload }) });
    if (!r.ok) throw Error(await r.text()); return r.json();
};
const wait = ms => new Promise(r => setTimeout(r, ms));
app.whenReady().then(async () => {
    const win = new BrowserWindow({ width: 1500, height: 1000, show: false, webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code, true);
    const until = async (code, seconds = 15) => { for (let i = 0; i < seconds * 10; i++) { if (await run(code)) return; await wait(100); } throw Error(`Timeout: ${code}`); };
    const open = async id => {
        const p = await request("open", { id }); await request("save", { ...p, updatedAt: new Date().toISOString() });
        await win.loadURL(`${base}/studio`);
        await until(`document.body.innerText.includes(${JSON.stringify(p.name)}) && document.body.innerText.includes("已保存")`);
        await run(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="图层合成").click()`);
        await until(`!!document.querySelector(".editor-stage canvas")`);
        await wait(1500);
    };
    try {
        const original = await request("open", { id: "editor-ui-qa" });
        await request("save", { ...original, id: "editor-export-qa", name: "界面导出验证", updatedAt: new Date().toISOString() });
        await open("editor-export-qa");
        await run(`window.exportProfile=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{const start=performance.now();const result=await originalFetch(...args);const action=typeof args[1]?.body==="string"?JSON.parse(args[1].body).action:"";if(action?.startsWith("export-"))window.exportProfile.push({action,ms:Math.round(performance.now()-start)});return result;};const originalEncode=OffscreenCanvas.prototype.convertToBlob;OffscreenCanvas.prototype.convertToBlob=async function(...args){const start=performance.now();const result=await originalEncode.apply(this,args);window.exportProfile.push({action:"encode",ms:Math.round(performance.now()-start)});return result;};void 0;`);
        const dir = path.join(root, ".tools/editor-foundation-qa/exports"), before = new Set(fs.readdirSync(dir)), started = Date.now();
        await run(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="导出画面").click()`);
        let file;
        for (let i = 0; i < 1200; i++) { file = fs.readdirSync(dir).find(f => !before.has(f) && f.startsWith("界面导出验证-") && f.endsWith(".png")); if (file) break; await wait(100); }
        assert.ok(file, "UI export finished");
        const header = fs.readFileSync(path.join(dir, file)).subarray(0, 24);
        assert.equal(header.readUInt32BE(16), 10000); assert.equal(header.readUInt32BE(20), 10000);
        const result = { normalWindowUiExportMilliseconds: Date.now() - started, dimensions: [10000, 10000] };
        result.exportProfile = await run("window.exportProfile");
        await open("editor-visual-c");
        fs.writeFileSync(path.join(evidence, "editor-workspace-c.png"), (await win.webContents.capturePage()).toPNG());
        result.layout = await run(`({width:innerWidth,body:document.documentElement.scrollWidth,toolbar:document.querySelector(".editor-controls").getBoundingClientRect().width})`);
        assert.equal(result.layout.width, result.layout.body);
        fs.writeFileSync(path.join(evidence, "editor-workspace-visual-results.json"), JSON.stringify(result, null, 2));
        console.log(JSON.stringify(result)); app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});
