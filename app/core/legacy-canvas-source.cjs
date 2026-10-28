const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {launchHelper}=require('./launch-helper.cjs');
const { safePath, hash } = require('./storage.cjs');

async function readLegacyCanvas(profile) {
  const source = await safePath(profile, 'IndexedDB');
  const tempRoot=await fs.realpath(os.tmpdir());
  const temporary = await fs.mkdtemp(path.join(tempRoot, 'tugou-canvas-import-'));
  const fingerprints = async (folder, relative = '') => {
    const rows = [];
    for (const entry of await fs.readdir(await safePath(folder, relative), { withFileTypes: true })) {
      if (['LOCK', 'LOG', 'LOG.old'].includes(entry.name)) continue;
      const name = path.join(relative, entry.name), file = await safePath(folder, name);
      if (entry.isDirectory()) rows.push(...await fingerprints(folder, name));
      else rows.push([name, hash(await fs.readFile(file))]);
    }
    return rows.sort(([a], [b]) => a.localeCompare(b));
  };
  try {
    const before = await fingerprints(source);
    for (const [name, digest] of before) {
      const bytes = await fs.readFile(await safePath(source, name));
      if (hash(bytes) !== digest) throw new Error('旧画布正在写入，请稍后重试迁移');
      const target = await safePath(temporary, 'IndexedDB', name);
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, bytes);
    }
    if (JSON.stringify(before) !== JSON.stringify(await fingerprints(source))) throw new Error('旧画布正在写入，请稍后重试迁移');
    const value = await new Promise((resolve, reject) => {
      const child = launchHelper('--tugou-canvas-reader',[temporary]);
      let result;
      const timer = setTimeout(() => child.kill(), 30000);
      child.once('error', reject);
      child.on('message', (message) => { if (message?.ok) result = message.value; });
      child.once('exit', (code) => { clearTimeout(timer); code === 0 && result ? resolve(result) : reject(new Error('旧画布数据库读取失败，原数据未修改')); });
    });
    if (JSON.stringify(before) !== JSON.stringify(await fingerprints(source))) throw new Error('读取期间旧画布有更新，请重新迁移');
    return { ...value, sourceHashes: before };
  } finally {
    if (path.dirname(temporary) === tempRoot && path.basename(temporary).startsWith('tugou-canvas-import-')) await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}
module.exports = { readLegacyCanvas };
