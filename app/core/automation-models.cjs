const {randomUUID}=require('node:crypto');
const {reconcile,purposes}=require('./connection-state.cjs');

function register(define,{string,object,enumeration}) {
  const revision={type:'integer',minimum:0},name={type:'string',minLength:1,maxLength:60},url={type:'string',maxLength:2048},secret={type:'string',minLength:1,maxLength:8192,pattern:'^[^\\r\\n]+$'};
  const write=(command,description,properties,required)=>define(command,description,{settingsRevision:revision,...properties},['settingsRevision',...required],'configuration');
  write('models.provider.create','添加供应商，每个供应商只有一个 URL；立即加密保存',{name,baseUrl:url},['name','baseUrl']);
  write('models.provider.update','修改供应商名称或唯一 URL；地址变化清空其模型和默认用途',{id:string,patch:object({name,baseUrl:url})},['id','patch']);
  write('models.provider.delete','删除供应商及其全部 Key，清空受影响默认用途',{id:string},['id']);
  write('models.key.create','在供应商下添加 Key；密钥仅写入，不返回或写入请求日志',{providerId:string,name,apiKey:secret},['providerId','name','apiKey']);
  write('models.key.update','修改 Key 名称或密钥；密钥变化清空模型和默认用途',{id:string,patch:object({name,apiKey:secret,clearKey:{type:'boolean'},textApiMode:enumeration('chat','responses'),videoProtocol:enumeration('json','multipart','sora')})},['id','patch']);
  write('models.key.delete','删除单个 Key，清空受影响默认用途',{id:string},['id']);
  const lookup={id:string,settingsRevision:revision};
  define('models.test','使用已保存 Key 测试模型列表接口，不调用生成、不返回密钥',lookup,['id','settingsRevision'],'network');
  define('models.fetch','按已保存 Key 获取模型 ID；不自动保存或猜测用途，之后使用 models.set',lookup,['id','settingsRevision'],'network');
  write('models.set','设置单个 Key 的模型及用途；可手填模型，移除模型会清空受影响默认用途',{id:string,models:{type:'array',maxItems:10000,items:object({id:{type:'string',minLength:1,maxLength:256},purposes:{type:'array',maxItems:5,uniqueItems:true,items:enumeration(...purposes.map(p=>p[0]))}},['id','purposes'])}},['id','models']);
  write('models.assign','按用途选择已分类的 Key 和模型；不传 keyId/modelId 则清除此用途',{purpose:enumeration(...purposes.map(p=>p[0])),keyId:string,modelId:{type:'string',minLength:1,maxLength:256}},['purpose']);
}

async function execute(connections,name,args,{find,fail}) {
  let manager=await connections.listSuppliers();
  if(manager.revision!==args.settingsRevision)fail('CONFIG_CONFLICT','连接配置已变化，请重新读取 models.status');
  if((args.apiKey!==undefined&&!args.apiKey.trim())||(args.patch?.apiKey!==undefined&&!args.patch.apiKey.trim()))fail('INVALID_ARGUMENT','Key 不能为空白');
  const ids=[],provider=()=>find(manager.providers,args.id),key=()=>find(manager.connections,args.id);
  if(name==='models.test'||name==='models.fetch'){
    key();const result=await connections.probe({id:args.id},name==='models.fetch');
    if((await connections.listSuppliers()).revision!==manager.revision)fail('CONFIG_CONFLICT','探测期间连接配置已变化，请重新获取');
    return {...result,settingsRevision:manager.revision,keyId:args.id};
  }
  let id=args.id;
  if(name==='models.provider.create'){
    id=randomUUID();manager.providers.push({id,name:args.name,endpoints:[{id:randomUUID(),name:'API',baseUrl:args.baseUrl.trim().replace(/\/+$/,'')}]});
  }else if(name==='models.provider.update'){
    const p=provider();if(args.patch.name!==undefined)p.name=args.patch.name;
    if(args.patch.baseUrl!==undefined){
      const address=args.patch.baseUrl.trim().replace(/\/+$/,'');
      if(address!==p.endpoints[0].baseUrl){p.endpoints[0].baseUrl=address;for(const c of manager.connections.filter(c=>c.providerId===p.id)){c.baseUrl=address;c.models=[];ids.push(c.id);}}
    }
  }else if(name==='models.provider.delete'){
    provider();ids.push(...manager.connections.filter(c=>c.providerId===id).map(c=>c.id));manager.providers=manager.providers.filter(p=>p.id!==id);manager.connections=manager.connections.filter(c=>!ids.includes(c.id));
  }else if(name==='models.key.create'){
    const p=find(manager.providers,args.providerId),endpoint=p.endpoints[0];id=randomUUID();
    manager.connections.push({id,providerId:p.id,endpointId:endpoint.id,name:args.name,baseUrl:endpoint.baseUrl,apiKey:args.apiKey,models:[]});
  }else if(name==='models.key.update'){
    const c=key();if(args.patch.clearKey&&args.patch.apiKey)fail('INVALID_ARGUMENT','不能同时设置和清空 Key');
    Object.assign(c,args.patch);
    if(args.patch.apiKey!==undefined||args.patch.clearKey){c.models=[];ids.push(c.id);if(args.patch.clearKey){c.hasKey=false;delete c.apiKey;}}
  }else if(name==='models.key.delete'){
    key();ids.push(id);manager.connections=manager.connections.filter(c=>c.id!==id);
  }else if(name==='models.set')key().models=args.models;
  else if(name==='models.assign'){
    if(Boolean(args.keyId)!==Boolean(args.modelId))fail('INVALID_ARGUMENT','keyId 和 modelId 必须同时提供');
    if(args.keyId){const c=find(manager.connections,args.keyId);if(!(c.hasKey||c.apiKey?.trim())||!c.baseUrl||!c.models.some(m=>m.id===args.modelId&&m.purposes.includes(args.purpose)))fail('INVALID_TARGET','请选择有 Key 和 URL、且已标注对应用途的模型');c[purposes.find(p=>p[0]===args.purpose)[2]]=args.modelId;}
    manager.routes[args.purpose]=args.keyId||null;
  }else fail('UNKNOWN_COMMAND','未知连接操作');
  const before={...manager.routes};manager=reconcile(manager);
  const clearedPurposes=purposes.filter(([p])=>before[p]&&!manager.routes[p]).map(([p])=>p);
  const saved=await connections.saveManager(manager);
  return {id,settingsRevision:saved.revision,clearedPurposes,affectedKeyIds:ids};
}
module.exports={register,execute};
