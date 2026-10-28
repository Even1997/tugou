const { app, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { safePath } = require('./storage.cjs');
const [temporary, source] = process.argv.slice(process.argv.indexOf('--tugou-key-reader')+1);
if (!process.argv.includes('--tugou-key-reader') || !process.send || !temporary || path.dirname(temporary) !== require('node:fs').realpathSync(os.tmpdir()) || !path.basename(temporary).startsWith('tugou-key-import-')) process.exit(1);
app.setPath('userData', temporary);
app.whenReady().then(async () => {
  try {
    const filename = await safePath(path.dirname(source), path.basename(source));
    const value = safeStorage.decryptString(await fs.readFile(filename));
    process.send({ ok: true, value }, () => app.exit(0));
  } catch { process.send({ ok: false }, () => app.exit(1)); }
});
