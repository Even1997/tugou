const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
if (!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR)) throw new Error('QA profile required');
const timer = setTimeout(()=>app.exit(1), 20000);
app.on('browser-window-created', (_event, window) => window.webContents.once('did-finish-load', async () => {
  try {
    const js = code=>window.webContents.executeJavaScript(code,true);
    const prior = JSON.parse(await fs.readFile(path.join(__dirname,'../test-results/generation-desktop.json'),'utf8'));
    const record = await js(`window.tugou.open(${JSON.stringify(prior.projectId)})`);
    const tasks = await js('window.tugou.tasks()');
    const results = await js(`window.tugou.results(${JSON.stringify(record.id)})`);
    assert.equal(record.document.name, '生成期间仍可编辑'); assert.equal(record.document.assets.length, 5);
    assert.deepEqual(tasks.map(t=>t.status), ['completed','cancelled','failed']); assert.equal(results.length,1);
    assert.equal(record.document.tugouCanvas.nodes.length,6);
    assert.equal(results[0].assets[0].resource, record.document.assets.find(a=>a.generation).resource);
    await fs.writeFile(path.join(__dirname,'../test-results/generation-restart.json'),JSON.stringify({ actualProcessRestart:true, tasksRetained:3, resultAssetsRetained:1, noNetworkRetry:true, canvasNodesRetained:6, originalLegacyNodesRetained:record.document.legacyCanvas.nodes.length },null,2));
    clearTimeout(timer); await js('window.tugou.window("close")');
  } catch(e) { console.error(e.message); clearTimeout(timer); app.exit(1); }
}));
require('../main.cjs');
