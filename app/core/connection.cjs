const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, safePath } = require('./storage.cjs');
const { boundedBytes } = require('./image-api.cjs');
const { randomUUID } = require('node:crypto');
const {supplierView,validateGroups,modelList}=require('./connection-groups.cjs');
const purposes = { image:'model', analysis:'analysisModel', text:'textModel', video:'videoModel', audio:'audioModel' };
const emptyConnection = () => ({baseUrl:'',apiKey:'',model:'',analysisModel:'',textModel:'',videoModel:'',audioModel:''});
const publicConnection = ({apiKey,...settings}) => ({...settings,hasKey:Boolean(apiKey)});
const publicManager = db => ({revision:db.revision,activeId:db.activeId,routes:db.routes,connections:db.connections.map(publicConnection),...(db.providers?{providers:db.providers}:{})});
function selectedConnection(db,purpose) {
  if(purpose!==undefined&&!Object.hasOwn(purposes,purpose))throw Error('未知连接用途');
  const id=db.routes[purpose]||db.activeId;
  if(!id)return emptyConnection();
  const selected=db.connections.find(c=>c.id===id);
  if(!selected)throw Error('已分配的连接不存在，请重新设置用途');
  return selected;
}

function connectionSettings(update,previous,index) {
  const name=String(update.name??previous.name??`连接 ${index+1}`).trim();
  if(!name||name.length>60)throw Error('连接名称请填写 1–60 个字符');
  const apiKey=update.clearKey===true?'':(typeof update.apiKey==='string'&&update.apiKey.trim()?update.apiKey.trim():previous.apiKey||'');
  if(/[\r\n]/.test(apiKey))throw Error('密钥不能包含换行');
  return {id:update.id,name,baseUrl:connectionAddress(update.baseUrl??previous.baseUrl),
    ...((update.models??previous.models)?{providerId:update.providerId??previous.providerId,endpointId:update.endpointId??previous.endpointId,models:modelList(update.models??previous.models)}:{}),
    ...Object.fromEntries(Object.values(purposes).map(key=>[key,String(update[key]??previous[key]??'').trim()])),
    textApiMode:['chat','responses'].includes(update.textApiMode??previous.textApiMode)?(update.textApiMode??previous.textApiMode):'chat',
    videoProtocol:['json','multipart','sora'].includes(update.videoProtocol??previous.videoProtocol)?(update.videoProtocol??previous.videoProtocol):'json',apiKey};
}

