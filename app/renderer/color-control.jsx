import React, {useLayoutEffect,useRef,useState} from 'react';
import {ColorPicker} from 'antd';
import {Button} from './components.jsx';
import './color-control.css';

export function ColorControl({value,onChange,disabled,'aria-label':label='颜色'}) {
  const host=useRef(null),[open,setOpen]=useState(false),[draft,setDraft]=useState(value),[inheritedDisabled,setInheritedDisabled]=useState(false);
  useLayoutEffect(()=>{setInheritedDisabled(!!host.current?.closest('fieldset:disabled'))});
  const toggle=next=>{if(next)setDraft(value);else if(document.activeElement?.closest('.color-control-panel'))host.current?.querySelector('button')?.focus();setOpen(next)};
  const hex=typeof draft==='string'?draft:draft.toHexString();
  return <span className="color-control" ref={host} onKeyDown={e=>e.stopPropagation()}>
    <ColorPicker value={draft} onChange={setDraft} open={open&&!disabled&&!inheritedDisabled} onOpenChange={toggle} disabled={disabled||inheritedDisabled} disabledAlpha defaultFormat="hex" arrow={false} destroyOnHidden
      autoAdjustOverflow={{adjustX:1,adjustY:1,shiftX:true,shiftY:true}} classNames={{popup:{root:'color-control-popup'}}}
      panelRender={panel=><section className="color-control-panel" aria-label={`${label}选择器`} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();toggle(false)}}}>
        <header><strong>{label}</strong><Button iconOnly icon="close" onClick={()=>toggle(false)}>关闭颜色选择器</Button></header>
        {panel}
        <footer><span className="color-compare" title="原色 / 新色"><i style={{background:value}}/><i style={{background:hex}}/></span><Button onClick={()=>toggle(false)}>取消</Button><Button primary onClick={()=>{if(hex.toLowerCase()!==value.toLowerCase())onChange({target:{value:hex},currentTarget:{value:hex}});toggle(false)}}>应用颜色</Button></footer>
      </section>}>
      <button type="button" className="color-control-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled||inheritedDisabled} title={`${label} · ${value.toUpperCase()}`} data-color={value}><span style={{background:value}}/></button>
    </ColorPicker>
  </span>;
}
