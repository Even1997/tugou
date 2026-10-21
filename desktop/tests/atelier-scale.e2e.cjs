// Read-only UI reuse of an already completed local job; no inference or API billing.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const scale = Number(process.env.STUDIO_QA_SCALE);
assert.ok([1.25, 1.5].includes(scale));
app.commandLine.appendSwitch('force-device-scale-factor', String(scale));
app.disableHardwareAcceleration();
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'studio-scale-')));
const root = path.resolve(__dirname, '../../docs/studio-evidence');
const report = { at: new Date().toISOString(), scale, passed: false, cases: [], newModelRequests: 0 };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const request = async (action, payload) => {
    const r = await fetch('http://127.0.0.1:3439/api/studio', { method: 'POST', headers: { 'content-type': 'application/json', 'x-studio-request': '1' }, body: JSON.stringify({ action, payload }) });
    assert.ok(r.ok); return r.json();
};
app.whenReady().then(async () => {
    const deadline = setTimeout(() => app.exit(1), 90000);
    try {
        assert.match((await request('list')).location, /CanvasStudioCutoutUpgradeQA[\\/]atelier-qa/);
        const prior = JSON.parse(fs.readFileSync(path.join(root, 'atelier-detail-cutout-ui.json')));
        const original = await request('open', { id: prior.projectId });
        const jobs = await request('tool-list', { projectId: prior.projectId });
        const win = new BrowserWindow({ width: 1280, height: 800, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
        const run = code => win.webContents.executeJavaScript(code, true);
        const until = async (fn, label) => { for (let i = 0; i < 200; i++) { if (await fn()) return; await wait(100); } throw Error('Timeout: ' + label); };
        const click = text => run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
        await win.loadURL('http://127.0.0.1:3439/studio');
        await until(() => run(`document.body.innerText.includes(${JSON.stringify(prior.projectId)})`), 'project');
        await click('图片工具');
        await until(() => run(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='查看结果')`), 'history');
        await click('查看结果');
        await until(() => run(`document.querySelector('img[alt="处理后"]')?.naturalWidth===1024`), 'decoded image');
        for (const [width, height] of [[1280, 800], [960, 640]]) {
            win.setSize(width, height); await wait(300);
            for (const option of ['轻量识别', '精细识别']) {
                await run(`(()=>{const root=document.querySelector('[aria-label="主体识别模式"]').closest('.ant-select');const trigger=root.querySelector('.ant-select-content')||root.querySelector('.ant-select-selector')||root;trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));trigger.click()})()`);
                await until(() => run(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].some(e=>e.textContent.trim()===${JSON.stringify(option)})`), 'mode popup');
                const popup = await run(`(()=>{const e=[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].find(e=>e.textContent.trim()===${JSON.stringify(option)});const r=e.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);const visible=r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight&&(e===hit||e.contains(hit));if(visible)e.click();return visible})()`);
                assert.ok(popup, 'Mode popup option is clipped or obstructed');
                await until(() => run(`document.querySelector('[aria-label="主体识别模式"]').closest('.ant-select').innerText.includes(${JSON.stringify(option)})`), 'mode selection');
            }
            const geometry = await run(`(()=>{
                const labels=['图片处理工具','主体识别模式','边缘羽化','边缘收缩','边缘去底色'];
                const controls=labels.map(label=>{const e=document.querySelector('[aria-label="'+label+'"]');const root=e.closest('.ant-select')||e;const r=root.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {label,visible:r.width>0&&r.height>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,hit:!!hit&&(root===hit||root.contains(hit)),rect:{x:r.x,y:r.y,width:r.width,height:r.height}}});
                const buttons=[...document.querySelectorAll('[aria-label="图片工具"] button')].filter(e=>e.textContent.trim()==='存入素材库'||e.classList.contains('ant-btn-primary')).map(e=>{const r=e.getBoundingClientRect();return {label:e.textContent.trim(),visible:r.width>0&&r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight}});
                return {devicePixelRatio,viewport:[innerWidth,innerHeight],bodyOverflow:document.documentElement.scrollWidth>innerWidth,controls,buttons};
            })()`);
            report.cases.push({ window: [width, height], modeSwitch: true, ...geometry });
            await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await wait(600);
            const screenshot = await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
            report.cases.at(-1).screenshotPixels = screenshot.getSize();
            fs.writeFileSync(path.join(root, `atelier-scale-${scale}-${width}.png`), screenshot.toPNG());
            assert.equal(geometry.devicePixelRatio, scale);
            assert.equal(geometry.bodyOverflow, false);
            assert.ok(geometry.controls.every(c => c.visible && c.hit), JSON.stringify(geometry.controls));
            assert.equal(geometry.buttons.length, 2);
            assert.ok(geometry.buttons.every(b => b.visible), JSON.stringify(geometry.buttons));
        }
        assert.deepEqual(await request('open', { id: prior.projectId }), original);
        assert.deepEqual(await request('tool-list', { projectId: prior.projectId }), jobs);
        report.projectAndJobsUnchanged = true; report.passed = true;
    } catch (error) { report.error = error.message; process.exitCode = 1; }
    finally { clearTimeout(deadline); fs.writeFileSync(path.join(root, `atelier-scale-${scale}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report)); app.exit(process.exitCode || 0); }
});
