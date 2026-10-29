import {ColorControl} from './color-control.jsx';
import {useUiView} from './ui-view.js';
import React, {useMemo, useRef, useState} from 'react';
import {Modal} from 'antd';
import {Button, Input, Icon} from './components.jsx';
import {NumberField} from './number-field.jsx';
import {LayerEditor} from './layers.jsx';
import * as artboards from '../core/artboards.cjs';
import './composite-workspace.css';
import {BoardSizeControl,boardPresets as presets} from './board-size.jsx';

function BoardInspector({board,patch,applySize,duplicate,remove,canRemove,disabled}) {
  const [name,setName]=useState(board.name);
  return <fieldset className="layer-properties board-properties" disabled={disabled||board.locked}>
    <Input className="inspector-name" aria-label="画板名称" value={name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name.trim()!==board.name)patch({name:name.trim()});else if(!name.trim())setName(board.name)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>
    <p className="inspector-caption">画板 / {board.width} × {board.height} px</p>
    <div className="property-grid"><NumberField label="画板属性宽度" shortLabel="W" min={1} max={30000} value={board.width} onChange={width=>patch({width})}/><NumberField label="画板属性高度" shortLabel="H" min={1} max={30000} value={board.height} onChange={height=>patch({height})}/><NumberField label="画板 X" shortLabel="X" value={board.x} onChange={x=>patch({x})}/><NumberField label="画板 Y" shortLabel="Y" value={board.y} onChange={y=>patch({y})}/></div>
    <label className="check"><input type="checkbox" checked={board.clipContent!==false} onChange={e=>patch({clipContent:e.target.checked})}/>裁切画板外内容</label>
    <div className="board-background"><span>背景</span><ColorControl aria-label="画板背景" value={board.background==='transparent'?'#ffffff':board.background} onChange={e=>patch({background:e.target.value})}/><span>{board.background==='transparent'?'透明':board.background.replace('#','').toUpperCase()}</span><label className="check"><input aria-label="透明背景" type="checkbox" checked={board.background==='transparent'} onChange={e=>patch({background:e.target.checked?'transparent':'#ffffff'})}/>透明</label></div>
    <div className="board-actions"><BoardSizeControl board={board} apply={applySize} disabled={disabled||board.locked}><Button className="board-size-trigger">尺寸预设</Button></BoardSizeControl><Button iconOnly icon="copy" onClick={duplicate} disabled={disabled}>复制画板</Button><Button iconOnly icon="delete" onClick={remove} disabled={disabled||!canRemove}>删除画板</Button></div>
  </fieldset>;
}
export function CompositeWorkspace({document,change,selected,setSelected,initialPageView,onPageView,...props}) {
  const normalized=useMemo(()=>artboards.normalize(document),[document]);
  const list=artboards.boards(normalized);
  const [activeId,setActiveId]=useState(null),[dialog,setDialog]=useState(null),[error,setError]=useState('');
  const [maskId,setMaskId]=useState(null);
  const [scaleContent,setScaleContent]=useState(false);
  const view=useRef(initialPageView||null), latest=useRef(null);
  useUiView('boards',{get:()=>({activeId,maskId,scaleContent,view:view.current}),restore:v=>{view.current=v.view;setActiveId(v.activeId);setMaskId(v.maskId);setScaleContent(v.scaleContent);}});
  const selectedOwner=selected.length ? artboards.owner(normalized,selected[0]) : null;
  const board=selectedOwner || list.find(b=>b.id===activeId) || list[0];
  const local=useMemo(()=>artboards.extract(normalized,board.id),[normalized,board.id]);
  latest.current={normalized,board};
  const run=fn=>{try{setError('');return fn()}catch(e){setError(e.message);return false}};
  const activate=(id,ids=[])=>{setActiveId(id);setSelected(ids)};
  const save=next=>{artboards.validate(next);return change(next)};
  const edit=next=>run(()=>{if(latest.current.board.locked)throw Error('请先解锁画板');return save(artboards.replace(latest.current.normalized,latest.current.board.id,next))});
  const patch=values=>run(()=>{if(board.locked)throw Error('请先解锁画板');return save(artboards.update(normalized,board.id,values))});
  const resize=values=>run(()=>{if(board.locked)throw Error('请先解锁画板');return save(artboards.update(normalized,board.id,values,{scaleContent}))});
  const applySize=(width,height,scaleContent)=>run(()=>{if(board.locked)throw Error('请先解锁画板');return save(artboards.update(normalized,board.id,{width,height},{scaleContent}))});
  const createBoard=(width,height)=>run(()=>{const result=artboards.create(normalized,{width,height});if(save(result.document)===false)return false;view.current=null;activate(result.id)});
  const choose=(id,extend)=>{
    setMaskId(null);
    const b=artboards.owner(normalized,id);if(!b)return;
    if(b.id===id){activate(id);return}
    activate(b.id,extend&&b.id===board.id ? selected.includes(id)?selected.filter(n=>n!==id):[...selected,id] : [id]);
  };
  const relocate=(ids,targetId,placement)=>run(()=>{
    targetId=targetId || board.id;
    const next=artboards.relocate(normalized,ids,targetId,placement);
    if(save(next)!==false)activate(artboards.owner(next,ids[0]).id,ids);
  });
  const workspace={
    board,boards:list.map(b=>({...b,x:b.x-board.x,y:b.y-board.y})),layers:normalized.layers,
    parameters:<fieldset className="board-tool-options" disabled={props.disabled||board.locked}>
      <BoardSizeControl board={board} apply={applySize} disabled={props.disabled||board.locked}><Button className="board-preset-button">{presets.find(([,w,h])=>w===board.width&&h===board.height)?.[0]||'自定义尺寸'}<Icon name="collapse"/></Button></BoardSizeControl>
      <NumberField label="工具栏画板宽度" shortLabel="W" value={board.width} min={1} max={30000} onChange={width=>resize({width})}/><NumberField label="工具栏画板高度" shortLabel="H" value={board.height} min={1} max={30000} onChange={height=>resize({height})}/>
      <Button icon="replace" onClick={()=>resize({width:board.height,height:board.width})}>交换宽高</Button>
      <label className="check"><input type="checkbox" checked={scaleContent} onChange={e=>setScaleContent(e.target.checked)}/>缩放内容</label>
      <BoardSizeControl board={board} creating apply={createBoard} disabled={props.disabled||board.locked}><Button icon="add">新建画板</Button></BoardSizeControl>
    </fieldset>,
    initialView:view.current ? {...view.current,x:view.current.x+board.x*view.current.zoom,y:view.current.y+board.y*view.current.zoom}:null,
    onView:v=>{view.current={...v,x:v.x-board.x*v.zoom,y:v.y-board.y*v.zoom};onPageView?.(view.current)},
    compose:(edited,drag)=>{
      const rendered=artboards.display(normalized,board.id,edited);
      if(!drag)return rendered;
      const b=artboards.boards(rendered).find(b=>b.id===drag.id);
      return artboards.update(rendered,b.id,drag.width?{width:drag.width,height:drag.height}:{x:b.x+drag.dx,y:b.y+drag.dy});
    },
    addShape:(layer,id)=>run(()=>{if(list.find(b=>b.id===id)?.locked)throw Error('请先解锁画板');const result=save({...normalized,layers:[...normalized.layers,{...layer,parentId:id}]});if(result!==false)activate(id,[layer.id]);return result}),
    activate,choose,relocate,maskId,selectMask:id=>{const b=artboards.owner(normalized,id);if(b){setMaskId(id);activate(b.id,[id])}},
    move:(id,dx,dy)=>run(()=>{const b=list.find(b=>b.id===id);return save(artboards.update(normalized,id,{x:b.x+dx,y:b.y+dy}))}),
    resizeBoard:(id,width,height)=>run(()=>save(artboards.update(normalized,id,{width,height}))),
    patchLayer:(id,values)=>run(()=>save({...normalized,layers:normalized.layers.map(l=>l.id===id?{...l,...values}:l)})),
    inspector:<BoardInspector key={`${board.id}-${board.name}`} board={board} patch={patch} applySize={applySize} disabled={props.disabled} canRemove={list.length>1}
      duplicate={()=>run(()=>{const result=artboards.duplicate(normalized,board.id);if(save(result.document)!==false){view.current=null;activate(result.id)}})}
      remove={()=>setDialog('delete')}/>,
  };
  return <div className="composite-workspace">
    {error&&<div className="message error" role="alert">{error}<Button iconOnly icon="close" onClick={()=>setError('')}>关闭错误</Button></div>}
    <LayerEditor key={board.id} {...props} document={local} change={edit} selected={selected.filter(id=>local.layers.some(l=>l.id===id))} setSelected={setSelected} workspace={workspace}/>
    {dialog==='delete'&&<Modal open getContainer={()=>window.document.getElementById('dialogs')} transitionName="" maskTransitionName="" title={`删除“${board.name}”？`} onCancel={()=>setDialog(null)} onOk={()=>run(()=>{if(save(artboards.remove(normalized,board.id))===false)return;activate(list.find(b=>b.id!==board.id).id);setDialog(null)})} okText="删除画板" cancelText="取消" okButtonProps={{danger:true}}><p>画板内的 {local.layers.length} 个图层会一起删除。可通过撤销恢复。</p></Modal>}
  </div>;
}
