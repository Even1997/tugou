import React,{createContext,useContext,useEffect,useState,useCallback} from 'react';
import {defaults,languageFor} from '../core/preference-values.cjs';
import {messages} from './settings-messages.js';
const Context=createContext(null);
export const usePreferences=()=>useContext(Context);
export function PreferencesProvider({children}){
  const [value,setValue]=useState(defaults),[systemLocale,setSystemLocale]=useState(navigator.language),[ready,setReady]=useState(false),[status,setStatus]=useState('saved'),[error,setError]=useState('');
  const [update,setUpdate]=useState(null);
  const [updatePromptRequest,setUpdatePromptRequest]=useState(0);
  const requestUpdatePrompt=useCallback(()=>setUpdatePromptRequest(n=>n+1),[]);
  useEffect(()=>{let live=true;const stop=window.tugou.onUpdate(setUpdate);window.tugou.update('status').then(state=>{if(live)setUpdate(state);}).catch(()=>{});return()=>{live=false;stop();};},[]);
  useEffect(()=>{let live=true;window.tugou.settings('get').then(data=>{if(live){setValue(data.preferences);setSystemLocale(data.locale);setReady(true);}}).catch(e=>{if(live){setError(e.message);setReady(true);}});return()=>{live=false;};},[]);
  const save=useCallback(async patch=>{setStatus('saving');setError('');try{const next=await window.tugou.settings('save',patch);setValue(next);setStatus('saved');return next;}catch(e){setStatus('saveFailed');setError(e.message);throw e;}},[]);
  const locale=languageFor(value,systemLocale),t=useCallback(key=>messages[locale][key]||key,[locale]);
  useEffect(()=>{document.documentElement.lang=locale;},[locale]);
  return <Context.Provider value={{value,save,ready,status,error,locale,t,update,setUpdate,updatePromptRequest,requestUpdatePrompt}}>{children}</Context.Provider>;
}
