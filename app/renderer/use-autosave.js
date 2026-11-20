import {useEffect,useRef,useState} from 'react';
import {createAutosave} from '../core/autosave.cjs';

export function useAutosave(context){
  const latest=useRef(context);latest.current=context;
  const [state,setState]=useState('saved'),[error,setError]=useState('');
  const queue=useRef(null);
  const input=useRef(null);
  if(!input.current)input.current={pointers:new Set(),dragging:false,scrollUntil:0};
  if(!queue.current)queue.current=createAutosave({
    read:()=>latest.current.present.current,
    dirty:()=>latest.current.dirtyRef.current,
    blocked:()=>latest.current.busyRef.current||input.current.pointers.size>0||input.current.dragging||Date.now()<input.current.scrollUntil,
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
    const active=input.current;
    const reset=()=>{active.pointers.clear();active.dragging=false;active.scrollUntil=0;};
    const release=e=>active.pointers.delete(e.pointerId);
    const handlers={
      pointerdown:e=>active.pointers.add(e.pointerId),
      pointerup:e=>{release(e);active.dragging=false;},
      pointercancel:release,
      pointerout:e=>{if(!e.relatedTarget&&!e.target?.hasPointerCapture?.(e.pointerId))release(e);},
      dragstart:()=>{active.dragging=true;},
      dragend:reset,
      drop:reset,
      wheel:()=>{active.scrollUntil=Date.now()+250;},
    };
    for(const [event,handler] of Object.entries(handlers))window.addEventListener(event,handler,{capture:true,passive:true});
    window.addEventListener('blur',reset);
    if(latest.current.dirtyRef.current)queue.current.changed();
    return()=>{
      for(const [event,handler] of Object.entries(handlers))window.removeEventListener(event,handler,true);
      window.removeEventListener('blur',reset);
      queue.current.dispose();
    };
  },[]);
  return {queue:queue.current,state,error};
}
