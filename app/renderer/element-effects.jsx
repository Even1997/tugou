import React from 'react';
import {Button,IconButton} from './components.jsx';
import {NumberField} from './number-field.jsx';
import {ColorControl} from './color-control.jsx';
import {types,defaults} from '../core/effects.cjs';
import './element-effects.css';

const names={shadow:'外阴影',innerShadow:'内阴影',stroke:'边框'};
export function ElementEffects({effects=[],onChange,presentation=false}){
  const update=(id,patch)=>onChange(effects.map(e=>e.id===id?{...e,...patch}:e));
  return <section className="element-effects" aria-label="阴影与边框">
    <h3>阴影与边框</h3>
    <div className="element-effects-add">{Object.entries(names).map(([type,name])=><Button key={type} icon="add" aria-label={`添加${name}`} disabled={presentation&&effects.some(e=>e.type===type)} onClick={()=>onChange([...effects,{...defaults(type),...(presentation&&type==='stroke'?{position:'center'}:{})}])}>{name}</Button>)}</div>
    {effects.filter(e=>names[e.type]).map(e=><details key={e.id} open className="element-effect">
      <summary><span>{names[e.type]}</span><span className="element-effect-actions" onClick={event=>event.stopPropagation()}><input type="checkbox" aria-label={`启用${names[e.type]}`} checked={e.enabled} onChange={event=>update(e.id,{enabled:event.target.checked})}/><IconButton label={`移除${names[e.type]}`} icon="close" onClick={()=>onChange(effects.filter(v=>v.id!==e.id))}/></span></summary>
      <fieldset disabled={!e.enabled} className="element-effect-fields">
        <label>颜色<ColorControl aria-label={`${names[e.type]}颜色`} value={e.color} onChange={event=>update(e.id,{color:event.target.value})}/></label>
        <NumberField label={`${names[e.type]}不透明度`} shortLabel="不透明度 %" value={e.opacity} min={0} max={100} onChange={opacity=>update(e.id,{opacity})}/>
        {Object.entries(types[e.type].values).filter(([key])=>!presentation||key!=='spread').map(([key,[label,,min,max,step]])=><NumberField key={key} label={`${names[e.type]}${key==='size'?'粗细':label}`} shortLabel={key==='size'?'粗细 px':label} value={e[key]} min={min} max={presentation&&key==='radius'?100:presentation&&key==='distance'?200:max} step={step||1} onChange={value=>update(e.id,{[key]:value})}/>)}
      </fieldset>
    </details>)}
    {presentation&&<p>边框围绕元素外框，阴影跟随可见内容。</p>}
  </section>;
}
