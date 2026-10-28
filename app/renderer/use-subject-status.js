import {useCallback,useEffect,useRef,useState} from 'react';
export function useSubjectStatus(size,enabled){
  const [status,setStatus]=useState({ready:false,reason:'正在检查主体模型…',checking:true}),version=useRef(0);
  const refresh=useCallback(async()=>{
    if(!enabled)return;
    const token=++version.current;setStatus({ready:false,reason:'正在检查主体模型…',checking:true});
    try{const next=await window.tugou.subjectStatus(size);if(token===version.current)setStatus(next);}
    catch(e){if(token===version.current)setStatus({ready:false,reason:e.message});}
  },[size?.width,size?.height,enabled]);
  useEffect(()=>{refresh();window.addEventListener('focus',refresh);return()=>{version.current++;window.removeEventListener('focus',refresh)}},[refresh]);
  return {...status,refresh};
}
