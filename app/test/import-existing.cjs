const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { ProjectStore, hash, resourcesIn } = require('../core/storage.cjs');

// Explicit paths only; never writes to the source profile or prints project contents.
(async () => {
  const [sourceArg, targetArg] = process.argv.slice(2);
  if (!sourceArg || !targetArg) throw new Error('Usage: node test/import-existing.cjs SOURCE_PROJECTS NEW_PROFILE');
  const source = path.resolve(sourceArg), target = path.resolve(targetArg);
  if (target === source || target.startsWith(source + path.sep) || source.startsWith(target + path.sep)) throw new Error('Source and destination must be separate');
  const store = new ProjectStore(path.join(target, 'workspace'));
  await store.init();
  const snapshot = async (folder) => {
    const result = {};
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isFile() && (entry.name.endsWith('.json') || /\.(png|jpe?g|webp)$/.test(entry.name))) result[entry.name] = hash(await fs.readFile(file));
      else if (entry.isDirectory() && entry.name === 'resources') for (const [name, value] of Object.entries(await snapshot(file))) result[`resources/${name}`] = value;
    }
    return result;
  };
  const before = await snapshot(source), results = [];
  for (const name of await fs.readdir(source)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(source, name), original = JSON.parse(await fs.readFile(file, 'utf8'));
    if (original.format !== 'canvas-studio') continue;
    const start = performance.now();
    const imported = await store.importLegacy(file);
    const reopened = await store.read(imported.id);
    assert.deepEqual(reopened.document, original);
    assert.equal((await store.importLegacy(file)).id, imported.id);
    await store.verifyResources(reopened.document);
    results.push({ sourceId: original.id, destinationId: imported.id, fieldsPreserved: true, resourcesVerified: resourcesIn(original).size, externalCanvas: imported.origin.canvasStatus, milliseconds: Math.round(performance.now() - start) });
  }
  assert.deepEqual(await snapshot(source), before);
  const report = { sourceUnchanged: true, sourceFilesChecked: Object.keys(before).length, projects: results, verifiedAt: new Date().toISOString() };
  await fs.mkdir('test-results', { recursive: true });
  await fs.writeFile('test-results/import-existing.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
