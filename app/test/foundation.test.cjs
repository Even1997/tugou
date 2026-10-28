const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { ProjectStore, safePath, atomicWrite, hash } = require('../core/storage.cjs');
const { ConnectionStore } = require('../core/connection.cjs');
const { TaskQueue } = require('../core/tasks.cjs');

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'tugou-test-'));
  t.after(async () => { if (path.dirname(root) !== await fs.realpath(os.tmpdir()) || !path.basename(root).startsWith('tugou-test-')) throw new Error('Unsafe cleanup'); await fs.rm(root, { recursive: true, force: true }); });
  const store = new ProjectStore(path.join(root, 'new'));
  await store.init();
  return { root, store };
}

async function legacyFixture(root) {
  const folder = path.join(root, 'old');
  await fs.mkdir(path.join(folder, 'resources'), { recursive: true });
  const image = Buffer.from('immutable resource bytes');
  const name = `${hash(image)}.png`;
  await fs.writeFile(path.join(folder, 'resources', name), image);
  const document = { format: 'canvas-studio', version: 5, id: crypto.randomUUID(), name: '完整工程', width: 10000, height: 10000,
    modules: [{ id: 'm1', name: '画风', kind: 'style', text: '画风', global: false, custom: { untouched: true } }], recipes: [],
    assets: [{ id: 'a1', resource: name }], layers: [{ id: 'l1', bitmap: { resource: name }, mask: { paths: [[1, 2]], opacity: .37 }, effects: [{ future: true }] }], jobs: [{ status: 'running' }],
    canvasProjectIds: ['canvas-external'], unknown: { nested: ['原样保留', { v: 9 }] } };
  const source = path.join(folder, 'legacy.json');
  const raw = Buffer.from(JSON.stringify(document, null, 2));
  await fs.writeFile(source, raw);
  return { source, document, raw, name, image };
}

test('legacy import preserves every field and original bytes, copies resources, and is idempotent', async (t) => {
  const { root, store } = await fixture(t);
  const legacy = await legacyFixture(root);
  const record = await store.importLegacy(legacy.source);
  assert.deepEqual(record.document, legacy.document);
  assert.equal(record.origin.canvasStatus, 'external-data-pending');
  assert.deepEqual(await fs.readFile(legacy.source), legacy.raw);
  assert.deepEqual(await fs.readFile(path.join(store.root, 'imports', `${hash(legacy.raw)}.json`)), legacy.raw);
  assert.deepEqual(await fs.readFile(path.join(store.root, 'resources', legacy.name)), legacy.image);
  assert.equal((await store.importLegacy(legacy.source)).id, record.id);
  assert.equal((await store.list()).length, 1);
  const reopened = await new ProjectStore(store.root).read(record.id);
  assert.deepEqual(reopened.document, legacy.document);
});

test('changed legacy source creates a separate import without overwriting existing edits', async (t) => {
  const { root, store } = await fixture(t);
  const legacy = await legacyFixture(root);
  const first = await store.importLegacy(legacy.source);
  await store.save(first.id, { ...first.document, name: '新版本已编辑' }, 1);
  assert.equal((await store.importLegacy(legacy.source)).document.name, '新版本已编辑');
  await fs.writeFile(legacy.source, JSON.stringify({ ...legacy.document, name: '旧版新修改' }));
  const second = await store.importLegacy(legacy.source);
  assert.notEqual(first.id, second.id);
  assert.equal((await store.read(first.id)).document.name, '新版本已编辑');
});

test('missing or corrupt resource prevents project publication', async (t) => {
  const { root, store } = await fixture(t);
  const legacy = await legacyFixture(root);
  await fs.writeFile(path.join(root, 'old', 'resources', legacy.name), 'corrupt');
  await assert.rejects(store.importLegacy(legacy.source), /素材校验失败/);
  await fs.unlink(path.join(root, 'old', 'resources', legacy.name));
  await assert.rejects(store.importLegacy(legacy.source), { code: 'ENOENT' });
  assert.deepEqual(await store.list(), []);
});

test('optimistic revision prevents simultaneous saves losing data', async (t) => {
  const { store } = await fixture(t);
  const record = await store.create();
  const result = await Promise.allSettled(['first', 'second'].map((name) => store.save(record.id, { ...record.document, name }, 1)));
  assert.equal(result.filter((item) => item.status === 'fulfilled').length, 1);
  assert.match(result.find((item) => item.status === 'rejected').reason.message, /工程已更新/);
  assert.equal((await store.read(record.id)).revision, 2);
});

