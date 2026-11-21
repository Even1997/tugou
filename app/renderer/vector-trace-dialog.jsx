import React,{useEffect,useState} from 'react';
import {Modal} from 'antd';
import {pathData} from '../core/vector-path.cjs';
import {traceLayer} from './vector-trace.js';

export function VectorTraceDialog({source,id,apply,close}){
  const layer=source.layers.find(l=>l.id===id),[threshold,setThreshold]=useState(128),[result,setResult]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    setResult(null);setError('');
    const timer=setTimeout(()=>{
      traceLayer(source,id,threshold,controller.signal).then(paths=>{
        if(!controller.signal.aborted)setResult({threshold,paths,d:pathData(paths,layer.width,layer.height)});
      }).catch(e=>{if(!controller.signal.aborted)setError(e.message);});
    },100);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[source,id,threshold]);
  const ready=result?.threshold===threshold;
  return <Modal open centered title="图片矢量化" okText="创建路径图层" cancelText="取消" okButtonProps={{disabled:!ready}} onOk={()=>ready&&apply(result.paths)} onCancel={close} getContainer={()=>document.getElementById('dialogs')}>
    <svg aria-label="黑白描摹预览" viewBox={`0 0 ${layer.width} ${layer.height}`} style={{width:'100%',height:190,background:'white'}}>{ready&&<path d={result.d} fill="#222222" fillRule="evenodd"/>}</svg>
    <label>黑白阈值 <input type="range" aria-label="黑白阈值" min={1} max={254} value={threshold} onChange={e=>setThreshold(+e.target.value)}/> {threshold}</label>
    {error?<p role="alert">{error}</p>:!ready&&<p role="status">正在描摹…</p>}
  </Modal>;
}
