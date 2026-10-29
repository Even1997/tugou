const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const resourcePattern = /^[a-f0-9]{64}\.(png|jpe?g|webp|mp4|webm|weba|mp3|wav|ogg|m4a|flac|obj|fbx|ttf)$/;
const projectPattern = /^[a-f0-9-]{36}$/;

// Reject junctions/symlinks as well as lexical traversal at the filesystem boundary.
async function safePath(root, ...parts) {
  const absolute = path.resolve(root);
  const target = path.resolve(absolute, ...parts);
  if (target !== absolute && !target.startsWith(absolute + path.sep)) throw new Error('路径超出数据目录');
  let cursor = path.parse(target).root;
  for (const segment of target.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, segment);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new Error('数据路径不能经过链接目录');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return target;
}

async function atomicWrite(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }); }
}

function resourcesIn(value, found = new Set()) {
  if (typeof value === 'string') {
    if (resourcePattern.test(value)) found.add(value);
    else if (value.startsWith('/api/studio/resource/')) {
      const name = value.slice('/api/studio/resource/'.length);
      if (!resourcePattern.test(name)) throw new Error('工程含无效素材引用');
      found.add(name);
    }
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'resource' && (typeof entry !== 'string' || !resourcePattern.test(entry))) {
        throw new Error('工程含无效素材文件名');
      }
      resourcesIn(entry, found);
    }
  }
  return found;
}

function validateDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('无效工程');
  if (typeof document.name !== 'string' || !document.name.trim()) throw new Error('请输入工程名称');
  for (const dimension of [document.width, document.height]) {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 100000) throw new Error('画布尺寸无效');
  }
  if (document.width * document.height > 100000000) throw new Error('当前支持最多一亿像素');
  for (const key of ['modules', 'recipes', 'assets', 'layers', 'jobs']) {
    if (!Array.isArray(document[key])) throw new Error(`工程缺少 ${key}`);
  }
  for (const module of document.modules) {
    if (!module || ['id', 'name', 'kind', 'text'].some((key) => typeof module[key] !== 'string')) throw new Error('提示词模块格式无效');
  }
  for (const recipe of document.recipes) {
    validateRecipe(recipe);
  }
  for (const asset of document.assets) {
    if (!asset || typeof asset.id !== 'string') throw new Error('素材格式无效');
  }
  if (document.tugouCanvas !== undefined) validateCanvas(document.tugouCanvas);
  if(document.compositionView!==undefined){const v=document.compositionView;if(!v||![v.x,v.y,v.zoom].every(Number.isFinite)||v.zoom<.02||v.zoom>8)throw Error('合成视图无效');}
  if (document.layers.some(l => l.artboard)) require('./artboards.cjs').validate(document);
  require('./pages.cjs').validate(document,validateDocument);
  resourcesIn(document);
}

function validateRecipe(recipe) {
  if (!recipe || typeof recipe.name !== 'string' || !Array.isArray(recipe.moduleIds) || recipe.moduleIds.some((id) => typeof id !== 'string')) throw new Error('配方格式无效');
  if (recipe.moduleBindings !== undefined) validateBindings(recipe.moduleBindings);
  if (recipe.references !== undefined && (!Array.isArray(recipe.references) || recipe.references.some((reference) => !reference || typeof reference.assetId !== 'string' || typeof reference.role !== 'string'))) throw new Error('参考图格式无效');
}

function validateBindings(bindings) {
  if (!Array.isArray(bindings) || bindings.some((binding) => !binding || typeof binding.moduleId !== 'string' || !binding.snapshot
    || ['id', 'name', 'kind', 'text'].some((field) => typeof binding.snapshot[field] !== 'string')
    || (binding.overrideText !== undefined && typeof binding.overrideText !== 'string'))) throw new Error('模块引用格式无效');
}

