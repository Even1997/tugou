const fs = require('node:fs/promises');
const { atomicWrite, safePath, hash, resourcePattern, validateDocument } = require('./storage.cjs');
const { compileNode } = require('./prompts.cjs');
const { angleRequest } = require('./canvas-view.cjs');

const failure = (message) => Object.assign(new Error(message), { safeMessage: message });
const {boundedBytes,imageExtension,requestImages}=require('./image-api.cjs');
const imageWrites = require('p-limit').default(1);
const {validateImageSettings}=require('./image-settings.cjs');
async function saveImage(root, bytes, inspectImage) {
  if (!bytes.length || bytes.length > 64 * 1024 * 1024) throw failure('图片大小超出支持范围');
  const extension = imageExtension(bytes);
  if (extension === 'png' && (bytes.length < 24 || bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 100000000)) throw failure('图片无效或超过一亿像素');
  const dimensions = inspectImage(bytes);
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 100000000) throw failure('图片无效或超过一亿像素');
  const resource = `${hash(bytes)}.${extension}`;
  const file = await safePath(root, 'resources', resource);
  // Concurrent responses can contain identical bytes; keep Windows resource replacement serial.
  await imageWrites(() => atomicWrite(file, bytes));
  return { resource, ...dimensions, bytes: bytes.length };
}
async function referenceBytes(root, asset) {
  const name = asset?.resource || asset?.dataUrl?.split('/api/studio/resource/')[1];
  if (name && resourcePattern.test(name)) {
    const bytes = await fs.readFile(await safePath(root, 'resources', name));
    if (hash(bytes) !== name.split('.')[0]) throw failure('参考图校验失败');
    return bytes;
  }
  const data = asset?.dataUrl?.match(/^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (data) return Buffer.from(data[2], 'base64');
  throw failure('参考图缺失，请先将图片存入素材库');
}
class GenerationService {
  constructor(projects, connections, tasks, inspectImage) { Object.assign(this, { projects, connections, tasks, inspectImage }); this.root = projects.root; }
  async recover() {
    for (const task of this.tasks.tasks) {
      if (['analysis','semantic-analysis','runtime-install'].includes(task.context?.kind) || task.status !== 'interrupted') continue;
      try {
        const result = JSON.parse(await fs.readFile(await safePath(this.root, 'results', `${task.id}.json`), 'utf8'));
        if (result.id !== task.id || result.projectId !== task.context?.projectId || !result.assets?.length) continue;
        await this.projects.verifyResources(result.assets);
        task.status = 'completed'; task.resultId = task.id; task.message = task.context?.kind === 'local-tool' ? '已恢复上次完整处理结果，未重复计算' : '已恢复上次落盘的结果，未重复请求模型';
      } catch { /* Incomplete work stays interrupted and requires an explicit retry. */ }
    }
    await this.tasks.persist();
  }
  async start(projectId, document, nodeId) {
    await this.projects.read(projectId);
    validateDocument(document);
    const snapshot = structuredClone(document), compiled = compileNode(snapshot, nodeId);
    return this.submit(projectId, snapshot, nodeId, compiled, snapshot.tugouCanvas.nodes.find(n => n.id === nodeId).data.snapshot.name);
  }
  async angle(projectId, document, nodeId, assetId, params) {
    await this.projects.read(projectId); validateDocument(document);
    const snapshot = structuredClone(document);
    let request;
    try { request = angleRequest(snapshot, nodeId, assetId, params); } catch (e) { throw failure(e.message); }
    return this.submit(projectId, snapshot, nodeId, request.compiled, request.label, { kind: 'angle', angle: request.params, sourceAssetId: assetId });
  }
  async submit(projectId, snapshot, nodeId, compiled, label, extra = {}) {
    if (!compiled.prompt.trim()) throw failure('请先填写提示词');
    if (!/^(auto|\d{1,5}x\d{1,5})$/.test(compiled.size || '')) throw failure('尺寸格式应为宽x高，例如 2048x3072，或 auto');
    if (this.tasks.list().some(t => t.context?.projectId === projectId && t.context?.nodeId === nodeId && ['queued', 'running'].includes(t.status))) throw failure('这个节点已有任务，请等待或取消');
    const settings = await this.connections.readPrivate('image');
    if (!settings.baseUrl || !settings.model || !settings.apiKey) throw failure('请先在模型连接中填写 API 地址、密钥和生图模型');
    validateImageSettings(settings.model,compiled);
    const refs = [];
    for (const ref of compiled.references) refs.push(await referenceBytes(this.root, snapshot.assets.find(a => a.id === ref.assetId)));
    const context = { ...extra, kind:extra.kind||'generation', projectId, nodeId, model: settings.model, requestedSize: compiled.size,quality:compiled.quality||'auto' };
    if (this.tasks.list().some(t => t.context?.projectId === projectId && t.context?.nodeId === nodeId && ['queued', 'running'].includes(t.status))) throw failure('这个节点已有任务，请等待或取消');
    const task = await this.tasks.start(label, async (cancelSignal, taskId) => {
      await atomicWrite(await safePath(this.root, 'requests', `${taskId}.json`), JSON.stringify({ ...extra, projectId, nodeId, compiled, referenceAssets: snapshot.assets.filter(a => compiled.references.some(r => r.assetId === a.id)), node: snapshot.tugouCanvas.nodes.find(n => n.id === nodeId) }));
      const signal = AbortSignal.any([cancelSignal, AbortSignal.timeout(600000)]);
      const images = await requestImages(settings, { prompt:compiled.prompt, size:compiled.size,quality:compiled.quality, images:refs }, signal);
      const assets = [];
      for (const [i, bytes] of images.entries()) {
        signal.throwIfAborted();
        const image = await saveImage(this.root, bytes, this.inspectImage);
        assets.push({ id: `${taskId}-${i}`, name: `${label} · ${i + 1}`, ...image, generation: { ...extra, taskId, nodeId, model: settings.model, requestedSize: compiled.size,quality:compiled.quality||'auto' } });
      }
      signal.throwIfAborted();
      const result = { id: taskId, projectId, nodeId, createdAt: new Date().toISOString(), prompt: compiled.prompt, references: compiled.references, assets };
      const entry = this.tasks.tasks.find(t => t.id === taskId);
      entry.actualSizes = assets.map(a => `${a.width}x${a.height}`);
      if (compiled.size !== 'auto' && entry.actualSizes.some(size => size !== compiled.size)) entry.message = `模型返回 ${entry.actualSizes.join('、')}，与请求 ${compiled.size} 不同；已按原图保存`;
      await atomicWrite(await safePath(this.root, 'results', `${taskId}.json`), JSON.stringify(result));
      return taskId;
    }, context);
    return { id: task.id };
  }
  async results(projectId) {
    await this.projects.read(projectId);
    const results = [];
    for (const task of this.tasks.list().filter(t => !['analysis','semantic-analysis','runtime-install'].includes(t.context?.kind) && t.context?.projectId === projectId && t.status === 'completed')) {
      if (!/^[a-f0-9-]{36}$/.test(task.resultId || '')) continue;
      const result = JSON.parse(await fs.readFile(await safePath(this.root, 'results', `${task.resultId}.json`), 'utf8'));
      if (result.projectId === projectId && result.id === task.resultId) results.push(result);
    }
    return results;
  }
  async assetDetails(projectId, document, assetId, nodeId) {
    await this.projects.read(projectId); validateDocument(document);
    const asset=document.assets.find(a=>a.id===assetId);
    if(!asset)throw failure('素材已移除');
    let source=asset;
    const visited=new Set();
    for(let depth=0;source&&depth<16;depth++){
      if(visited.has(source.id))break;visited.add(source.id);
      const inherited=source!==asset;
      const describe=(prompt,label,metadata={})=>({prompt,label:inherited?'来源素材的'+label:label,sourceName:source.name||'',...metadata});
      if(typeof source.toolResult?.prompt==='string'&&source.toolResult.prompt.trim())
        return describe(source.toolResult.prompt,'处理提示词',{model:source.toolResult.model||''});
      const taskId=source.generation?.taskId;
      const task=/^[a-f0-9-]{36}$/.test(taskId||'')&&this.tasks.list().find(t=>t.id===taskId&&t.context?.projectId===projectId&&t.status==='completed'&&t.resultId===taskId);
      if(task){
        try{
          const result=JSON.parse(await fs.readFile(await safePath(this.root,'results',taskId+'.json'),'utf8'));
          const saved=result.assets?.find(a=>a.id===source.id&&a.resource===source.resource);
          if(result.id===taskId&&result.projectId===projectId&&saved&&typeof result.prompt==='string')
            return describe(result.prompt,'生成提示词',{model:saved.generation?.model||'',createdAt:result.createdAt||'',requestedSize:saved.generation?.requestedSize||'',references:(result.references||[]).map(r=>({assetId:r.assetId,role:r.role}))});
        }catch(e){if(e.code!=='ENOENT')throw failure('生成记录无法读取，请保留原文件并检查');}
      }
      if(typeof source.prompt==='string'&&source.prompt.trim())return describe(source.prompt,'记录的提示词',{model:source.model||'',createdAt:source.createdAt||''});
      source=source.toolResult?.source;
    }
    const node=nodeId&&document.tugouCanvas?.nodes.find(n=>n.id===nodeId&&n.type==='asset'&&n.data.assetId===assetId);
    const old=node && (node.data.legacyPromptAssetId ?? assetId)===assetId ? node.data.legacy?.metadata : null, prompt=old?.generationPrompt||old?.prompt;
    if(typeof prompt==='string'&&prompt.trim())return {prompt,label:'导入记录中的提示词',sourceName:asset.name,model:typeof old.model==='string'?old.model:''};
    return {prompt:'',label:'生成提示词',sourceName:asset.name,reason:'这张素材没有可读取的提示词记录，可使用图片反推。'};
  }
}
module.exports = { GenerationService, saveImage, referenceBytes, imageExtension, boundedBytes };

