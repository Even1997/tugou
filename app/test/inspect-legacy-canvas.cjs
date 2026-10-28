const { app } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { readLegacyCanvas } = require('../core/legacy-canvas-source.cjs');
app.setPath('userData', require('./qa-paths.cjs').path("canvas-reader"));
app.whenReady().then(async () => {
  const result = await readLegacyCanvas(path.join(app.getPath('appData'), 'CanvasStudio'));
  await fs.writeFile(path.join(__dirname, '../test-results/legacy-canvas-snapshot.json'), JSON.stringify(result));
  const state = typeof result.state === 'string' ? JSON.parse(result.state) : result.state;
  await fs.writeFile(path.join(__dirname, '../test-results/legacy-canvas-summary.json'), JSON.stringify({ images: result.images.map(([id, data]) => ({ id, bytes: data.length })), projects: state?.state?.projects?.map(p => ({ id: p.id, title: p.title, nodes: p.nodes.map(n => ({ id: n.id, type: n.type, title: n.title, metadataKeys: Object.keys(n.metadata || {}), storageKey: n.metadata?.storageKey, contentPrefix: n.metadata?.content?.slice(0, 80) })), connections: p.connections })) }, null, 2));
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });
