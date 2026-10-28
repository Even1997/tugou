const { app, BrowserWindow, safeStorage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
if (!process.env.TUGOU_DATA_DIR || !require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR)) throw new Error('Isolated QA profile required');
const results = { checks: [], consoleErrors: [], networkRequests: [] };
const output = path.resolve(__dirname, '../test-results');
const timeout = setTimeout(() => { console.error('Desktop QA timeout'); app.exit(1); }, 45000);
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') results.consoleErrors.push(details.message); });
  window.webContents.once('did-finish-load', async () => {
    const js = (source) => window.webContents.executeJavaScript(source, true);
    const wait = async (expression) => {
      for (let attempt = 0; attempt < 80; attempt++) { if (await js(expression)) return; await new Promise((resolve) => setTimeout(resolve, 75)); }
      throw new Error(`Timed out: ${expression}`);
    };
    const check = (name, value) => { assert.ok(value, name); results.checks.push(name); };
    try {
      await fs.mkdir(output, { recursive: true });
      window.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => { results.networkRequests.push(details.url); callback({ cancel: true }); });
      await wait('document.querySelector(".toolbar") !== null');
      check('renderer isolated from Node', await js('typeof require === "undefined" && typeof process === "undefined"'));
      const secondInstance = new Promise((resolve) => app.once('second-instance', resolve));
      const child = spawn(process.execPath, [path.resolve(__dirname, '..')], { windowsHide: true, stdio: 'ignore', env: process.env });
      await Promise.race([Promise.all([secondInstance, new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Second process exit ${code}`))); })]), new Promise((_, reject) => setTimeout(() => reject(new Error('Single instance timeout')), 6000))]);
      check('second launch reuses the existing window', BrowserWindow.getAllWindows().length === 1);
      const projects = await js('window.tugou.list()');
      check('real legacy imports available', projects.length >= 2);
      let assetProject;
      for (const project of projects) {
        const record = await js(`window.tugou.open(${JSON.stringify(project.id)})`);
        if (record.document.assets.length && record.origin?.canvasStatus === 'external-data-pending') { assetProject = record; break; }
      }
      assert.ok(assetProject);
      await wait('document.querySelector("select[aria-label=当前工程]").options.length >= 3');
      await js(`{ const select = document.querySelector('select[aria-label=当前工程]'); select.value = ${JSON.stringify(assetProject.id)}; select.dispatchEvent(new Event('change', { bubbles: true })); }`);
      await wait('document.querySelector(".module-editor") !== null');
      check('external canvas migration status visible', await js('document.body.textContent.includes("可从顶部「⋯」迁移画布内容")'));
      await fs.writeFile(path.join(output, 'workbench.png'), (await window.webContents.capturePage()).toPNG());
      await js(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent === '素材库').click()`);
      await wait('document.querySelectorAll(".asset-image img").length === 4 && Array.from(document.querySelectorAll(".asset-image img")).every(img => img.complete && img.naturalWidth > 0)');
      check('four real asset thumbnails render', true);
      await fs.writeFile(path.join(output, 'assets.png'), (await window.webContents.capturePage()).toPNG());
      window.setSize(960, 720);
      await wait('innerWidth === 960');
      check('960px layout has no horizontal overflow', await js('document.documentElement.scrollWidth === innerWidth'));
      await fs.writeFile(path.join(output, 'assets-960.png'), (await window.webContents.capturePage()).toPNG());
      await js(`Array.from(document.querySelectorAll('.project-menu button')).find(b => b.textContent === '新建').click()`);
      await wait('document.querySelector("input[aria-label=工程名称]")?.value === "未命名创作"');
      await js(`Array.from(document.querySelectorAll('nav button')).find(b => b.textContent === '提示词工作台').click()`);
      await wait('document.querySelector("button[aria-label=新建模块]") !== null');
      await js(`document.querySelector('button[aria-label=新建模块]').click()`);
      await wait('document.querySelector("textarea[aria-label=模块提示词]") !== null');
      await js(`{ const input = document.querySelector('textarea[aria-label=模块提示词]'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '独立实现验收：人物与动作分别配置。'); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
      await wait('document.querySelector("[role=status]").textContent === "有未保存修改"');
      await js(`Array.from(document.querySelectorAll('.toolbar-end button')).find(b => b.textContent === '保存').click()`);
      await wait('document.querySelector("[role=status]").textContent === "已保存"');
      const createdId = await js('document.querySelector("select[aria-label=当前工程]").value');
      const created = await js(`window.tugou.open(${JSON.stringify(createdId)})`);
      check('module edit survives disk reload', created.document.modules[0].text === '独立实现验收：人物与动作分别配置。' && created.revision === 2);
      check('DPAPI available', safeStorage.isEncryptionAvailable());
      const publicSettings = await js(`window.tugou.saveConnection({baseUrl:'https://example.com/v1',model:'test-model',apiKey:'qa-only-dummy-key'})`);
      check('key omitted from renderer response', publicSettings.apiKey === undefined && publicSettings.hasKey);
      const encrypted = await fs.readFile(path.join(process.env.TUGOU_DATA_DIR, 'workspace', 'connection.enc'));
      check('key encrypted using system protection', !encrypted.includes(Buffer.from('qa-only-dummy-key')) && JSON.parse(safeStorage.decryptString(encrypted)).apiKey === 'qa-only-dummy-key');
      await js(`Array.from(document.querySelectorAll('.toolbar-end button')).find(b => b.textContent === '模型连接').click()`);
      await wait('document.querySelector(".ant-modal input[type=password]") !== null');
      check('saved secret is not populated in input', await js('document.querySelector("input[type=password]").value === ""'));
      await fs.writeFile(path.join(output, 'connection-960.png'), (await window.webContents.capturePage()).toPNG());
      await js(`{ const input = document.querySelector('.ant-modal input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'http://unsafe.example.com'); input.dispatchEvent(new Event('input', { bubbles: true })); }`);
      await js(`document.querySelector('.ant-modal form').requestSubmit()`);
      await wait('document.querySelector(".ant-modal [role=alert]")?.textContent.includes("HTTPS")');
      check('connection errors remain visible inside the dialog', true);
      await js(`document.querySelector('button[aria-label=关闭模型连接]').click()`);
      window.webContents.setZoomFactor(1.5);
      await wait('document.querySelector(".toolbar").getBoundingClientRect().width <= innerWidth');
      check('150% content zoom has no horizontal overflow', await js('document.documentElement.scrollWidth === innerWidth'));
      await fs.writeFile(path.join(output, 'workbench-150.png'), (await window.webContents.capturePage()).toPNG());
      window.webContents.setZoomFactor(1);
      await js('window.tugou.window("maximize")');
      await new Promise((resolve) => setTimeout(resolve, 200));
      check('custom maximize works', window.isMaximized());
      await js('window.tugou.window("maximize")');
      await new Promise((resolve) => setTimeout(resolve, 200));
      check('custom restore works', !window.isMaximized());
      await js('window.tugou.window("minimize")');
      await new Promise((resolve) => setTimeout(resolve, 200));
      check('custom minimize works', window.isMinimized());
      window.restore();
      check('no cloud calls or old service requests', results.networkRequests.length === 0);
      check('no renderer errors', results.consoleErrors.length === 0);
      results.processMemoryKiB = app.getAppMetrics().map((item) => ({ type: item.type, workingSetSize: item.memory.workingSetSize, peakWorkingSetSize: item.memory.peakWorkingSetSize }));
      results.finishedAt = new Date().toISOString();
      await fs.writeFile(path.join(output, 'desktop-smoke.json'), JSON.stringify(results, null, 2));
      console.log(JSON.stringify(results));
      clearTimeout(timeout);
      await js('window.tugou.window("close")');
    } catch (error) {
      results.failure = error.stack;
      await fs.writeFile(path.join(output, 'desktop-smoke.json'), JSON.stringify(results, null, 2));
      await fs.writeFile(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG());
      console.error(error.stack); clearTimeout(timeout); app.exit(1);
    }
  });
});
require('../main.cjs');
