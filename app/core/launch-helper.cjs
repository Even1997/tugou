const { app } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

function launchHelper(mode, args) {
  if (!['--tugou-key-reader', '--tugou-canvas-reader'].includes(mode)) throw new Error('未知迁移工具');
  const entry = app.isPackaged ? [] : [path.join(__dirname, '../main.cjs')];
  return spawn(process.execPath, [...entry, mode, ...args], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
}
module.exports = { launchHelper };
