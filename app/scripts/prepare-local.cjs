const { app, safeStorage, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ProjectStore, safePath, hash } = require('../core/storage.cjs');
const { ConnectionStore } = require('../core/connection.cjs');
const { decryptLegacyConnection } = require('../core/legacy-connection.cjs');
const { readLegacyCanvas } = require('../core/legacy-canvas-source.cjs');
const { migrateCanvases } = require('../core/legacy-canvas.cjs');
app.setName('TugouIndependent');
app.setPath('userData', path.join(app.getPath('appData'),'TugouIndependent'));
if (!app.requestSingleInstanceLock()) app.exit(1);
else app.whenReady().then(async () => {
  const source = path.join(app.getPath('appData'),'CanvasStudio');
  const root = path.join(app.getPath('userData'),'workspace'), store = new ProjectStore(root); await store.init();
  const files = [];
  for (const name of await fs.readdir(path.join(source,'projects'))) {
    if (!name.endsWith('.json')) continue;
    const file = await safePath(source,'projects',name), bytes=await fs.readFile(file);
    const value=JSON.parse(bytes); if(value.format!=='canvas-studio')continue;
    files.push({ file, digest: hash(bytes) });
    await store.importLegacy(file);
  }
  const snapshot = await readLegacyCanvas(source);
  const canvases = await migrateCanvases(store,snapshot,bytes=>nativeImage.createFromBuffer(bytes).getSize());
  const connections = new ConnectionStore(root,safeStorage);
  if (!(await connections.publicSettings()).hasKey) await connections.importLegacy(path.join(source,'credentials.enc'),decryptLegacyConnection);
  for (const file of files) if(hash(await fs.readFile(file.file))!==file.digest)throw new Error('Source project changed during import');
  const report = { root, importedStudioProjects:files.length, canvases, sourceProjectHashes:files, sourceDatabaseHashes:snapshot.sourceHashes, settingsHaveKey:(await connections.publicSettings()).hasKey, oldSourceUnchanged:true, verifiedAt:new Date().toISOString() };
  await fs.writeFile(path.join(__dirname,'../test-results/production-migration.json'),JSON.stringify(report,null,2));
  app.exit(0);
}).catch(error=>{console.error(error.message);app.exit(1);});
