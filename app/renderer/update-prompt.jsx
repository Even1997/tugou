import React,{useEffect,useRef,useState} from 'react';
import {Button,FormDialog} from './components.jsx';
import {usePreferences} from './preferences.jsx';
import './update-prompt.css';

const reminderKey='tugou.update-reminder';
function readReminder(){try{return JSON.parse(localStorage.getItem(reminderKey))||{};}catch{return {};}}
export function UpdatePrompt(){
  const {update,setUpdate,t,updatePromptRequest}=usePreferences();
  const [opened,setOpened]=useState(null),[reminder,setReminder]=useState(readReminder),[busy,setBusy]=useState(false),[failure,setFailure]=useState(''),[confirm,setConfirm]=useState(false);
  const handledRequest=useRef(0);
  const current=update||{},phase=current.status==='ready'?'ready':'available';
  const eligible=current.supported&&current.version&&['available','downloading','ready'].includes(current.status);
  useEffect(()=>{
    if(opened){handledRequest.current=updatePromptRequest;return;}
    if(!eligible)return;
    const requested=updatePromptRequest!==handledRequest.current;
    if(!requested&&reminder.version===current.version&&reminder[phase]>Date.now())return;
    let idleSince=Date.now(),dragging=false;
    const activity=()=>{idleSince=Date.now();};
    const down=()=>{dragging=true;activity();},up=()=>{dragging=false;activity();};
    const move=e=>{dragging=!!e.buttons;if(dragging)activity();};
    document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);
    document.addEventListener('keydown',activity,true);document.addEventListener('wheel',activity,true);window.addEventListener('blur',up);
    document.addEventListener('pointermove',move,true);
    const timer=setInterval(()=>{
      const editing=document.activeElement?.matches('input,textarea,[contenteditable="true"],[role="textbox"]');
      const overlay=[...document.querySelectorAll('[role="dialog"],[role="listbox"],.ant-popover')].some(el=>el.getClientRects().length);
      if(dragging||editing||overlay||Date.now()-idleSince<1200)return;
      handledRequest.current=updatePromptRequest;setFailure('');setConfirm(false);setOpened({version:current.version});
    },400);
    return()=>{clearInterval(timer);document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);document.removeEventListener('keydown',activity,true);document.removeEventListener('wheel',activity,true);document.removeEventListener('pointermove',move,true);window.removeEventListener('blur',up);};
  },[opened,eligible,current.version,phase,reminder,updatePromptRequest]);
  useEffect(()=>{if(['latest','portable'].includes(current.status))setOpened(null);},[current.status]);
  function close(){
    const next={...(reminder.version===opened.version?reminder:{}),version:opened.version,[phase]:Date.now()+86400000};
    try{localStorage.setItem(reminderKey,JSON.stringify(next));}catch{/* Session reminder still works when storage is unavailable. */}
    setReminder(next);setOpened(null);setConfirm(false);
  }
  async function act(action){
    setBusy(true);setFailure('');setConfirm(false);
    try{setUpdate(await window.tugou.update(action));}catch{setFailure('updateFailed');}finally{setBusy(false);}
  }
  if(!opened)return null;
  const dmg=current.installMode==='dmg',downloading=current.status==='downloading',ready=current.status==='ready';
  const locked=busy&&(!downloading||confirm);
  return <FormDialog title={t(confirm?'installConfirm':ready?'updateReadyTitle':'updateFoundTitle')} className="update-prompt" close={()=>!locked&&close()}>
    <div className="update-prompt-version"><img src="brand/logo.png" alt=""/><div><strong>土狗 · v{current.version||opened.version}</strong><span>v{current.currentVersion} → v{current.version||opened.version}</span></div></div>
    {confirm?<p>{t('installHint')}</p>:<>
      <div className="update-prompt-notes"><strong>{t('releaseNotes')}</strong><pre>{current.notes||t('updateNoNotes')}</pre></div>
      {dmg&&<p className="muted">{t(ready?'dmgInstallHint':'dmgUpdateHint')}</p>}
      {downloading&&<div className="update-prompt-progress" role="status"><span>{t('downloading')} · {Math.floor(current.percent||0)}%</span><progress aria-label={t('downloading')} max="100" value={current.percent||0}/></div>}
      {!downloading&&!ready&&<p className="muted">{t('updateLaterHint')}</p>}
    </>}
    {(failure||current.error||current.blocked)&&<p className="update-prompt-error" role="alert">{t(failure||current.error||current.blocked)}</p>}
    <div className="dialog-footer">
      <Button disabled={locked} onClick={()=>confirm?setConfirm(false):close()}>{t(confirm?'cancel':downloading?'updateBackground':'updateLater')}</Button>
      {current.status==='available'&&<Button primary disabled={busy} onClick={()=>act('download')}>{t(dmg?'downloadDmg':'download')}</Button>}
      {ready&&<Button primary disabled={busy} onClick={()=>dmg?act('openInstaller'):confirm?act('install'):setConfirm(true)}>{t(dmg?'openInstaller':'install')}</Button>}
      {current.status==='error'&&<Button primary disabled={busy} onClick={()=>act('check')}>{t('check')}</Button>}
    </div>
  </FormDialog>;
}
