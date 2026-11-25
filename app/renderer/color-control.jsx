import React, {useLayoutEffect,useRef,useState} from 'react';
import {ColorPicker} from 'antd';
import {Button} from './components.jsx';
import {useBrandKit} from './brand-kit.jsx';
import './color-control.css';

export function ColorControl({value,onChange,disabled,'aria-label':label='颜色'}) {
  const host=useRef(null),[open,setOpen]=useState(false),[draft,setDraft]=useState(value),[inheritedDisabled,setInheritedDisabled]=useState(false);
  const {brandKit,addColor,openBrandKit}=useBrandKit();
  useLayoutEffect(()=>{setInheritedDisabled(!!host.current?.closest('fieldset:disabled'))});
  const toggle=next=>{if(next)setDraft(value);else if(document.activeElement?.closest('.color-control-panel'))host.current?.querySelector('button')?.focus();setOpen(next)};
  const hex=typeof draft==='string'?draft:draft.toHexString();
  const apply=nextHex=>{if(nextHex.toLowerCase()!==value.toLowerCase())onChange({target:{value:nextHex},currentTarget:{value:nextHex}});toggle(false);};
  return <span className="color-control" ref={host} onKeyDown={e=>e.stopPropagation()}>
    <ColorPicker value={draft} onChange={setDraft} open={open&&!disabled&&!inheritedDisabled} onOpenChange={toggle} disabled={disabled||inheritedDisabled} disabledAlpha defaultFormat="hex" arrow={false} destroyOnHidden
      autoAdjustOverflow={{adjustX:1,adjustY:1,shiftX:true,shiftY:true}} classNames={{popup:{root:'color-control-popup'}}}
      panelRender={panel=><section className="color-control-panel" aria-label={`${label}选择器`} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();toggle(false)}}}>
        <header><strong>{label}</strong><Button iconOnly icon="close" onClick={()=>toggle(false)}>关闭颜色选择器</Button></header>
        {panel}
        {(brandKit.colors.length>0||addColor)&&<div className="color-control-brand">
          <div className="color-control-brand-head">
            <span>工程色板</span>
            <div>
              {addColor&&<button type="button" onClick={()=>addColor(hex)}>+ 存当前色</button>}
              {openBrandKit&&<button type="button" style={{marginLeft:8}} onClick={()=>{toggle(false);openBrandKit();}}>管理</button>}
            </div>
          </div>
          {brandKit.colors.length>0&&<div className="color-control-brand-swatches">
            {brandKit.colors.map(c=><button key={c.hex} type="button" title={`${c.name||c.hex} · ${c.hex}`} aria-label={`使用工程色 ${c.name||c.hex}`} style={{background:c.hex}} onClick={()=>apply(c.hex)}/>)}
          </div>}
        </div>}
        <footer><span className="color-compare" title="原色 / 新色"><i style={{background:value}}/><i style={{background:hex}}/></span><Button onClick={()=>toggle(false)}>取消</Button><Button primary onClick={()=>apply(hex)}>应用颜色</Button></footer>
      </section>}>
      <button type="button" className="color-control-trigger" aria-label={label} aria-haspopup="dialog" aria-expanded={open} disabled={disabled||inheritedDisabled} title={`${label} · ${value.toUpperCase()}`} data-color={value}><span style={{background:value}}/></button>
    </ColorPicker>
  </span>;
}
