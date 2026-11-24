import React,{useEffect,useRef,useState} from 'react';
import {Button,FormDialog,Input,ToolPopover} from './components.jsx';
import {RemovalDialog} from './removal-dialog.jsx';
import {ContextMenu,useContextMenu,menuAction as item} from './context-menu.jsx';
import * as pages from '../core/pages.cjs';
import './page-tabs.css';

export function PageTabs({document,kind,disabled,activate,edit}){
  const items=pages.list(document,kind),current=items.find(p=>p.active),label=pages.label(kind),holder=useRef(null);
  const [dialog,setDialog]=useState(null),[name,setName]=useState(''),[error,setError]=useState('');
  const menu=useContextMenu(),target=items.find(p=>p.id===menu.context?.id),dialogPage=items.find(p=>p.id===dialog?.id);
  useEffect(()=>{holder.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'});menu.close();setDialog(null);setError('');},[kind,current.id]);
  const run=async fn=>{try{setError('');await fn();}catch(e){setError(e.message);}};
  const open=(action,page=current)=>{setName(action==='create'?label+' '+(items.length+1):page.name);setDialog({action,id:page.id});setError('');};
  const menuItems=target&&!disabled?[
    item('open','切换到此页',()=>run(()=>activate(kind,target.id)),{disabled:target.active}),
    item('rename','重命名…',()=>open('rename',target)),
    item('duplicate','复制'+label,()=>run(()=>edit('duplicate',kind,target.id))),
    item('delete','删除'+label,()=>open('delete',target),{danger:true,disabled:items.length===1}),
  ]:[];
  return <div className="page-strip">
    <div className="page-tabs" role="tablist" aria-label={kind==='layers'?label+'面':label+'页面'} ref={holder}>
      {items.map((p,index)=><button key={p.id} type="button" role="tab" aria-selected={p.active} tabIndex={p.active?0:-1} disabled={disabled} title={p.name} data-page-id={p.id} onClick={()=>run(()=>activate(kind,p.id))} onContextMenu={e=>menu.open(e,{id:p.id})} onKeyDown={e=>{const next=e.key==='ArrowRight'?(index+1)%items.length:e.key==='ArrowLeft'?(index+items.length-1)%items.length:e.key==='Home'?0:e.key==='End'?items.length-1:-1;if(next>=0){e.preventDefault();run(async()=>{await activate(kind,items[next].id);holder.current?.querySelectorAll('[role="tab"]')[next]?.focus();});}}}>{p.name}</button>)}
    </div>
    <Button icon="add" iconOnly aria-label={'新建'+label} disabled={disabled} onClick={()=>open('create')}/>
    {!disabled&&<ToolPopover label={label+'页面操作'}><Button icon="edit" onClick={()=>open('rename')}>重命名</Button><Button icon="copy" onClick={()=>run(()=>edit('duplicate',kind,current.id))}>复制{label}</Button><Button danger icon="delete" disabled={items.length===1} onClick={()=>open('delete')}>删除{label}</Button></ToolPopover>}
    {error&&!dialog&&<span role="alert" className="page-error">{error}</span>}
    {(dialog?.action==='create'||dialog?.action==='rename'&&dialogPage)&&<FormDialog title={dialog.action==='create'?'新建'+label:'重命名'+label} width={420} close={()=>setDialog(null)}>
      <form onSubmit={e=>{e.preventDefault();run(async()=>{await edit(dialog.action,kind,dialog.id,name);setDialog(null);});}}><label>{label}名称<Input autoFocus aria-label={label+'名称'} value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label>{error&&<p role="alert">{error}</p>}<div className="dialog-footer"><Button onClick={()=>setDialog(null)}>取消</Button><Button primary type="submit" disabled={!name.trim()||disabled}>确定</Button></div></form>
    </FormDialog>}
    {dialog?.action==='delete'&&dialogPage&&<RemovalDialog title={'删除「'+dialogPage.name+'」？'} description={'此'+label+'的内容将一起移除，共享素材保留。可通过撤销恢复。'} close={()=>setDialog(null)} remove={()=>edit('delete',kind,dialog.id)}/>}
    <ContextMenu context={menu.context} close={menu.close} items={menuItems} className="page-context-menu"/>
  </div>;
}
