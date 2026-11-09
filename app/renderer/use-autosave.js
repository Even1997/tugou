import {useEffect,useRef,useState} from 'react';
import {createAutosave} from '../core/autosave.cjs';

export function useAutosave(context){
  const latest=useRef(context);latest.current=context;
  const [state,setState]=useState('saved'),[error,setError]=useState('');
  const queue=useRef(null);
  if(!queue.current)queue.current=createAutosave({
    read:()=>latest.current.present.current,
    dirty:()=>latest.current.dirtyRef.current,
    blocked:()=>latest.current.busyRef.current,
    snapshot:()=>latest.current.pageDocument(),
    write:(...args)=>window.tugou.save(...args),
    commit:(saved,unchanged)=>{
      const c=latest.current;
      c.present.current={...saved,document:c.present.current.document};
      c.setRecord(c.present.current);
      if(unchanged)c.markDirty(false);
      c.setProjects(list=>list.map(p=>p.id===saved.id?{...p,name:saved.document.name,revision:saved.revision,updatedAt:saved.updatedAt,recovered:false}:p));
    },
    status:(next,message='')=>{setState(next);setError(message);},
  });
  useEffect(()=>{
    if(latest.current.dirtyRef.current)queue.current.changed();
    return()=>queue.current.dispose();
  },[]);
  return {queue:queue.current,state,error,clearError:()=>setError('')};
}
