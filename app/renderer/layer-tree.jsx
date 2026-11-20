import { Button, Icon } from "./components.jsx";
import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { inherited } from "../core/layers.cjs";
import {assetUrl} from './canvas.jsx';
import {ShapePath} from './shape-tools.jsx';
const rowHeight=42,overscan=7;
export function LayerTree({
  layers,
  selected,
  choose,
  patch,
  relocate,
  disabled,
  assets=[],onMask,onMaskView,paintTarget,
  query='',kind='all',propertiesOpen=false,
}) {
  const [closed, setClosed] = useState(new Set()),
    [drop, setDrop] = useState(null),[dragged,setDragged]=useState(null);
  const list=useRef(null),rowsHost=useRef(null),focusRow=useRef(null);
  const [viewport,setViewport]=useState({top:0,height:400});
  const search=query.trim().toLocaleLowerCase(),searching=!!search||kind!=='all';
  const byId=useMemo(()=>new Map(layers.map(l=>[l.id,l])),[layers]);
  const assetsById=useMemo(()=>new Map(assets.map(a=>[a.id,a])),[assets]);
  const ordered=useMemo(()=>{
    const children=new Map(),visible=new Set(),rows=[];
    for(const layer of layers){
      const siblings=children.get(layer.parentId)||[];
      siblings.push(layer);children.set(layer.parentId,siblings);
      if(searching&&layer.name.toLocaleLowerCase().includes(search)&&(kind==='all'||layer.kind===kind)){
        for(let p=layer;p&&!visible.has(p.id);p=byId.get(p.parentId))visible.add(p.id);
      }
    }
    const walk=(parent,depth)=>{
      const siblings=children.get(parent)||[];
      for(let i=siblings.length-1;i>=0;i--){
        const layer=siblings[i];
        if(searching&&!visible.has(layer.id))continue;
        rows.push({layer,depth});
        if(layer.kind==='group'&&(searching||!closed.has(layer.id)))walk(layer.id,depth+1);
      }
    };
    walk(undefined,0);return rows;
  },[layers,byId,search,kind,searching,closed]);
  const indexes=useMemo(()=>new Map(ordered.map(({layer},i)=>[layer.id,i])),[ordered]);
  const selectedIds=useMemo(()=>new Set(selected),[selected]),activeId=selected.at(-1);
  const virtual=ordered.length>120;
  const readViewport=()=>{
    if(!list.current)return;
    const top=list.current.scrollTop,height=list.current.clientHeight;
    setViewport(old=>old.top===top&&old.height===height?old:{top,height});
  };
  const scrollToRow=index=>{
    if(index===undefined||!rowsHost.current)return;
    const listRect=list.current.getBoundingClientRect(),rowsRect=rowsHost.current.getBoundingClientRect();
    const top=rowsRect.top-listRect.top+index*rowHeight;
    if(top<0)list.current.scrollTop+=top;
    else if(top+rowHeight>list.current.clientHeight)list.current.scrollTop+=top+rowHeight-list.current.clientHeight;
    readViewport();
  };
  useLayoutEffect(()=>{
    if(!virtual)return;
    const observer=new ResizeObserver(readViewport);observer.observe(list.current);readViewport();
    return()=>observer.disconnect();
  },[virtual]);
  useLayoutEffect(()=>{if(virtual)scrollToRow(indexes.get(activeId));},[virtual,activeId,indexes]);
  const start=virtual?Math.min(Math.max(0,ordered.length-1),Math.max(0,Math.floor(viewport.top/rowHeight)-overscan)):0;
  const end=virtual?Math.min(ordered.length,start+Math.ceil(viewport.height/rowHeight)+2*overscan):ordered.length;
  const pinned=indexes.get(dragged),rows=ordered.slice(start,end).map((row,i)=>({...row,index:start+i}));
  if(virtual&&pinned!==undefined){
    if(pinned<start)rows.unshift({...ordered[pinned],index:pinned});
    if(pinned>=end)rows.push({...ordered[pinned],index:pinned});
  }
  useLayoutEffect(()=>{
    if(focusRow.current===null)return;
    const button=Array.from(list.current.querySelectorAll('[data-layer-id]')).find(e=>e.dataset.layerId===focusRow.current);
    if(button){button.focus({preventScroll:true});focusRow.current=null;}
  },[start,end]);
  const payload = (e) => {
    try {
      return JSON.parse(e.dataTransfer.getData("application/x-tugou-layers"));
    } catch {
      return [];
    }
  };
  const position = (e, l) => {
    const r = e.currentTarget.getBoundingClientRect(),
      fraction = (e.clientY - r.top) / r.height;
    return l.kind === "group" && fraction > 0.25 && fraction < 0.75
      ? "inside"
      : fraction < 0.5
        ? "above"
        : "below";
  };
  const rendered=rows.map(({ layer: l, depth, index }) => {
    const isSelected=selectedIds.has(l.id),inspecting=propertiesOpen&&selected.length===1&&isSelected&&paintTarget!=='mask',locked=inherited(byId,l,'locked');
    return (
        <div
          key={l.id}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={isSelected}
          aria-expanded={l.kind === "group" ? !closed.has(l.id) : undefined}
          data-tree-id={l.id}
          data-artboard={Boolean(l.artboard)}
          style={{paddingLeft:Math.min(depth,5)*10,top:virtual?index*rowHeight:undefined}}
          className={`layer-row ${isSelected ? "selected" : ""} ${drop?.id === l.id ? `drop-${drop.position}` : ""}`}
          onDragOver={(e) => {
            if (disabled) return;
            e.preventDefault();
            const placement=position(e,l);
            setDrop(old=>old?.id===l.id&&old.position===placement?old:{id:l.id,position:placement});
          }}
          onDragLeave={() => setDrop(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (!disabled) relocate(payload(e), l.id, position(e, l));
            setDrop(null);setDragged(null);
          }}
        >
          <Button iconOnly icon={l.visible === false ? "hidden" : "visible"}
            aria-label={`${l.visible === false ? "显示" : "隐藏"} ${l.name}`}
            onClick={() => patch(l.id, { visible: l.visible === false })}
          />
          {l.kind === "group" && (
            <Button iconOnly icon={closed.has(l.id) ? "expand" : "collapse"}
              aria-label={`${closed.has(l.id) ? "展开" : "折叠"} ${l.name}`}
              onClick={() =>
                setClosed((old) => {
                  const next = new Set(old);
                  next.has(l.id) ? next.delete(l.id) : next.add(l.id);
                  return next;
                })
              }
            >
              {closed.has(l.id) ? "▸" : "▾"}
            </Button>
          )}
          <Button className="layer-preview" aria-label={`选择 ${l.name}`} title="点击开关图层属性（Shift 多选）" aria-expanded={inspecting} aria-pressed={isSelected&&paintTarget!=='mask'} onClick={e=>choose(l.id,e.shiftKey,!e.shiftKey)}>
            {l.kind==='image'?<img className="layer-thumbnail" src={assetUrl(l.bitmap || assetsById.get(l.assetId) || {})} alt="" loading="lazy"/>:l.kind==='shape'?<svg className="layer-thumbnail shape-thumbnail" viewBox="-3 -3 26 26" aria-hidden="true"><ShapePath shape={l.shape} linePoints={l.linePoints} width={20} height={20} radius={l.radius?4:0} fill={l.fill===false?'none':l.color||'#b0bff2'} stroke={l.strokeWidth?l.stroke:'none'} strokeWidth={l.strokeWidth?1.5:0}/></svg>:<span className="layer-thumbnail"><Icon name={l.artboard?'layout':l.kind==='text'?'text':l.kind==='group'?'open':l.kind==='adjustment'?'adjust':'other'}/></span>}
          </Button>
          {onMask&&!l.artboard&&(l.mask||isSelected)&&<Button className={`layer-mask-thumbnail ${l.mask?.disabled?"is-disabled":""}`} disabled={disabled||locked} aria-label={`编辑 ${l.name} 的蒙版`} title={l.mask?.disabled?'蒙版已停用':l.mask?'编辑蒙版 · Alt+点击单独查看':'添加白色蒙版（保留选区）'} aria-pressed={isSelected&&paintTarget==='mask'} onClick={e=>{onMask(l.id);if(e.altKey&&l.mask)onMaskView?.(l.id)}}>{l.mask?.bitmap?<img src={assetUrl(l.mask.bitmap)} style={{filter:l.mask.inverted?'grayscale(1) invert(1)':'grayscale(1)'}} alt=""/>:<span className="mask-vector-preview"><Icon name={l.mask?'mask':'add'}/></span>}</Button>}
          <Button
            className="layer-name"
            style={{ paddingLeft: 8 + depth * 14 }}
            data-layer-id={l.id}
            onClick={(e) => choose(l.id,e.shiftKey,!e.shiftKey)}
            aria-expanded={inspecting}
            title={l.name}
            draggable={!disabled && !locked}
            onDragStart={(e) => {
              const ids = isSelected ? selected : [l.id];
              e.dataTransfer.setData(
                "application/x-tugou-layers",
                JSON.stringify(ids),
              );
              e.dataTransfer.effectAllowed = "move";
              if(virtual)setDragged(l.id);
            }}
            onDragEnd={() => {setDrop(null);setDragged(null);}}
          >

            <span className="layer-row-name">{l.name}</span>
            {l.clipping ? " ↳" : ""}
            {l.effects?.length ? ' ƒx' : ''}
          </Button>

          <Button iconOnly icon={l.locked ? "locked" : "unlocked"}
            aria-label={`${l.locked ? "解锁" : "锁定"} ${l.name}`}
            onClick={() => patch(l.id, { locked: !l.locked })}
          />
        </div>
    );
  });
  return (
    <div className="layer-list" ref={list} role="tree" aria-label="图层层级" aria-multiselectable="true" data-virtual={virtual||undefined}
      onScroll={virtual?readViewport:undefined} onKeyDown={virtual?e=>{
        const current=indexes.get(e.target.closest('[data-tree-id]')?.dataset.treeId);
        if(current===undefined||!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;
        e.preventDefault();e.stopPropagation();
        const index=e.key==='Home'?0:e.key==='End'?ordered.length-1:Math.max(0,Math.min(ordered.length-1,current+(e.key==='ArrowUp'?-1:1)));
        const id=ordered[index].layer.id;
        scrollToRow(index);
        const button=Array.from(list.current.querySelectorAll('[data-layer-id]')).find(el=>el.dataset.layerId===id);
        if(button)button.focus({preventScroll:true});else focusRow.current=id;
      }:undefined}>
      <div className="layer-root-drop" onDragOver={e=>{if(!disabled)e.preventDefault();}} onDrop={e=>{
        e.preventDefault();if(!disabled)relocate(payload(e),undefined,'inside');setDrop(null);setDragged(null);
      }}>拖到此处移至顶层</div>
      {searching&&!ordered.length&&<p className="empty-small">没有匹配的图层</p>}
      {virtual?<div className="layer-virtual-rows" ref={rowsHost} style={{height:ordered.length*rowHeight,'--virtual-row-height':`${rowHeight}px`}}>{rendered}</div>:rendered}
    </div>
  );
}
