import React,{useEffect,useRef,useState} from 'react';
import {FormDialog,Button,Input} from './components.jsx';
import {KeyRow,KeyModels} from './connection-key.jsx';
import {purposes,reconcile,affected} from '../core/connection-state.cjs';
import './connection.css';
const api=window.tugou;
const newEndpoint=()=>({id:crypto.randomUUID(),name:'API',baseUrl:''});
const newKey=(provider,endpoint,n)=>({id:crypto.randomUUID(),providerId:provider.id,endpointId:endpoint.id,name:`Key ${n}`,baseUrl:endpoint.baseUrl,apiKey:'',hasKey:false,models:[]});
const hostOf=url=>{const text=url?.trim();if(!text)return '未填地址';try{return new URL(text).host||text;}catch{return text.replace(/^https?:\/\//,'').split('/')[0]||text;}};
const activeModel=m=>!m.purposes.length||m.purposes.some(p=>purposes.some(([k])=>k===p));

function fillDefaults(manager){
  const base=reconcile(manager);
  const routes={...base.routes};
  const connections=base.connections.map(c=>({...c}));
  for(const [purpose,,field] of purposes){
    if(routes[purpose])continue;
    const match=connections.find(c=>c.baseUrl?.trim()&&(c.apiKey?.trim()||c.hasKey)&&c.models.some(m=>m.purposes.includes(purpose)));
    if(match){
      routes[purpose]=match.id;
      match[field]=match.models.find(m=>m.purposes.includes(purpose)).id;
    }
  }
  return {...base,routes,connections};
}

export function ConnectionDialog({close}) {
  const [manager,setManager]=useState(null),[selected,setSelected]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[statuses,setStatuses]=useState({});
  const [modelId,setModelId]=useState(''),[confirmation,setConfirmation]=useState(null);
  const alive=useRef(true),versions=useRef({}),pending=useRef(new Set()),savingRef=useRef(false);
  const provider=manager?.providers.find(p=>p.id===selected)||manager?.providers[0];
  const endpoint=provider?.endpoints[0];
  const modelEntry=manager?.connections.find(c=>c.id===modelId);
  const visible=useRef(null);visible.current={providerId:provider?.id,endpointId:endpoint?.id,modelId};

  const load=async()=>{try{const next=await api.listSuppliers();if(alive.current){setManager(next);setSelected(next.providers[0]?.id||'');setError('');}}catch(e){if(alive.current)setError(e.message);}};
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;};},[]);

  const change=next=>{setManager(fillDefaults(next));setError('');};
  const invalidate=ids=>{for(const id of ids){versions.current[id]=(versions.current[id]||0)+1;pending.current.delete(id);}setStatuses(s=>Object.fromEntries(Object.entries(s).filter(([id])=>!ids.includes(id))));};
  const chooseProvider=id=>{setSelected(id);setNotice('');setError('');};
  const addProvider=()=>{const p={id:crypto.randomUUID(),name:`供应商 ${manager.providers.length+1}`,endpoints:[newEndpoint()]};change({...manager,providers:[...manager.providers,p],connections:[...manager.connections,newKey(p,p.endpoints[0],1)]});chooseProvider(p.id);};
  const patchProvider=patch=>change({...manager,providers:manager.providers.map(p=>p.id===provider.id?{...p,...patch}:p)});
  const patchEndpoint=patch=>{
    const ids=manager.connections.filter(c=>c.endpointId===endpoint.id).map(c=>c.id),addressChanged=Object.hasOwn(patch,'baseUrl');
    if(addressChanged){invalidate(ids);setNotice('地址变化后，此供应商的模型列表已清空，请重新获取或添加模型。');}
    change({...manager,providers:manager.providers.map(p=>p.id===provider.id?{...p,endpoints:p.endpoints.map(e=>e.id===endpoint.id?{...e,...patch}:e)}:p),connections:manager.connections.map(c=>ids.includes(c.id)&&addressChanged?{...c,baseUrl:patch.baseUrl,models:[]}:c)});
  };
  const patchKey=(id,patch)=>{
    if(Object.hasOwn(patch,'apiKey')){invalidate([id]);patch={...patch,models:[]};setNotice('Key 变化后，它的模型列表已清空，请重新获取或添加模型。');}
    change({...manager,connections:manager.connections.map(c=>c.id===id?{...c,...patch}:c)});
  };
  const setDefaultModel=(connectionId,purpose,model)=>{
    const field=purposes.find(([p])=>p===purpose)?.[2];
    if(!field)return;
    change({...manager,routes:{...manager.routes,[purpose]:connectionId},connections:manager.connections.map(c=>c.id===connectionId?{...c,[field]:model}:c)});
  };
  const removeInlineModel=(connectionId,targetModelId)=>{
    change({...manager,connections:manager.connections.map(c=>c.id===connectionId?{...c,models:c.models.filter(m=>m.id!==targetModelId)}:c)});
  };
  const confirmRemove=(title,ids,action)=>setConfirmation({title,text:`${affected(manager,ids).length?`将同时移除默认用途：${affected(manager,ids).join('、')}（如有其他可用模型会自动接替）。`:''}删除在保存配置后生效，取消可恢复。`,action:()=>{invalidate(ids);action();setConfirmation(null);}});
  const removeProvider=()=>{
    const ids=manager.connections.filter(c=>c.providerId===provider.id).map(c=>c.id);
    const remaining=manager.providers.filter(p=>p.id!==provider.id);
    confirmRemove(`删除供应商「${provider.name}」？`,ids,()=>{
      change({...manager,providers:remaining,connections:manager.connections.filter(c=>!ids.includes(c.id))});
      chooseProvider(remaining[0]?.id||'');
    });
  };
  const probe=async(entry,kind)=>{
    if(pending.current.has(entry.id))return;pending.current.add(entry.id);
    const version=versions.current[entry.id]||0;
    setStatuses(s=>({...s,[entry.id]:{...s[entry.id],busy:kind}}));
    try{const result=await (kind==='fetch'?api.fetchModels(entry):api.testConnection(entry));
      if(alive.current&&version===(versions.current[entry.id]||0)){
        setStatuses(s=>({...s,[entry.id]:{...s[entry.id],busy:'',ok:result.ok,...(kind==='fetch'?{models:result.ok?result.models:[]}:{}),message:result.ok?(kind==='fetch'?`已获取 ${result.count} 个模型`:`连接成功 · ${result.elapsedMs} ms`):result.message}}));
        if(kind==='fetch'&&result.ok&&visible.current.providerId===entry.providerId&&visible.current.endpointId===entry.endpointId&&!visible.current.modelId)setModelId(entry.id);
      }
    }catch(e){if(alive.current&&version===(versions.current[entry.id]||0))setStatuses(s=>({...s,[entry.id]:{busy:'',ok:false,message:e.message}}));}
    finally{if(version===(versions.current[entry.id]||0))pending.current.delete(entry.id);}
  };
  const applyModels=patch=>{
    change({...manager,connections:manager.connections.map(c=>c.id===modelId?{...c,...patch}:c)});
    setModelId('');
  };
  const save=async()=>{if(savingRef.current)return;savingRef.current=true;setSaving(true);setError('');try{await api.saveConnections(manager);if(alive.current){window.dispatchEvent(new Event('tugou-connection-changed'));close();}}catch(e){if(alive.current)setError(e.message);}finally{savingRef.current=false;if(alive.current)setSaving(false);}};

  return <>
    <FormDialog title="模型连接" width={960} className="connection-dialog" close={()=>{if(!saving)close();}}>
      {!manager?<div className="supplier-loading">{error&&<p className="error" role="alert">{error}</p>}<Button onClick={load}>重新加载配置</Button></div>:<>
        <div className="supplier-layout">
          <nav className="supplier-sidebar" aria-label="供应商列表">
            <small className="muted supplier-sidebar-heading">供应商 · {manager.providers.length}</small>
            <div className="supplier-provider-list">
              {manager.providers.map(p=>{
                const keys=manager.connections.filter(c=>c.providerId===p.id);
                const count=keys.reduce((sum,c)=>sum+c.models.filter(activeModel).length,0);
                return <Button key={p.id} aria-label={`供应商 ${p.name}`} className={provider?.id===p.id?'selected':''} onClick={()=>chooseProvider(p.id)}>
                  <strong>{p.name||'未命名供应商'}</strong>
                  <span>{hostOf(p.endpoints[0]?.baseUrl)} · {count} 个模型</span>
                </Button>;
              })}
            </div>
            <Button type="default" disabled={saving||manager.providers.length>=100||manager.connections.length>=100} onClick={addProvider}>＋ 添加供应商</Button>
          </nav>

          <main className="supplier-content">
            <div className="supplier-routes-bar" role="region" aria-label="当前默认用途模型">
              {purposes.map(([purpose, label, field]) => {
                const conn = manager.connections.find((c) => c.id === manager.routes?.[purpose]);
                const model = conn?.[field] || '';
                const prov = conn ? manager.providers.find((p) => p.id === conn.providerId) : null;
                const active = prov && prov.id === provider?.id;
                return (
                  <button
                    key={purpose}
                    type="button"
                    className={`supplier-route-chip${model ? ' is-ready' : ''}${active ? ' is-current' : ''}`}
                    disabled={!prov}
                    title={model ? `${label}：${model}（${prov?.name || ''}）· 点击定位` : `${label}：尚未设置默认模型`}
                    onClick={() => prov && chooseProvider(prov.id)}
                  >
                    <span className="supplier-route-head">
                      <i aria-hidden="true" />
                      <span>{label}</span>
                    </span>
                    <strong>{model || '未设置'}</strong>
                  </button>
                );
              })}
            </div>
            {error&&<p className="error" role="alert">{error}</p>}
            {provider?<>
              <div className="supplier-heading">
                <h3>供应商配置</h3>
                <Button className="supplier-danger-btn" disabled={saving} aria-label="删除供应商" onClick={removeProvider}>删除供应商</Button>
              </div>
              <div className="supplier-basic-fields">
                <label className="supplier-field"><span>名称</span><Input id="supplier-name" maxLength={60} disabled={saving} value={provider.name} onChange={e=>patchProvider({name:e.target.value})}/></label>
                {endpoint&&<label className="supplier-field"><span>API URL</span><Input id="supplier-url" aria-label="API URL" value={endpoint.baseUrl} disabled={saving} placeholder="https://api.example.com/v1" onChange={e=>patchEndpoint({baseUrl:e.target.value})}/></label>}
              </div>
              {endpoint&&<>
                <div className="supplier-keys-heading">
                  <div><strong>API Keys 与模型</strong><p className="muted">首次添加某用途模型会自动设为默认；多个模型可直接点标签切换默认。</p></div>
                  <Button type="default" disabled={saving||manager.connections.length>=100} onClick={()=>change({...manager,connections:[...manager.connections,newKey(provider,endpoint,manager.connections.filter(c=>c.endpointId===endpoint.id).length+1)]})}>＋ 添加 Key</Button>
                </div>
                {notice&&<p className="supplier-notice" role="status">{notice}</p>}
                <div className="supplier-keys">
                  {manager.connections.filter(c=>c.endpointId===endpoint.id).map(c=><KeyRow
                    key={c.id}
                    entry={c}
                    routes={manager.routes}
                    status={statuses[c.id]}
                    busy={saving}
                    update={patch=>patchKey(c.id,patch)}
                    probe={kind=>probe(c,kind)}
                    editModels={()=>setModelId(c.id)}
                    setDefault={(purpose,id)=>setDefaultModel(c.id,purpose,id)}
                    removeModel={id=>removeInlineModel(c.id,id)}
                    remove={()=>confirmRemove(`移除「${c.name}」？`,[c.id],()=>change({...manager,connections:manager.connections.filter(k=>k.id!==c.id)}))}
                  />)}
                </div>
                {!manager.connections.some(c=>c.endpointId===endpoint.id)&&<p className="muted">暂无 Key，点击「添加 Key」开始配置。</p>}
                <p className="supplier-help muted">Key 加密保存在本机。测试连接只检查模型接口，不调用生成。</p>
              </>}
            </>:<div className="supplier-empty">
              <p className="muted">还没有配置模型供应商。添加后填写 API 地址、Key 并选择模型即可使用 AI 生图与分析。</p>
              <Button primary onClick={addProvider}>＋ 添加供应商</Button>
            </div>}
          </main>
        </div>
        <footer><small className="muted">所有更改在保存配置后生效</small><Button disabled={saving} onClick={close}>取消</Button><Button primary loading={saving} onClick={save}>保存配置</Button></footer>
      </>}
    </FormDialog>
    {modelEntry&&<KeyModels key={modelEntry.id} entry={modelEntry} catalog={statuses[modelEntry.id]?.models||[]} close={()=>setModelId('')} apply={applyModels}/>}
    {confirmation&&<FormDialog title={confirmation.title} width={440} className="supplier-confirm" close={()=>setConfirmation(null)}><p>{confirmation.text}</p><footer><Button onClick={()=>setConfirmation(null)}>保留当前设置</Button><Button primary onClick={confirmation.action}>确认更改</Button></footer></FormDialog>}
  </>;
}