test('save failure preserves the committed project', async (t) => {
  const { store } = await fixture(t);
  const record = await store.create();
  const file = await store.projectPath(record.id);
  const before = await fs.readFile(file);
  await assert.rejects(store.save(record.id, { ...record.document, assets: [{ id: 'a1', resource: `${'a'.repeat(64)}.png` }] }, 1));
  assert.deepEqual(await fs.readFile(file), before);
  await assert.rejects(store.save(record.id, { ...record.document, width: 10001, height: 10000 }, 1), /一亿像素/);
  assert.deepEqual(await fs.readFile(file), before);
});

test('canvas state and reference snapshots survive save; malformed canvas cannot replace them', async (t) => {
  const { store } = await fixture(t);
  const { createNode, emptyCanvas } = require('../core/prompts.cjs');
  const record = await store.create('画布');
  const document = { ...record.document, modules: [{ id: 'm', name: '人物', kind: 'character', text: '快照', global: false }] };
  const node = createNode(document, 'module', 'm', { x: -222.5, y: 904.25 });
  document.tugouCanvas = { ...emptyCanvas(), nodes: [node], viewport: { x: 18, y: 22, zoom: .57 }, customFutureField: { retained: true } };
  await store.save(record.id, document, 1);
  assert.deepEqual((await new ProjectStore(store.root).read(record.id)).document, document);
  const invalid = { ...document, tugouCanvas: { ...document.tugouCanvas, edges: [{ id: 'broken', source: node.id, target: 'missing' }] } };
  await assert.rejects(store.save(record.id, invalid, 2), /画布连线/);
  assert.deepEqual((await store.read(record.id)).document, document);
});

test('damaged primary is recovered read-only, then can be explicitly saved', async (t) => {
  const { store } = await fixture(t);
  const record = await store.create('初始');
  await store.save(record.id, { ...record.document, name: '后一次保存' }, 1);
  const file = await store.projectPath(record.id);
  await fs.writeFile(file, '{broken');
  const recovered = await store.read(record.id);
  assert.equal(recovered.recovered, true);
  assert.equal(recovered.document.name, '初始');
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
  const saved = await store.save(record.id, { ...recovered.document, name: '恢复版本' }, recovered.revision);
  assert.equal(saved.recovered, false);
  assert.equal((await store.read(record.id)).document.name, '恢复版本');
});

test('invalid paths and linked folders are rejected', async (t) => {
  const { root, store } = await fixture(t);
  await assert.rejects(store.read('../secret'), /无效工程标识/);
  await assert.rejects(safePath(store.root, '..', 'outside'), /超出数据目录/);
  const outside = path.join(root, 'outside');
  await fs.mkdir(outside);
  await fs.symlink(outside, path.join(store.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(safePath(store.root, 'linked', 'x.json'), /链接目录/);
});

test('malicious resource names cannot import external files', async (t) => {
  const { root, store } = await fixture(t);
  const legacy = await legacyFixture(root);
  legacy.document.assets[0].resource = '../../outside.txt';
  await fs.writeFile(legacy.source, JSON.stringify(legacy.document));
  await assert.rejects(store.importLegacy(legacy.source), /无效素材文件名/);
  assert.equal((await store.list()).length, 0);
});

test('atomic write cleans its temporary file when rename fails', async (t) => {
  const { root } = await fixture(t);
  const target = path.join(root, 'directory');
  await fs.mkdir(target);
  await assert.rejects(atomicWrite(target, 'not a directory'));
  assert.equal((await fs.readdir(root)).filter((name) => name.endsWith('.tmp')).length, 0);
});

function encryptionFixture() {
  const key = crypto.randomBytes(32);
  return { isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]); },
    decryptString(bytes) { const cipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); } };
}

test('shared settings retain keys on blank edits, encrypt on disk, never return the secret', async (t) => {
  const { store } = await fixture(t);
  const encryption = encryptionFixture();
  const settings = new ConnectionStore(store.root, encryption);
  const result = await settings.save({ baseUrl: 'https://example.com/v1/', apiKey: 'test-only-secret', model: 'image' });
  assert.equal(result.hasKey, true); assert.equal(result.apiKey, undefined);
  assert.equal((await fs.readFile(path.join(store.root, 'connection.enc'))).includes(Buffer.from('test-only-secret')), false);
  await settings.save({ model: 'new-image', apiKey: '' });
  const reloaded = new ConnectionStore(store.root, encryption);
  assert.equal((await reloaded.readPrivate()).apiKey, 'test-only-secret');
  assert.equal((await reloaded.publicSettings()).model, 'new-image');
  assert.equal((await settings.save({ clearKey: true })).hasKey, false);
});