function connectionAddress(value) {
  const baseUrl = String(value || '').trim().replace(/\/+$/, '');
  if (!baseUrl) return '';
  let url;
  try { url = new URL(baseUrl); } catch { throw new Error('模型地址无效，请填写完整的 API 地址'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('模型地址须使用 HTTPS，本机服务可用 HTTP');
  }
  return baseUrl;
}

class ConnectionStore {
  constructor(root, encryption) { this.root = root; this.encryption = encryption; this.pending = Promise.resolve(); }
  async readDatabase() {
    const file = await safePath(this.root, 'connection.enc');
    try {
      const bytes = await fs.readFile(file);
      if (!this.encryption.isEncryptionAvailable()) throw new Error('系统密钥保护不可用');
      const stored=JSON.parse(this.encryption.decryptString(bytes));
      if(Array.isArray(stored.connections))return stored;
      // Preserve the user's existing encrypted single connection when adding multi-connection management.
      return {revision:0,activeId:'default',routes:{},connections:[{...stored,id:'default',name:'原有连接'}]};
    } catch (error) { if (error.code === 'ENOENT') return {revision:0,activeId:null,routes:{},connections:[]}; throw error; }
  }
  async readPrivate(purpose) {
    return selectedConnection(await this.readDatabase(),purpose);
  }
  async list() {
    return publicManager(await this.readDatabase());
  }
  async listSuppliers() {
    return supplierView(await this.list());
  }
  async publicSettings() {
    const db=await this.readDatabase(),settings=publicConnection(selectedConnection(db,'image'));
    for(const [purpose,field] of Object.entries(purposes)){
      const selected=selectedConnection(db,purpose);settings[field]=selected[field]||(purpose==='text'?selected.analysisModel:'')||'';
    }
    return settings;
  }
  async probe(input, includeModels = false, timeoutMs = 15000) {
    const db=await this.readDatabase();
    const previous = input?.id===undefined ? selectedConnection(db) : db.connections.find(c=>c.id===input.id)||emptyConnection();
    const baseUrl = connectionAddress(input?.baseUrl ?? previous.baseUrl);
    const apiKey = input?.clearKey === true ? '' : (typeof input?.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : previous.apiKey);
    if (!baseUrl || !apiKey) throw new Error('请先填写 API 地址和密钥');
    if (/[\r\n]/.test(apiKey)) throw new Error('密钥不能包含换行');
    const endpoint = baseUrl + (baseUrl.endsWith('/v1') ? '' : '/v1') + '/models';
    const started = Date.now(), signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await fetch(endpoint, { headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal });
      if (!response.ok) {
        await response.body?.cancel();
        const reason = response.status === 401 ? '密钥无效或已过期' : response.status === 403 ? '当前密钥无权读取模型列表' : [404,405].includes(response.status) ? '服务未提供模型列表接口，无法验证；可手动填写模型' : response.status === 429 ? '请求过于频繁，请稍后重试' : '服务返回错误，请检查地址或稍后重试';
        return { ok: false, message: `${reason}（HTTP ${response.status}）` };
      }
      const bytes = await boundedBytes(response, 2 * 1024 * 1024);
      let payload;
      try { payload = JSON.parse(bytes.toString('utf8')); } catch { return { ok: false, message: '响应不是模型列表，请检查 API 地址；可手动填写模型' }; }
      if (!Array.isArray(payload?.data) || payload.data.length > 10000) return { ok: false, message: '模型列表格式不支持或数量过大；可手动填写模型' };
      const models = [...new Set(payload.data.filter(item => typeof item?.id === 'string' && item.id.trim() && item.id.length <= 256 && !/[\x00-\x1f\x7f]/.test(item.id)).map(item => item.id.trim()))].sort();
      if (payload.data.length && !models.length) return { ok: false, message: '模型列表没有有效的模型 ID；可手动填写模型' };
      return { ok: true, elapsedMs: Date.now() - started, count: models.length, ...(includeModels ? { models } : {}) };
    } catch {
      await response?.body?.cancel().catch(() => {});
      return { ok: false, message: signal.aborted ? '连接超时，请检查网络后重试' : '无法读取模型列表，请检查网络、地址或响应大小；可手动填写模型' };
    }
  }
  async importLegacy(filename, decrypt = (bytes) => this.encryption.decryptString(bytes)) {
    if (!this.encryption.isEncryptionAvailable()) throw new Error('系统密钥保护不可用');
    const source = await safePath(path.dirname(path.resolve(filename)), path.basename(filename));
    const legacy = JSON.parse(await decrypt(await fs.readFile(source), source));
    if (typeof legacy.baseUrl !== 'string' || typeof legacy.apiKey !== 'string') throw new Error('不是有效的旧版连接配置');
    return this.save({ baseUrl: legacy.baseUrl, apiKey: legacy.apiKey, clearKey: !legacy.apiKey, model: legacy.model || '', analysisModel: legacy.analysisModel || '' });
  }
  mutate(action) {
    const operation = this.pending.then(async () => {
      if (!this.encryption.isEncryptionAvailable()) throw new Error('系统密钥保护不可用，未保存');
      const db=await this.readDatabase();action(db);db.revision++;
      await atomicWrite(await safePath(this.root, 'connection.enc'), this.encryption.encryptString(JSON.stringify(db)));
      return db;
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
  save(input) {
    const update=structuredClone(input);let id;
    return this.mutate(db=>{
      id=update.id||db.activeId||randomUUID();const index=db.connections.findIndex(c=>c.id===id);
      const settings=connectionSettings({...update,id},db.connections[index]||emptyConnection(),index<0?db.connections.length:index);
      if(index<0)db.connections.push(settings);else db.connections[index]=settings;
      if(!db.activeId)db.activeId=id;
    }).then(db=>publicConnection(db.connections.find(c=>c.id===id)));
  }
  saveManager(input) {
    const update=structuredClone(input);
    return this.mutate(db=>{
      if(update.revision!==db.revision)throw Error('连接配置已变化，请重新打开后编辑，未覆盖已有设置');
      if(!Array.isArray(update.connections)||update.connections.length>100)throw Error('连接列表无效');
      const ids=new Set();
      const connections=update.connections.map((c,i)=>{
        if(!c||typeof c.id!=='string'||! /^[a-zA-Z0-9-]{1,80}$/.test(c.id)||ids.has(c.id))throw Error('连接标识无效或重复');
        ids.add(c.id);return connectionSettings(c,db.connections.find(old=>old.id===c.id)||emptyConnection(),i);
      });
      const activeId=update.activeId||null;
      if(activeId&&!ids.has(activeId))throw Error('默认连接不存在');
      const routes={};for(const purpose of Object.keys(purposes)){
        const id=update.routes?.[purpose]||null;
        if(id&&!ids.has(id))throw Error('用途分配的连接不存在');
        routes[purpose]=id;
      }
      if(update.providers){db.providers=validateGroups(update,connections,connectionAddress);if(activeId)throw Error('请按用途选择默认模型');}
      Object.assign(db,{connections,activeId,routes});
    }).then(publicManager);
  }
}
module.exports = { ConnectionStore };
