import React,{useEffect,useRef,useState} from 'react';
import {Select} from './select.jsx';
import {FormDialog,Button,Input} from './components.jsx';
import {KeyRow,KeyModels} from './connection-key.jsx';
import {purposes,reconcile,affected} from '../core/connection-state.cjs';
import './connection.css';
const api=window.tugou;
const newEndpoint=()=>({id:crypto.randomUUID(),name:'API',baseUrl:''});
const newKey=(provider,endpoint,n)=>({id:crypto.randomUUID(),providerId:provider.id,endpointId:endpoint.id,name:`Key ${n}`,baseUrl:endpoint.baseUrl,apiKey:'',hasKey:false,models:[]});

export function ConnectionDialog({close}) {
  const [manager,setManager]=useState(null),[selected,setSelected]=useState('');
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false),[statuses,setStatuses]=useState({});
  const [modelId,setModelId]=useState(''),[confirmation,setConfirmation]=useState(null);
  const alive=useRef(true),versions=useRef({}),pending=useRef(new Set()),savingRef=useRef(false);
  const provider=manager?.providers.find(p=>p.id===selected),endpoint=provider?.endpoints[0];
  const modelEntry=manager?.connections.find(c=>c.id===modelId);
  const visible=useRef(null);visible.current={providerId:provider?.id,endpointId:endpoint?.id,modelId};
  const load=async()=>{try{const next=await api.listSuppliers();if(alive.current){setManager(next);setSelected(next.providers[0]?.id||'defaults');setError('');}}catch(e){if(alive.current)setError(e.message);}};
  useEffect(()=>{alive.current=true;load();return()=>{alive.current=false;};},[]);
  const change=next=>{setManager(reconcile(next));setError('');};
  const invalidate=ids=>{for(const id of ids){versions.current[id]=(versions.current[id]||0)+1;pending.current.delete(id);}setStatuses(s=>Object.fromEntries(Object.entries(s).filter(([id])=>!ids.includes(id))));};
  const chooseProvider=id=>{setSelected(id);setNotice('');setError('');};
  const addProvider=()=>{const p={id:crypto.randomUUID(),name:`供应商 ${manager.providers.length+1}`,endpoints:[newEndpoint()]};change({...manager,providers:[...manager.providers,p],connections:[...manager.connections,newKey(p,p.endpoints[0],1)]});chooseProvider(p.id);};
  const patchProvider=patch=>change({...manager,providers:manager.providers.map(p=>p.id===provider.id?{...p,...patch}:p)});
  const patchEndpoint=patch=>{
    const ids=manager.connections.filter(c=>c.endpointId===endpoint.id).map(c=>c.id),addressChanged=Object.hasOwn(patch,'baseUrl');
    if(addressChanged){invalidate(ids);setNotice('地址变化后，此供应商的模型与默认用途已清空，请重新获取或添加模型。');}
    change({...manager,providers:manager.providers.map(p=>p.id===provider.id?{...p,endpoints:p.endpoints.map(e=>e.id===endpoint.id?{...e,...patch}:e)}:p),connections:manager.connections.map(c=>ids.includes(c.id)&&addressChanged?{...c,baseUrl:patch.baseUrl,models:[]}:c)});
  };
  const patchKey=(id,patch)=>{
    if(Object.hasOwn(patch,'apiKey')){invalidate([id]);patch={...patch,models:[]};setNotice('Key 变化后，它的模型与默认用途已清空，请重新获取或添加模型。');}
    change({...manager,connections:manager.connections.map(c=>c.id===id?{...c,...patch}:c)});
  };
  const confirmRemove=(title,ids,action)=>setConfirmation({title,text:`${affected(manager,ids).length?`会清空默认用途：${affected(manager,ids).join('、')}。`:''}删除在保存配置后生效，取消可恢复。`,action:()=>{invalidate(ids);action();setConfirmation(null);}});
  const removeProvider=()=>{const ids=manager.connections.filter(c=>c.providerId===provider.id).map(c=>c.id);confirmRemove(`删除供应商「${provider.name}」？`,ids,()=>{change({...manager,providers:manager.providers.filter(p=>p.id!==provider.id),connections:manager.connections.filter(c=>!ids.includes(c.id))});chooseProvider('defaults');});};
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
    const next=reconcile({...manager,connections:manager.connections.map(c=>c.id===modelId?{...c,...patch}:c)});
    const removed=purposes.filter(([p])=>manager.routes[p]&&!next.routes[p]).map(([,label])=>label);
    const apply=()=>{change(next);setModelId('');setConfirmation(null);};
    if(removed.length)setConfirmation({title:'调整模型会清空默认用途',text:`${removed.join('、')} 需重新选择默认模型。`,action:apply});else apply();
  };
  const save=async()=>{if(savingRef.current)return;savingRef.current=true;setSaving(true);setError('');try{await api.saveConnections(manager);if(alive.current){window.dispatchEvent(new Event('tugou-connection-changed'));close();}}catch(e){if(alive.current)setError(e.message);}finally{savingRef.current=false;if(alive.current)setSaving(false);}};
  return <>
    <FormDialog title="模型连接" width={1000} className="connection-dialog" close={()=>{if(!saving)close();}}>
      {!manager?<div>{error&&<p role="alert">{error}</p>}<Button onClick={load}>重新加载配置</Button></div>:<>
        <div className="supplier-layout">
          <nav className="supplier-sidebar" aria-label="模型连接导航">
            <Button className={selected==='defaults'?'selected':''} onClick={()=>chooseProvider('defaults')}>默认模型<span>按用途选择</span></Button>
            <small className="muted supplier-sidebar-heading">供应商</small>
            <div className="supplier-provider-list">{manager.providers.map(p=><Button key={p.id} aria-label={`供应商 ${p.name}`} className={selected===p.id?'selected':''} onClick={()=>chooseProvider(p.id)}><strong>{p.name||'未命名供应商'}</strong><span>{manager.connections.filter(c=>c.providerId===p.id).length} 个 Key</span></Button>)}</div>
            <Button type="default" disabled={saving||manager.providers.length>=100||manager.connections.length>=100} onClick={addProvider}>＋ 添加供应商</Button>
          </nav>
          <main className="supplier-content">
            {error&&<p className="error" role="alert">{error}</p>}
            {selected==='defaults'?<>
              <div className="supplier-heading"><h3>默认模型</h3><p className="muted">每个用途单独选择，明确使用哪个供应商和 Key。</p></div>
              <div className="supplier-defaults">{purposes.map(([purpose,label,field])=>{
                const key=manager.connections.find(c=>c.id===manager.routes[purpose]);
                const options=manager.connections.filter(c=>c.baseUrl&&(c.hasKey||c.apiKey?.trim())).flatMap(c=>c.models.filter(m=>m.purposes.includes(purpose)).map(m=>({value:JSON.stringify([c.id,m.id]),label:`${manager.providers.find(p=>p.id===c.providerId)?.name} / ${c.name} / ${m.id}`})));
                return <label key={purpose}>{label}<Select aria-label={`${label}默认模型`} disabled={saving} value={key?.[field]?JSON.stringify([key.id,key[field]]):''} onChange={e=>{const [id,model]=e.target.value?JSON.parse(e.target.value):[null,''];change({...manager,routes:{...manager.routes,[purpose]:id},connections:manager.connections.map(c=>c.id===id?{...c,[field]:model}:c)});}}><option value="">未设置</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</Select><small className="muted">{key?`${key.baseUrl} · ${key.name}`:'先在供应商页获取或添加模型，并设置用途'}</small></label>;
              })}</div>
            </>:provider?<>
              <div className="supplier-heading"><h3>供应商配置</h3><Button disabled={saving} aria-label="删除供应商" onClick={removeProvider}>删除供应商</Button></div>
              <label className="supplier-field">供应商<Input id="supplier-name" maxLength={60} disabled={saving} value={provider.name} onChange={e=>patchProvider({name:e.target.value})}/></label>
              {endpoint?<>
                <label className="supplier-field">API URL<Input id="supplier-url" aria-label="API URL" value={endpoint.baseUrl} disabled={saving} placeholder="https://api.example.com/v1" onChange={e=>patchEndpoint({baseUrl:e.target.value})}/></label>
                <div className="supplier-keys-heading"><div><strong>API Keys</strong><p className="muted">同一地址可添加多个 Key，各自管理模型。</p></div><Button type="default" disabled={saving||manager.connections.length>=100} onClick={()=>change({...manager,connections:[...manager.connections,newKey(provider,endpoint,manager.connections.filter(c=>c.endpointId===endpoint.id).length+1)]})}>＋ 添加 Key</Button></div>
                {notice&&<p className="supplier-notice" role="status">{notice}</p>}
                <div className="supplier-keys">{manager.connections.filter(c=>c.endpointId===endpoint.id).map(c=><KeyRow key={c.id} entry={c} status={statuses[c.id]} busy={saving} update={patch=>patchKey(c.id,patch)} probe={kind=>probe(c,kind)} editModels={()=>setModelId(c.id)} remove={()=>confirmRemove(`移除「${c.name}」？`,[c.id],()=>change({...manager,connections:manager.connections.filter(k=>k.id!==c.id)}))}/>)}</div>
                {!manager.connections.some(c=>c.endpointId===endpoint.id)&&<p className="muted">暂无 Key，点击“添加 Key”开始。</p>}
                <p className="supplier-help muted">Key 加密保存在本机。测试连接只检查模型接口，不调用生成。</p>
              </>:<p className="muted">请添加供应商后管理 Key。</p>}
            </>:null}
          </main>
        </div>
        <footer><small className="muted">所有更改在保存后生效</small><Button disabled={saving} onClick={close}>取消</Button><Button primary loading={saving} onClick={save}>保存配置</Button></footer>
      </>}
    </FormDialog>
    {modelEntry&&<KeyModels key={modelEntry.id} entry={modelEntry} catalog={statuses[modelEntry.id]?.models||[]} close={()=>setModelId('')} apply={applyModels}/>}
    {confirmation&&<FormDialog title={confirmation.title} width={440} className="supplier-confirm" close={()=>setConfirmation(null)}><p>{confirmation.text}</p><footer><Button onClick={()=>setConfirmation(null)}>保留当前设置</Button><Button primary onClick={confirmation.action}>确认更改</Button></footer></FormDialog>}
  </>;
}
