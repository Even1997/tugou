const { randomUUID } = require('node:crypto');
const { hash, atomicWrite, safePath, validateDocument } = require('./storage.cjs');
const { saveImage } = require('./generation.cjs');
const { bindModule, emptyCanvas } = require('./prompts.cjs');

async function migrateCanvases(store, snapshot, inspectImage) {
  const state = typeof snapshot.state === 'string' ? JSON.parse(snapshot.state) : snapshot.state;
  const sources = state?.state?.projects;
  if (!Array.isArray(sources)) throw new Error('旧数据库中没有可读取的画布列表');
  const archive = JSON.stringify(snapshot), digest = hash(archive);
  await atomicWrite(await safePath(store.root, 'imports', `${digest}.json`), archive);
  return store.serialize(async () => {
    const existing = await Promise.all((await store.list()).filter(p => !p.error).map(p => store.read(p.id)));
    const imported = [];
    for (const source of sources) {
      if (typeof source.id !== 'string' || !Array.isArray(source.nodes) || !Array.isArray(source.connections)) throw new Error('旧画布结构无效，原数据已保留');
      const sourceHash = hash(JSON.stringify({ source, images: snapshot.images }));
      const duplicate = existing.find(r => r.origin?.legacyCanvasHash === sourceHash);
      const parent = existing.find(r => r.document.canvasProjectIds?.includes(source.id));
      if (duplicate) {
        if (!duplicate.origin.migrationVersion) {
          const assets = [...duplicate.document.assets];
          for (const asset of parent?.document.assets || []) if (!assets.some(a => a.id === asset.id)) assets.push(structuredClone(asset));
          imported.push(await store.writeRecord({ ...duplicate, revision: duplicate.revision + 1, origin: { ...duplicate.origin, migrationVersion: 2 }, document: { ...duplicate.document, assets } }));
        } else imported.push(duplicate);
        continue;
      }
      const id = randomUUID(), warnings = [], document = {
        id, name: source.title || '迁入画布', width: parent?.document.width || 1024, height: parent?.document.height || 1536,
        background: '#fffdf8', modules: [], recipes: [], assets: structuredClone(parent?.document.assets || []), layers: [], jobs: [],
        legacyCanvas: source, legacyArchive: digest, legacyParentId: parent?.id, migrationWarnings: warnings,
        tugouCanvas: emptyCanvas(),
      };
      for (const old of source.nodes) {
        const metadata = old.metadata || {}, position = old.position || { x: 0, y: 0 };
        let node;
        const imageData = new Map(snapshot.images || []).get(metadata.storageKey) || metadata.content;
        if (old.type === 'image' && /^data:image\/(png|jpeg|webp);base64,/.test(imageData || '')) {
          const asset = { id: randomUUID(), name: old.title || '图片', ...await saveImage(store.root, Buffer.from(imageData.split(',')[1], 'base64'), inspectImage) };
          document.assets.push(asset); node = { type: 'asset', data: { assetId: asset.id, role: '参考内容' } };
        } else if (['image', 'config'].includes(old.type) && !imageData && (!metadata.generationMode || metadata.generationMode === 'image')) {
          const recipe = { id: randomUUID(), name: old.title || '生成配方', moduleIds: [], moduleBindings: [], references: [], output: metadata.prompt || metadata.generationPrompt || '', size: metadata.size || '1024x1536' };
          document.recipes.push(recipe); node = { type: 'recipe', data: { recipeId: recipe.id, snapshot: structuredClone(recipe) } };
        } else if (old.type === 'text') {
          const ref = metadata.moduleRef;
          const linked = parent?.document.modules.find(m => ref?.moduleId === m.id);
          const module = { id: randomUUID(), name: old.title || '文字模块', kind: ref?.kind || (/画风/.test(old.title) ? 'style' : 'other'), text: metadata.content || '', global: false };
          // Preserve text exactly; a genuine moduleRef retains source identity and local overrides.
          if (linked) {
            if (!document.modules.some(m => m.id === linked.id)) document.modules.push(structuredClone(linked));
            const binding = bindModule(linked);
            if (module.text !== linked.text) binding.overrideText = module.text;
            node = { type: 'module', data: { binding } };
          } else { document.modules.push(module); node = { type: 'module', data: { binding: bindModule(module) } }; }
        } else {
          warnings.push(`${old.title || old.id}：${old.type} 尚未转换，原始内容已保留`);
          node = { type: 'text', data: { name: old.title || old.type, text: metadata.prompt || (typeof metadata.content === 'string' ? metadata.content : '') || `旧版 ${old.type} 节点，原始数据已保留`, migrationPending: true } };
        }
        document.tugouCanvas.nodes.push({ id: old.id, position, ...node, data: { ...node.data, legacy: old } });
      }
      const ids = new Set(document.tugouCanvas.nodes.map(n => n.id));
      for (const edge of source.connections) {
        if (ids.has(edge.fromNodeId) && ids.has(edge.toNodeId)) document.tugouCanvas.edges.push({ ...edge, id: edge.id, source: edge.fromNodeId, target: edge.toNodeId });
        else warnings.push(`连线 ${edge.id} 的端点缺失，原始连线保留在迁移快照中`);
      }
      document.tugouCanvas.viewport = { x: source.viewport?.x || 0, y: source.viewport?.y || 0, zoom: source.viewport?.k || 1 };
      validateDocument(document);
      const record = await store.writeRecord({ format: 'tugou-project', version: 1, id, revision: 1, updatedAt: new Date().toISOString(), document,
        origin: { legacyCanvasId: source.id, legacyCanvasHash: sourceHash, archive: digest, migrationVersion: 2 } });
      imported.push(record);
    }
    for (const parent of existing.filter(r => r.document.canvasProjectIds?.length)) {
      const links = parent.document.canvasProjectIds.map(id => ({ legacyId: id, projectId: imported.find(r => r.origin.legacyCanvasId === id)?.id }));
      if (JSON.stringify(parent.document.migratedCanvases) === JSON.stringify(links)) continue;
      await store.writeRecord({ ...parent, revision: parent.revision + 1, updatedAt: new Date().toISOString(), document: { ...parent.document, migratedCanvases: links },
        origin: { ...parent.origin, canvasStatus: links.every(l => l.projectId) ? 'migrated' : 'external-data-pending' } });
    }
    return imported.map(r => ({ id: r.id, name: r.document.name, nodes: r.document.tugouCanvas.nodes.length, edges: r.document.tugouCanvas.edges.length, warnings: r.document.migrationWarnings }));
  });
}
module.exports = { migrateCanvases };
