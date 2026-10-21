const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const sharp = require('../../web/node_modules/sharp');
const base = process.env.STUDIO_TEST_URL, evidence = path.resolve(__dirname, '../../docs/studio-evidence');
if (!['http://127.0.0.1:3437', 'http://127.0.0.1:3439'].includes(base)) throw Error('Isolated QA required');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'studio-refs-ui-')));
app.disableHardwareAcceleration(); app.on('window-all-closed', () => {});
const wait = ms => new Promise(r => setTimeout(r, ms));
const step = label => fs.writeFileSync(path.join(evidence, 'atelier-references-ui-progress.json'), JSON.stringify({ at: new Date().toISOString(), label }));
const request = async (action, payload) => { const r = await fetch(base + '/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' }, body: JSON.stringify({ action, payload }) }); if (!r.ok) throw Error(await r.text()); return r.json(); };
app.whenReady().then(async () => {
    const deadline = setTimeout(() => { step('timeout'); app.exit(1); }, 180000);
    try {
        assert.ok((await request('list')).location.includes('atelier-qa'), 'Isolated data directory required');
        const dataUrl = 'data:image/png;base64,' + (await sharp(path.resolve(__dirname, '../../web/public/studio-demo/03-couple.png')).resize({ height: 192 }).png().toBuffer()).toString('base64');
        const id = 'atelier-refs-' + Date.now(), createdAt = new Date().toISOString();
        await request('save', { format: 'canvas-studio', version: 5, id, name: '参考职责验收', width: 1024, height: 1536, background: 'transparent', updatedAt: createdAt, modules: [{ id: 'style', name: '画风', kind: 'style', text: '细暖灰线条', global: true }], recipes: [{ id: 'recipe', name: '人物试样', moduleIds: [], references: [{ assetId: 'person', role: '只参考人物身份' }, { assetId: 'style-image', role: '只参考画风' }], output: '完整全身', size: '1024x1536' }], jobs: [], layers: [], assets: ['person', 'style-image'].map(id => ({ id, name: id, dataUrl, width: 128, height: 192, hasAlpha: true, createdAt })) });
        const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
        const run = code => win.webContents.executeJavaScript(code, true);
        const until = async (fn, label) => { step(label); for (let i = 0; i < 400; i++) { if (await fn()) return; await wait(150); } throw Error('Timeout: ' + label); };
        await win.loadURL(base + '/studio'); await until(() => run(`document.body.innerText.includes('参考职责验收')`), 'load');
        await run(`[...document.querySelectorAll('nav button')].find(e => e.textContent.includes('提示词工作台')).click()`);
        await until(() => run(`!!document.querySelector('[aria-label="上移参考图 2"]')`), 'reference editor');
        await run(`document.querySelector('[aria-label="上移参考图 2"]').click()`);
        await until(async () => (await request('open', { id })).recipes[0].references[0].assetId === 'style-image', 'reorder persisted');
        await run(`[...document.querySelectorAll('.ant-collapse-header')].find(e => e.textContent.includes('完整提示词')).click()`);
        await until(() => run(`document.querySelector('pre')?.textContent.includes('图片1：只参考画风')`), 'preview numbering');
        await run(`[...document.querySelectorAll('button')].find(e => e.textContent.includes('发送到画布')).click()`);
        await until(() => run(`!!document.querySelector('[aria-label="当前工程画布"]')`), 'canvas imported');
        const readCanvas = () => run(`new Promise((resolve,reject)=>{const r=indexedDB.open('infinite-canvas');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result;const q=db.transaction('app_state').objectStore('app_state').get('infinite-canvas:canvas_store');q.onsuccess=()=>{db.close();resolve(JSON.parse(q.result));};q.onerror=()=>reject(q.error);};})`);
        const state = await readCanvas(); const canvas = state.state.projects.find(p => p.title.includes('人物试样'));
        assert.ok(canvas); const links = canvas.connections.filter(c => c.referenceRole);
        assert.deepEqual(links.map(c => c.referenceRole), ['只参考画风', '只参考人物身份']);
        const target = canvas.nodes.find(n => n.title === '人物试样');
        assert.equal(target.metadata.prompt, '【构图与输出】\n完整全身');
        assert.equal(canvas.nodes.filter(n => n.metadata?.moduleRef).length, 1);
        for (const reference of canvas.nodes.filter(n => n.title.startsWith('图'))) {
            assert.ok(reference.metadata.content.startsWith('/api/studio/resource/'));
            const actual = await run(`fetch(${JSON.stringify(reference.metadata.content)}).then(r=>r.blob()).then(blob=>new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob)}))`);
            assert.equal(actual, dataUrl, 'canvas reference must resolve the full original');
        }
        await until(() => run(`!!document.querySelector('[data-node-id="${target.id}"]')`), 'canvas rendered');
        await run(`document.querySelector('[data-node-id="${target.id}"] > .relative').dispatchEvent(new MouseEvent('mousedown',{bubbles:true,button:0,clientX:500,clientY:300}));window.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0,clientX:500,clientY:300}));`);
        await until(() => run(`!!document.querySelector('[aria-label="设置图片1职责"]')`), 'canvas role control');
        assert.ok(await run(`(()=>{const r=document.querySelector('[aria-label="设置图片1职责"]').getBoundingClientRect();return r.top>=0&&r.bottom<innerHeight&&r.left>=0&&r.right<innerWidth;})()`), 'reference controls must be on screen');
        await run(`document.querySelector('[aria-label="设置图片1职责"]').click()`);
        await until(() => run(`!!document.querySelector('[aria-label="图片1职责"]')`), 'canvas role editor');
        await run(`(()=>{const el=document.querySelector('[aria-label="图片1职责"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'仅参考线条配色');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
        await until(async () => (await readCanvas()).state.projects.find(p => p.id === canvas.id).connections.some(c => c.referenceRole === '仅参考线条配色'), 'canvas role saved');
        const updated = (await readCanvas()).state.projects.find(p => p.id === canvas.id);
        await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }); await wait(500);
        fs.writeFileSync(path.join(evidence, 'atelier-references-ui.png'), (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
        await win.reload(); await until(() => run(`document.body.innerText.includes('参考职责验收')`), 'reload');
        assert.deepEqual((await readCanvas()).state.projects.find(p => p.id === canvas.id).connections, updated.connections);
        fs.writeFileSync(path.join(evidence, 'atelier-references-ui-results.json'), JSON.stringify({ at: new Date().toISOString(), reordered: true, promptMatchesOrder: true, rolesOnConnections: true, staticNumbersRemoved: true, moduleReferencePreserved: true, restartRestored: true, paidModelCalls: 0 }, null, 2));
        clearTimeout(deadline); step('passed'); app.exit(0);
    } catch (e) { step(String(e.stack || e)); app.exit(1); }
});
