const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { ProjectStore, hash } = require('../core/storage.cjs');
const { TaskQueue } = require('../core/tasks.cjs');
const { GenerationService } = require('../core/generation.cjs');
const { mergeResults } = require('../core/results.cjs');
const { migrateCanvases } = require('../core/legacy-canvas.cjs');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tugou-generation-test-'));
  const store = new ProjectStore(root); await store.init();
  const tasks = new TaskQueue(root); await tasks.init();
  const requests = []; let behavior = 'ok', release;
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    requests.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
    if (req.url === '/image.png') { res.end(png); return; }
    if (behavior === 'wait') await new Promise(resolve => { release = resolve; });
    if (behavior === 'error') { res.writeHead(401); res.end('secret-test-token'); return; }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: behavior === 'empty' ? [] : [behavior === 'url' ? { url: `http://127.0.0.1:${server.address().port}/image.png` } : { b64_json: png.toString('base64') }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { release?.(); await tasks.shutdown(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); if (path.dirname(root) === os.tmpdir()) await fs.rm(root, { recursive: true, force: true }); });
  const service = new GenerationService(store, { readPrivate: async () => ({ baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'test-model', apiKey: 'secret-test-token' }) }, tasks, () => ({ width: 1, height: 1 }));
  const record = await store.create('生成测试');
  const recipe = { id: 'r', name: '人物', moduleIds: [], moduleBindings: [], references: [], output: '人物测试', size: '2048x3072' };
  const document = { ...record.document, recipes: [recipe], tugouCanvas: { version: 1, nodes: [{ id: 'n', type: 'recipe', position: { x: 10, y: 20 }, data: { recipeId: 'r', snapshot: recipe } }], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, unknown: { retained: true } };
  return { root, store, tasks, service, record, document, requests, behavior: value => { behavior = value; }, release: () => release?.() };
}
async function finished(f) { await f.tasks.execution; return f.tasks.list().at(-1); }
async function requestArrived(f) { for (let i = 0; i < 100 && !f.requests.length; i++) await new Promise(r => setTimeout(r, 10)); assert.ok(f.requests.length); }

test('angle generation snapshots source and camera, shares configured model and persists output without altering original', async t=>{
  const f=await fixture(t),a={id:'a',name:'人物',dataUrl:`data:image/png;base64,${png.toString('base64')}`,width:1,height:1};
  f.document.assets.push(a);f.document.tugouCanvas.nodes.push({id:'image',type:'asset',position:{x:40,y:50},data:{assetId:'a',role:'主体'}});
  const original=structuredClone(f.document),params={horizontalAngle:30,pitchAngle:-20,cameraDistance:2.5,wideAngle:true};
  const {id}=await f.service.angle(f.record.id,f.document,'image','a',params);await finished(f);
  assert.deepEqual(f.document,original);assert.equal(f.requests.length,1);assert.match(f.requests[0].body,/右侧 30°/);assert.match(f.requests[0].body,/test-model/);
  const journal=JSON.parse(await fs.readFile(path.join(f.root,'requests',id+'.json'),'utf8'));assert.deepEqual(journal.angle,params);assert.equal(journal.referenceAssets[0].dataUrl,a.dataUrl);assert.ok(!JSON.stringify(journal).includes('secret-test-token'));
  const result=(await f.service.results(f.record.id))[0],merged=mergeResults(f.document,[result]);
  assert.deepEqual(merged.assets[0],a);assert.deepEqual(merged.tugouCanvas.nodes[1],original.tugouCanvas.nodes[1]);assert.deepEqual(result.assets[0].generation.angle,params);assert.equal(merged.tugouCanvas.nodes.at(-1).position.x,40+require('../core/workflow-nodes.cjs').nodeWidth('asset')+70);
  assert.equal((await f.service.assetDetails(f.record.id,merged,result.assets[0].id)).prompt,result.prompt);
  await assert.rejects(f.service.angle(f.record.id,f.document,'image','missing',params),/源图片/);assert.equal(f.requests.length,1);
});

