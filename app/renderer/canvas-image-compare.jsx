import React, {useLayoutEffect, useRef, useState} from 'react';
import {Button, FormDialog} from './components.jsx';
import {originalUrl} from './image-processing.js';
import './canvas-image-compare.css';

const clamp = (value, scale) => {const limit=Math.max(0,(scale-1)/2);return Math.max(-limit,Math.min(limit,value));};
const zoomView = (view, delta) => {
  const scale=Math.max(.25,Math.min(4,view.scale+delta));
  return {scale,x:clamp(view.x,scale),y:clamp(view.y,scale)};
};

export function CanvasImageCompare({assets, close}) {
  const [views, setViews] = useState(()=>assets.map(()=>({scale:1,x:0,y:0})));
  const [linked, setLinked] = useState(true);
  const [active, setActive] = useState(0);
  const [overview, setOverview] = useState(false);
  const [failed, setFailed] = useState({});
  const drag = useRef(null);
  const grid = useRef(null);
  useLayoutEffect(()=>{
    const element=grid.current;
    // Percentage grid tracks collapse in this flex layout; use the actual available height.
    const resize=()=>element.style.setProperty('--compare-detail-height',`${element.clientHeight}px`);
    resize();
    const observer=new ResizeObserver(resize);observer.observe(element);
    const wheel=event=>{
      if(!event.ctrlKey)return;
      event.preventDefault();event.stopPropagation();
      if(event.deltaY)setViews(previous=>previous.map(view=>zoomView(view,event.deltaY<0?.25:-.25)));
    };
    element.addEventListener('wheel',wheel,{passive:false});
    return ()=>{observer.disconnect();element.removeEventListener('wheel',wheel);};
  },[]);
  useLayoutEffect(()=>{
    const cell=grid.current?.children[active];
    if(cell)grid.current.scrollTop=cell.offsetTop-grid.current.offsetTop;
  },[overview]);
  const adjust = (index, transform) => setViews(previous=>previous.map((view,i)=>linked||i===index?transform(view,i):view));
  const zoom = delta => adjust(active,view=>zoomView(view,delta));
  const pan = (index,dx,dy,start) => adjust(index,(view,i)=>{
    const source=start?.[i]||view;
    return {...view,x:clamp(source.x+dx,view.scale),y:clamp(source.y+dy,view.scale)};
  });
  const reset = () => adjust(active,()=>({scale:1,x:0,y:0}));
  const targets=linked?views:[views[active]];
  const linkedPan=linked&&views.some(view=>view.scale>1);
  const mixed=targets.some(view=>view.scale!==targets[0].scale);
  const factor=scale=>`${Number(scale.toFixed(2))}×`;
  const columns = assets.length <= 3 ? assets.length : assets.length === 4 ? 2 : Math.min(4, Math.ceil(Math.sqrt(assets.length)));
  return <FormDialog title="多图对比" close={close} width="calc(100vw - 32px)" className="canvas-image-compare">
    <div className="image-compare-toolbar">
      <div className="image-compare-options">
        <div className="image-compare-modes" role="group" aria-label="对比布局">
          <Button aria-pressed={!overview} onClick={()=>setOverview(false)}>两列细看</Button>
          <Button aria-pressed={overview} onClick={()=>setOverview(true)}>全部总览</Button>
        </div>
        <div className="image-compare-modes" role="group" aria-label="对比调整模式">
          <Button aria-pressed={linked} onClick={()=>setLinked(true)}>联动调整</Button>
          <Button aria-pressed={!linked} onClick={()=>setLinked(false)}>单独调整</Button>
        </div>
        <span className="image-compare-hint">{linked?`${assets.length} 张图片一起调整`:`正在调整第 ${active+1} 张 · 点击图片切换`}{!overview&&assets.length>2?' · 向下滚动查看更多':''}</span>
      </div>
      <div className="image-compare-controls" aria-label="对比缩放控件" title="Ctrl＋滚轮：统一缩放全部图片">
        <Button iconOnly icon="zoomOut" aria-label="缩小对比图片" disabled={targets.every(view=>view.scale<=.25)} onClick={()=>zoom(-.25)}/>
        <span aria-label="对比缩放倍率" title={mixed?'各图倍率不同，联动时同时增减':'相对于适应窗口的倍率'}>{mixed?'混合':factor(targets[0].scale)}</span>
        <Button iconOnly icon="zoomIn" aria-label="放大对比图片" disabled={targets.every(view=>view.scale>=4)} onClick={()=>zoom(.25)}/>
        <Button icon="fit" onClick={reset}>适应窗口</Button>
      </div>
    </div>
    <div ref={grid} className={`image-compare-grid${overview?'':' is-detail'}`} style={{'--compare-columns':columns,'--compare-rows':Math.ceil(assets.length/columns),'--compare-small-rows':Math.ceil(assets.length/2)}}>
      {assets.map((asset,index)=>{const view=views[index],canPan=linked?linkedPan:view.scale>1;return <section className={`image-compare-cell${!linked&&active===index?' is-active':''}`} key={index} aria-label={`对比图片 ${index+1}：${asset.name||'未命名图片'}`} onPointerDownCapture={event=>{setActive(index);event.currentTarget.querySelector('.image-compare-stage').focus({preventScroll:true});}}>
        <header><span className="image-compare-index">{index+1}</span><span className="image-compare-name" title={asset.name}>{asset.name||'未命名图片'}</span><small>{asset.width} × {asset.height} · {factor(view.scale)}</small></header>
        <div className="image-compare-stage" tabIndex={0} onFocus={()=>setActive(index)} aria-label={`查看图片 ${index+1}，放大后可用方向键平移`} style={{cursor:canPan?'grab':'default'}}
          onKeyDown={event=>{
            const direction={ArrowLeft:[.05,0],ArrowRight:[-.05,0],ArrowUp:[0,.05],ArrowDown:[0,-.05]}[event.key];
            if(direction){event.preventDefault();pan(index,...direction);}
          }}
          onPointerDown={event=>{
            if(event.button!==0||!canPan)return;
            event.preventDefault();event.currentTarget.focus();
            const rect=event.currentTarget.getBoundingClientRect();
            drag.current={x:event.clientX,y:event.clientY,width:rect.width,height:rect.height,views};
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event=>{
            const start=drag.current;
            if(!start||!event.currentTarget.hasPointerCapture(event.pointerId))return;
            pan(index,(event.clientX-start.x)/start.width,(event.clientY-start.y)/start.height,start.views);
          }}
          onPointerUp={event=>{drag.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
          onLostPointerCapture={()=>{drag.current=null;}}>
          {failed[index]?<p role="alert">图片加载失败，请关闭后重试</p>:<img src={originalUrl(asset)} alt={asset.name||`图片 ${index+1}`} draggable={false} loading="lazy"
            onError={()=>setFailed(previous=>({...previous,[index]:true}))}
            style={{transform:`translate(${view.x*100}%, ${view.y*100}%) scale(${view.scale})`}}/>}
        </div>
      </section>;})}
    </div>
  </FormDialog>;
}
