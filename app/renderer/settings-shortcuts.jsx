import React,{useEffect,useRef,useState} from 'react';
import {Button,FormDialog,Input} from './components.jsx';
import {usePreferences} from './preferences.jsx';
import {definitions,bindings,eventBinding,bindingError,formatBinding} from '../core/shortcuts.cjs';

export function SettingsShortcuts(){
  const {value,save,t,ready}=usePreferences(),platform=window.tugou.platform==='darwin'?'darwin':'win32';
  const [editing,setEditing]=useState(null),[candidate,setCandidate]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[capturing,setCapturing]=useState(false);
  const recorder=useRef(null),current=bindings(platform,value.shortcuts),defaults=bindings(platform);
  const explain=code=>code?.startsWith('shortcutConflict:')?`${t('shortcutConflict')} ${t(code.split(':')[1])}`:t(code);
  const apply=async next=>{setBusy(true);setError('');try{await save({shortcuts:{...value.shortcuts,[platform]:next}});setEditing(null);}catch(e){setError(t(e.message)==='INVALID_SHORTCUTS'?t('shortcutInvalid'):t('saveFailed'));}finally{setBusy(false);}};
  useEffect(()=>{
    if(!editing)return;
    let live=true;
    // Native macOS menu accelerators must not steal keys while recording.
    window.tugou.settings('shortcutCapture',true).then(()=>{if(live){setCapturing(true);recorder.current?.focus();}}).catch(()=>live&&setError(t('saveFailed')));
    return()=>{live=false;setCapturing(false);window.tugou.settings('shortcutCapture',false).catch(()=>{});};
  },[editing]);
  const record=e=>{if(e.key==='Tab')return;e.preventDefault();e.stopPropagation();if(e.key==='Escape'){setEditing(null);return;}if(!capturing||busy||e.repeat||e.nativeEvent.isComposing)return;const key=eventBinding(e.nativeEvent);if(!key){if(!['Control','Meta','Alt','Shift'].includes(e.key))setError(t('shortcutInvalid'));return;}setCandidate(key);setError(explain(bindingError(editing,key,platform,value.shortcuts)));};
  const reset=id=>{const next={...value.shortcuts?.[platform]};delete next[id];const problem=bindingError(id,defaults[id],platform,{...value.shortcuts,[platform]:next});if(problem){setError(explain(problem));return;}apply(next);};
  return <div className="settings-shortcuts">
    <div className="shortcut-actions"><p>{platform==='darwin'?'macOS · ⌘ Command / ⌥ Option':'Windows · Ctrl / Alt'} · {t('shortcutPlatformHint')}</p><Button disabled={busy||!ready||!Object.keys(value.shortcuts?.[platform]||{}).length} onClick={()=>apply({})}>{t('shortcutResetAll')}</Button></div>
    {error&&!editing&&<p role="alert" className="settings-error">{error}</p>}
    {Object.keys(definitions).map(id=><div className="settings-row" key={id}><div className="settings-row-copy"><h2>{t(id)}</h2>{id==='pan'&&<p>{t('shortcutPanHint')}</p>}</div><div className="settings-row-control shortcut-row-control"><button className="shortcut-binding" aria-label={`${t('shortcutEdit')} · ${t(id)}`} disabled={busy||!ready} onClick={()=>{setEditing(id);setCandidate(current[id]);setError('');}}><kbd>{formatBinding(current[id],platform)}</kbd></button><Button disabled={busy||current[id]===defaults[id]} onClick={()=>reset(id)}>{t('shortcutReset')}</Button></div></div>)}
    <p className="muted">{t('shortcutFixedHint')}</p>
    {editing&&<FormDialog title={`${t('shortcutEdit')} · ${t(editing)}`} close={()=>!busy&&setEditing(null)}><p>{t('shortcutRecordHint')}</p><Input ref={recorder} autoFocus readOnly className="shortcut-recorder" aria-label={t('shortcutRecord')} value={capturing?formatBinding(candidate,platform):t('saving')} onKeyDown={record}/>{error&&<p role="alert" className="settings-error">{error}</p>}<div className="dialog-footer"><Button disabled={busy} onClick={()=>setEditing(null)}>{t('cancel')}</Button><Button primary disabled={busy||!capturing||!!error||!candidate} onClick={()=>apply({...value.shortcuts?.[platform],[editing]:candidate})}>{t('save')}</Button></div></FormDialog>}
  </div>;
}