test('asset prompt is the saved generation snapshot, scoped to project and exact output identity, including derivative lineage',async t=>{
  const f=await fixture(t);await f.service.start(f.record.id,f.document,'n');await finished(f);
  const [result]=await f.service.results(f.record.id),asset=result.assets[0];
  const doc=mergeResults(f.document,[result]);doc.recipes[0].output='后续修改';asset.generation.model='改动的元数据';
  const details=await f.service.assetDetails(f.record.id,doc,asset.id);assert.equal(details.prompt,result.prompt);assert.equal(details.model,'test-model');assert.equal(details.requestedSize,'2048x3072');assert.ok(!JSON.stringify(details).includes('secret-test-token'));
  const derivative={id:'derived',name:'裁剪结果',toolResult:{source:structuredClone(asset)}};doc.assets.push(derivative);
  const inherited=await f.service.assetDetails(f.record.id,doc,derivative.id);assert.equal(inherited.prompt,result.prompt);assert.equal(inherited.label,'来源素材的生成提示词');
  const other=await f.store.create('其他工程');assert.equal((await f.service.assetDetails(other.id,{...other.document,assets:[asset]},asset.id)).prompt,'');
  const spoofed={...asset,resource:'0'.repeat(64)+'.png'};assert.equal((await f.service.assetDetails(f.record.id,{...doc,assets:[spoofed]},asset.id)).prompt,'');
  await fs.unlink(path.join(f.root,'results',result.id+'.json'));assert.equal((await f.service.assetDetails(f.record.id,doc,asset.id)).prompt,'');
});
test('legacy prompt belongs only to its original image; cloud tool text remains explicit and missing records stay empty',async t=>{
  const f=await fixture(t),{replaceCanvasAsset}=require('../core/canvas-media.cjs');
  const a={id:'a',name:'导入图'},b={id:'b',name:'替换图'},doc={...f.document,assets:[a,b],tugouCanvas:{...f.document.tugouCanvas,nodes:[{id:'old',type:'asset',position:{x:0,y:0},data:{assetId:'a',role:'仅身份',legacy:{metadata:{prompt:'旧图生成文本'}}}}]}};
  assert.equal((await f.service.assetDetails(f.record.id,doc,'a','old')).prompt,'旧图生成文本');
  assert.equal((await f.service.assetDetails(f.record.id,doc,'b','old')).prompt,'');
  const replaced=replaceCanvasAsset(doc,'old','a',b);assert.equal((await f.service.assetDetails(f.record.id,replaced,'b','old')).prompt,'');
  assert.equal((await f.service.assetDetails(f.record.id,replaceCanvasAsset(replaced,'old','b',a),'a','old')).prompt,'旧图生成文本');
  const cloud={id:'cloud',toolResult:{prompt:'将背景改为蓝色',model:'editor'}};assert.equal((await f.service.assetDetails(f.record.id,{...doc,assets:[cloud]},'cloud')).label,'处理提示词');
  await assert.rejects(f.service.assetDetails(f.record.id,doc,'absent'),/移除/);
});