test('plaintext fallback and remote HTTP connections are rejected without touching settings', async (t) => {
  const { store } = await fixture(t);
  const settings = new ConnectionStore(store.root, encryptionFixture());
  await assert.rejects(settings.save({ baseUrl: 'http://example.com/v1', apiKey: 'secret' }), /HTTPS/);
  await assert.rejects(settings.save({ baseUrl: 'https://user:password@example.com/v1' }), /HTTPS/);
  const unavailable = new ConnectionStore(store.root, { isEncryptionAvailable: () => false });
  await assert.rejects(unavailable.save({ apiKey: 'secret' }), /未保存/);
  await assert.rejects(fs.access(path.join(store.root, 'connection.enc')));
  await settings.save({ baseUrl: 'http://127.0.0.1:8080/v1' });
});

test('legacy credentials are read-only and only supported connection fields migrate', async (t) => {
  const { root, store } = await fixture(t);
  const encryption = encryptionFixture();
  const legacy = path.join(root, 'credentials.enc');
  const before = encryption.encryptString(JSON.stringify({ baseUrl: 'https://example.com/v1', apiKey: 'old-secret', model: 'model', backendAdminPassword: 'must-not-migrate' }));
  await fs.writeFile(legacy, before);
  const connection = new ConnectionStore(store.root, encryption);
  const result = await connection.importLegacy(legacy);
  assert.equal(result.hasKey, true);
  assert.equal((await connection.readPrivate()).apiKey, 'old-secret');
  assert.equal((await connection.readPrivate()).backendAdminPassword, undefined);
  assert.deepEqual(await fs.readFile(legacy), before);
});

test('cancelled task discards late results even when the executor ignores abort', async (t) => {
  const { store } = await fixture(t);
  const queue = new TaskQueue(store.root); await queue.init();
  let finish, notify;
  const started = new Promise((resolve) => { notify = resolve; });
  const job = await queue.start('generation', () => new Promise((resolve) => { finish = resolve; notify(); }));
  await started;
  await queue.cancel(job.id);
  finish('late-image'); await job.completion;
  const record = queue.list()[0];
  assert.equal(record.status, 'cancelled'); assert.equal(record.resultId, undefined);
  const restart = new TaskQueue(store.root); await restart.init();
  assert.equal(restart.list()[0].status, 'cancelled');
});

test('restart marks submitted work interrupted and performs no resubmission', async (t) => {
  const { store } = await fixture(t);
  const queue = new TaskQueue(store.root); await queue.init();
  let calls = 0, finish, notify;
  const started = new Promise((resolve) => { notify = resolve; });
  const job = await queue.start('paid request', () => { calls++; return new Promise((resolve) => { finish = resolve; notify(); }); });
  await started;
  const restart = new TaskQueue(store.root); await restart.init();
  assert.equal(restart.list()[0].status, 'interrupted'); assert.equal(calls, 1);
  await queue.shutdown(); finish('discarded'); await job.completion;
  assert.equal(queue.list()[0].status, 'interrupted'); assert.equal(queue.list()[0].resultId, undefined);
});

test('jobs execute serially and cancelling queued work prevents submission', async (t) => {
  const { store } = await fixture(t);
  const queue = new TaskQueue(store.root); await queue.init();
  let finish, notify, secondCalls = 0;
  const started = new Promise((resolve) => { notify = resolve; });
  const first = await queue.start('first', () => new Promise((resolve) => { finish = resolve; notify(); }));
  await started;
  const second = await queue.start('second', async () => { secondCalls++; return 'second-result'; });
  assert.equal(queue.list()[1].status, 'queued'); assert.equal(secondCalls, 0);
  await queue.cancel(second.id);
  finish('first-result'); await Promise.all([first.completion, second.completion]);
  assert.equal(secondCalls, 0); assert.equal(queue.list()[1].status, 'cancelled');
  assert.equal(queue.list()[0].resultId, 'first-result');
});

test('task errors cannot leak provider credentials into the journal', async (t) => {
  const { store } = await fixture(t);
  const queue = new TaskQueue(store.root); await queue.init();
  const job = await queue.start('generation', () => { throw new Error('Authorization: secret-key'); });
  await job.completion;
  assert.equal(queue.list()[0].status, 'failed');
  assert.equal((await fs.readFile(path.join(store.root, 'tasks.json'), 'utf8')).includes('secret-key'), false);
});
