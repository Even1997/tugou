const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3439';
const report = { at: new Date().toISOString(), passed: false };
const evidence = path.resolve(__dirname, '../../docs/studio-evidence/atelier-detail-cutout-ui.json');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'studio-detail-cutout-')));
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(action, payload) {
    const response = await fetch(base + '/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' }, body: JSON.stringify({ action, payload }) });
    if (!response.ok) throw Error(await response.text());
    return response.json();
}
app.whenReady().then(async () => {
    const deadline = setTimeout(() => app.exit(1), 120000);
    try {
        assert.ok((await request('list')).location.includes('CanvasStudioCutoutUpgradeQA/atelier-qa') || (await request('list')).location.includes('CanvasStudioCutoutUpgradeQA\\atelier-qa'));
        assert.equal((await request('tool-capabilities')).cutoutDetail, true);
        const id = 'detail-cutout-' + Date.now(), now = new Date().toISOString();
        const dataUrl = 'data:image/png;base64,' + fs.readFileSync('D:/CanvasStudioBiRefNetFullQA/alpha-benchmark/flowers-pattern.png').toString('base64');
        await request('save', { format: 'canvas-studio', version: 5, id, name: id, width: 1024, height: 683, background: 'transparent', updatedAt: now, modules: [], recipes: [], jobs: [], layers: [], assets: [{ id: 'source', name: '花束主体', dataUrl, width: 1024, height: 683, hasAlpha: false, createdAt: now }] });
        const win = new BrowserWindow({ width: 1300, height: 960, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
        const run = async code => { try { return await win.webContents.executeJavaScript(code, true); } catch (error) { throw Error('UI evaluation: ' + code.slice(0, 250), { cause: error }); } };
        const until = async (fn, label) => { for (let i = 0; i < 300; i++) { if (await fn()) return; await wait(100); } throw Error('Timeout: ' + label); };
        const click = text => run(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`);
        const choose = async (label, option) => {
            await run(`(()=>{const root=document.querySelector('[aria-label="${label}"]').closest('.ant-select');const trigger=root.querySelector('.ant-select-content')||root.querySelector('.ant-select-selector')||root;trigger.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0}));trigger.click();})()`);
            await until(() => run(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].some(e=>e.textContent.trim()===${JSON.stringify(option)})`), option);
            await run(`[...document.querySelectorAll('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')].find(e=>e.textContent.trim()===${JSON.stringify(option)}).click()`);
        };
        await win.loadURL(base + '/studio');
        await until(() => run(`document.body.innerText.includes(${JSON.stringify(id)})`), 'project');
        await click('图片工具');
        await until(() => run(`!!document.querySelector('[aria-label="图片处理工具"]')`), 'tool controls');
        await choose('图片处理工具', '主体抠图');
        const mode = () => run(`document.querySelector('[aria-label="主体识别模式"]').closest('.ant-select').innerText`);
        await until(async () => (await mode()).includes('精细识别'), 'detail default');
        await choose('主体识别模式', '轻量识别');
        assert.ok((await mode()).includes('轻量识别'));
        await choose('主体识别模式', '精细识别');
        for (const width of [1300, 960]) {
            win.setSize(width, 960); await wait(150);
            assert.ok(await run(`(()=>{const r=document.querySelector('[aria-label="主体识别模式"]').closest('.ant-select').getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()`));
        }
        await run(`document.querySelector('[aria-label="图片工具"] button.ant-btn-primary').click()`);
        let job;
        await until(async () => { job = (await request('tool-list', { projectId: id })).find(j => j.tool === 'cutout'); if (job?.status === 'failed') throw Error(job.error); return job?.status === 'completed'; }, 'real detail result');
        assert.equal(job.options.cutoutModel, 'detail');
        await until(() => run(`[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='查看结果')`), 'completed task UI');
        await click('查看结果');
        await until(() => run(`!!document.querySelector('img[alt="处理后"]')`), 'result preview');
        await click('存入素材库');
        await until(async () => (await request('open', { id })).assets.length === 2, 'saved output');
        const saved = await request('open', { id });
        assert.equal(saved.assets[0].dataUrl, dataUrl);
        assert.equal(saved.assets[1].width, 1024); assert.equal(saved.assets[1].height, 683);
        await win.loadURL(base + '/studio');
        await until(() => run(`document.body.innerText.includes(${JSON.stringify(id)})`), 'reload');
        await click('图片工具');
        await until(() => run(`document.body.innerText.includes('查看结果')`), 'history');
        await click('查看结果');
        await until(async () => (await mode()).includes('精细识别'), 'restored mode');
        await until(() => run(`(()=>{const img=document.querySelector('img[alt="处理后"]');return img?.complete&&img.naturalWidth===1024})()`), 'restored image decoded');
        try {
            for (const width of [1300, 960]) {
                win.setSize(width, 960);
                await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await wait(600);
                fs.writeFileSync(path.join(path.dirname(evidence), `atelier-detail-cutout-ui-${width}.png`), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
            }
            report.screenshot = true;
        }
        catch (error) { report.screenshot = false; report.captureError = error.message; }
        Object.assign(report, { passed: true, projectId: id, jobId: job.id, defaultDetail: true, modeSwitch: true, widths: [1300, 960], actualModel: job.options.cutoutModel, savedAndReloaded: true, originalUnchanged: true });
        fs.writeFileSync(evidence, JSON.stringify(report, null, 2)); clearTimeout(deadline); console.log(JSON.stringify(report)); app.exit(0);
    } catch (error) { report.error = error.stack; fs.writeFileSync(evidence, JSON.stringify(report, null, 2)); console.error(error); app.exit(1); }
});
