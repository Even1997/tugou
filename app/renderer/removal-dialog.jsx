import React,{useState} from 'react';
import {Button,FormDialog} from './components.jsx';

export function RemovalDialog({title,description,confirmLabel='删除',close,remove}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <FormDialog title={title} close={()=>!busy&&close()} width={460}>
    <p>{description}</p>
    {error&&<p className="font-error" role="alert">{error}</p>}
    <div className="dialog-footer"><Button autoFocus disabled={busy} onClick={close}>取消</Button><Button danger disabled={busy} loading={busy} onClick={async()=>{setBusy(true);setError('');try{await remove();close();}catch(e){setError(e.message);setBusy(false);}}}>{confirmLabel}</Button></div>
  </FormDialog>;
}

export function ProjectManager({projects,currentId,dirty,busy,remove,close}){
  const [target,setTarget]=useState(null);
  return <>
    <FormDialog title="管理项目" close={close} width={560}>
      <div className="project-management-list">
        {!projects.length&&<p className="muted">还没有项目</p>}
        {projects.map(p=><div className="project-management-row" key={p.id}>
          <div><strong>{p.name}</strong><small>{p.id===currentId?'当前项目'+(dirty?' · 未保存':''):p.error||'已保存'}</small></div>
          <Button icon="delete" aria-label={'删除项目 '+p.name} disabled={busy||!!p.error} onClick={()=>setTarget(p)}>删除</Button>
        </div>)}
      </div>
    </FormDialog>
    {target&&<RemovalDialog title={'删除项目「'+target.name+'」？'} description={(target.id===currentId&&dirty?'此项目有未保存的修改，删除后将一并丢弃。':'')+'项目将从列表移除，不能通过撤销恢复。共享素材保留。'} close={()=>setTarget(null)} remove={()=>remove(target)}/>}
  </>;
}
