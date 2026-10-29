import {useEffect,useRef} from 'react';
export const views=new Map();
export function useUiView(name,handlers){
  const latest=useRef(handlers);latest.current=handlers;
  useEffect(()=>{const entry={get:()=>latest.current.get(),restore:v=>latest.current.restore(v),navigate:a=>latest.current.navigate?.(a),blocked:()=>latest.current.blocked?.()};views.set(name,entry);return()=>{if(views.get(name)===entry)views.delete(name);};},[name]);
}
