import React,{useEffect,useState} from 'react';
import {Button,Icon,FormDialog,Input} from './components.jsx';
import {Select} from './select.jsx';
import {usePreferences} from './preferences.jsx';
import {languages} from './settings-messages.js';
import {SettingsModelDefaults,McpConnectionInfo} from './settings-connections.jsx';
import {SettingsShortcuts} from './settings-shortcuts.jsx';
import GithubOutlined from '@ant-design/icons/GithubOutlined';
import HeartOutlined from '@ant-design/icons/HeartOutlined';
import {ReleaseNotes} from './release-notes.jsx';
import {definitions} from '../core/shortcuts.cjs';
import './settings.css';
import {useUiView} from './ui-view.js';
const tabs=[['general','settings'],['appearance','style'],['canvas','canvas'],['shortcuts','text'],['notifications','tasks'],['models','model'],['mcp','connect'],['storage','open'],['updates','sync'],['about','info']];
const groups=[['workHabits',['general','appearance','canvas','shortcuts']],['connectionsGroup',['notifications','models','mcp']],['applicationGroup',['storage','updates','about']]];
const keys={general:['language','followSystemLanguage','restoreProject','startupWorkspace'],appearance:['theme','zoom','reduceMotion'],canvas:['grid','canvasGridSize','canvasSnap','canvasWheel','canvasMinimap'],notifications:['notifyTasks','sounds'],storage:['dataDir','cache','backup'],models:['image','analysis','text','imageConcurrency'],mcp:['mcpEnabled','copyConfig'],shortcuts:Object.keys(definitions),updates:['autoCheck','autoDownload','check','download','install'],about:['currentVersion','platformInfo','license','source']};
export function SettingsWorkspace({openModels,modelsOpen}){
  const {value,save,status,error,ready,t,locale,update,setUpdate,requestUpdatePrompt}=usePreferences();
  const [tab,setTab]=useState('general'),[query,setQuery]=useState(''),[info,setInfo]=useState(null),[storage,setStorage]=useState(null),[models,setModels]=useState(null),[mcp,setMcp]=useState(null),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState(null);
  const perform=async action=>{setBusy(true);setFailure('');setNotice('');try{await action();}catch(e){setFailure(t(e.message)||e.message);}finally{setBusy(false);}};
  const patch=p=>perform(()=>save(p));
  useEffect(()=>{let live=true;Promise.all([window.tugou.settings('get'),window.tugou.update('status')]).then(([i,u])=>{if(live){setInfo(i);setUpdate(u);}}).catch(e=>live&&setFailure(e.message));return()=>{live=false;};},[]);
  useEffect(()=>{let live=true;const request=tab==='storage'?window.tugou.settings('storage'):tab==='models'?window.tugou.listSuppliers():tab==='mcp'?window.tugou.settings('mcpStatus'):null;request?.then(result=>{if(!live)return;if(tab==='storage')setStorage(result);if(tab==='models')setModels(result);if(tab==='mcp')setMcp(result);}).catch(e=>live&&setFailure(e.message));return()=>{live=false;};},[tab,modelsOpen]);
  const toggle=(key,hint,disabled=false)=> <Row label={t(key)} hint={hint&&t(hint)}><button className="settings-switch" role="switch" aria-label={t(key)} aria-checked={value[key]} disabled={busy||!ready||disabled} onClick={()=>patch({[key]:!value[key]})}><span/></button></Row>;
  const dropdown=(key,options,hint,disabled=false)=><Row label={t(key)} hint={hint&&t(hint)}><Select aria-label={t(key)} value={value[key]} disabled={busy||disabled||!ready} onChange={e=>patch({[key]:['zoom','imageConcurrency','canvasGridSize'].includes(key)?Number(e.target.value):e.target.value})}>{options.map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select></Row>;
  const filtered=tabs.filter(([id])=>[id,t(id),...keys[id].map(t)].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(()=>{if(query.trim()&&filtered.length&&!filtered.some(([id])=>id===tab))setTab(filtered[0][0]);},[query,tab,locale]);
  const open=id=>{setTab(id);setFailure('');setNotice('');};
  useUiView('settings',{get:()=>({tab,query}),restore:v=>{setTab(v.tab);setQuery(v.query);},navigate:a=>{setQuery('');open(a.settingsTab);},blocked:()=>busy?'设置正在保存，请稍后导航':null});
  const current=update||{status:'idle'};
  const manualDmg=current.installMode==='dmg';
  const checkUpdate=action=>perform(async()=>{const next=await window.tugou.update(action);setUpdate(next);if(action==='check'&&['available','downloading','ready'].includes(next.status))requestUpdatePrompt();});
  return <div className="settings-workspace">
    <aside className="settings-nav"><h1>{t('settings')}</h1><div className="settings-search"><Icon name="search"/><Input aria-label={t('searchSettings')} placeholder={t('searchSettings')} value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <nav aria-label={t('settings')}>{groups.map(([label,ids])=>{const items=filtered.filter(([id])=>ids.includes(id));return items.length?<div className="settings-nav-group" key={label}><span>{t(label)}</span>{items.map(([id,icon])=><Button key={id} icon={icon} aria-current={tab===id?'page':undefined} onClick={()=>open(id)} data-settings-tab={id}>{t(id)}</Button>)}</div>:null})}{!filtered.length&&<p>{t('noResults')}</p>}</nav>
      <footer><span className={status==='saveFailed'?'settings-error':''}>{t(status)}</span><small>Tugou {info?.version||''}</small></footer>
    </aside>
    <section className="settings-content" aria-label={t(tab)}><div className="settings-content-inner"><header><div><h1>{t(tab)}</h1><p>{t(tab+'Desc')}</p></div><span className="settings-save">{t(busy&&tab!=='updates'?'saving':status)}</span></header>
      {(failure||error)&&<div role="alert" className="settings-error">{failure||t('saveFailed')}</div>}{notice&&<p role="status" className="settings-success">{t(notice)}</p>}
      {tab==='general'&&<>
        <Group icon="text" title={t('languageGroup')}>{dropdown('language',Object.entries(languages),'languageHint',value.followSystemLanguage)}{toggle('followSystemLanguage')}</Group>
        <Group icon="home" title={t('startupGroup')}>{toggle('restoreProject','restoreHint')}{dropdown('startupWorkspace',['home','canvas','layers','prompts'].map(id=>[id,t(id)]),'startupWorkspaceHint',!value.restoreProject)}</Group>
      </>}
      {tab==='notifications'&&<Group icon="tasks" title={t('notificationGroup')}>{toggle('notifyTasks')}{toggle('sounds','soundsHint',!value.notifyTasks)}</Group>}
      {tab==='canvas'&&<><Group icon="canvas" title={t('canvasGridGroup')}>{dropdown('grid',['dots','lines','none'].map(id=>[id,t(id)]),'gridHint')}{dropdown('canvasGridSize',[16,24,32,48,64].map(v=>[v,v+' px']))}</Group><Group icon="action" title={t('canvasInteractionGroup')}>{toggle('canvasSnap','canvasSnapHint')}{dropdown('canvasWheel',[['zoom',t('wheelZoom')],['pan',t('wheelPan')]],'canvasWheelHint')}{toggle('canvasMinimap','canvasMinimapHint')}</Group></>}

      {tab==='appearance'&&<Group icon="style" title={t('displayGroup')}><Row className="settings-theme-row" label={t('theme')}><div className="settings-themes">{['dark','light','system'].map(theme=><button key={theme} aria-label={t(theme)} aria-pressed={value.theme===theme} disabled={busy} onClick={()=>patch({theme})}><span className={'theme-sample theme-'+theme}><i/><i/></span>{t(theme)}{value.theme===theme&&<Icon name="check"/>}</button>)}</div></Row>{dropdown('zoom',[80,90,100,110,125].map(v=>[v,v+'%']))}{toggle('reduceMotion','reduceMotionHint')}</Group>}
      {tab==='storage'&&<Group icon="open" title={t('storageGroup')}><div className="settings-storage-summary"><Icon name="open"/><div><span>{t('projects')}</span><strong>{storage?bytes(storage.bytes):'—'}</strong></div><div><span>{t('cache')}</span><strong>{storage?bytes(storage.cacheBytes):'—'}</strong></div></div><Row label={t('dataDir')} hint={storage?.dataDir||info?.dataDir}><Button icon="open" disabled={busy} onClick={()=>perform(()=>window.tugou.settings('openFolder'))}>{t('openFolder')}</Button></Row><Row label={t('cache')} hint={t('cacheHint')}><Button disabled={busy} onClick={()=>setConfirm('cache')}>{t('clearCache')}</Button></Row><Row label={t('backup')} hint={t('backupHint')}><Icon name="check"/></Row><Row label={t('exportHint')}><Icon name="check"/></Row></Group>}
      {tab==='models'&&<><div className="settings-feature"><Icon name="model"/><div><h2>{t('models')}</h2><p>{t('modelHint')}</p></div><Button primary disabled={busy} onClick={openModels}>{t('manageModels')}</Button></div><Group icon="model" title={t('generationGroup')}>{dropdown('imageConcurrency',Array.from({length:32},(_,i)=>[i+1,String(i+1)]),'imageConcurrencyHint')}<SettingsModelDefaults models={models} setModels={setModels} busy={busy} perform={perform} t={t}/></Group></>}
      {tab==='mcp'&&<><div className="settings-service-card"><div className="settings-feature"><Icon name="connect"/><div><h2>{t(mcp?.enabled?'connected':'disabled')}</h2><p>{t('mcpSafety')}</p></div><span className={'settings-dot '+(mcp?.enabled?'active':'')}/></div><Row label={t('mcpEnabled')} hint={t('mcpHint')}><button className="settings-switch" role="switch" aria-label={t('mcpEnabled')} aria-checked={!!mcp?.enabled} disabled={busy||!mcp} onClick={()=>perform(async()=>setMcp(await window.tugou.settings('mcpEnable',!mcp.enabled)))}><span/></button></Row></div><McpConnectionInfo busy={busy} perform={perform} t={t}/></>}
      {tab==='shortcuts'&&<SettingsShortcuts/>}
      {tab==='updates'&&<>
        <div className="settings-version-card">
        <div className="settings-support"><span><HeartOutlined aria-hidden="true"/>{t('githubSupportHint')}</span><Button icon={<GithubOutlined />} disabled={busy} onClick={()=>perform(()=>window.tugou.settings('sourcePage'))}>{t('githubStar')}</Button></div>
        <div className="settings-version"><div><h2>{t('currentVersion')}</h2><p>v{current.currentVersion||info?.version} · {info?.platform==='darwin'?'macOS':'Windows'} {info?.arch}</p></div><Button disabled={busy||!current.supported||['checking','downloading','ready','installing'].includes(current.status)} onClick={()=>checkUpdate('check')} icon={current.status==='checking'?'loading':'sync'}>{t('check')}</Button></div>
        </div>
        <div className={'settings-update-status status-'+current.status} role="status"><Icon name={current.status==='error'?'info':current.status==='latest'?'check':current.status==='ready'?'download':'sync'}/><div><strong>{t(manualDmg&&current.status==='ready'?'dmgReady':current.status)}{current.version?' · v'+current.version:''}</strong><p>{current.status==='portable'?t('portableHint'):current.error?t(current.error):current.status==='ready'?t(manualDmg?'dmgInstallHint':'installHint'):''}</p>{current.status==='downloading'&&<><progress aria-label={t('downloading')} value={current.percent||0} max="100"/><small>{Math.round(current.percent||0)}% · {bytes(current.transferred||0)} / {bytes(current.total||0)}</small></>}{current.blocked&&<p className="settings-error">{t(current.blocked)}</p>}</div>
          {current.status==='available'&&<Button primary disabled={busy} onClick={()=>checkUpdate('download')}>{t(manualDmg?'downloadDmg':'download')}</Button>}{current.status==='ready'&&<Button primary disabled={busy} onClick={()=>manualDmg?checkUpdate('openInstaller'):setConfirm('install')}>{t(manualDmg?'openInstaller':'install')}</Button>}
        </div>
        {manualDmg&&current.status!=='ready'&&<p>{t('dmgUpdateHint')}</p>}
        <Group icon="sync" title={t('updatePolicyGroup')}>{toggle('autoCheck','autoCheckHint')}{toggle('autoDownload','autoDownloadHint')}
        <Row label={t('lastCheck')}><span>{current.lastChecked?new Date(current.lastChecked).toLocaleString(locale):t('never')}</span></Row></Group>
        {current.notes&&<details className="settings-notes"><summary>{t('releaseNotes')}</summary><ReleaseNotes text={current.notes} onLink={url=>perform(()=>window.tugou.settings('releaseLink',url))}/></details>}
        <div className="settings-links"><Button icon="export" onClick={()=>perform(()=>window.tugou.settings('releasePage'))}>{t('releases')}</Button></div>
      </>}
      {tab==='about'&&<>
        <div className="settings-about"><img src="brand/logo.png" alt=""/><div><h2>土狗 <span>Tugou</span></h2><p>{t('aboutTagline')}</p></div></div>
        <Group icon="info" title={t('productInfo')}><Row label={t('currentVersion')}><span>v{info?.version||'—'}</span></Row><Row label={t('platformInfo')}><span>{info?.platform==='darwin'?'macOS':info?.platform==='win32'?'Windows':info?.platform||'—'} · {info?.arch||'—'}</span></Row><Row label={t('license')}><span>Apache-2.0</span></Row></Group>
        <div className="settings-links"><Button icon="export" onClick={()=>perform(()=>window.tugou.settings('sourcePage'))}>{t('source')}</Button><Button icon="sync" onClick={()=>open('updates')}>{t('goToUpdates')}</Button></div>
      </>}
      </div></section>
    {confirm&&<FormDialog title={t(confirm==='cache'?'clearConfirm':'installConfirm')} close={()=>!busy&&setConfirm(null)}><p>{t(confirm==='cache'?'cacheHint':'installHint')}</p><div className="dialog-footer"><Button disabled={busy} onClick={()=>setConfirm(null)}>{t('cancel')}</Button><Button primary disabled={busy} onClick={()=>{const action=confirm;setConfirm(null);perform(async()=>{if(action==='cache'){await window.tugou.settings('clearCache');setStorage(await window.tugou.settings('storage'));setNotice('cacheDone');}else setUpdate(await window.tugou.update('install'));});}}>{t(confirm==='cache'?'clearCache':'install')}</Button></div></FormDialog>}
  </div>;
}
function Group({title,icon,children}){return <section className="settings-group"><h2>{icon&&<Icon name={icon}/>}<span>{title}</span></h2><div className="settings-group-body">{children}</div></section>;}
function Row({label,hint,children,className=''}){return <div className={'settings-row '+className}><div className="settings-row-copy"><h2>{label}</h2>{hint&&<p>{hint}</p>}</div><div className="settings-row-control">{children}</div></div>;}
function bytes(value){return value<1024*1024?`${Math.round(value/1024)} KB`:`${(value/1024/1024).toFixed(1)} MB`;}
