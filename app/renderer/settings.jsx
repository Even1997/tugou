import React,{useEffect,useState} from 'react';
import {Button,Icon,FormDialog,Input} from './components.jsx';
import {Select} from './select.jsx';
import {usePreferences} from './preferences.jsx';
import {languages} from './settings-messages.js';
import {SettingsModelDefaults,McpConnectionInfo} from './settings-connections.jsx';
import {SettingsShortcuts} from './settings-shortcuts.jsx';
import {definitions} from '../core/shortcuts.cjs';
import './settings.css';
const tabs=[['general','settings'],['appearance','style'],['storage','open'],['models','model'],['mcp','transform'],['shortcuts','text'],['updates','sync']];
const keys={general:['language','followSystemLanguage','restoreProject','confirmClose','notifyTasks','sounds'],appearance:['theme','zoom','grid'],storage:['dataDir','cache','backup'],models:['image','analysis','text'],mcp:['mcpEnabled','copyConfig'],shortcuts:Object.keys(definitions),updates:['autoCheck','autoDownload','check','download','install']};
export function SettingsWorkspace({openModels,modelsOpen}){
  const {value,save,status,error,ready,t,locale,update,setUpdate}=usePreferences();
  const [tab,setTab]=useState('general'),[query,setQuery]=useState(''),[info,setInfo]=useState(null),[storage,setStorage]=useState(null),[models,setModels]=useState(null),[mcp,setMcp]=useState(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(null);
  const perform=async action=>{setBusy(true);setFailure('');setNotice('');try{await action();}catch(e){setFailure(t(e.message)||e.message);}finally{setBusy(false);}};
  const patch=p=>perform(()=>save(p));
  useEffect(()=>{let live=true;Promise.all([window.tugou.settings('get'),window.tugou.update('status')]).then(([i,u])=>{if(live){setInfo(i);setUpdate(u);}}).catch(e=>live&&setFailure(e.message));return()=>{live=false;};},[]);
  useEffect(()=>{let live=true;const request=tab==='storage'?window.tugou.settings('storage'):tab==='models'?window.tugou.listSuppliers():tab==='mcp'?window.tugou.settings('mcpStatus'):null;request?.then(result=>{if(!live)return;if(tab==='storage')setStorage(result);if(tab==='models')setModels(result);if(tab==='mcp')setMcp(result);}).catch(e=>live&&setFailure(e.message));return()=>{live=false;};},[tab,modelsOpen]);
  const toggle=(key,hint)=> <Row label={t(key)} hint={hint&&t(hint)}><button className="settings-switch" role="switch" aria-label={t(key)} aria-checked={value[key]} disabled={busy||!ready} onClick={()=>patch({[key]:!value[key]})}><span/></button></Row>;
  const dropdown=(key,options,hint,disabled=false)=><Row label={t(key)} hint={hint&&t(hint)}><Select aria-label={t(key)} value={value[key]} disabled={busy||disabled||!ready} onChange={e=>patch({[key]:key==='zoom'?Number(e.target.value):e.target.value})}>{options.map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></Row>;
  const filtered=tabs.filter(([id])=>[id,t(id),...keys[id].map(t)].join(' ').toLowerCase().includes(query.toLowerCase()));
  const open=id=>{setTab(id);setFailure('');setNotice('');};
  const current=update||{status:'idle'};
  const manualDmg=current.installMode==='dmg';
  const checkUpdate=action=>perform(async()=>setUpdate(await window.tugou.update(action)));
  return <div className="settings-workspace">
    <aside className="settings-nav"><h1>{t('settings')}</h1><div className="settings-search"><Icon name="search"/><Input aria-label={t('searchSettings')} placeholder={t('searchSettings')} value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <nav aria-label={t('settings')}>{filtered.map(([id,icon])=><Button key={id} icon={icon} aria-current={tab===id?'page':undefined} onClick={()=>open(id)} data-settings-tab={id}>{t(id)}</Button>)}{!filtered.length&&<p>{t('noResults')}</p>}</nav>
      <footer><span className={status==='saveFailed'?'settings-error':''}>{t(status)}</span><small>Tugou {info?.version||''}</small></footer>
    </aside>
    <section className="settings-content" aria-label={t(tab)}><header><div><h1>{t(tab)}</h1><p>{t(tab+'Desc')}</p></div><span className="settings-save">{t(busy&&tab!=='updates'?'saving':status)}</span></header>
      {(failure||error)&&<div role="alert" className="settings-error">{failure||t('saveFailed')}</div>}{notice&&<p role="status" className="settings-success">{t(notice)}</p>}
      {tab==='general'&&<>
        {dropdown('language',Object.entries(languages),'languageHint',value.followSystemLanguage)}{toggle('followSystemLanguage')}
        <div className="settings-section-gap"/>{toggle('restoreProject','restoreHint')}{toggle('confirmClose','confirmHint')}{toggle('notifyTasks')}{toggle('sounds')}
      </>}
      {tab==='appearance'&&<><Row label={t('theme')}><div className="settings-themes">{['dark','light','system'].map(theme=><button key={theme} aria-label={t(theme)} aria-pressed={value.theme===theme} disabled={busy} onClick={()=>patch({theme})}><span className={'theme-sample theme-'+theme}><i/><i/></span>{t(theme)}{value.theme===theme&&<Icon name="check"/>}</button>)}</div></Row>{dropdown('zoom',[80,90,100,110,125].map(v=>[v,v+'%']))}{dropdown('grid',['dots','lines','none'].map(id=>[id,t(id)]),'gridHint')}</>}
      {tab==='storage'&&<><div className="settings-storage-summary"><Icon name="open"/><div><span>{t('projects')}</span><strong>{storage?bytes(storage.bytes):'—'}</strong></div><div><span>{t('cache')}</span><strong>{storage?bytes(storage.cacheBytes):'—'}</strong></div></div><Row label={t('dataDir')} hint={storage?.dataDir||info?.dataDir}><Button icon="open" disabled={busy} onClick={()=>perform(()=>window.tugou.settings('openFolder'))}>{t('openFolder')}</Button></Row><Row label={t('cache')} hint={t('cacheHint')}><Button disabled={busy} onClick={()=>setConfirm('cache')}>{t('clearCache')}</Button></Row><Row label={t('backup')} hint={t('backupHint')}><Icon name="check"/></Row><Row label={t('exportHint')}><Icon name="check"/></Row></>}
      {tab==='models'&&<><div className="settings-feature"><Icon name="model"/><div><h2>{t('models')}</h2><p>{t('modelHint')}</p></div><Button primary disabled={busy} onClick={openModels}>{t('manageModels')}</Button></div><SettingsModelDefaults models={models} setModels={setModels} busy={busy} perform={perform} t={t}/></>}
      {tab==='mcp'&&<><div className="settings-feature"><Icon name="transform"/><div><h2>{t(mcp?.enabled?'connected':'disabled')}</h2><p>{t('mcpSafety')}</p></div><span className={'settings-dot '+(mcp?.enabled?'active':'')}/></div><Row label={t('mcpEnabled')} hint={t('mcpHint')}><button className="settings-switch" role="switch" aria-label={t('mcpEnabled')} aria-checked={!!mcp?.enabled} disabled={busy||!mcp} onClick={()=>perform(async()=>setMcp(await window.tugou.settings('mcpEnable',!mcp.enabled)))}><span/></button></Row><McpConnectionInfo busy={busy} perform={perform} t={t}/></>}
      {tab==='shortcuts'&&<SettingsShortcuts/>}
      {tab==='updates'&&<>
        <div className="settings-version"><img src="brand/logo.png" alt=""/><div><h2>土狗 <span>Tugou</span></h2><p>v{current.currentVersion||info?.version} · {info?.platform==='darwin'?'macOS':'Windows'} {info?.arch}</p></div><Button disabled={busy||!current.supported||['checking','downloading','ready','installing'].includes(current.status)} onClick={()=>checkUpdate('check')} icon={current.status==='checking'?'loading':'sync'}>{t('check')}</Button></div>
        <div className={'settings-update-status status-'+current.status} role="status"><Icon name={current.status==='error'?'info':current.status==='latest'?'check':current.status==='ready'?'download':'sync'}/><div><strong>{t(manualDmg&&current.status==='ready'?'dmgReady':current.status)}{current.version?' · v'+current.version:''}</strong><p>{current.status==='portable'?t('portableHint'):current.error?t(current.error):current.status==='ready'?t(manualDmg?'dmgInstallHint':'installHint'):''}</p>{current.status==='downloading'&&<><progress aria-label={t('downloading')} value={current.percent||0} max="100"/><small>{Math.round(current.percent||0)}% · {bytes(current.transferred||0)} / {bytes(current.total||0)}</small></>}{current.blocked&&<p className="settings-error">{t(current.blocked)}</p>}</div>
          {current.status==='available'&&<Button primary disabled={busy} onClick={()=>checkUpdate('download')}>{t(manualDmg?'downloadDmg':'download')}</Button>}{current.status==='ready'&&<Button primary disabled={busy} onClick={()=>manualDmg?checkUpdate('openInstaller'):setConfirm('install')}>{t(manualDmg?'openInstaller':'install')}</Button>}
        </div>
        {manualDmg&&current.status!=='ready'&&<p>{t('dmgUpdateHint')}</p>}
        {toggle('autoCheck','autoCheckHint')}{toggle('autoDownload','autoDownloadHint')}
        <Row label={t('lastCheck')}><span>{current.lastChecked?new Date(current.lastChecked).toLocaleString(locale):t('never')}</span></Row>
        {current.notes&&<details className="settings-notes"><summary>{t('releaseNotes')}</summary><pre>{current.notes}</pre></details>}
        <div className="settings-links"><Button icon="export" onClick={()=>perform(()=>window.tugou.settings('releasePage'))}>{t('releases')}</Button><Button onClick={()=>perform(()=>window.tugou.settings('sourcePage'))}>{t('source')}</Button><span>Apache-2.0</span></div>
      </>}
    </section>
    {confirm&&<FormDialog title={t(confirm==='cache'?'clearConfirm':'installConfirm')} close={()=>!busy&&setConfirm(null)}><p>{t(confirm==='cache'?'cacheHint':'installHint')}</p><div className="dialog-footer"><Button disabled={busy} onClick={()=>setConfirm(null)}>{t('cancel')}</Button><Button primary disabled={busy} onClick={()=>{const action=confirm;setConfirm(null);perform(async()=>{if(action==='cache'){await window.tugou.settings('clearCache');setStorage(await window.tugou.settings('storage'));setNotice('cacheDone');}else setUpdate(await window.tugou.update('install'));});}}>{t(confirm==='cache'?'clearCache':'install')}</Button></div></FormDialog>}
  </div>;
}
function Row({label,hint,children}){return <div className="settings-row"><div className="settings-row-copy"><h2>{label}</h2>{hint&&<p>{hint}</p>}</div><div className="settings-row-control">{children}</div></div>;}
function bytes(value){return value<1024*1024?`${Math.round(value/1024)} KB`:`${(value/1024/1024).toFixed(1)} MB`;}
