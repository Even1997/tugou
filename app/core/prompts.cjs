const uid = () => globalThis.crypto.randomUUID();
const isGlobal = (module) => module.global ?? module.kind === 'style';
const signature = (module) => JSON.stringify([module.name, module.kind, module.text, isGlobal(module)]);
const bindModule = (module) => ({ moduleId: module.id, snapshot: structuredClone(module) });

function bindingsFor(document, recipe) {
  const ids = [...new Set([...recipe.moduleIds, ...document.modules.filter(isGlobal).map((module) => module.id)])];
  return ids.map((id) => recipe.moduleBindings?.find((binding) => binding.moduleId === id)
    || (document.modules.find((module) => module.id === id) ? bindModule(document.modules.find((module) => module.id === id)) : { moduleId: id, snapshot: { id, name: '已删除模块', kind: 'other', text: '' } }));
}

function bindingStatus(document, binding) {
  const current = document.modules.find((module) => module.id === binding.moduleId);
  if (!current) return 'missing';
  const changed = signature(current) !== signature(binding.snapshot);
  return changed ? (binding.overrideText !== undefined ? 'conflict' : 'outdated') : (binding.overrideText !== undefined ? 'local' : 'current');
}

function refreshBinding(document, binding, mode = 'safe') {
  const current = document.modules.find((module) => module.id === binding.moduleId);
  if (!current || (mode === 'safe' && bindingStatus(document, binding) === 'conflict')) return binding;
  const next = { ...binding, snapshot: structuredClone(current) };
  if (mode === 'source') delete next.overrideText;
  return next;
}

function pinRecipe(document, recipe) { return { ...recipe, moduleBindings: bindingsFor(document, recipe) }; }
function refreshRecipe(document, recipe, mode = 'safe') {
  return { ...recipe, moduleBindings: bindingsFor(document, recipe).map((binding) => refreshBinding(document, binding, mode)) };
}

function editModule(document, id, patch) {
  // Pin existing recipe content before editing the shared definition, including legacy recipes.
  const recipes = document.recipes.map((recipe) => pinRecipe(document, recipe));
  return { ...document, recipes, modules: document.modules.map((module) => module.id === id
    ? { ...module, ...patch, revision: (module.revision || 1) + 1 } : module) };
}

function removeModule(document, id) {
  // Keep snapshots and IDs so deletion does not silently erase an existing recipe's prompt.
  return { ...document, recipes: document.recipes.map((recipe) => {
    const pinned = pinRecipe(document, recipe);
    return pinned.moduleBindings.some((binding) => binding.moduleId === id) && !pinned.moduleIds.includes(id) ? { ...pinned, moduleIds: [...pinned.moduleIds, id] } : pinned;
  }), modules: document.modules.filter((module) => module.id !== id) };
}

function newRecipe() { return { id: uid(), name: '新配方', moduleIds: [], moduleBindings: [], references: [], output: '', size: '1024x1536', quality:'auto' }; }
function recipeKey(recipe) { return JSON.stringify([recipe.name, recipe.moduleIds, recipe.references, recipe.output, recipe.size,recipe.quality||'auto']); }
function recipeNodeStatus(document, node) {
  const current = document.recipes.find((recipe) => recipe.id === node.data.recipeId);
  if (!current) return 'missing';
  const states = (node.data.snapshot.moduleBindings || []).map((binding) => bindingStatus(document, binding));
  if (bindingsFor(document, current).some((binding) => bindingStatus(document, binding) === 'conflict')) return 'conflict';
  if (states.includes('missing')) return 'missing';
  if (recipeKey(current) !== recipeKey(node.data.snapshot) || states.includes('outdated') || states.includes('conflict')
    || JSON.stringify(bindingsFor(document, current)) !== JSON.stringify(node.data.snapshot.moduleBindings)) return 'outdated';
  return 'current';
}

function nodeStatus(document, node) {
  if (node.type === 'module') return bindingStatus(document, node.data.binding);
  if (node.type === 'recipe') return recipeNodeStatus(document, node);
  return 'current';
}

function refreshNode(document, node, mode = 'safe') {
  if (node.type === 'module') return { ...node, data: { ...node.data, binding: refreshBinding(document, node.data.binding, mode) } };
  if (node.type === 'recipe') {
    const source = document.recipes.find((recipe) => recipe.id === node.data.recipeId);
    if (!source || (mode === 'safe' && nodeStatus(document, node) === 'conflict')) return node;
    return { ...node, data: { ...node.data, snapshot: refreshRecipe(document, source, mode) } };
  }
  return node;
}

function syncActive(document) {
  const recipes = document.recipes.map((recipe) => refreshRecipe(document, recipe));
  const updated = { ...document, recipes };
  if (document.tugouCanvas) updated.tugouCanvas = { ...document.tugouCanvas, nodes: document.tugouCanvas.nodes.map((node) => refreshNode(updated, node)) };
  return updated;
}
function syncAll(document){const pages=require('./pages.cjs');let next=document;for(const p of pages.list(document,'canvas'))next=pages.withCanvas(next,p.id,syncActive);return next;}