function validateCanvas(graph) {
  if (!graph || graph.version !== 1 || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)
    || !graph.viewport || ![graph.viewport.x, graph.viewport.y, graph.viewport.zoom].every(Number.isFinite) || graph.viewport.zoom <= 0) throw new Error('画布数据格式无效');
  const ids = new Set();
  for (const node of graph.nodes) {
    if (!node || typeof node.id !== 'string' || ids.has(node.id) || !['module', 'recipe', 'asset', 'text','group',...require('./workflow-nodes.cjs').types].includes(node.type)
      || !node.position || ![node.position.x, node.position.y].every(Number.isFinite) || !node.data) throw new Error('画布节点格式无效');
    ids.add(node.id);
    if(require('./workflow-nodes.cjs').types.includes(node.type)){
      if(typeof node.data.name!=='string'||typeof node.data.prompt!=='string'||(node.data.inputOrder!==undefined&&(!Array.isArray(node.data.inputOrder)||node.data.inputOrder.some(id=>typeof id!=='string'))))throw Error('生成节点参数格式无效');
      const scene=node.data.scene;
      if(scene){
        const vector=v=>Array.isArray(v)&&v.length===3&&v.every(n=>Number.isFinite(n)&&Math.abs(n)<=1e6);
        const validObject=o=>o&&['box','sphere','character','model'].includes(o.kind)&&typeof o.id==='string'&&vector(o.position)&&vector(o.rotation)&&vector(o.scale)&&(!o.pose||Object.values(o.pose).every(Number.isFinite))&&(o.kind!=='model'||/^[a-f0-9]{64}\.(obj|fbx)$/.test(o.resource));
        const validCamera=c=>c&&typeof c.id==='string'&&vector(c.position)&&vector(c.target)&&Number.isFinite(c.fov)&&c.fov>=10&&c.fov<=120;
        if(!Array.isArray(scene.objects)||scene.objects.length>1000||!Array.isArray(scene.cameras)||!scene.cameras.length||scene.cameras.length>100||!scene.objects.every(validObject)||!scene.cameras.every(validCamera)||!scene.cameras.some(c=>c.id===scene.activeCamera))throw Error('3D 场景数据无效');
        if((scene.position&&!vector(scene.position))||(scene.rotation&&!vector(scene.rotation))||(scene.size&&!['1280x720','1920x1080','3840x2160','1080x1920','2048x2048'].includes(scene.size)))throw Error('3D 场景输出设置无效');
        for(const [key,min,max] of [['scale',.1,10],['floorHeight',-100,100],['floorOpacity',0,1],['light',0,10]])if(scene[key]!==undefined&&(!Number.isFinite(scene[key])||scene[key]<min||scene[key]>max))throw Error('3D 场景参数超出范围');
        if(scene.frames!==undefined&&(!Array.isArray(scene.frames)||scene.frames.length>601||scene.frames.some(f=>!f||!Number.isFinite(f.time)||f.time<0||f.time>60||!validCamera(f.camera)||!Array.isArray(f.objects)||f.objects.length>1000||!f.objects.every(validObject))))throw Error('3D 动画关键帧无效');
      }
    }
    if (node.type === 'module') validateBindings([node.data.binding]);
    if (node.type === 'recipe') {
      if (typeof node.data.recipeId !== 'string' || !node.data.snapshot || typeof node.data.snapshot.name !== 'string' || !Array.isArray(node.data.snapshot.moduleIds)) throw new Error('配方节点格式无效');
      validateBindings(node.data.snapshot.moduleBindings);
      validateRecipe(node.data.snapshot);
    }
    if (node.type === 'asset' && (typeof node.data.assetId !== 'string' || typeof node.data.role !== 'string')) throw new Error('素材节点格式无效');
    if (node.type === 'text' && (typeof node.data.name !== 'string' || typeof node.data.text !== 'string')) throw new Error('文字节点格式无效');
  }
  const edges = new Set();
  for(const node of graph.nodes)if(node.parentId&&!graph.nodes.some(n=>n.id===node.parentId&&n.type==='group'&&!n.parentId))throw Error('画布分组引用无效');
  for (const edge of graph.edges) {
    if (!edge || typeof edge.id !== 'string' || edges.has(edge.id) || !ids.has(edge.source) || !ids.has(edge.target)) throw new Error('画布连线格式无效');
    edges.add(edge.id);
  }
}

class ProjectStore {
  constructor(root) { this.root = path.resolve(root); this.pending = Promise.resolve(); }

  serialize(operation) {
    const next = this.pending.then(operation);
    this.pending = next.catch(() => {});
    return next;
  }

  async init() {
    for (const name of ['projects', 'resources', 'imports']) {
      await fs.mkdir(await safePath(this.root, name), { recursive: true });
    }
  }

  async projectPath(id) {
    if (!projectPattern.test(id)) throw new Error('无效工程标识');
    return safePath(this.root, 'projects', `${id}.json`);
  }

  async read(id) {
    const file = await this.projectPath(id);
    const decode = (bytes) => {
      const record = JSON.parse(bytes);
      if (record.format !== 'tugou-project' || record.version !== 1 || record.id !== id || !Number.isInteger(record.revision)) {
        throw new Error('工程存储格式无效');
      }
      validateDocument(record.document);
      return record;
    };
    try { return { ...decode(await fs.readFile(file, 'utf8')), recovered: false }; }
    catch (error) {
      try {
        const backup = await safePath(this.root, 'projects', `${id}.json.bak`);
        return { ...decode(await fs.readFile(backup, 'utf8')), recovered: true };
      } catch { throw error; }
    }
  }

