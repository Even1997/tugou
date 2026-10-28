import React, { useEffect, useRef, useState } from 'react';
import { Dropdown } from 'antd';
import { Button, Icon, Input } from './components.jsx';

const entries = [
  ['text', '文字提示词', 'text', '文本 prompt text'],
  ['emptyImage', '图片节点', 'assets', '图像 image picture'],
  ['config', '生成台', 'tools', '生成 生图 generator'],
  ['textgen', '文本生成', 'text', '文案 text'],
  ['image', '图片生成', 'tools', '生图 image'],
  ['import', '导入图片', 'import', '上传 image upload'],
];

export function CanvasNodeMenu({ position, close, choose, disabled, canChoose }) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[activeKey,setActiveKey]=useState();
  const input=useRef(null),panel=useRef(null),trigger=useRef(null),previousFocus=useRef(null),visible=!!position||open;
  const filtered=entries.filter(([key,label,,aliases])=>(!canChoose||canChoose(key))&&`${label} ${aliases}`.toLowerCase().includes(query.trim().toLowerCase()));
  const dismiss=restore=>{setOpen(false);close();if(restore)requestAnimationFrame(()=>{if(!position)trigger.current?.focus();else if(previousFocus.current?.isConnected)previousFocus.current.focus();});};
  const pick=key=>{setOpen(false);choose(key,position?.point);requestAnimationFrame(()=>document.querySelector('.canvas-workspace')?.focus());};
  useEffect(()=>{
    if(!visible)return;
    previousFocus.current=document.activeElement;
    setQuery('');setActiveKey(undefined);
    const frame=requestAnimationFrame(()=>input.current?.focus());
    return ()=>cancelAnimationFrame(frame);
  },[visible]);
  useEffect(()=>{
    if(!position)return;
    const outside=event=>{if(!event.target.closest('.canvas-node-dropdown'))close();};
    document.addEventListener('pointerdown',outside,true);
    return ()=>document.removeEventListener('pointerdown',outside,true);
  },[position,close]);
  const items=filtered.flatMap(([key,label,icon],index)=>[
    ...(!query.trim()&&index>0&&key==='textgen'?[{type:'divider',key:'more'}]:[]),
    {key,label,icon:<Icon name={icon}/>,onFocus:()=>setActiveKey(key)},
  ]);
  return <Dropdown
    overlayClassName="canvas-node-dropdown"
    disabled={disabled}
    trigger={position ? [] : ['click']}
    open={visible&&!disabled}
    destroyOnHidden
    onOpenChange={next=>{setOpen(next);if(!next)close();}}
    popupRender={menu=><div ref={panel} className="canvas-node-picker" onKeyDown={event=>{
      event.stopPropagation();
      if(event.key==='Escape'&&!event.nativeEvent.isComposing){event.preventDefault();dismiss(true);}
    }}>
      <Input ref={input} aria-label="搜索节点类型" prefix={<Icon name="search"/>} allowClear value={query} placeholder={canChoose?'搜索可连接节点…':'搜索节点…'} onChange={e=>{setQuery(e.target.value);setActiveKey(undefined);}} onKeyDown={event=>{
        if(event.nativeEvent.isComposing||event.keyCode===229)return;
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();event.stopPropagation();
          const options=panel.current.querySelectorAll('[role=menuitem]');
          const next=options[event.key==='ArrowDown'?0:options.length-1];next?.focus();next?.scrollIntoView({block:'nearest'});
        }else if(event.key==='Enter'&&filtered.length){event.preventDefault();event.stopPropagation();pick(filtered[0][0]);}
      }}/>
      {filtered.length?menu:<p className="node-search-empty" role="status">没有匹配的节点，试试“图片”或“生成”</p>}
      <small className="node-picker-hint">↑↓ 选择 · Enter 添加 · Esc 关闭</small>
    </div>}
    menu={{ items, activeKey, style:{maxHeight:'min(420px, 55vh)',overflowY:'auto'}, onClick: ({key}) => pick(key) }}
  >
    {position
      ? <span style={{position:'fixed',left:position.x,top:position.y,width:1,height:1,pointerEvents:'none'}}/>
      : <Button ref={trigger} iconOnly icon="add" disabled={disabled}>添加节点</Button>}
  </Dropdown>;
}
