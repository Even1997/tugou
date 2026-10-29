import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Button} from './components.jsx';
import {originalUrl} from './image-processing.js';
import {comparisonLayout,zoomCamera} from './comparison-view.cjs';
import './image-comparison.css';

export function ImageComparison({source,result,mode}) {
  const layout=comparisonLayout(source,result),host=useRef(null),drag=useRef(null);
  const [size,setSize]=useState({width:0,height:0}),[camera,setCamera]=useState({zoom:null,x:layout.width/2,y:layout.height/2}),[split,setSplit]=useState(50),[failed,setFailed]=useState(false);
  const parallel=mode==='compare',swipe=mode==='swipe';
  const panelWidth=parallel?(size.width-1)/2:size.width;
  const fit=Math.max(.01,Math.min(32,(panelWidth-32)/layout.width,(size.height-32)/layout.height));
  const current={...camera,zoom:camera.zoom??fit},live=useRef(current);live.current=current;
  useLayoutEffect(()=>{const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(host.current);return()=>observer.disconnect();},[]);
  useLayoutEffect(()=>{if(size.width&&size.height)setCamera(c=>c.zoom===null?{...c,zoom:fit}:c);},[size.width,size.height,fit]);
  useEffect(()=>{
    const node=host.current;
    const wheel=e=>{e.preventDefault();const pane=e.target.closest('.comparison-pane');if(!pane)return;const r=pane.getBoundingClientRect(),c=live.current;setCamera(zoomCamera(c,c.zoom*Math.exp(-e.deltaY*.002),e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2));};
    node.addEventListener('wheel',wheel,{passive:false});return()=>node.removeEventListener('wheel',wheel);
  },[]);
  const reset=()=>setCamera({zoom:fit,x:layout.width/2,y:layout.height/2});
  const image=(asset,box,alt)=><div className="comparison-world" style={{width:layout.width,height:layout.height,transform:`translate(${panelWidth/2-current.x*current.zoom}px, ${size.height/2-current.y*current.zoom}px) scale(${current.zoom})`}}><img src={originalUrl(asset)} alt={alt} draggable={false} onError={()=>setFailed(true)} style={{left:box.x,top:box.y,width:box.width,height:box.height}}/></div>;
  const panStart=e=>{if(e.button!==0||e.target.closest('[role="slider"]'))return;e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,camera:live.current};};
  const panMove=e=>{const d=drag.current;if(d?.id===e.pointerId)setCamera({...d.camera,x:d.camera.x-(e.clientX-d.x)/d.camera.zoom,y:d.camera.y-(e.clientY-d.y)/d.camera.zoom});};
  const moveSplit=e=>{const r=host.current.getBoundingClientRect();setSplit(Math.max(0,Math.min(100,(e.clientX-r.left)/r.width*100)));};
  const keys=e=>{
    const delta={ArrowLeft:[-40,0],ArrowRight:[40,0],ArrowUp:[0,-40],ArrowDown:[0,40]}[e.key];
    if(delta){e.preventDefault();e.stopPropagation();setCamera(c=>({...c,x:c.x+delta[0]/live.current.zoom,y:c.y+delta[1]/live.current.zoom}));}
    else if(['+','=','-','0'].includes(e.key)){e.preventDefault();e.stopPropagation();if(e.key==='0')reset();else setCamera(zoomCamera(live.current,live.current.zoom*(e.key==='-'?1/1.25:1.25)));}
  };
  return <section className="comparison-viewer" aria-label="图片对比">
    <header className="comparison-heading"><span>原图 <small>{source.width} × {source.height}</small></span><span>结果 <small>{result.width} × {result.height}</small></span></header>
    <div ref={host} className={`comparison-stage ${parallel?'is-parallel':''}`}>
      {(parallel?['original','result']:[mode==='original'?'original':'result']).map(side=><div key={side} className="comparison-pane" tabIndex={0} aria-label={side==='original'?'原图预览，可缩放和拖动':'结果预览，可缩放和拖动'} onPointerDown={panStart} onPointerMove={panMove} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}} onKeyDown={keys} onDoubleClick={reset}>
        {swipe?<>
          <div className="comparison-clip" style={{clipPath:`inset(0 ${100-split}% 0 0)`}}>{image(source,layout.original,'处理原图')}</div>
          <div className="comparison-clip" style={{clipPath:`inset(0 0 0 ${split}%)`}}>{image(result,layout.output,'处理结果')}</div>
        </>:image(side==='original'?source:result,side==='original'?layout.original:layout.output,side==='original'?'处理原图':'处理结果')}
      </div>)}
      {swipe&&<div role="slider" tabIndex={0} aria-label="对比分割线" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split)} aria-valuetext={`原图 ${Math.round(split)}%，结果 ${100-Math.round(split)}%`} className="comparison-divider" style={{left:`clamp(12px, ${split}%, calc(100% - 12px))`}} onPointerDown={e=>{if(e.button!==0)return;e.stopPropagation();e.currentTarget.focus();e.currentTarget.setPointerCapture(e.pointerId);moveSplit(e);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))moveSplit(e);}} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();e.stopPropagation();setSplit(n=>e.key==='Home'?0:e.key==='End'?100:Math.max(0,Math.min(100,n+(e.key==='ArrowLeft'?-2:2))));}}}><span>↔</span></div>}
    </div>
    <footer className="comparison-controls"><Button aria-label="缩小对比" onClick={()=>setCamera(zoomCamera(current,current.zoom/1.25))}>−</Button><output aria-label="对比缩放比例">{Math.round(current.zoom*100)}%</output><Button aria-label="放大对比" onClick={()=>setCamera(zoomCamera(current,current.zoom*1.25))}>＋</Button><Button onClick={reset}>适应窗口</Button><Button title="按原图像素显示，结果同步对齐" onClick={()=>setCamera({...current,zoom:1})}>100%</Button><small>{failed?'图片加载失败，请重新打开素材':'滚轮缩放 · 拖动画面 · 双击复位'}</small></footer>
  </section>;
}