test('direct API request persists original pixels and result independently; merging retains edits and is idempotent', async t => {
  const f = await fixture(t); await f.service.start(f.record.id, f.document, 'n');
  assert.equal((await finished(f)).status, 'completed');
  assert.match(f.tasks.list()[0].message, /与请求 2048x3072 不同/);
  const results = await f.service.results(f.record.id); assert.equal(results.length, 1);
  const a = results[0].assets[0]; assert.equal(a.width, 1); assert.equal(a.generation.requestedSize, '2048x3072');
  assert.equal(hash(await fs.readFile(path.join(f.root, 'resources', a.resource))), hash(png));
  const edited = { ...f.document, name: '生成期间修改', layers: [{ id: 'kept' }] };
  const merged = mergeResults(edited, results); assert.equal(merged.name, edited.name); assert.deepEqual(merged.layers, edited.layers); assert.deepEqual(merged.unknown, edited.unknown);
  assert.deepEqual(mergeResults(merged, results), merged);
  const removedNode = { ...merged, tugouCanvas: { ...merged.tugouCanvas, nodes: merged.tugouCanvas.nodes.filter(n => !n.id.startsWith('result-')) } };
  assert.deepEqual(mergeResults(removedNode, results), removedNode, 'Deleted result nodes must not resurrect after reopening');
  assert.equal(JSON.parse(f.requests[0].body).size, '2048x3072');
  assert.ok(!(await fs.readFile(path.join(f.root, 'tasks.json'), 'utf8')).includes('secret-test-token'));
});
test('ordered reference images use multipart edits and retain role descriptions', async t => {
  const f = await fixture(t); f.document.assets.push({ id: 'a', dataUrl: `data:image/png;base64,${png.toString('base64')}` });
  f.document.tugouCanvas.nodes[0].data.snapshot.references.push({ assetId: 'a', role: '仅身份' });
  await f.service.start(f.record.id, f.document, 'n'); assert.equal((await finished(f)).status, 'completed');
  assert.equal(f.requests[0].url, '/v1/images/edits'); assert.match(f.requests[0].body, /name="image\[\]"/); assert.match(f.requests[0].body, /仅身份/);
});
test('result URL downloads carry no model authorization header', async t => {
  const f = await fixture(t); f.behavior('url'); await f.service.start(f.record.id, f.document, 'n'); assert.equal((await finished(f)).status, 'completed');
  assert.equal(f.requests[1].headers.authorization, undefined);
});
test('HTTP failure shows safe status, creates no empty asset, and never automatically retries', async t => {
  const f = await fixture(t); f.behavior('error'); await f.service.start(f.record.id, f.document, 'n'); const task = await finished(f);
  assert.equal(task.status, 'failed'); assert.match(task.message, /401/); assert.ok(!task.message.includes('secret-test-token'));
  assert.equal((await f.service.results(f.record.id)).length, 0); assert.equal(f.requests.length, 1);
});
test('cancellation discards a late provider response; same-node duplicate submissions are rejected', async t => {
  const f = await fixture(t); f.behavior('wait'); const job = await f.service.start(f.record.id, f.document, 'n'); await requestArrived(f);
  await assert.rejects(f.service.start(f.record.id, f.document, 'n'), /已有任务/);
  await f.tasks.cancel(job.id); f.release(); assert.equal((await finished(f)).status, 'cancelled'); assert.deepEqual(await f.service.results(f.record.id), []);
});
test('completed disk results recover after interruption without another provider request', async t => {
  const f = await fixture(t); await f.service.start(f.record.id, f.document, 'n'); await finished(f);
  f.tasks.tasks[0].status = 'running'; await f.tasks.persist();
  const restarted = new TaskQueue(f.root); await restarted.init();
  const service = new GenerationService(f.store, {}, restarted, () => ({})); await service.recover();
  assert.equal(restarted.list()[0].status, 'completed'); assert.equal((await service.results(f.record.id)).length, 1); assert.equal(f.requests.length, 1);
});
test('missing reference prevents submission, and empty response never publishes a result', async t => {
  const f = await fixture(t); f.document.tugouCanvas.nodes[0].data.snapshot.references.push({ assetId: 'missing', role: '身份' });
  await assert.rejects(f.service.start(f.record.id, f.document, 'n'), /缺失/); assert.equal(f.requests.length, 0);
  f.document.tugouCanvas.nodes[0].data.snapshot.references = []; f.behavior('empty'); await f.service.start(f.record.id, f.document, 'n'); assert.equal((await finished(f)).status, 'failed');
});
test('canvas migration preserves opaque source, positions, links, images and parent data; repeat import keeps edits', async t => {
  const f = await fixture(t);
  const source = { id: 'old', title: '旧画布', nodes: [{ id: 'text', type: 'text', title: '公共画风', position: { x: 5, y: 6 }, metadata: { content: '画风原文' } }, { id: 'gen', type: 'image', title: '人物', position: { x: 320, y: 0 }, metadata: { prompt: '全身' } }, { id: 'pic', type: 'image', position: { x: 0, y: 300 }, metadata: { storageKey: 'local-pic' } }], connections: [{ id: 'edge', fromNodeId: 'text', toNodeId: 'gen' }], viewport: { x: 80, y: 90, k: .5 }, unknown: { preserved: true } };
  const parent = await f.store.save(f.record.id, { ...f.document, canvasProjectIds: ['old'] }, 1);
  const snapshot = { state: JSON.stringify({ state: { projects: [source] } }), images: [['local-pic', `data:image/png;base64,${png.toString('base64')}`]] };
  const imported = await migrateCanvases(f.store, snapshot, () => ({ width: 1, height: 1 })); const child = await f.store.read(imported[0].id);
  assert.deepEqual(child.document.legacyCanvas, source); assert.equal(child.document.tugouCanvas.nodes.length, 3); assert.equal(child.document.tugouCanvas.edges.length, 1); assert.equal(child.document.assets.length, 1); assert.equal(child.document.tugouCanvas.viewport.zoom, .5);
  const linked = await f.store.read(parent.id); assert.deepEqual(linked.document.tugouCanvas, parent.document.tugouCanvas); assert.equal(linked.origin.canvasStatus, 'migrated');
  await f.store.save(child.id, { ...child.document, name: '后续修改' }, child.revision); await migrateCanvases(f.store, snapshot, () => ({})); assert.equal((await f.store.read(child.id)).document.name, '后续修改');
});
