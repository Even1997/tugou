// Distinct large decoded images, isolated packaged UI, no model requests.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto'), { execFile } = require('node:child_process');
const sharp = require('../../web/node_modules/sharp');
const base = process.env.STUDIO_TEST_URL, serverPid = Number(process.env.STUDIO_QA_SERVER_PID);
if (base !== 'http://127.0.0.1:3439' || !Number.isInteger(serverPid) || serverPid < 1) throw Error('Isolated QA and explicit server PID required');
const evidence = path.resolve(__dirname, '../../docs/studio-evidence/atelier-large-library.json');
const result = { at: new Date().toISOString(), passed: false, samples: [], scrolls: [], errors: [] };
const save = () => fs.writeFileSync(evidence, JSON.stringify(result, null, 2));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const post = async (action, payload) => {
    const response = await fetch(base + '/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' }, body: JSON.stringify({ action, payload }) });
    if (!response.ok) throw Error(await response.text());
    return response.json();
};
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'studio-large-library-')));
app.whenReady().then(async () => {
    let active = true, sampler, phase = 'prepare', guardError;
    const deadline = setTimeout(() => { result.error = 'Benchmark exceeded 6 minutes'; save(); app.exit(1); }, 360000);
    try {
        assert.ok((await post('list')).location.includes('atelier-qa'));
        const assets = [], pixelHashes = new Set(), id = 'large-library-' + Date.now(), now = new Date().toISOString();
        let sourceBytes = 0, first;
        for (let index = 0; index < 500; index++) {
            assert.ok(os.freemem() > 1024 ** 3, 'Stop preparation below 1 GiB free physical memory');
            const raw = Buffer.alloc(256 * 256 * 3);
            for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
                const offset = (y * 256 + x) * 3;
                raw[offset] = (x + index) % 256;
                raw[offset + 1] = (y + Math.floor(index / 256) * 97) % 256;
                raw[offset + 2] = (x + y + index * 19) % 256;
            }
            pixelHashes.add(createHash('sha256').update(raw).digest('hex'));
            const bytes = await sharp(raw, { raw: { width: 256, height: 256, channels: 3 } }).resize(2048, 2048, { kernel: 'nearest' }).png({ compressionLevel: 3 }).toBuffer();
            if (!index) first = bytes;
            sourceBytes += bytes.length;
            const stored = await post('resource-store', { dataUrl: 'data:image/png;base64,' + bytes.toString('base64') });
            assets.push({ id: 'image-' + index, name: '大素材 ' + index, dataUrl: stored.dataUrl, width: 2048, height: 2048, hasAlpha: false, createdAt: now });
            if (index % 100 === 99) console.log('Prepared ' + (index + 1));
        }
        assert.equal(pixelHashes.size, 500, 'Pixel contents must be distinct, not just file metadata');
        assert.equal(new Set(assets.map(asset => asset.dataUrl)).size, 500);
        const project = { format: 'canvas-studio', version: 5, id, name: id, width: 2048, height: 2048, background: 'transparent', updatedAt: now, assets, layers: [], jobs: [], modules: [], recipes: [] };
        await post('save', project);
        const openStart = Date.now(), loaded = await post('open', { id, lazy: true });
        Object.assign(result, { projectId: id, assets: 500, size: [2048, 2048], sourceBytes, uniquePixelContents: pixelHashes.size, hypotheticalFullRgbaBytes: 500 * 2048 * 2048 * 4, lazyOpenMs: Date.now() - openStart, lazyResponseBytes: Buffer.byteLength(JSON.stringify(loaded)) });
        assert.equal(loaded.assets.length, 500);
        assert.ok(!JSON.stringify(loaded).includes('base64,'));
        const win = new BrowserWindow({ width: 1440, height: 1000, show: false, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
        const run = code => win.webContents.executeJavaScript(code, true);
        const until = async (predicate, label) => { for (let i = 0; i < 300; i++) { if (guardError) throw guardError; if (await predicate()) return; await wait(100); } throw Error('Timeout: ' + label); };
        const requests = [];
        win.webContents.session.webRequest.onCompleted({ urls: [base + '/api/studio/resource/*'] }, details => requests.push(details.url));
        win.webContents.on('console-message', ({ level, message }) => { if (level === 'error' || level === 3) result.errors.push(message); });
        sampler = (async () => {
            while (active) {
                const metrics = app.getAppMetrics(), server = await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${serverPid} | Select-Object PrivateMemorySize64 | ConvertTo-Json -Compress`], { windowsHide: true }, (error, out) => resolve(error ? null : JSON.parse(out))));
                const electronPrivateMiB = metrics.reduce((sum, process) => sum + (process.memory.privateBytes || 0), 0) / 1024;
                const totalPrivateMiB = electronPrivateMiB + (server?.PrivateMemorySize64 || 0) / 1048576;
                const freeMiB = os.freemem() / 1048576;
                let heartbeatMs = null;
                if (phase !== 'load') { const start = Date.now(); await run('1'); heartbeatMs = Date.now() - start; }
                result.samples.push({ phase, at: Date.now(), electronPrivateMiB, serverPrivateMiB: server?.PrivateMemorySize64 / 1048576, totalPrivateMiB, freeMiB, heartbeatMs });
                if (!server || freeMiB < 1024 || totalPrivateMiB > 3072) { guardError = Error('Memory safety gate reached'); win.destroy(); break; }
                await wait(750);
            }
        })();
        phase = 'load';
        await win.loadURL(base + '/studio');
        await until(() => run(`document.body.innerText.includes(${JSON.stringify(id)})`), 'open');
        const openLibrary = async () => {
            await run(`[...document.querySelectorAll('nav button')].find(button=>button.textContent.trim()==='素材库').click()`);
            await until(() => run(`document.querySelectorAll('.asset-preview img').length===500&&document.querySelector('.asset-preview img').naturalWidth>0`), 'library');
        };
        await openLibrary();
        phase = 'initial'; await wait(1500);
        result.initialRequests = new Set(requests).size;
        assert.ok(result.initialRequests < 150, 'Originals or all thumbnails loaded eagerly');
        for (let round = 0; round < 3; round++) {
            phase = 'scroll-' + round;
            for (let index = 0; index < 500; index += 20) {
                const start = Date.now();
                await run(`document.querySelectorAll('.asset-card')[${index}].scrollIntoView()`);
                await until(() => run(`document.querySelectorAll('.asset-card')[${index}].querySelector('img').naturalWidth>0`), 'thumbnail ' + index);
                result.scrolls.push({ round, index, readyMs: Date.now() - start });
            }
            phase = 'idle-' + round; await wait(3000);
            if (round === 1) { phase = 'load'; await win.reload(); await until(() => run(`document.body.innerText.includes(${JSON.stringify(id)})`), 'reload'); await openLibrary(); }
        }
        assert.ok(requests.every(url => url.endsWith('?thumbnail=1')), 'Library loaded full original images');
        assert.ok(await run(`[...document.querySelectorAll('.asset-preview img')].filter(img=>img.naturalWidth).every(img=>img.naturalWidth<=384&&img.naturalHeight<=384)`));
        result.thumbnailOnlyWhileBrowsing = true;
        result.reopened = true;
        phase = 'selected-original';
        await run(`document.querySelector('.asset-card:first-child').scrollIntoView();document.querySelector('.asset-card:first-child .asset-buttons button').click()`);
        await until(async () => (await post('open', { id, lazy: true })).layers.length === 1, 'selected original layer');
        await until(() => Promise.resolve(requests.some(url => url.endsWith(assets[0].dataUrl))), 'original loaded');
        const original = await fetch(base + assets[0].dataUrl);
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), first);
        result.originalBytesPreserved = true;
        phase = 'final-idle'; await wait(3000);
        active = false; await sampler;
        if (guardError) throw guardError;
        assert.deepEqual(result.errors, []);
        result.peakPrivateMiB = Math.round(Math.max(...result.samples.map(sample => sample.totalPrivateMiB)));
        result.maxHeartbeatMs = Math.max(...result.samples.map(sample => sample.heartbeatMs || 0));
        assert.ok(result.maxHeartbeatMs < 2000, 'UI heartbeat exceeded 2 seconds');
        result.memoryScope = 'All test Electron processes plus isolated Next server; excludes fixture preparation, unrelated apps and Go API. Private commit is not physical RAM or VRAM.';
        result.limits = '500 distinct synthetic 4MP pixels, 3 bounded scroll passes, one reload, one selected full image. Not 500 simultaneous editor layers, arbitrary photo quality, or unlimited lifetime.';
        result.passed = true;
        save(); console.log(JSON.stringify({ passed: true, sourceBytes, peakPrivateMiB: result.peakPrivateMiB, maxHeartbeatMs: result.maxHeartbeatMs, initialRequests: result.initialRequests }));
        clearTimeout(deadline); app.exit(0);
    } catch (error) { active = false; result.error = String(error.stack || error); save(); console.error(error); clearTimeout(deadline); app.exit(1); }
});
