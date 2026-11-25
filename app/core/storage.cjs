const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const resourcePattern = /^[a-f0-9]{64}\.(png|jpe?g|webp|gif|mp4|webm|weba|mp3|wav|ogg|m4a|flac|obj|fbx|ttf)$/;
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

function validateDocument(document, allowPageRefs = false) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('无效工程');
  if (typeof document.name !== 'string' || !document.name.trim()) throw new Error('请输入工程名称');
  for (const dimension of [document.width, document.height]) {
    if (!Number.isInteger(dimension) || dimension < 1 || dimension > 100000) throw new Error('画布尺寸无效');
  }
  if (document.width * document.height > 100000000) throw new Error('当前支持最多一亿像素');
  for (const key of ['modules', 'recipes', 'assets', 'layers', 'jobs']) {
    if (!Array.isArray(document[key])) throw new Error(`工程缺少 ${key}`);
  }
  document.layers.forEach(layer=>require('./rich-text.cjs').validateTextRuns(layer));
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
  require('./presentations.cjs').validate(document.presentations,document.assets);
  if(document.compositionView!==undefined){const v=document.compositionView;if(!v||![v.x,v.y,v.zoom].every(Number.isFinite)||v.zoom<.02||v.zoom>8)throw Error('合成视图无效');}
  if (document.layers.some(l => l.artboard)) require('./artboards.cjs').validate(document);
  require('./pages.cjs').validate(document,validateDocument,allowPageRefs);
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
    if (!node || typeof node.id !== 'string' || ids.has(node.id) || !['module', 'recipe', 'asset', 'text','group','imageTool',...require('./workflow-nodes.cjs').types].includes(node.type)
      || !node.position || ![node.position.x, node.position.y].every(Number.isFinite) || !node.data) throw new Error('画布节点格式无效');
    ids.add(node.id);
    if(node.type==='imageTool'){
      if(typeof node.data.name!=='string')throw Error('工具节点名称无效');
      require('./canvas-tools.cjs').validateTool(node);
      if(['upscale','cutout'].includes(node.data.operation))require('./local-ai.cjs').validateLocalSettings(require('./canvas-tools.cjs').settingsOf(node),{width:1,height:1});
    }
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
    if(node.data.localEdit!=null&&(node.type!=='asset'||typeof node.data.localEdit.assetId!=='string'||typeof node.data.localEdit.maskId!=='string'||!node.data.localEdit.assetId||!node.data.localEdit.maskId))throw Error('局部生图区域格式无效');
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
  constructor(root) { this.root = path.resolve(root); this.pending = Promise.resolve(); this.resourceChecks=new Map(); }

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

  async pagePath(id,digest) {
    if(typeof id!=='string'||typeof digest!=='string'||!projectPattern.test(id)||!require('./pages.cjs').pageFiles.test(digest))throw Error('无效页面文件标识');
    return safePath(this.root,'project-pages',id,`${digest}.json`);
  }

  async readPage(id,digest) {
    const bytes=await fs.readFile(await this.pagePath(id,digest)).catch(error=>{
      if(error.code==='ENOENT')throw Error('页面文件缺失，请恢复完整工程备份');
      throw error;
    });
    if(hash(bytes)!==digest)throw Error('页面文件损坏，请恢复工程备份');
    return JSON.parse(bytes);
  }

  async readSnapshot(id, mode='index') {
    const file = await this.projectPath(id);
    const pages=require('./pages.cjs');
    const decode = async (bytes) => {
      const record = JSON.parse(bytes);
      if (record.format !== 'tugou-project' || ![1,2].includes(record.version) || record.id !== id || !Number.isInteger(record.revision)) {
        throw new Error('工程存储格式无效');
      }
      validateDocument(record.document,record.version===2);
      if(record.version===2&&mode!=='index'){
        let doc=record.document;
        const entries=pages.kinds.flatMap(kind=>{
          const g=doc.pages?.[kind];
          return (g?.items||[]).filter(p=>p.ref&&(mode==='all'||p.id===g.activeId)).map(p=>[kind,p]);
        });
        const pageRefs={};
        // Limit the number of decoded pages in flight for callers that need the whole project.
        for(const [kind,p] of entries){
          doc=pages.storagePage(doc,kind,p.id,{content:await this.readPage(id,p.ref.hash)});
          (pageRefs[kind]??=Object.create(null))[p.id]=p.ref;
        }
        validateDocument(doc,mode==='editor');
        record.document=doc;
        if(mode==='editor')record.pageRefs=pageRefs;
      }
      return record;
    };
    const read = async (file, recovered) => {
      const bytes = await fs.readFile(file, 'utf8');
      return { record: await decode(bytes), bytes, recovered };
    };
    try { return await read(file, false); }
    catch (error) {
      try {
        const backup = await safePath(this.root, 'projects', `${id}.json.bak`);
        return await read(backup, true);
      } catch { throw error; }
    }
  }

  async read(id, {metadataOnly=false}={}) {
    const {record, recovered} = await this.readSnapshot(id,metadataOnly?'index':'all');
    return { ...record, recovered };
  }

  async readEditor(id) {
    const opened=await this.readSnapshot(id,'editor');
    const {record,recovered}=opened;
    if(recovered||record.version!==1||!Object.values(record.document.pages||{}).some(group=>group.items.length>1))return {...record,recovered};
    // Convert an existing multi-page project once, preserving its original file as the backup.
    return this.serialize(async()=>{
      const current=await this.readSnapshot(id,'editor');
      if(current.record.version!==1||current.recovered)return {...current.record,recovered:current.recovered};
      await this.writeRecord(current.record,current);
      const split=await this.readSnapshot(id,'editor');
      return {...split.record,recovered:split.recovered};
    });
  }

  async list() {
    const projects = new Map();
    for (const name of await fs.readdir(await safePath(this.root, 'projects'))) {
      if (name.endsWith('.json')) projects.set(name.slice(0, -5), name);
      else if (name.endsWith('.json.bak')) {
        const id = name.slice(0, -9);
        if (projectPattern.test(id) && !projects.has(id)) projects.set(id, name);
      }
    }
    const result = [];
    for (const [id, name] of projects) {
      try {
        const {record,recovered} = await this.readSnapshot(id);
        const assets = record.document.assets || [];
        const coverResource = assets.filter(a => (!a.kind || a.kind === 'image') && a.resource).at(-1)?.resource || '';
        result.push({ id, name: record.document.name, updatedAt: record.updatedAt, revision: record.revision, recovered, assetCount: assets.length,
          ...(coverResource ? { coverResource } : {}),
          ...(record.origin?.legacyCanvasId ? { canvasNodeCount: record.document.tugouCanvas?.nodes.length??record.document.pages?.canvas.items.find(p=>p.id===record.document.pages.canvas.activeId)?.ref?.nodes.length??0 } : {}) });
      } catch { result.push({ id, name, error: '工程无法读取，请保留原文件并恢复备份' }); }
    }
    return result.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  async verifyResources(document, folder = this.root) {
    const resources=resourcesIn(document);
    if(!resources.size)return;
    const {hashFile}=require('./runtime-files.cjs');
    for (const name of resources) {
      const file=await safePath(folder,'resources',name);
      const info=await fs.stat(file,{bigint:true});
      const stamp=`${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
      if(this.resourceChecks.get(file)===stamp)continue;
      if (await hashFile(file) !== name.split('.')[0]) throw new Error(`素材校验失败：${name}`);
      if(this.resourceChecks.size>=4096)this.resourceChecks.clear();
      this.resourceChecks.set(file,stamp);
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
      const project = await this.projectPath(id);
      const backup = await safePath(this.root, 'projects', `${id}.json.bak`);
      const archivedProject = await safePath(folder, 'project.json');
      const archivedBackup = await safePath(folder, 'project.json.bak');
      let backupMoved = false;
      try {
        await fs.rename(backup, archivedBackup);
        backupMoved = true;
      } catch (error) {
        if (error.code !== 'ENOENT' || record.recovered) throw error;
      }
      try {
        await fs.rename(project, archivedProject);
      } catch (error) {
        if (error.code !== 'ENOENT' || !record.recovered) {
          if (backupMoved) await fs.rename(archivedBackup, backup);
          throw error;
        }
      }
      return { id };
    });
  }

  async writeRecord(record, previous) {
    const file = await this.projectPath(record.id);
    if (!previous) {
      try { previous = await this.readSnapshot(record.id); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const pages=require('./pages.cjs'),pageRefs={};
    let document=record.document;
    for(const kind of pages.kinds){
      const group=document.pages?.[kind];if(!group)continue;
      const refs=Object.create(null);
      for(const p of group.items){
        let ref=p.ref;
        if(!ref){
          const content=pages.content(record.document,kind,p.id),bytes=JSON.stringify(content);
          ref={hash:hash(bytes),nodes:kind==='canvas'?content.tugouCanvas.nodes.map(n=>n.id):[]};
          const target=await this.pagePath(record.id,ref.hash);
          const existing=await fs.readFile(target,'utf8').catch(error=>{if(error.code!=='ENOENT')throw error;});
          if(existing!==bytes)await atomicWrite(target,bytes);
        }else{
          const existing=previous?.record.document.pages?.[kind]?.items.find(item=>item.id===p.id)?.ref;
          if(existing?.hash===ref.hash)ref=existing;
          else {
            const data=await this.readPage(record.id,ref.hash);
            const projected=pages.storagePage(record.document,kind,p.id,{content:data});
            validateDocument(projected,true);
            ref={hash:ref.hash,nodes:kind==='canvas'?data.tugouCanvas.nodes.map(n=>n.id):[]};
          }
        }
        refs[p.id]=ref;
        document=pages.storagePage(document,kind,p.id,{ref});
      }
      pageRefs[kind]=refs;
    }
    const version=Object.keys(pageRefs).length?2:1;
    validateDocument(document,version===2);
    if (previous) await atomicWrite(await safePath(this.root, 'projects', `${record.id}.json.bak`), previous.bytes);
    const {pageRefs:ignored,...metadata}=record;
    await atomicWrite(file, JSON.stringify({...metadata,version,document}));
    return { ...record,version,pageRefs,recovered: false };
  }

  save(id, document, expectedRevision, { detached = false } = {}) {
    const snapshot = detached ? document : structuredClone(document);
    return this.serialize(async () => {
      let previous = await this.readSnapshot(id);
      if(previous.record.revision!==expectedRevision&&previous.record.version===2)previous=await this.readSnapshot(id,'editor');
      const { recovered, ...record } = previous.record;
      if (record.revision !== expectedRevision) throw new Error('工程已更新，请重新打开后再保存，避免覆盖');
      validateDocument(snapshot,true);
      await this.verifyResources(snapshot);
      return this.writeRecord({ ...record, document: snapshot, revision: record.revision + 1, updatedAt: new Date().toISOString() }, previous);
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
