const test = require('node:test');
const assert = require('node:assert/strict');
const { bindModule, bindingsFor, bindingStatus, editModule, removeModule, refreshBinding, pinRecipe, refreshRecipe, nodeStatus, refreshNode, syncAll, compileRecipe, emptyCanvas, createNode, canConnect, compileNode } = require('../core/prompts.cjs');

function fixture() {
  return { name: '配方验收', width: 1024, height: 1536,
    modules: [{ id: 'style', name: '画风', kind: 'style', text: '柔和清线', global: true }, { id: 'person', name: '人物', kind: 'character', text: '保留人物身份', global: false }],
    recipes: [{ id: 'couple', name: '人物配方', moduleIds: ['person'], references: [{ assetId: 'a1', role: '身份' }], output: '全身，透明背景', size: '2048x3072', legacyField: { keep: true } }],
    assets: [{ id: 'a1', name: '照片', width: 1024, height: 1536 }], layers: [{ mask: { paths: [1, 2] } }], jobs: [{ status: 'completed', future: 5 }], canvasProjectIds: ['old-id'], unknown: { keep: ['unchanged'] } };
}

test('legacy recipes receive pinned references before a shared module changes', () => {
  const document = fixture(), before = JSON.stringify(document);
  const updated = editModule(document, 'person', { text: '更新后的身份' });
  const recipe = updated.recipes[0], binding = bindingsFor(updated, recipe)[0];
  assert.equal(bindingStatus(updated, binding), 'outdated');
  assert.match(compileRecipe(updated, recipe).prompt, /保留人物身份/);
  assert.doesNotMatch(compileRecipe(updated, recipe).prompt, /更新后的身份/);
  assert.match(compileRecipe(updated, refreshRecipe(updated, recipe)).prompt, /更新后的身份/);
  assert.equal(JSON.stringify(document), before);
  for (const key of ['layers', 'assets', 'jobs', 'canvasProjectIds', 'unknown']) assert.deepEqual(updated[key], document[key]);
  assert.deepEqual(recipe.legacyField, { keep: true });
});

test('global modules apply to every recipe without duplicate references and styles compose last', () => {
  const document = fixture(); document.recipes[0].moduleIds.push('style');
  const result = compileRecipe(document, document.recipes[0]);
  assert.equal(result.prompt.split('柔和清线').length - 1, 1);
  assert.ok(result.prompt.indexOf('柔和清线') > result.prompt.indexOf('全身，透明背景'));
  const updated = editModule(document, 'person', { global: true });
  const empty = { id: 'new', name: '新配方', moduleIds: [], references: [], output: '', size: '1024x1024' };
  assert.ok(bindingsFor(updated, empty).some((binding) => binding.moduleId === 'person'));
});

test('local modifications conflict with changed source; safe sync never overwrites them', () => {
  const document = fixture();
  const binding = { ...bindModule(document.modules[1]), overrideText: '仅用于这一张的修改' };
  const updated = editModule(document, 'person', { text: '共享新版' });
  assert.equal(bindingStatus(updated, binding), 'conflict');
  assert.deepEqual(refreshBinding(updated, binding), binding);
  const kept = refreshBinding(updated, binding, 'keep');
  assert.equal(kept.overrideText, binding.overrideText); assert.equal(bindingStatus(updated, kept), 'local');
  const replaced = refreshBinding(updated, binding, 'source');
  assert.equal(replaced.overrideText, undefined); assert.equal(replaced.snapshot.text, '共享新版');
});

test('deleting a referenced global module preserves its old content and records a missing source', () => {
  const document = fixture(), updated = removeModule(document, 'style');
  const binding = bindingsFor(updated, updated.recipes[0]).find((entry) => entry.moduleId === 'style');
  assert.ok(binding); assert.equal(bindingStatus(updated, binding), 'missing');
  assert.match(compileRecipe(updated, updated.recipes[0]).prompt, /柔和清线/);
  assert.deepEqual(refreshBinding(updated, binding), binding);
});

test('one-click sync updates recipes and canvas references but keeps conflicts', () => {
  let document = fixture();
  const recipe = createNode(document, 'recipe', 'couple', { x: 0, y: 0 });
  const module = createNode(document, 'module', 'person', { x: 300, y: 0 });
  module.data.binding.overrideText = '本地人物';
  document.tugouCanvas = { ...emptyCanvas(), nodes: [recipe, module] };
  document = editModule(document, 'person', { text: '新身份' });
  assert.equal(nodeStatus(document, recipe), 'outdated');
  const updated = syncAll(document);
  assert.equal(nodeStatus(updated, updated.tugouCanvas.nodes[0]), 'current');
  assert.equal(nodeStatus(updated, updated.tugouCanvas.nodes[1]), 'conflict');
  assert.equal(updated.tugouCanvas.nodes[1].data.binding.overrideText, '本地人物');
  assert.deepEqual(updated.layers, document.layers);
});

