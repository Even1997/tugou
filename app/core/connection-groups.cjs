const fields={image:'model',analysis:'analysisModel',text:'textModel',video:'videoModel',audio:'audioModel'};
const validId=value=>typeof value==='string'&&/^[a-zA-Z0-9-]{1,80}$/.test(value);
const groupId=(type,id)=>type+'-'+require('node:crypto').createHash('sha256').update(id).digest('hex').slice(0,32);
function modelList(value) {
  if(!Array.isArray(value)||value.length>10000)throw Error('模型列表无效');
  const ids=new Set();
  return value.map(model=>{
    if(typeof model?.id!=='string'||!model.id.trim()||model.id.length>256||/[\x00-\x1f\x7f]/.test(model.id)||ids.has(model.id.trim()))throw Error('模型 ID 无效或重复');
    ids.add(model.id.trim());
    if(!Array.isArray(model.purposes)||model.purposes.some(p=>!Object.hasOwn(fields,p)))throw Error('模型用途无效');
    return {id:model.id.trim(),purposes:[...new Set(model.purposes)]};
  });
}
function supplierView(manager) {
  if(manager.providers)return manager;
  const providers=manager.connections.map(c=>({id:groupId('provider',c.id),name:c.name,endpoints:[{id:groupId('endpoint',c.id),name:'主接口',baseUrl:c.baseUrl}]}));
  const connections=manager.connections.map(c=>{
    const models=[];for(const [purpose,field] of Object.entries(fields)){
      const id=c[field]||(purpose==='text'?c.analysisModel:'');if(!id)continue;
      let model=models.find(m=>m.id===id);if(!model){model={id,purposes:[]};models.push(model);}model.purposes.push(purpose);
    }
    return {...c,providerId:groupId('provider',c.id),endpointId:groupId('endpoint',c.id),name:'Key 1',models,textModel:c.textModel||c.analysisModel||''};
  });
  const routes={};for(const [p,f] of Object.entries(fields)){
    const c=connections.find(c=>c.id===(manager.routes[p]||manager.activeId));routes[p]=c?.[f]?c.id:null;
  }
  return {...manager,providers,connections,routes,activeId:null};
}
function validateGroups(input,connections,address) {
  if(!Array.isArray(input.providers)||input.providers.length>100)throw Error('供应商列表无效');
  const ids=new Set(),endpoints=new Map();
  const named=(item,label)=>{if(!validId(item?.id)||ids.has(item.id))throw Error(`${label}标识无效或重复`);ids.add(item.id);const name=String(item.name||'').trim();if(!name||name.length>60)throw Error(`${label}名称请填写 1–60 个字符`);return name;};
  const providers=input.providers.map(p=>{
    const name=named(p,'供应商');if(!Array.isArray(p.endpoints)||p.endpoints.length!==1)throw Error('每个供应商必须且只能配置一个 URL');
    return {id:p.id,name,endpoints:p.endpoints.map(ep=>{
      const result={id:ep.id,name:named(ep,'接口'),baseUrl:address(ep.baseUrl)};
      endpoints.set(ep.id,{...result,providerId:p.id});return result;
    })};
  });
  for(const c of connections){
    const endpoint=endpoints.get(c.endpointId);if(!endpoint||endpoint.providerId!==c.providerId)throw Error('Key 所属供应商或接口不存在');
    if(c.baseUrl!==endpoint.baseUrl)throw Error('Key 地址与所属接口不一致');
    if(!Array.isArray(c.models))throw Error('Key 缺少模型列表');
  }
  for(const [purpose,field] of Object.entries(fields)){
    const id=input.routes?.[purpose];if(!id)continue;
    const c=connections.find(c=>c.id===id);if(!c||!c.apiKey||!c.baseUrl||!c.models.some(m=>m.id===c[field]&&m.purposes.includes(purpose)))throw Error('默认模型必须来自对应 Key 的已选用途模型');
  }
  return providers;
}
module.exports={supplierView,validateGroups,modelList};
