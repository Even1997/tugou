const { app, nativeImage, dialog } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
if (!require('./qa-paths.cjs').inside(process.env.TUGOU_DATA_DIR)) throw new Error('QA profile required');
const output = path.resolve(__dirname, '../test-results'), report = { checks: [], errors: [] };
const timeout = setTimeout(() => app.exit(1), 90000);
let release, mode = 'wait', calls = 0;
const server = http.createServer(async (req, res) => {
  for await (const _ of req) { /* Consume the request. */ }
  calls++;
  if (mode === 'wait') await new Promise(resolve => { release = resolve; });
  if (mode === 'error') { res.writeHead(400); res.end('not logged'); return; }
  const image = nativeImage.createFromBitmap(Buffer.from([80, 150, 240, 255, 240, 180, 90, 128]), { width: 2, height: 1 });
  res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ b64_json: image.toPNG().toString('base64') }] }));
});
app.on('browser-window-created', (_event, window) => {
  window.webContents.on('console-message', (_event, details) => { if (details.level === 'error') report.errors.push(details.message); });
  window.webContents.once('did-finish-load', async () => {
    const js = code => window.webContents.executeJavaScript(code, true);
    const wait = async expression => { for (let i = 0; i < 140; i++) { if (await js(expression)) return; await new Promise(r => setTimeout(r, 50)); } throw new Error(`Timed out: ${expression}`); };
    const click = async (selector, text) => { await wait(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).some(e=>e.textContent.trim()===${JSON.stringify(text)})`); await js(`Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(e=>e.textContent.trim()===${JSON.stringify(text)}).click()`); };
    const check = (name, result) => { assert.ok(result, name); report.checks.push(name); };
    const fill = (selector, value) => js(`{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));}`);
    const open = async id => { await js(`{const el=document.querySelector('select[aria-label=当前工程]');el.value=${JSON.stringify(id)};el.dispatchEvent(new Event('change',{bubbles:true}));}`); await wait(`document.querySelector('select[aria-label=当前工程]').value===${JSON.stringify(id)}`); };
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      await wait('document.querySelector(".toolbar")');
      await js(`window.tugou.saveConnection({baseUrl:'http://127.0.0.1:${server.address().port}/v1',apiKey:'qa-only',model:'qa-images'})`);
      const original = path.join(app.getPath('appData'), 'CanvasStudio/projects/67ca1e15-a70e-432a-9f15-6a26cfba9eb4.json');
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [original] });
      await click('.project-menu button', '导入'); await wait('document.querySelector(".document-heading")');
      await js("document.querySelector('button[aria-label=更多操作]').click()"); await new Promise(r=>setTimeout(r,100)); await click('.import-menu button', '迁移旧画布');
      await wait('document.querySelector(".statusbar").textContent.includes("已迁入 3 个画布")');
      const projects = await js('window.tugou.list()'); const migrated = [];
      for (const p of projects) { const r = await js(`window.tugou.open(${JSON.stringify(p.id)})`); if (r.origin?.legacyCanvasId) migrated.push(r); }
      check('real legacy canvas migration: 3 canvases, 19 nodes, 16 edges', migrated.length === 3 && migrated.reduce((sum,r)=>sum+r.document.tugouCanvas.nodes.length,0) === 19 && migrated.reduce((sum,r)=>sum+r.document.tugouCanvas.edges.length,0) === 16);
      check('actual source node fields preserved', migrated.every(r=>r.document.legacyCanvas.nodes.every(n=>JSON.stringify(n)===JSON.stringify(r.document.tugouCanvas.nodes.find(x=>x.id===n.id).data.legacy))));
      report.migrationWarnings = migrated.flatMap(r=>r.document.migrationWarnings);
      const r = migrated.find(r=>r.origin.legacyCanvasId === 'EjfAj87SsbpUDQn7OQuZO');
      await open(r.id); await click('nav button', '无限画布'); await click('#canvas-actions button', '适应画布');
      await wait('document.querySelectorAll(".react-flow__node").length===5');
      const node = r.document.tugouCanvas.nodes.find(n=>n.type==='recipe');
      await js(`document.querySelector('[data-id="${node.id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
      await wait('Array.from(document.querySelectorAll("#canvas-actions button")).some(b=>b.textContent==="生成图片"&&!b.disabled)');
      await click('#canvas-actions button', '生成图片');
      await wait('Array.from(document.querySelectorAll("#canvas-actions button")).some(b=>b.textContent==="生成中")');
      check('top toolbar submits and exposes running state', calls === 1);
      await fill('input[aria-label=工程名称]', '生成期间仍可编辑');
      release();
      await wait('document.querySelectorAll(".react-flow__node").length===6');
      check('result inserts into current canvas without losing concurrent edits', await js('document.querySelector("input[aria-label=工程名称]").value === "生成期间仍可编辑"'));
      await click('.toolbar-end button', '保存'); await wait('document.querySelector("[role=status]").textContent==="已保存"');
      const saved = await js(`window.tugou.open(${JSON.stringify(r.id)})`);
      check('result stored with actual dimensions and requested size', saved.document.assets.some(a=>a.width===2&&a.height===1&&a.generation.requestedSize));
      await click('nav button', '素材库'); await wait('document.querySelectorAll(".asset-grid .asset-card").length===5');
      await wait('[...document.querySelectorAll(".asset-grid img")].every(img=>img.complete&&img.naturalWidth>0)');
      check('same generated result visible in asset library', true);
      mode = 'wait'; await click('nav button', '无限画布'); await js(`document.querySelector('[data-id="${node.id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`); await click('#canvas-actions button', '生成图片');
      await wait('Array.from(document.querySelectorAll(".statusbar button")).some(b=>b.textContent==="任务 · 1")'); await click('.statusbar button', '任务 · 1');
      await wait('document.querySelector(".task-dialog")'); await click('.task-row button', '取消任务'); release?.();
      await wait('document.querySelector(".task-list").textContent.includes("已取消")');
      check('task panel cancellation works', true);
      await js('document.querySelector("[aria-label=关闭任务]").click()');
      mode = 'error'; await click('#canvas-actions button', '生成图片');
      await wait('(async()=> (await window.tugou.tasks()).at(-1)?.status === "failed")()');
      await click('.statusbar button', '任务'); await wait('document.querySelector(".task-list").textContent.includes("HTTP 400")');
      check('failure status is actionable without automatic retry', calls === 3);
      await new Promise(resolve => setTimeout(resolve, 150)); await fs.writeFile(path.join(output, 'generation-tasks.png'), (await window.webContents.capturePage()).toPNG());
      await js('document.querySelector("[aria-label=关闭任务]").click()'); await click('#canvas-actions button', '适应画布');
      window.setSize(960, 720); await new Promise(resolve=>setTimeout(resolve,200));
      check('960px top toolbar stays inside viewport', await js('document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll(".toolbar button,#canvas-actions button")].every(e=>e.getBoundingClientRect().right<=innerWidth)'));
      await fs.writeFile(path.join(output, 'generation-canvas-960.png'), (await window.webContents.capturePage()).toPNG());
      if (await js('document.querySelector("[role=status]").textContent.includes("未保存")')) { await click('.toolbar-end button', '保存'); await wait('document.querySelector("[role=status]").textContent==="已保存"'); }
      mode='wait';await click('nav button','提示词工作台');
      await click('.recipe-footer button','生成素材');
      await wait('(async()=> (await window.tugou.tasks()).at(-1)?.status === "running")()');
      await js(`{const e=document.querySelector('textarea[aria-label=模块提示词]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,'提交之后继续编辑，不能丢失');e.dispatchEvent(new Event('input',{bubbles:true}));}`);
      release();await wait('(async()=> (await window.tugou.tasks()).at(-1)?.status === "completed")()');await new Promise(resolve=>setTimeout(resolve,1400));
      check('workbench generation preserves subsequent module edits',await js('document.querySelector("textarea[aria-label=模块提示词]").value === "提交之后继续编辑，不能丢失"'));
      await click('.toolbar-end button','保存');await wait('document.querySelector(".statusbar").textContent.includes("已保存")');
      const workbenchSaved=await js(`window.tugou.open(${JSON.stringify(r.id)})`);
      check('workbench-generated image joins same material library',workbenchSaved.document.assets.length===6&&calls===4);
      report.projectId = r.id; report.providerCalls = calls; check('no renderer errors', report.errors.length===0);
      await fs.writeFile(path.join(output, 'generation-desktop.json'), JSON.stringify(report,null,2));
      clearTimeout(timeout); server.closeAllConnections(); server.close(); await js('window.tugou.window("close")');
    } catch(error) { report.failure = error.message; await fs.writeFile(path.join(output, 'generation-desktop.json'), JSON.stringify(report,null,2)); clearTimeout(timeout); server.closeAllConnections(); server.close(); app.exit(1); }
  });
});
require('../main.cjs');
