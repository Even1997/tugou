import React,{useEffect,useRef,useState} from 'react';
import {Button} from './components.jsx';
import {Select} from './select.jsx';
import {purposes,reconcile} from '../core/connection-state.cjs';

export function SettingsModelDefaults({models,setModels,busy,perform,t}){
  const saving=useRef(false);
  const select=(purpose,field,value)=>{
    if(saving.current||!models)return;
    saving.current=true;
    perform(async()=>{
      try{
        const [id,model]=value?JSON.parse(value):[null,''];
        const next=reconcile({...models,routes:{...models.routes,[purpose]:id},connections:models.connections.map(c=>c.id===id?{...c,[field]:model}:c)});
        setModels(await window.tugou.saveConnections(next));
        window.dispatchEvent(new Event('tugou-connection-changed'));
      }catch(error){
        // A stale revision must reload, never overwrite another client's changes.
        try{setModels(await window.tugou.listSuppliers());}catch{}
        throw error;
      }finally{saving.current=false;}
    });
  };
  return <div className="settings-model-defaults">{purposes.map(([purpose,,field])=>{
    const connection=models?.connections.find(c=>c.id===models.routes[purpose]);
    const options=(models?.connections||[]).filter(c=>c.baseUrl&&c.hasKey).flatMap(c=>c.models.filter(m=>m.purposes.includes(purpose)).map(m=>({value:JSON.stringify([c.id,m.id]),label:`${m.id} · ${models.providers.find(p=>p.id===c.providerId)?.name} / ${c.name}`})));
    return <div className="settings-row" key={purpose}><div className="settings-row-copy"><h2 id={`default-model-${purpose}`}>{t(purpose)}</h2>{models&&!options.length&&<p>{t('noPurposeModels')}</p>}</div><div className="settings-row-control"><Select aria-labelledby={`default-model-${purpose}`} aria-label={`${t(purpose)} ${t('defaultModel')}`} className="settings-model-select" disabled={busy||!models} value={connection?.[field]?JSON.stringify([connection.id,connection[field]]):''} showSearch={{optionFilterProp:'label'}} notFoundContent={t('noResults')} onChange={e=>select(purpose,field,e.target.value)}><option value="">{t('unconfigured')}</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</Select></div></div>;
  })}</div>;
}

export function McpConnectionInfo({busy,perform,t}){
  const [info,setInfo]=useState(null),[format,setFormat]=useState('json'),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  useEffect(()=>{let live=true;window.tugou.settings('mcpConnection').then(value=>{if(live)setInfo(value);}).catch(e=>live&&setError(e.message));return()=>{live=false;};},[]);
  return <section className="settings-mcp-config" aria-label={t('connectionInfo')}>
    <header><div><h2>{t('connectionInfo')}</h2><p>{t('stdioHint')}</p></div><span className="settings-protocol">stdio</span></header>
    {error&&<p role="alert" className="settings-error">{error}</p>}
    <div className="settings-config-toolbar"><Select aria-label={t('configFormat')} value={format} onChange={e=>{setFormat(e.target.value);setCopied(false);}}><option value="json">{t('genericJson')}</option><option value="vscode">VS Code · JSON</option><option value="codex">Codex · TOML</option></Select><Button icon="copy" disabled={busy||!info} onClick={()=>perform(async()=>{await window.tugou.copyText(info.formats[format]);setCopied(true);})}>{t(copied?'copied':'copyConnection')}</Button></div>
    <pre className="settings-config-code" tabIndex={0} aria-label={t('configPreview')}>{info?.formats[format]||t('loadingConfig')}</pre>
    {info&&<details className="settings-connection-fields"><summary>{t('manualConnection')}</summary><dl><dt>{t('command')}</dt><dd>{info.command}</dd><dt>{t('arguments')}</dt><dd>{JSON.stringify(info.args,null,2)}</dd><dt>{t('environment')}</dt><dd>ELECTRON_RUN_AS_NODE=1</dd></dl></details>}
    <p className="settings-config-hint">{t('stdioUsage')}</p>
  </section>;
}
