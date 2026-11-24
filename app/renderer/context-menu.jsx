import React,{useCallback,useEffect,useState} from 'react';
import {Dropdown} from 'antd';
import {createPortal} from 'react-dom';

export function useContextMenu(){
  const [context,setContext]=useState(null);
  const close=useCallback(()=>setContext(null),[]);
  return {context,close,open:(event,target)=>{
    if(event.defaultPrevented||event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    event.preventDefault();event.stopPropagation();
    const anchor=event.target.closest('button,[tabindex]')||event.target;
    const rect=anchor.getBoundingClientRect();
    const {clientX:x,clientY:y}=event;
    setContext({...target,x:x||y?x:rect.left+8,y:x||y?y:rect.bottom,anchor});
  }};
}

export function ContextMenu({context,close,items,className=''}){
  useEffect(()=>{
    if(!context)return;
    const outside=e=>{if(!e.target.closest('.studio-context-menu,.ant-dropdown-menu-submenu-popup'))close();};
    const escape=e=>{
      if(e.key!=='Escape')return;
      e.preventDefault();e.stopPropagation();close();
      if(context.anchor?.isConnected)context.anchor.focus?.({preventScroll:true});
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[context,close]);
  if(!context||!items.length)return null;
  return createPortal(<Dropdown open autoFocus trigger={[]} classNames={{root:`studio-context-menu ${className}`}} onOpenChange={next=>{if(!next)close();}}
    menu={{items,onClick:({domEvent})=>{domEvent.stopPropagation();close();}}}>
    <span style={{position:'fixed',left:context.x,top:context.y,width:1,height:1,pointerEvents:'none'}}/>
  </Dropdown>,document.body);
}

export const menuDivider={type:'divider'};
export const menuAction=(key,label,onClick,options)=>({key,label,onClick,...options});
