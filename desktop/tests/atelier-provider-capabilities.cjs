// Read-only provider discovery. Decrypt only in memory, use only the configured host.
const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const sync = require('node:fs');
const qaProfile = 'D:/CanvasStudioLiveQA/capability-electron';
// SafeStorage's encrypted master-key state must match the ciphertext; copy only
// encrypted state to our own QA profile before Chromium initializes it.
sync.mkdirSync(qaProfile, { recursive: true });
sync.copyFileSync(path.join(app.getPath('appData'), 'CanvasStudio', 'Local State'), path.join(qaProfile, 'Local State'));
app.setPath('userData', qaProfile);
app.whenReady().then(async () => {
    let key = '';
    try {
        const credentialFile = path.join(app.getPath('appData'), 'CanvasStudio', 'credentials.enc');
        const before = await fs.readFile(credentialFile);
        const config = JSON.parse(safeStorage.decryptString(before));
        const origin = new URL(config.baseUrl);
        assert.equal(origin.protocol, 'https:'); assert.equal(origin.host, 'xymm.win');
        key = config.apiKey; assert.ok(key);
        const results = [];
        for (const route of ['/v1/models', '/v1/images/batches/models']) {
            const response = await fetch(new URL(route, origin), { method: 'GET', headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(20000) });
            const raw = (await response.text()).split(key).join('[REDACTED]');
            assert.ok(raw.length < 100000, 'Unexpected discovery response size');
            let body; try { body = JSON.parse(raw); } catch { body = raw.slice(0, 300); }
            results.push({ route, status: response.status, body });
        }
        assert.equal(createHash('sha256').update(before).digest('hex'), createHash('sha256').update(await fs.readFile(credentialFile)).digest('hex'));
        const report = { at: new Date().toISOString(), host: origin.host, configuredModel: config.model, readOnly: true, imageRequests: 0, credentialFileUnchanged: true, results };
        await fs.writeFile(path.resolve(__dirname, '../../docs/studio-evidence/atelier-provider-capabilities.json'), JSON.stringify(report, null, 2));
        console.log(JSON.stringify(report)); app.exit(0);
    } catch (e) { console.error(String(e.message).split(key || '\0').join('[REDACTED]')); app.exit(1); }
});
