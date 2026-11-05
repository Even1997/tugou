import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Modal} from 'antd';
import {Button} from './components.jsx';
import {Select} from './select.jsx';
import {Compositor} from './composite.js';
import {boards,extract} from '../core/artboards.cjs';
import {timeline} from '../core/gif-timeline.cjs';
import './gif.css';

export function BoardExport({document,initialId,single,initialFrame=0,close,complete}){
  const list=boards(document),[chosen,setChosen]=useState([initialId]),[state,setState]=useState(null),[error,setError]=useState(''),[format,setFormat]=useState('png'),[frame,setFrame]=useState(initialFrame+1),[first,setFirst]=useState(1),[last,setLast]=useState(null);
  const control=useRef(null),alive=useRef(true),preview=useRef(null);
  const animation=useMemo(()=>{try{return {frames:timeline({...document,layers:list.filter(b=>chosen.includes(b.id)).flatMap(b=>extract(document,b.id).layers)})};}catch(e){return {frames:[{time:0,delay:100}],error:e.message}}},[document,chosen.join(',')]);
  const count=animation.frames.length,current=Math.min(frame,count),start=Math.min(first,count),end=Math.min(last??count,count);
  useEffect(()=>()=>{alive.current=false;control.current?.abort();},[]);
  useEffect(()=>{
    if(!preview.current||!chosen.length)return;
    const controller=new AbortController(),doc=extract(document,chosen[0]);
    const timer=setTimeout(async()=>{
      const engine=new Compositor(),canvas=window.document.createElement('canvas');
      try{await engine.render(doc,canvas,{scale:Math.min(1,480/doc.width,180/doc.height),time:animation.frames[current-1].time,signal:controller.signal});if(!controller.signal.aborted&&preview.current){preview.current.width=canvas.width;preview.current.height=canvas.height;preview.current.getContext('2d').drawImage(canvas,0,0);}}
      catch(e){if(!controller.signal.aborted)setError(e.message)}finally{engine.dispose();canvas.width=canvas.height=1;}
    },60);
    return()=>{clearTimeout(timer);controller.abort();};
  },[document,chosen.join(','),current,animation]);
  const save=async()=>{
    if(control.current)return;
    const controller=new AbortController();control.current=controller;
    const selected=list.filter(b=>chosen.includes(b.id));let files=[],saved=0,engine;
    setError('');setState({label:'选择保存位置…',progress:0});
    try{
      if(animation.error)throw Error(animation.error);
      if(format==='gif'&&start>end)throw Error('结束帧不能早于开始帧');
      const choice=await window.tugou.chooseExport(single?selected[0].name:selected.map(b=>b.name),format);
      if(!choice)return;
      files=choice.files||[choice];controller.signal.throwIfAborted();engine=new Compositor();
      for(let i=0;i<selected.length;i++){
        const board=selected[i],doc=extract(document,board.id),frames=format==='gif'?animation.frames.slice(start-1,end):[animation.frames[current-1]];
        if(format==='gif'&&(doc.width>4096||doc.height>4096||doc.width*doc.height*frames.length>64*1024*1024))throw Error('GIF 支持单边 4096 像素，全部帧合计不超过 6400 万像素；请减小画板或缩短帧范围');
        const images=[];
        for(let j=0;j<frames.length;j++){
          controller.signal.throwIfAborted();
          images.push(await engine.export(doc,{time:frames[j].time,signal:controller.signal,progress:value=>{if(alive.current)setState({label:`正在渲染 ${board.name} · 第 ${j+1}/${frames.length} 帧`,progress:(i+(j+value)/frames.length)/selected.length});}}));
        }
        let bytes=images[0];
        if(format==='gif'){setState({label:`正在编码 ${board.name}…`,progress:(i+1)/selected.length});bytes=await window.tugou.encodeGif(images,{width:doc.width,height:doc.height,loop:0,delays:frames.map(f=>f.delay)});}
        controller.signal.throwIfAborted();
        if(alive.current)setState({label:`正在写入 ${i+1}/${selected.length}`,progress:(i+1)/selected.length,writing:true});
        await window.tugou.writeExport(files[i].token,bytes);saved++;
      }
      if(alive.current){complete(`已保存 ${saved} 个 ${format.toUpperCase()} 文件`);close();}
    }catch(e){
      if(alive.current){if(controller.signal.aborted){complete(`已保存 ${saved} 个文件，已取消其余导出`);close();}else{setChosen(selected.slice(saved).map(b=>b.id));setError(`已保存 ${saved} 个文件。${e.message}`);}}
    }finally{
      engine?.dispose();await Promise.allSettled(files.map(file=>window.tugou.cancelExport(file.token)));control.current=null;if(alive.current)setState(null);
    }
  };
  return <Modal open centered styles={{body:{maxHeight:'calc(100vh - 220px)',overflowY:'auto'}}} title={single?'导出画板':'批量导出画板'} width={580} getContainer={()=>window.document.getElementById('dialogs')} transitionName="" maskTransitionName="" onCancel={()=>{if(!state)close();}} closable={!state} maskClosable={!state} footer={<><Button disabled={state?.writing} onClick={()=>state?control.current?.abort():close()}>{state?'取消导出':'取消'}</Button><Button primary disabled={!!state||!chosen.length||!!animation.error||(format==='gif'&&start>end)} onClick={save}>保存 {format.toUpperCase()}</Button></>}>
    <canvas ref={preview} className="gif-export-preview" aria-label="导出帧预览"/>
    <div className="gif-export-settings"><label>导出格式<Select aria-label="导出格式" value={format} disabled={!!state} onChange={e=>setFormat(e.target.value)}><option value="png">PNG 图片 · 指定帧</option><option value="gif">GIF 动图 · 帧范围</option></Select></label><label className="gif-frame-slider"><span>预览 / PNG 导出帧 <b>{current} / {count}</b></span><input aria-label="预览 / PNG 导出帧" type="range" value={current} min={1} max={count} step={1} disabled={!!state||count===1} onChange={e=>setFrame(+e.target.value)}/></label>{format==='gif'&&<><label className="gif-frame-slider"><span>开始帧 <b>{start} / {count}</b></span><input aria-label="开始帧" type="range" min={1} max={end} value={start} disabled={!!state||count===1} onChange={e=>{setFirst(+e.target.value);setFrame(+e.target.value)}}/></label><label className="gif-frame-slider"><span>结束帧 <b>{end} / {count}</b></span><input aria-label="结束帧" type="range" min={start} max={count} value={end} disabled={!!state||count===1} onChange={e=>{setLast(+e.target.value);setFrame(+e.target.value)}}/></label></>}</div>
    <p className="muted">共 {count} 帧 · 原始画板尺寸。PNG 保存所选帧；GIF 保留帧时长并循环播放，含背景与所有可见图层。多张 GIF 按最长动画一轮合成。</p>
    {!single&&<><div className="dialog-actions"><Button disabled={!!state} onClick={()=>setChosen(list.map(b=>b.id))}>全选画板</Button><Button disabled={!!state} onClick={()=>setChosen([])}>清空选择</Button></div><div className="board-export-list">{list.map(b=><label key={b.id}><input type="checkbox" aria-label={`保存画板 ${b.name}`} checked={chosen.includes(b.id)} disabled={!!state} onChange={e=>setChosen(ids=>e.target.checked?[...ids,b.id]:ids.filter(id=>id!==b.id))}/><span>{b.name}</span><small>{b.width} × {b.height} px</small></label>)}</div><p className="muted">同名文件自动编号，不覆盖已有图片。</p></>}
    {state&&<div role="status"><p>{state.label}</p><progress aria-label="画板保存进度" max={1} value={state.progress}/></div>}
    {(error||animation.error)&&<p role="alert">{error||animation.error}</p>}
  </Modal>;
}
