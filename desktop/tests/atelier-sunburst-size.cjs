// One alternate-model request; never change the user's connection or retry it.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sharp = require('../../web/node_modules/sharp');
const root = 'D:/CanvasStudioLiveQA';
const profile = path.join(root, 'sunburst-electron');
const reportFile = path.join(root, 'live-upscale-sunburst.json');
assert.ok(!sync.existsSync(reportFile), 'Existing attempt must be reviewed, never retried');
sync.mkdirSync(profile, { recursive: true });
sync.copyFileSync(path.join(app.getPath('appData'), 'CanvasStudio', 'Local State'), path.join(profile, 'Local State'));
app.setPath('userData', profile);
app.whenReady().then(async () => {
    let key = '', report, before;
    const credentialFile = path.join(app.getPath('appData'), 'CanvasStudio', 'credentials.enc');
    try {
        before = await fs.readFile(credentialFile);
        const config = JSON.parse(safeStorage.decryptString(before));
        key = config.apiKey;
        const base = new URL(config.baseUrl);
        assert.equal(base.protocol, 'https:'); assert.equal(base.host, 'xymm.win'); assert.ok(key);
        const source = await fs.readFile(path.join(root, 'cloud-quality-source.png'));
        const original = JSON.parse(await fs.readFile(path.join(root, 'live-upscale.json'), 'utf8'));
        const hash = createHash('sha256').update(source).digest('hex');
        assert.equal(hash, original.sourceSha256);
        const form = new FormData();
        form.set('model', 'gpt-image-2.5-sunburst'); form.set('n', '1'); form.set('size', '2048x2048');
        form.set('prompt', '将参考图片进行2倍创意放大，输出完整2048×2048像素图片。保持猫的姿态、脸部、胡须、照片边界、背景、色块位置，文字必须仍为“ATELIER 2026”。仅改善清晰度和细节，不改变设计。');
        form.set('image[]', new Blob([source], { type: 'image/png' }), 'reference-1.png');
        report = { at: new Date().toISOString(), status: 'submitted', host: base.host, model: 'gpt-image-2.5-sunburst', configuredModel: config.model, sourceSha256: hash, requestedSize: [2048, 2048], remoteRequests: 1, source: 'Existing CC0 Chelsea plus local shapes and text; no user photos' };
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
        const started = Date.now();
        const response = await fetch(config.baseUrl.replace(/\/$/, '') + '/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, redirect: 'error', signal: AbortSignal.timeout(600000) });
        report.responseMs = Date.now() - started; report.httpStatus = response.status;
        const data = await response.json();
        assert.ok(response.ok, String(data.error?.message || `HTTP ${response.status}`).slice(0, 400));
        assert.ok(data.data?.[0]?.b64_json, 'No inline image; inspect provider protocol before any further request');
        const bytes = Buffer.from(data.data[0].b64_json, 'base64');
        await fs.writeFile(path.join(root, 'upscale-sunburst-provider-output.png'), bytes);
        const meta = await sharp(bytes).metadata(); report.providerSize = [meta.width, meta.height];
        assert.deepEqual(report.providerSize, report.requestedSize, 'Provider output does not match requested 2K dimensions');
        report.status = 'dimensions-passed-visual-review-pending';
    } catch (error) {
        process.exitCode = 1;
        if (!report) report = { remoteRequests: 0 };
        report.status = 'failed'; report.error = String(error.message).split(key || '\0').join('[REDACTED]').slice(0, 500);
    } finally {
        report.credentialFileUnchanged = !!before && before.equals(await fs.readFile(credentialFile));
        report.finishedAt = new Date().toISOString();
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
        await fs.writeFile(path.resolve(__dirname, '../../docs/studio-evidence/atelier-live-upscale-sunburst.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report));
        app.exit(process.exitCode || 0);
    }
});
