const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), assert = require('node:assert/strict');
const base = 'http://127.0.0.1:3439';
const folder = path.resolve(__dirname, '../../docs/studio-evidence');
const fixture = JSON.parse(fs.readFileSync(path.join(folder, 'atelier-large-library.json')));
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'studio-thumb-profile-')));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
    const report = { at: new Date().toISOString(), passes: [], passed: false };
    let win;
    const deadline = setTimeout(() => app.exit(1), 90000);
    try {
        const response = await fetch(base + '/api/studio', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Request': '1' }, body: JSON.stringify({ action: 'list' }) });
        assert.ok((await response.json()).location.includes('CanvasStudioThumbnailQA'));
        win = new BrowserWindow({ width: 1440, height: 1000, show: process.env.STUDIO_THUMB_VISIBLE === '1', webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } });
        const run = code => win.webContents.executeJavaScript(code, true);
        const trace = [];
        let finishTrace;
        const traceDone = new Promise(resolve => { finishTrace = resolve; });
        if (process.env.STUDIO_THUMB_TRACE === '1') {
            win.webContents.debugger.attach('1.3');
            win.webContents.debugger.on('message', (_event, method, params) => {
                if (method === 'Tracing.dataCollected') trace.push(...params.value);
                if (method === 'Tracing.tracingComplete') finishTrace();
            });
            await win.webContents.debugger.sendCommand('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
        }
        const until = async (fn, label) => { for (let i = 0; i < 300; i++) { if (await fn()) return; await wait(50); } throw Error('Timeout: ' + label); };
        await win.loadURL(base + '/studio');
        await until(() => run(`document.body.innerText.includes(${JSON.stringify(fixture.projectId)})`), 'project');
        for (const cache of process.env.STUDIO_THUMB_WHEEL === '1' ? ['first-pass-disk-cache-partial', 'repeat-pass'] : ['cold', 'warm']) {
            await run(`(()=>{performance.clearResourceTimings();window.profileLongTasks=[];window.profileObserver?.disconnect();window.profileObserver=new PerformanceObserver(list=>window.profileLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));window.profileObserver.observe({type:'longtask'});window.profileStart=performance.now();})()`);
            await run(`[...document.querySelectorAll('nav button')].find(e=>e.textContent.trim()==='素材库').click()`);
            await until(() => run(`!!document.querySelector('.asset-grid')`), 'library grid');
            await run(`document.querySelector('.asset-grid').scrollTop=0`);
            await until(() => run(`document.querySelector('.asset-preview img')?.naturalWidth>0`), 'thumbnail');
            await wait(1500);
            const scrolls = [];
            for (const index of [100, 200, 300, 400]) {
                if (process.env.STUDIO_THUMB_WHEEL === '1') {
                    const box = await run(`(()=>{const e=document.querySelector('.asset-grid'),r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),before:e.scrollTop}})()`);
                    for (let tick = 0; tick < 5; tick++) {
                        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: 180 });
                        await wait(100);
                    }
                    const after = await run(`document.querySelector('.asset-grid').scrollTop`);
                    assert.ok(after > box.before, 'Wheel input must actually move the library');
                    scrolls.push({ input: 'wheel', before: box.before, after });
                } else {
                    await run(`window.scrollStart=performance.now();document.querySelectorAll('.asset-card')[${index}].scrollIntoView()`);
                    await until(() => run(`document.querySelectorAll('.asset-card')[${index}].querySelector('img').naturalWidth>0`), 'scroll ' + index);
                    scrolls.push({ index, readyMs: await run('performance.now()-window.scrollStart') });
                }
            }
            await wait(500);
            report.passes.push({ cache, scrolls, ...(await run(`({longTasks:window.profileLongTasks,resources:performance.getEntriesByType('resource').filter(e=>e.name.includes('thumbnail=1')).map(e=>({start:e.startTime,duration:e.duration,request:e.requestStart,responseStart:e.responseStart,responseEnd:e.responseEnd,transferSize:e.transferSize}))})`)) });
            await run(`[...document.querySelectorAll('nav button')].find(e=>e.textContent.trim()==='提示词工作台').click()`);
        }
        if (process.env.STUDIO_THUMB_TRACE === '1') {
            await win.webContents.debugger.sendCommand('Tracing.end');
            await traceDone;
            report.trace = trace.filter(event => event.ph === 'X' && event.dur > 10000).sort((a, b) => b.dur - a.dur).slice(0, 50).map(event => ({ name: event.name, ms: event.dur / 1000, data: event.args?.data }));
            report.layoutTotals = ['Layout', 'UpdateLayoutTree', 'Paint', 'FunctionCall', 'RecalculateStyles'].map(name => ({ name, ms: trace.filter(event => event.name === name && event.ph === 'X').reduce((sum, event) => sum + event.dur / 1000, 0) }));
        }
        report.passed = true;
    } catch (error) {
        report.error = String(error.stack || error);
        if (win && !win.isDestroyed()) {
            report.page = await win.webContents.executeJavaScript('document.body.innerText.slice(0,1000)').catch(() => 'unavailable');
            try { fs.writeFileSync(path.join(folder, 'atelier-thumbnail-failure.png'), (await win.webContents.capturePage()).toPNG()); }
            catch (captureError) { report.captureError = String(captureError.message || captureError); }
        }
    }
    clearTimeout(deadline);
    fs.writeFileSync(path.join(folder, process.env.STUDIO_THUMB_VISIBLE === '1' ? 'atelier-thumbnail-visible.json' : process.env.STUDIO_THUMB_WHEEL === '1' ? 'atelier-thumbnail-wheel.json' : process.env.STUDIO_THUMB_TRACE === '1' ? 'atelier-thumbnail-trace.json' : 'atelier-thumbnail-profile.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, error: report.error, passes: report.passes.map(p => ({ cache: p.cache, scrolls: p.scrolls, longestTaskMs: Math.max(0, ...p.longTasks.map(t => t.duration)), resourceCount: p.resources.length, maxRequestMs: Math.max(0, ...p.resources.map(r => r.duration)) })) }));
    app.exit(report.passed ? 0 : 1);
});
