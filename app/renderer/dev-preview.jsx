import React,{useEffect,useRef,useState} from 'react';
import './dev-preview.css';
export function useDevPreview({enabled,initial,getSnapshot,blockReason,freeze}){
  const latest=useRef({getSnapshot,blockReason,freeze});latest.current={getSnapshot,blockReason,freeze};
  const [status,setStatus]=useState(null),[waiting,setWaiting]=useState('');
  useEffect(()=>{
    if(!enabled)return;
    let live=true,state=null,applying=false,pointer=false,lastInput=Date.now();
    const receive=next=>{state=next;if(live){setStatus(next);setWaiting('');}};
    const activity=()=>{lastInput=Date.now();},down=()=>{pointer=true;activity();},up=()=>{pointer=false;activity();};
    window.addEventListener('pointerdown',down,true);window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',up,true);window.addEventListener('blur',up);window.addEventListener('keydown',activity,true);window.addEventListener('input',activity,true);
    const stop=window.tugou.onDevUpdate(receive);window.tugou.devPreview('status').then(receive).catch(()=>{});
    window.tugou.devPreview('ready').catch(()=>{});
    const timer=setInterval(async()=>{
      if(!live||applying||state?.status!=='pending')return;
      if(pointer||Date.now()-lastInput<700)return;
      let reason='';
      if(!state.css){
        reason=latest.current.blockReason();
        if(!reason)reason=document.querySelector('[data-dev-update-blocked]')?.dataset.devUpdateBlocked||'';
        if(!reason&&document.activeElement?.matches('input,textarea,[contenteditable="true"],[role="combobox"]'))reason='正在输入，离开输入框后自动更新';
        if(!reason&&[...document.querySelectorAll('[role="dialog"],.ant-dropdown,.ant-popover,.shape-picker[open],.tool-popover[open]')].some(e=>e.getClientRects().length))reason='请先完成或关闭弹窗，草稿会保持原样';
      }
      if(reason){setWaiting(reason);return;}
      applying=true;const frozen=!state.css;if(frozen){document.body.inert=true;latest.current.freeze(true);}
      try{
        const snapshot=state.css?null:{version:1,...latest.current.getSnapshot(),ui:{settingsTab:document.querySelector('[data-settings-tab][aria-current]')?.dataset.settingsTab,palette:[...document.querySelectorAll('.palette-tabs button')].findIndex(e=>e.getAttribute('aria-pressed')==='true'),scroll:[...document.querySelectorAll('.settings-content,.canvas-palette,.canvas-inspector')].map(e=>({className:e.className,top:e.scrollTop,left:e.scrollLeft}))}};
        const result=await window.tugou.devPreview('apply',{version:state.version,snapshot});
        if(!result.applied){setWaiting('等待任务或当前操作完成');return;}
        if(result.css){
          const link=document.querySelector('link[rel="stylesheet"][href*="ui.css"]');
          if(link){const url=new URL(link.href);url.searchParams.set('dev',String(result.version));link.href=url.href;}
        }
      }catch(error){setWaiting(error.message);state=null;}
      finally{if(live){if(frozen){document.body.inert=false;latest.current.freeze(false);}applying=false;}}
    },350);
    // Restore view-only UI after the document and undo stacks have been restored by App.
    const restore=setTimeout(()=>{
      const ui=initial?.ui;if(!ui)return;
      if(ui.settingsTab)document.querySelector(`[data-settings-tab="${CSS.escape(ui.settingsTab)}"]`)?.click();
      if(ui.palette>=0)document.querySelectorAll('.palette-tabs button')[ui.palette]?.click();
      for(const item of ui.scroll||[]){const e=document.getElementsByClassName(item.className)[0];if(e){e.scrollTop=item.top;e.scrollLeft=item.left;}}
    },150);
    return()=>{live=false;stop();clearInterval(timer);clearTimeout(restore);window.removeEventListener('pointerdown',down,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',up,true);window.removeEventListener('blur',up);window.removeEventListener('keydown',activity,true);window.removeEventListener('input',activity,true);document.body.inert=false;};
  },[enabled]);
  return enabled?<div className={`dev-preview-notice dev-${status?.status||'ready'}`} role="status"><span>开发预览</span><span>{waiting||status?.message||(status?.status==='building'?'正在构建界面…':'界面修改会自动更新')}</span>{status?.detail&&<details><summary>构建错误</summary><pre>{status.detail}</pre></details>}</div>:null;
}