test('recipe definition and reference-role changes flag existing canvas nodes', () => {
  const document = fixture(), node = createNode(document, 'recipe', 'couple', { x: 10, y: 20 });
  document.recipes[0] = { ...document.recipes[0], output: '全景', references: [{ assetId: 'a1', role: '仅身份，忽略背景' }] };
  assert.equal(nodeStatus(document, node), 'outdated');
  const refreshed = refreshNode(document, node);
  assert.equal(refreshed.data.snapshot.output, '全景');
  assert.equal(refreshed.data.snapshot.references[0].role, '仅身份，忽略背景');
  assert.deepEqual(refreshed.position, node.position);
});

test('graph links reject cycles, duplicate edges, missing nodes and non-recipe targets', () => {
  const document = fixture();
  const a = createNode(document, 'recipe', 'couple', { x: 0, y: 0 }), b = createNode(document, 'recipe', 'couple', { x: 400, y: 0 });
  const m = createNode(document, 'module', 'person', { x: 800, y: 0 });
  const graph = { ...emptyCanvas(), nodes: [a, b, m], edges: [{ id: 'ab', source: a.id, target: b.id }] };
  assert.ok(canConnect(graph, m.id, a.id));
  for (const [source, target] of [[b.id, a.id], [a.id, b.id], [a.id, a.id], [a.id, m.id], ['missing', a.id]]) assert.equal(canConnect(graph, source, target), false);
});

test('connected module overrides its recipe copy, images share the asset ID and style stays last', () => {
  const document = fixture();
  const recipe = createNode(document, 'recipe', 'couple', { x: 0, y: 0 });
  const module = createNode(document, 'module', 'person', { x: 300, y: 0 });
  module.data.binding.overrideText = '这张图的人物';
  const asset = createNode(document, 'asset', 'a1', { x: 0, y: 300 }); asset.data.role = '仅脸部身份';
  document.tugouCanvas = { ...emptyCanvas(), nodes: [recipe, module, asset], edges: [module, asset].map((node) => ({ id: node.id, source: node.id, target: recipe.id })) };
  const result = compileNode(document, recipe.id);
  assert.match(result.prompt, /这张图的人物/); assert.doesNotMatch(result.prompt, /保留人物身份/);
  assert.deepEqual(result.references, [{ assetId: 'a1', role: '仅脸部身份' }]);
  assert.equal(result.size, '2048x3072'); assert.ok(result.prompt.indexOf('柔和清线') > result.prompt.indexOf('这张图的人物'));
  const restored = JSON.parse(JSON.stringify(document));
  assert.deepEqual(compileNode(restored, recipe.id), result);
  assert.deepEqual(restored.layers, document.layers);
});

test('deleted recipes remain usable from canvas snapshots without claiming to be synchronized', () => {
  const document = fixture(), node = createNode(document, 'recipe', 'couple', { x: 0, y: 0 });
  document.tugouCanvas = { ...emptyCanvas(), nodes: [node] }; document.recipes = [];
  assert.equal(nodeStatus(document, node), 'missing');
  assert.match(compileNode(document, node.id).prompt, /保留人物身份/);
  assert.equal(refreshNode(document, node), node);
});

test('a recipe conflict resolved in the workbench can subsequently update its canvas snapshot', () => {
  let document = fixture();
  document.recipes[0] = pinRecipe(document, document.recipes[0]);
  document.recipes[0].moduleBindings[0].overrideText = '配方人物调整';
  const node = createNode(document, 'recipe', 'couple', { x: 0, y: 0 });
  document = editModule(document, 'person', { text: '公共人物新版' });
  assert.equal(nodeStatus(document, node), 'conflict');
  document.recipes[0] = refreshRecipe(document, document.recipes[0], 'keep');
  assert.equal(nodeStatus(document, node), 'outdated');
  const updated = refreshNode(document, node);
  assert.equal(nodeStatus(document, updated), 'current');
  assert.equal(updated.data.snapshot.moduleBindings[0].overrideText, '配方人物调整');
});
