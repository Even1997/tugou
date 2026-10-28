const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const os = require('node:os');
const { ConnectionStore } = require('../core/connection.cjs');
const { hash } = require('../core/storage.cjs');
const { decryptLegacyConnection } = require('../core/legacy-connection.cjs');
if (!process.env.TUGOU_DATA_DIR || !require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR)) throw new Error('Isolated QA profile required');
const timeout = setTimeout(() => app.exit(1), 20000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  try {
    const js = (source) => window.webContents.executeJavaScript(source, true);
    const projects = await js('window.tugou.list()');
    let savedModule = false, assets = false;
    for (const project of projects) {
      const record = await js(`window.tugou.open(${JSON.stringify(project.id)})`);
      savedModule ||= record.document.modules.some((module) => module.text === '独立实现验收：人物与动作分别配置。');
      assets ||= record.document.assets.length === 4;
    }
    const settings = await js('window.tugou.connection()');
    assert.ok(savedModule && assets && settings.hasKey && settings.apiKey === undefined);
    const report = { actualProcessRestart: true, modulesPreserved: savedModule, assetsPreserved: assets, encryptedSettingsReloaded: settings.hasKey, rendererSecretAbsent: settings.apiKey === undefined, verifiedAt: new Date().toISOString() };
    const workflow = JSON.parse(await fs.readFile(path.resolve(__dirname, '../test-results/workflow-desktop.json'), 'utf8'));
    const workflowRecord = await js(`window.tugou.open(${JSON.stringify(workflow.projectId)})`);
    assert.equal(workflowRecord.document.tugouCanvas.nodes.length, 3);
    assert.equal(workflowRecord.document.tugouCanvas.edges.length, 1);
    assert.ok(workflowRecord.document.tugouCanvas.nodes.some((node) => node.data.binding?.overrideText === '单张人物覆盖'));
    assert.deepEqual(workflowRecord.document.canvasProjectIds, ['legacy-unmigrated-id']);
    assert.deepEqual(workflowRecord.document.unknown, { preserve: true });
    report.canvasAndRecipesRestored = true;
    const source = path.join(app.getPath('appData'), 'CanvasStudio', 'credentials.enc');
    const before = await fs.readFile(source);
    const stateFile = path.join(path.dirname(source), 'Local State');
    const stateBefore = hash(await fs.readFile(stateFile));
    const legacy = JSON.parse(await decryptLegacyConnection(before, source));
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'tugou-credential-qa-'));
    try {
      const store = new ConnectionStore(temporary, safeStorage);
      const publicResult = await store.importLegacy(source, decryptLegacyConnection);
      const restored = await store.readPrivate();
      assert.ok(restored.apiKey === legacy.apiKey.trim(), 'Credential value mismatch');
      assert.ok(restored.model === legacy.model.trim(), 'Model mismatch');
      assert.equal(publicResult.apiKey, undefined);
      assert.equal(hash(await fs.readFile(source)), hash(before));
      assert.equal(hash(await fs.readFile(stateFile)), stateBefore);
      report.realCredentialMigration = { valuesPreserved: true, originalUnchanged: true, rendererSecretAbsent: true };
    } finally {
      if (path.dirname(temporary) !== os.tmpdir() || !path.basename(temporary).startsWith('tugou-credential-qa-')) throw new Error('Unsafe cleanup');
      await fs.rm(temporary, { recursive: true, force: true });
    }
    await fs.writeFile(path.resolve(__dirname, '../test-results/desktop-restart.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); clearTimeout(timeout); await js('window.tugou.window("close")');
  } catch (error) { await fs.writeFile(path.resolve(__dirname, '../test-results/desktop-restart.json'), JSON.stringify({ passed: false, error: error.message })); console.error(error.message); clearTimeout(timeout); app.exit(1); }
}));
require('../main.cjs');
