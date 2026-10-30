import React, {useEffect, useRef, useState} from 'react';
import {Image} from 'antd';
import {Button} from './components.jsx';
import {originalUrl} from './image-processing.js';
import './canvas-image-viewer.css';

export function CanvasImageViewer({asset, close}) {
  const [viewport,setViewport]=useState({width:window.innerWidth,height:window.innerHeight});
  const [actual,setActual]=useState(false),[failed,setFailed]=useState(false),actionsRef=useRef(null);
  const fit=Math.min(1,Math.max(1,viewport.width-96)/asset.width,Math.max(1,viewport.height-160)/asset.height);
  const ratio=actual?1:fit;
  const reset=value=>{setActual(value);actionsRef.current?.onReset();};
  useEffect(()=>{
    const resize=()=>setViewport({width:window.innerWidth,height:window.innerHeight});
    const key=e=>{
      if(e.ctrlKey||e.metaKey||e.altKey)return;
      const action={'+':()=>actionsRef.current?.onZoomIn(),'=':()=>actionsRef.current?.onZoomIn(),'-':()=>actionsRef.current?.onZoomOut(),'0':()=>reset(false),'1':()=>reset(true)}[e.key];
      if(action){e.preventDefault();e.stopPropagation();action();}
    };
    window.addEventListener('resize',resize);window.addEventListener('keydown',key,true);
    return()=>{window.removeEventListener('resize',resize);window.removeEventListener('keydown',key,true);};
  },[]);
  return <Image src={originalUrl(asset)} alt={asset.name||'图片查看器'} styles={{root:{display:'none'},popup:{mask:{background:'rgba(12,14,18,.94)'}}}} onError={()=>setFailed(true)} classNames={{popup:{root:'canvas-image-viewer'}}} preview={{
    open:true,closeIcon:false,minScale:.1,maxScale:50,scaleStep:.25,getContainer:()=>document.getElementById('dialogs'),
    onOpenChange:open=>{if(!open)close();},
    imageRender:image=><>
      {React.cloneElement(image,{style:{...image.props.style,width:asset.width*ratio,height:asset.height*ratio,maxWidth:'none',maxHeight:'none'}})}
      <Button className="viewer-close" iconOnly icon="close" aria-label="关闭图片查看器" onClick={close}/>
      {failed&&<p role="alert" className="viewer-error">图片加载失败，请关闭后重新打开。</p>}
    </>,
    actionsRender:(_,info)=>{
      actionsRef.current=info.actions;
      return <div className="viewer-controls" aria-label="图片缩放控件">
        <Button iconOnly icon="zoomOut" aria-label="缩小图片" disabled={info.transform.scale<=.1} onClick={info.actions.onZoomOut}/>
        <span aria-label="图片缩放比例">{Math.round(ratio*info.transform.scale*100)}%</span>
        <Button iconOnly icon="zoomIn" aria-label="放大图片" disabled={info.transform.scale>=50} onClick={info.actions.onZoomIn}/>
        <Button onClick={()=>reset(false)}>适应窗口</Button><Button onClick={()=>reset(true)}>100%</Button>
      </div>;
    },
  }}/>;
}