  async list() {
    const result = [];
    for (const name of await fs.readdir(await safePath(this.root, 'projects'))) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -5);
      try {
        const record = await this.read(id);
        result.push({ id, name: record.document.name, updatedAt: record.updatedAt, revision: record.revision, recovered: record.recovered,
          ...(record.origin?.legacyCanvasId ? { canvasNodeCount: record.document.tugouCanvas.nodes.length } : {}) });
      } catch { result.push({ id, name, error: '工程无法读取，请保留原文件并恢复备份' }); }
    }
    return result.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async verifyResources(document, folder = this.root) {
    for (const name of resourcesIn(document)) {
      const bytes = await fs.readFile(await safePath(folder, 'resources', name));
      if (hash(bytes) !== name.split('.')[0]) throw new Error(`素材校验失败：${name}`);
    }
  }

  remove(id, expectedRevision, tasks) {
    return this.serialize(async () => {
      const record = await this.read(id);
      if (record.revision !== expectedRevision) throw new Error('工程已更新，请刷新列表后再删除');
      if (tasks.list().some(t => t.context?.projectId === id && (['queued','running'].includes(t.status) || tasks.completions?.has(t.id)))) throw new Error('工程仍有任务未结束，请等待完成后再删除');
      // Keep shared resources and a private recovery copy; stale saves cannot recreate the project.
      const folder = await safePath(this.root, 'deleted-projects', id);
      await fs.mkdir(folder, { recursive: true });
      const backup = await safePath(this.root, 'projects', `${id}.json.bak`);
      try { await fs.rename(backup, await safePath(folder, 'project.json.bak')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      await fs.rename(await this.projectPath(id), await safePath(folder, 'project.json'));
      return { id };
    });
  }

  async writeRecord(record) {
    const file = await this.projectPath(record.id);
    let previous;
    try { previous = await this.read(record.id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous) {
      const { recovered, ...backup } = previous;
      await atomicWrite(await safePath(this.root, 'projects', `${record.id}.json.bak`), JSON.stringify(backup));
    }
    await atomicWrite(file, JSON.stringify(record));
    return { ...record, recovered: false };
  }

  save(id, document, expectedRevision) {
    const snapshot = structuredClone(document);
    return this.serialize(async () => {
      const previous = await this.read(id);
      if (previous.revision !== expectedRevision) throw new Error('工程已更新，请重新打开后再保存，避免覆盖');
      validateDocument(snapshot);
      await this.verifyResources(snapshot);
      const { recovered, ...record } = previous;
      return this.writeRecord({ ...record, document: snapshot, revision: record.revision + 1, updatedAt: new Date().toISOString() });
    });
  }

  create(name = '未命名创作') {
    return this.serialize(async () => {
      const id = randomUUID();
      const record = {
        format: 'tugou-project', version: 1, id, revision: 1, updatedAt: new Date().toISOString(),
        document: { id, name, width: 1024, height: 1536, background: '#fffdf8', modules: [], recipes: [], assets: [], layers: [], jobs: [] },
      };
      validateDocument(record.document);
      return this.writeRecord(record);
    });
  }

  importLegacy(filename) {
    return this.serialize(async () => {
      const source = await safePath(path.dirname(path.resolve(filename)), path.basename(filename));
      const bytes = await fs.readFile(source);
      const document = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
      if (document.format !== 'canvas-studio' || ![1, 2, 3, 4, 5].includes(document.version)) throw new Error('不是支持的旧版图构工程');
      validateDocument(document);
      await this.verifyResources(document, path.dirname(source));
      const digest = hash(bytes);
      for (const item of await this.list()) {
        if (!item.error) {
          const existing = await this.read(item.id);
          if (existing.origin?.sha256 === digest) return existing;
        }
      }
      for (const name of resourcesIn(document)) {
        const resource = await fs.readFile(await safePath(path.dirname(source), 'resources', name));
        // Recheck the bytes actually copied in case the source changed after validation.
        if (hash(resource) !== name.split('.')[0]) throw new Error('导入时素材发生变化，请重试');
        await atomicWrite(await safePath(this.root, 'resources', name), resource);
      }
      await atomicWrite(await safePath(this.root, 'imports', `${digest}.json`), bytes);
      return this.writeRecord({
        format: 'tugou-project', version: 1, id: randomUUID(), revision: 1, updatedAt: new Date().toISOString(), document,
        origin: { format: document.format, sha256: digest, resourceCount: resourcesIn(document).size,
          canvasStatus: document.canvasProjectIds?.length ? 'external-data-pending' : 'none' },
      });
    });
  }
}

module.exports = { ProjectStore, atomicWrite, safePath, hash, resourcesIn, resourcePattern, validateDocument };