function compileParts(bindings, texts, references, output) {
  const unique = [...new Map(bindings.map((binding) => [binding.moduleId, binding])).values()];
  const normal = unique.filter((binding) => binding.snapshot.kind !== 'style');
  const styles = unique.filter((binding) => binding.snapshot.kind === 'style');
  const block = (binding) => {
    const text = (binding.overrideText ?? binding.snapshot.text).trim();
    return text ? text.startsWith(`【${binding.snapshot.name}】`) ? text : `【${binding.snapshot.name}】\n${text}` : '';
  };
  const referenceBlock = references.length ? `【参考图职责】\n${references.map((ref, index) => `图 ${index + 1}：${ref.role || '参考内容'}`).join('\n')}` : '';
  return [referenceBlock, ...normal.map(block), ...texts.filter(Boolean), output ? `【构图与输出】\n${output}` : '', ...styles.map((binding) => `${block(binding)}${block(binding) ? '\n此画风统一应用于以上全部内容。' : ''}`)].filter(Boolean).join('\n\n');
}

function compileRecipe(document, recipe) {
  const references = recipe.references || [];
  return { prompt: compileParts(bindingsFor(document, recipe), [], references, recipe.output || ''), references, size: recipe.size,quality:recipe.quality||'auto' };
}

const emptyCanvas = () => ({ version: 1, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
function createNode(document, type, sourceId, position) {
  if(require('./workflow-nodes.cjs').types.includes(type))return require('./workflow-nodes.cjs').workflowNode(type,position);
  let data;
  if (type === 'module') {
    const module = document.modules.find((entry) => entry.id === sourceId);
    if (!module) throw new Error('模块不存在');
    data = { binding: bindModule(module) };
  } else if (type === 'recipe') {
    const recipe = document.recipes.find((entry) => entry.id === sourceId);
    if (!recipe) throw new Error('配方不存在');
    data = { recipeId: recipe.id, snapshot: pinRecipe(document, recipe) };
  } else if (type === 'asset') {
    if (sourceId!==undefined&&!document.assets.some((asset) => asset.id === sourceId)) throw new Error('素材不存在');
    data = { assetId: sourceId||'', role: '主体身份' };
  } else if (type === 'text') data = { name: '自由提示词', text: '' };
  else throw new Error('不支持的节点类型');
  return { id: uid(), type, position, data };
}

function canConnect(graph, source, target) {
  if(require('./workflow-nodes.cjs').types.includes(graph.nodes.find(n=>n.id===target)?.type))return require('./workflow-nodes.cjs').canLink(graph,source,target);
  if(['group','config','video','audio'].includes(graph.nodes.find(n=>n.id===source)?.type))return false;
  if (source === target || !graph.nodes.some((node) => node.id === source) || !graph.nodes.some((node) => node.id === target && node.type === 'recipe')) return false;
  if (graph.edges.some((edge) => edge.source === source && edge.target === target)) return false;
  const visited = new Set();
  const reaches = (id) => {
    if (id === source) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    return graph.edges.filter((edge) => edge.source === id).some((edge) => reaches(edge.target));
  };
  return !reaches(target);
}

function compileNode(document, nodeId) {
  const graph = document.tugouCanvas || emptyCanvas();
  const root = graph.nodes.find((node) => node.id === nodeId);
  if (!root || root.type !== 'recipe') throw new Error('请选择配方节点');
  const visiting = new Set(), visited = new Set(), bindings = [], texts = [], references = [];
  const visit = (id) => {
    if (visiting.has(id)) throw new Error('画布连线形成循环');
    if (visited.has(id)) return;
    const node = graph.nodes.find((entry) => entry.id === id);
    if (!node) throw new Error('画布连线引用不存在的节点');
    visiting.add(id);
    if (node.type === 'recipe') {
      bindings.push(...(node.data.snapshot.moduleBindings || []));
      references.push(...(node.data.snapshot.references || []));
      if (node.id !== nodeId && node.data.snapshot.output) texts.push(`【${node.data.snapshot.name}的输出要求】\n${node.data.snapshot.output}`);
    }
    for (const edge of graph.edges.filter((entry) => entry.target === id)) visit(edge.source);
    if (node.type === 'module') bindings.push(node.data.binding);
    if (node.type === 'text') texts.push(node.data.text);
    if (node.type === 'asset') {
      const asset=document.assets.find(a=>a.id===node.data.assetId);
      if(asset?.kind==='text')texts.push(asset.text||'');
      else if(asset?.kind&&asset.kind!=='image')throw Error('生图配方不接受视频或音频参考');
      else references.push({ assetId: node.data.assetId, role: node.data.role });
    }
    if(node.type==='textgen')texts.push(node.data.resultText||'');
    if(['image','panorama','director'].includes(node.type)&&node.data.outputAssetId)references.push({assetId:node.data.outputAssetId,role:'参考内容'});
    visiting.delete(id); visited.add(id);
  };
  visit(nodeId);
  const uniqueReferences = [...new Map(references.map((reference) => [reference.assetId, reference])).values()];
  return { prompt: compileParts(bindings, texts, uniqueReferences, root.data.snapshot.output), references: uniqueReferences, size: root.data.snapshot.size,quality:root.data.snapshot.quality||'auto' };
}

function syncCounts(document) {
  const states = [...document.recipes.flatMap((recipe) => bindingsFor(document, recipe).map((binding) => bindingStatus(document, binding))), ...(document.tugouCanvas?.nodes || []).map((node) => nodeStatus(document, node))];
  return { outdated: states.filter((state) => state === 'outdated').length, conflicts: states.filter((state) => state === 'conflict').length, missing: states.filter((state) => state === 'missing').length };
}

module.exports = { isGlobal, bindModule, bindingsFor, bindingStatus, refreshBinding, pinRecipe, refreshRecipe, editModule, removeModule, newRecipe, nodeStatus, refreshNode, syncAll, compileParts, compileRecipe, emptyCanvas, createNode, canConnect, compileNode, syncCounts };
