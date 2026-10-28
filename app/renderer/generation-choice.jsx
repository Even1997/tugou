import {Select} from './select.jsx';
import React,{useState} from 'react';
import {Input,Button,ToolPopover} from './components.jsx';
import {imageRatios,ratioOf,sizeOptions} from './generation-sizes.js';
export {sizeDescription} from './generation-sizes.js';

const qualities=[['auto','自动'],['low','低'],['medium','中'],['high','高'],['standard','标准'],['hd','高清']];

export function ModelChoice({value,shared,disabled,onChange,openConnection}){
  const [mode,setMode]=useState(value?'custom':'shared'),[draft,setDraft]=useState(value||'');
  return <ToolPopover label={value||shared||'选择模型'} icon="model" showLabel description={value?'单独指定':'共享模型'} triggerClassName="generation-model" className="desk-popover model-picker" onOpenChange={open=>{if(open){setMode(value?'custom':'shared');setDraft(value||'');}}}>
    <h3>选择模型</h3>
    <div className="choice-tabs" data-keep-open role="group" aria-label="模型来源">{[['shared','沿用共享'],['custom','单独指定']].map(([id,label])=><Button key={id} aria-pressed={mode===id} disabled={disabled} onClick={()=>setMode(id)}>{label}</Button>)}</div>
    {mode==='shared'?<div className="shared-model"><strong>{shared||'尚未配置模型'}</strong><small>来自模型连接，随共享设置更新</small></div>:<label>完整模型 ID<Input aria-label="生成台模型" value={draft} disabled={disabled} placeholder="填写服务商提供的模型 ID" onChange={e=>setDraft(e.target.value)}/></label>}
    <div className="node-popup-actions"><Button onClick={openConnection}>模型连接</Button><Button primary disabled={disabled||(mode==='custom'&&!draft.trim())} onClick={()=>onChange(mode==='shared'?'':draft.trim())}>应用模型</Button></div>
  </ToolPopover>;
}

export function GenerationChoice({kind,value,disabled,onChange,'aria-label':label}){
  const [custom,setCustom]=useState(false),size=kind==='size',current=value||'auto';
  const options=size?sizeOptions(current).map(v=>[v,v==='auto'?'自动':v.replace('x',' × ')]):qualities;
  const known=options.some(([v])=>v===current),ratio=ratioOf(current),editing=size&&(custom||ratio==='custom');
  const dimensions=current.includes('x')?current.split('x'):['',''];
  return <div className="generation-choice" style={{display:'grid',gap:10}}>
    {size&&<div className="ratio-choices" role="group" aria-label="画面比例" data-keep-open>{[['auto',['auto']],...imageRatios,['custom',[]]].map(([id,sizes])=>{const [rw,rh]=id.includes(':')?id.split(':').map(Number):[1,1];return <button key={id} type="button" disabled={disabled} aria-pressed={editing?id==='custom':ratio===id} onClick={()=>{setCustom(id==='custom');if(id!=='custom')onChange(sizes[0]);else if(current==='auto')onChange('1024x1024');}}><i style={{width:Math.round(22*rw/Math.max(rw,rh)),height:Math.round(22*rh/Math.max(rw,rh))}}/><span>{id==='auto'?'自动':id==='custom'?'自定义':id}</span></button>;})}</div>}
    {!editing&&<Select aria-label={label} disabled={disabled} value={current} onChange={e=>onChange(e.target.value)}>
      {options.map(([v,text])=><option key={v} value={v}>{text}</option>)}
      {!size&&!known&&<option value={current}>{current}（当前值）</option>}
    </Select>}
    {editing&&<div className="generation-dimensions">{['宽度','高度'].map((name,index)=><div key={name}><span>{name}</span><Input aria-label={`${label}（${name}）`} type="number" min={1} max={99999} step={1} required suffix="px" disabled={disabled} value={dimensions[index]||''} onChange={e=>onChange(dimensions.map((v,i)=>i===index?e.target.value:v).join('x'))}/></div>)}</div>}
  </div>;
}
