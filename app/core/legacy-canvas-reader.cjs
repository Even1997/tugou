const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');
const os = require('node:os');
const temporary = process.argv[process.argv.indexOf('--tugou-canvas-reader')+1];
if (!process.argv.includes('--tugou-canvas-reader') || !process.send || !temporary || path.dirname(temporary) !== require('node:fs').realpathSync(os.tmpdir()) || !path.basename(temporary).startsWith('tugou-canvas-import-')) process.exit(1);
app.setPath('userData', temporary);
app.whenReady().then(async () => {
  // Intercept the old origin in a disposable profile. Never contact or run the old application.
  await session.defaultSession.protocol.handle('http', () => new Response('<!doctype html><title>Migration</title>', { headers: { 'Content-Type': 'text/html' } }));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await window.loadURL('http://127.0.0.1:3418');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const databases = await indexedDB.databases();
    if (!databases.some(db => db.name === 'infinite-canvas')) throw new Error('No canvas database');
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('infinite-canvas'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    const entries = async (store) => {
      if (!db.objectStoreNames.contains(store)) return [];
      return new Promise((resolve, reject) => { const rows = []; const tx = db.transaction(store, 'readonly'); const r = tx.objectStore(store).openCursor();
        r.onsuccess = () => { const c = r.result; if (c) { rows.push([c.key, c.value]); c.continue(); } }; tx.oncomplete = () => resolve(rows); tx.onerror = () => reject(tx.error); });
    };
    const state = (await entries('app_state')).find(([key]) => key === 'infinite-canvas:canvas_store')?.[1];
    const images = [];
    for (const [key, value] of await entries('image_files')) {
      if (value instanceof Blob) images.push([key, await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(value); })]);
    }
    db.close(); return { state, images };
  })()`);
  process.send({ ok: true, value: result }, () => app.exit(0));
}).catch(() => { process.send({ ok: false }, () => app.exit(1)); });
