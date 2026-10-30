import React,{useEffect,useState} from 'react';
import {Input,TextArea} from './components.jsx';
import {qualityLabels} from '../core/image-settings.cjs';

export function CanvasImageDetails({projectId,document,asset,nodeId,change,disabled}) {
  const [details,setDetails]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let stopped=false;setDetails(null);setError('');
    window.tugou.assetDetails(projectId,document,asset.id,nodeId).then(value=>{if(!stopped)setDetails(value);}).catch(e=>{if(!stopped)setError(e.message);});
    return()=>{stopped=true;};
  },[projectId,asset.id,nodeId,asset.resource]);
  return <>
    <label>图片名称<Input aria-label="图片名称" disabled={disabled} value={asset.name||''} onChange={e=>change({...document,assets:document.assets.map(a=>a.id===asset.id?{...a,name:e.target.value}:a)})}/></label>
    <label>{details?.label||'生成提示词'}<TextArea aria-label="图片生成提示词" readOnly rows={6} value={details?.prompt||''} placeholder={error||details?.reason||'正在读取…'}/></label>
    {error&&<p role="alert" className="message error">{error}</p>}
    {details?.model&&<p className="muted">{details.model}{details.requestedSize?` · 请求尺寸 ${details.requestedSize}`:''}</p>}
    {asset.generation&&<p className="muted">请求质量：{qualityLabels[asset.generation.quality||'auto']||asset.generation.quality} · 实际尺寸 {asset.width} × {asset.height}</p>}
    {details?.label?.startsWith('来源素材')&&<p className="muted">来源：{details.sourceName}</p>}
  </>;
}
