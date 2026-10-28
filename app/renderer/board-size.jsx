import React, {useEffect,useRef,useState} from 'react';
import {Popover} from 'antd';
import {Button,Input,Icon} from './components.jsx';
import './board-size.css';
import {boardPresetGroups,boardPresets} from './board-presets.js';
export {boardPresets} from './board-presets.js';

function BoardSizeForm({board,creating,apply,close}) {
  const panel=useRef(null);
  useEffect(()=>{panel.current?.querySelector('input[type=number]')?.focus()},[]);
  const [width,setWidth]=useState(board.width),[height,setHeight]=useState(board.height),[scale,setScale]=useState(false);
  const [category,setCategory]=useState('常用'),[query,setQuery]=useState('');
  const search=query.toLowerCase().replace(/\s/g,'').replace(/[×*]/g,'x');
  const presets=search?boardPresets.filter(p=>`${p[0]} ${p[1]}x${p[2]} ${p[3]}`.toLowerCase().replace(/\s/g,'').replace(/[×*]/g,'x').includes(search)):boardPresetGroups[category];
  const valid=Number.isInteger(+width)&&+width>0&&+width<=30000&&Number.isInteger(+height)&&+height>0&&+height<=30000&&width*height<=100000000;
  return <section ref={panel} className="board-size-panel" role="dialog" aria-label={creating?'新建画板尺寸':'画板尺寸'} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close()}}}>
    <header><strong>{creating?'新建画板':'画板尺寸'}</strong><Button iconOnly icon="close" onClick={close}>关闭尺寸浮层</Button></header>
    <div className="board-preset-browser"><Input aria-label="搜索画板预设" placeholder="搜索全部预设 / 尺寸" prefix={<Icon name="search"/>} allowClear value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="board-preset-categories" role="group" aria-label="画板预设分类">{Object.keys(boardPresetGroups).map(name=><Button key={name} aria-pressed={!search&&category===name} onClick={()=>{setCategory(name);setQuery('')}}>{name}</Button>)}</div>
      <small>{search?`搜索结果 · ${presets.length} 项`:`${category} · ${presets.length} 项`}</small>
    </div>
    <div className="board-size-presets">{presets.map(([name,w,h,ratio])=><Button key={name} aria-label={name} aria-pressed={+width===w&&+height===h} onClick={()=>{setWidth(w);setHeight(h)}}>
      <span className="preset-aspect"><i style={{width:Math.round(22*Math.min(1,w/h)),height:Math.round(22*Math.min(1,h/w))}}/></span>
      <span className="preset-copy"><span>{name}</span><small>{w} × {h} px</small></span><span className="preset-ratio">{ratio}</span>{+width===w&&+height===h&&<Icon name="check"/>}
    </Button>)}{!presets.length&&<p className="board-presets-empty">没有匹配的预设，可在下方填写宽高。</p>}</div>
    <div className="board-size-custom"><span>自定义尺寸</span><div className="board-size-fields"><label><span>W</span><Input aria-label="画板宽度" type="number" min={1} max={30000} value={width} onChange={e=>setWidth(e.target.value)}/><small>px</small></label><label><span>H</span><Input aria-label="画板高度" type="number" min={1} max={30000} value={height} onChange={e=>setHeight(e.target.value)}/><small>px</small></label></div>
      {(category==='印刷'||category==='照片'||presets.some(p=>p[3]==='300 PPI'))&&<p className="board-print-note">印刷与照片按 300 PPI 换算像素，不含出血。</p>}
      {!creating&&<label className="check"><input type="checkbox" checked={scale} onChange={e=>setScale(e.target.checked)}/>同时缩放画板内容</label>}
      {!valid&&<p role="alert">请输入正整数，单边最多 30000，总计一亿像素。</p>}
    </div>
    <footer className="board-dialog-actions"><Button onClick={close}>取消</Button><Button className="primary" disabled={!valid} onClick={()=>{if(apply(+width,+height,scale)!==false)close()}}>{creating?'创建画板':'应用尺寸'}</Button></footer>
  </section>;
}
export function BoardSizeControl({board,creating=false,apply,disabled,children}) {
  const [open,setOpen]=useState(false),host=useRef(null);
  const toggle=next=>{if(!next&&document.activeElement?.closest('.board-size-panel'))host.current?.querySelector('button')?.focus();setOpen(next)};
  return <span ref={host} className="board-size-control"><Popover open={open&&!disabled} onOpenChange={toggle} trigger="click" placement="bottomLeft" arrow={false} align={{offset:[0,0]}} destroyOnHidden autoAdjustOverflow={{adjustX:1,adjustY:1,shiftX:true,shiftY:true}}
    classNames={{root:'board-size-popover'}} content={<BoardSizeForm key={board.id} board={board} creating={creating} apply={apply} close={()=>toggle(false)}/>}>
    {children}
  </Popover></span>;
}
