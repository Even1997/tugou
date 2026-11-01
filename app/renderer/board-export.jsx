import React,{useEffect,useRef,useState} from 'react';
import {Modal} from 'antd';
import {Button} from './components.jsx';
import {Compositor} from './composite.js';
import {boards,extract} from '../core/artboards.cjs';

export function BoardExport({document,initialId,single,close,complete}){
  const list=boards(document),[chosen,setChosen]=useState([initialId]),[state,setState]=useState(null),[error,setError]=useState('');
  const control=useRef(null),started=useRef(false),alive=useRef(true);
  useEffect(()=>()=>{alive.current=false;control.current?.abort();},[]);
  const save=async()=>{
    if(control.current)return;
    const controller=new AbortController();control.current=controller;
    const selected=list.filter(b=>chosen.includes(b.id));let files=[],saved=0,engine;
    setError('');setState({label:'选择保存位置…',progress:0});
    try{
      const choice=await window.tugou.chooseExport(single?selected[0].name:selected.map(b=>b.name));
      if(!choice){if(single)close();return;}
      files=choice.files||[choice];controller.signal.throwIfAborted();
      engine=new Compositor();
      for(let i=0;i<selected.length;i++){
        controller.signal.throwIfAborted();
        const board=selected[i],doc=extract(document,board.id);
        const bytes=await engine.export(doc,{signal:controller.signal,progress:value=>{if(alive.current)setState({label:`正在保存 ${i+1}/${selected.length} · ${board.name}`,progress:(i+value)/selected.length});}});
        controller.signal.throwIfAborted();
        if(alive.current)setState({label:`正在写入 ${i+1}/${selected.length}`,progress:(i+1)/selected.length,writing:true});
        await window.tugou.writeExport(files[i].token,bytes);saved++;
      }
      if(alive.current){complete(`已按原始尺寸保存 ${saved} 张 PNG`);close();}
    }catch(e){
      if(alive.current){
        if(controller.signal.aborted){complete(`已保存 ${saved} 张，已取消其余图片`);close();}
        else {setChosen(selected.slice(saved).map(b=>b.id));setError(`已保存 ${saved} 张。${e.message}；可重新保存剩余画板。`);}
      }
    }finally{
      engine?.dispose();await Promise.allSettled(files.map(file=>window.tugou.cancelExport(file.token)));
      control.current=null;if(alive.current)setState(null);
    }
  };
  useEffect(()=>{if(single&&!started.current){started.current=true;save();}},[]);
  return <Modal open title={single?'保存画板图片':'批量保存画板图片'} getContainer={()=>window.document.getElementById('dialogs')} transitionName="" maskTransitionName="" maskClosable={false} keyboard={!state} closable={!state} onCancel={close} footer={<><Button disabled={state?.writing} onClick={()=>state?control.current?.abort():close()}>{state?'取消保存':'取消'}</Button>{!state&&<Button primary disabled={!chosen.length} onClick={save}>保存 {chosen.length} 张图片</Button>}</>}>
    <p>无损 PNG · 按各画板实际像素尺寸保存，保留背景设置，不受预览缩放影响。</p>
    {!single&&<><div className="dialog-actions"><Button disabled={!!state} onClick={()=>setChosen(list.map(b=>b.id))}>全选画板</Button><Button disabled={!!state} onClick={()=>setChosen([])}>清空选择</Button><span>已选 {chosen.length} / {list.length}</span></div><div className="board-export-list">{list.map(b=><label key={b.id}><input type="checkbox" aria-label={`保存画板 ${b.name}`} checked={chosen.includes(b.id)} disabled={!!state} onChange={e=>setChosen(ids=>e.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/><span>{b.name}</span><small>{b.width} × {b.height} px</small></label>)}</div><p className="muted">保存到同一文件夹；同名文件自动编号，不覆盖已有图片。</p></>}
    {state&&<div role="status"><p>{state.label}</p><progress aria-label="画板保存进度" max={1} value={state.progress}/></div>}
    {error&&<p role="alert">{error}</p>}
  </Modal>;
}
