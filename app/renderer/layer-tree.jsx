import { Button, Icon } from "./components.jsx";
import React, { useState } from "react";
import { inherited } from "../core/layers.cjs";
import {assetUrl} from './canvas.jsx';
import {ShapePath} from './shape-tools.jsx';
export function LayerTree({
  layers,
  selected,
  choose,
  patch,
  relocate,
  disabled,
  assets=[],onMask,onMaskView,paintTarget,
  query='',kind='all',
}) {
  const [closed, setClosed] = useState(new Set()),
    [drop, setDrop] = useState(null);
  const ordered = (parentId, depth = 0) =>
    layers
      .filter((l) => l.parentId === parentId)
      .reverse()
      .flatMap((layer) => [
        { layer, depth },
        ...(layer.kind === "group" && (!closed.has(layer.id)||query.trim()||kind!=="all")
          ? ordered(layer.id, depth + 1)
          : []),
      ]);
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
  const visible=new Set();
  if(query.trim()||kind!=='all')for(const layer of layers){
    if(!layer.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())||(kind!=='all'&&layer.kind!==kind))continue;
    visible.add(layer.id);
    let parent=layers.find(l=>l.id===layer.parentId);
    while(parent){visible.add(parent.id);parent=layers.find(l=>l.id===parent.parentId)}
  }
  const searching=Boolean(query.trim()||kind!=='all');
  return (
    <div
      className="layer-list"
      role="tree"
      aria-label="图层层级"
      aria-multiselectable="true"
    >
      <div
        className="layer-root-drop"
        onDragOver={(e) => {
          if (!disabled) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled) relocate(payload(e), undefined, "inside");
          setDrop(null);
        }}
      >
        拖到此处移至顶层
      </div>
      {searching&&!visible.size&&<p className="empty-small">没有匹配的图层</p>}
      {ordered().filter(({layer})=>!searching||visible.has(layer.id)).map(({ layer: l, depth }) => (
        <div
          key={l.id}
          role="treeitem"
          aria-level={depth + 1}
          aria-selected={selected.includes(l.id)}
          aria-expanded={l.kind === "group" ? !closed.has(l.id) : undefined}
          data-tree-id={l.id}
          data-artboard={Boolean(l.artboard)}
          style={{paddingLeft:Math.min(depth,5)*10}}
          className={`layer-row ${selected.includes(l.id) ? "selected" : ""} ${drop?.id === l.id ? `drop-${drop.position}` : ""}`}
          onDragOver={(e) => {
            if (disabled) return;
            e.preventDefault();
            setDrop({ id: l.id, position: position(e, l) });
          }}
          onDragLeave={() => setDrop(null)}
          onDrop={(e) => {
            e.preventDefault();
            if (!disabled) relocate(payload(e), l.id, position(e, l));
            setDrop(null);
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
          <Button className="layer-preview" aria-label={`选择 ${l.name}`} title="编辑图层内容（保留选区）" aria-pressed={selected.includes(l.id)&&paintTarget!=='mask'} onClick={e=>choose(l.id,e.shiftKey)}>
            {l.kind==='image'?<img className="layer-thumbnail" src={assetUrl(l.bitmap || assets.find(a=>a.id===l.assetId) || {})} alt="" loading="lazy"/>:l.kind==='shape'?<svg className="layer-thumbnail shape-thumbnail" viewBox="-3 -3 26 26" aria-hidden="true"><ShapePath shape={l.shape} width={20} height={20} radius={l.radius?4:0} fill={l.fill===false?'none':l.color||'#b0bff2'} stroke={l.strokeWidth?l.stroke:'none'} strokeWidth={l.strokeWidth?1.5:0}/></svg>:<span className="layer-thumbnail"><Icon name={l.artboard?'layout':l.kind==='text'?'text':l.kind==='group'?'open':l.kind==='adjustment'?'adjust':'other'}/></span>}
          </Button>
          {onMask&&!l.artboard&&(l.mask||selected.includes(l.id))&&<Button className={`layer-mask-thumbnail ${l.mask?.disabled?"is-disabled":""}`} disabled={disabled||inherited(layers,l,'locked')} aria-label={`编辑 ${l.name} 的蒙版`} title={l.mask?.disabled?'蒙版已停用':l.mask?'编辑蒙版 · Alt+点击单独查看':'添加白色蒙版（保留选区）'} aria-pressed={selected.includes(l.id)&&paintTarget==='mask'} onClick={e=>{onMask(l.id);if(e.altKey&&l.mask)onMaskView?.(l.id)}}>{l.mask?.bitmap?<img src={assetUrl(l.mask.bitmap)} style={{filter:l.mask.inverted?'grayscale(1) invert(1)':'grayscale(1)'}} alt=""/>:<span className="mask-vector-preview"><Icon name={l.mask?'mask':'add'}/></span>}</Button>}
          <Button
            className="layer-name"
            style={{ paddingLeft: 8 + depth * 14 }}
            data-layer-id={l.id}
            onClick={(e) => choose(l.id, e.shiftKey)}
            title={l.name}
            draggable={!disabled && !inherited(layers, l, "locked")}
            onDragStart={(e) => {
              const ids = selected.includes(l.id) ? selected : [l.id];
              e.dataTransfer.setData(
                "application/x-tugou-layers",
                JSON.stringify(ids),
              );
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragEnd={() => setDrop(null)}
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
      ))}
    </div>
  );
}
