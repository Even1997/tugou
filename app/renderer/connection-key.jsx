import React,{useState} from 'react';
import {FormDialog,Button,Input} from './components.jsx';
import {Select,EditableSelect} from './select.jsx';
import {purposes} from '../core/connection-state.cjs';

const activeModel=model=>!model.purposes.length||model.purposes.some(p=>purposes.some(([key])=>key===p));
const purposeMeta=Object.fromEntries(purposes.map(([k,label,field])=>[k,{label,field}]));

export function KeyRow({entry,routes,status,busy,update,probe,editModels,setDefault,removeModel,remove}) {
  const ready=!!entry.baseUrl.trim()&&!!(entry.apiKey?.trim()||entry.hasKey);
  const models=entry.models.filter(activeModel);
  return <section className="supplier-key" data-key-id={entry.id} aria-label={entry.name}>
    <div className="supplier-key-fields">
      <Input aria-label={`${entry.name} 名称`} maxLength={60} value={entry.name} disabled={busy} onChange={e=>update({name:e.target.value})}/>
      <Input.Password aria-label={`${entry.name} 密钥`} autoComplete="off" value={entry.apiKey||''} disabled={busy} placeholder={entry.hasKey?'已安全保存 · 输入以替换':'输入 API Key'} onChange={e=>update({apiKey:e.target.value})}/>
      <Button type="default" disabled={busy||!!status?.busy||!ready} loading={status?.busy==='test'} onClick={()=>probe('test')}>测试</Button>
      <Button className="supplier-danger-btn" aria-label={`移除 ${entry.name}`} disabled={busy} onClick={remove}>移除</Button>
    </div>
    {(status?.busy||status?.message)&&<div className={`supplier-key-status${status?.ok===false?' error':status?.ok?' ok':''}`} role="status">{status?.busy==='fetch'?'正在拉取模型列表…':status?.busy==='test'?'正在测试连接…':status.message}</div>}
    <div className="supplier-key-models">
      <div className="supplier-key-models-bar">
        <span className="muted">已启用模型 · {models.length}</span>
        <div>
          <Button type="default" disabled={busy||!!status?.busy||!ready} loading={status?.busy==='fetch'} onClick={()=>probe('fetch')}>获取模型</Button>
          <Button type="default" disabled={busy} onClick={editModels}>添加 / 管理</Button>
        </div>
      </div>
      {models.length?<div className="supplier-inline-models">
        {models.map(m=><div className="supplier-inline-model" key={m.id}>
          <strong title={m.id}>{m.id}</strong>
          <div className="supplier-inline-tags">
            {m.purposes.filter(p=>purposeMeta[p]).map(p=>{
              const {label,field}=purposeMeta[p];
              const isDef=routes?.[p]===entry.id&&entry[field]===m.id;
              return <button key={p} type="button" disabled={busy||isDef} className={`supplier-purpose-pill${isDef?' is-default':''}`} title={isDef?`当前${label}默认模型`:`点击设为${label}默认模型`} onClick={()=>setDefault(p,m.id)}>{label}{isDef?' · 默认':''}</button>;
            })}
          </div>
          <Button aria-label={`移除模型 ${m.id}`} disabled={busy} onClick={()=>removeModel(m.id)}>移除</Button>
        </div>)}
      </div>:<p className="supplier-models-empty muted">暂未启用模型。点击「获取模型」自动拉取，或点「添加 / 管理」手动填写模型 ID。</p>}
    </div>
  </section>;
}

export function KeyModels({entry,catalog=[],close,apply}) {
  const [models,setModels]=useState(entry.models.filter(activeModel)),[value,setValue]=useState(''),[uses,setUses]=useState(['image']);
  const [query,setQuery]=useState(''),[page,setPage]=useState(0),[error,setError]=useState('');
  const [protocol,setProtocol]=useState({textApiMode:entry.textApiMode||'chat'});
  const filtered=models.filter(m=>m.id.toLowerCase().includes(query.toLowerCase())),pages=Math.max(1,Math.ceil(filtered.length/20)),current=Math.min(page,pages-1);
  const toggle=(list,p)=>list.includes(p)?list.filter(x=>x!==p):[...list,p];
  const choices=(list,change)=>purposes.map(([p,label])=><label className="supplier-purpose-check" key={p}><input type="checkbox" checked={list.includes(p)} onChange={()=>change(toggle(list,p))}/>{label}</label>);
  const add=()=>{const id=value.trim();if(!id||id.length>256||/[\x00-\x1f\x7f]/.test(id)){setError('请填写有效的模型 ID（最多 256 个字符）');return;}if(!uses.length){setError('请至少选择一个用途');return;}if(models.some(m=>m.id===id)){setError('此模型已添加，可在下方修改用途');return;}setModels([{id,purposes:uses},...models]);setValue('');setQuery('');setPage(0);setError('');};
  return <FormDialog title={`${entry.name} · 添加与管理模型`} width={720} className="supplier-model-dialog" close={close}>
    <p className="muted">从拉取列表选择或直接输入模型 ID，并勾选适用用途；未设置默认时会自动启用首个模型。</p>
    <div className="supplier-model-add"><EditableSelect aria-label="模型 ID" value={value} options={catalog} onChange={setValue}/><Button type="default" onClick={add}>添加模型</Button></div>
    <div className="supplier-purpose-checks" aria-label="新模型用途">{choices(uses,setUses)}</div>
    {error&&<p role="alert" className="error">{error}</p>}
    <div className="supplier-model-heading"><strong>已选模型 · {models.length}</strong><Input aria-label="搜索已选模型" placeholder="搜索已选模型" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}}/></div>
    <div className="supplier-model-list">
      {!filtered.length&&<p className="muted">暂无模型。可以从上方选择，或直接填写模型 ID 后点「添加模型」。</p>}
      {filtered.slice(current*20,current*20+20).map(model=><div className="supplier-model-item" key={model.id}><div><strong title={model.id}>{model.id}</strong><Button aria-label={`移除模型 ${model.id}`} onClick={()=>setModels(models.filter(m=>m.id!==model.id))}>移除</Button></div><div className="supplier-purpose-checks">{choices(model.purposes,list=>setModels(models.map(m=>m.id===model.id?{...m,purposes:list}:m)))}</div></div>)}
    </div>
    {pages>1&&<div className="supplier-pagination"><Button disabled={!current} onClick={()=>setPage(current-1)}>上一页</Button><span>{current+1} / {pages}</span><Button disabled={current===pages-1} onClick={()=>setPage(current+1)}>下一页</Button></div>}
    <details className="supplier-protocol"><summary>高级协议设置</summary><div className="fields"><label>文本协议<Select aria-label="文本协议" value={protocol.textApiMode} onChange={e=>setProtocol({...protocol,textApiMode:e.target.value})}><option value="chat">Chat Completions</option><option value="responses">Responses</option></Select></label></div></details>
    <footer><small className="muted">确认后更新到当前草稿，点击主窗口「保存配置」生效</small><Button onClick={close}>取消</Button><Button primary onClick={()=>apply({models:[...models,...entry.models.filter(m=>!activeModel(m)&&!models.some(n=>n.id===m.id))],...protocol})}>确定</Button></footer>
  </FormDialog>;
}
