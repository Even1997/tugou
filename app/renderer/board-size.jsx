import React, {useEffect,useRef,useState} from 'react';
import {Popover} from 'antd';
import {Button,Input,Icon} from './components.jsx';
import './board-size.css';
import {Select} from './select.jsx';
import {dimensions,measure,units} from '../core/board-measure.cjs';
import {boardPresetGroups,boardPresets} from './board-presets.js';
export {boardPresets} from './board-presets.js';

function BoardSizeForm({board,creating,apply,close}) {
  const panel=useRef(null);
  useEffect(()=>{panel.current?.querySelector('input[type=number]')?.focus()},[]);
  const [unit,setUnit]=useState(board.printSize?.unit||'px'),[ppi,setPpi]=useState(board.printSize?.ppi||300);
  const initial=dimensions(board),[width,setWidth]=useState(initial.width),[height,setHeight]=useState(initial.height),[scale,setScale]=useState(false);
  const [category,setCategory]=useState('常用'),[query,setQuery]=useState('');
  const search=query.toLowerCase().replace(/\s/g,'').replace(/[×*]/g,'x');
  const presets=search?boardPresets.filter(p=>`${p[0]} ${p[1]}x${p[2]} ${p[3]}`.toLowerCase().replace(/\s/g,'').replace(/[×*]/g,'x').includes(search)):boardPresetGroups[category];
  let size,error;
  try{size=measure(+width,+height,unit,+ppi);}catch(e){error=e.message;}
  const exact=useRef(board);
  const switchUnit=next=>{if(size){if(unit!=='px'||exact.current.width!==size.width||exact.current.height!==size.height||exact.current.printSize?.ppi!==+ppi)exact.current=size;
    const value=dimensions(exact.current,next,+ppi);setWidth(value.width);setHeight(value.height);}setUnit(next);};
  const pick=(w,h,print)=>{setWidth(print?.width??w);setHeight(print?.height??h);setUnit(print?.unit||'px');if(print)setPpi(300);};
  return <section ref={panel} className="board-size-panel" role="dialog" aria-label={creating?'新建画板尺寸':'画板尺寸'} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();close()}}}>
    <header><strong>{creating?'新建画板':'画板尺寸'}</strong><Button iconOnly icon="close" onClick={close}>关闭尺寸浮层</Button></header>
    <div className="board-preset-browser"><Input aria-label="搜索画板预设" placeholder="搜索全部预设 / 尺寸" prefix={<Icon name="search"/>} allowClear value={query} onChange={e=>setQuery(e.target.value)}/>
      <div className="board-preset-categories" role="group" aria-label="画板预设分类">{Object.keys(boardPresetGroups).map(name=><Button key={name} aria-pressed={!search&&category===name} onClick={()=>{setCategory(name);setQuery('')}}>{name}</Button>)}</div>
      <small>{search?`搜索结果 · ${presets.length} 项`:`${category} · ${presets.length} 项`}</small>
    </div>
    <div className="board-size-presets">{presets.map(([name,w,h,ratio,print])=><Button key={name} aria-label={name} aria-pressed={size?.width===w&&size?.height===h} onClick={()=>pick(w,h,print)}>
      <span className="preset-aspect"><i style={{width:Math.round(22*Math.min(1,w/h)),height:Math.round(22*Math.min(1,h/w))}}/></span>
      <span className="preset-copy"><span>{name}</span><small>{w} × {h} px</small></span><span className="preset-ratio">{ratio}</span>{size?.width===w&&size?.height===h&&<Icon name="check"/>}
    </Button>)}{!presets.length&&<p className="board-presets-empty">没有匹配的预设，可在下方填写宽高。</p>}</div>
    <div className="board-size-custom"><label>尺寸单位 <Select getPopupContainer={trigger=>trigger.closest('.board-size-panel')} aria-label="尺寸单位" value={unit} onChange={e=>switchUnit(e.target.value)}>{Object.entries(units).map(([id,label])=><option key={id} value={id}>{label}（{id}）</option>)}</Select></label><div className="board-size-fields"><label><span>W</span><Input aria-label="画板宽度" type="number" min={unit==='px'?1:0} step={unit==='px'?1:'any'} value={width} onChange={e=>setWidth(e.target.value)}/><small>{unit}</small></label><label><span>H</span><Input aria-label="画板高度" type="number" min={unit==='px'?1:0} step={unit==='px'?1:'any'} value={height} onChange={e=>setHeight(e.target.value)}/><small>{unit}</small></label></div>
      <div className="board-size-fields"><label><span>PPI</span><Input aria-label="画板分辨率" type="number" min={1} max={2400} step="any" value={ppi} onChange={e=>setPpi(e.target.value)}/></label>{size&&unit!=='px'&&<output>{size.width} × {size.height} px</output>}</div>
      {!creating&&<label className="check"><input type="checkbox" checked={scale} onChange={e=>setScale(e.target.checked)}/>同时缩放画板内容</label>}
      {error&&<p role="alert">{error}</p>}
    </div>
    <footer className="board-dialog-actions"><Button onClick={close}>取消</Button><Button className="primary" disabled={!size} onClick={()=>{if(apply(size.width,size.height,scale,size.printSize)!==false)close()}}>{creating?'创建画板':'应用尺寸'}</Button></footer>
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
