import {Select} from './select.jsx';
import React,{useState} from 'react';
import {Input,Button,ToolPopover} from './components.jsx';

const imageSizes=['1024x1024','1024x1536','1536x1024','2048x2048','2048x3072','3072x2048','4096x4096'];
const videoSizes=['1280x720','720x1280','1920x1080','1080x1920','3840x2160','2160x3840'];
const qualities=[['auto','自动'],['low','低'],['medium','中'],['high','高'],['standard','标准'],['hd','高清']];

export function sizeDescription(value){
  if(!value||value==='auto')return '自动尺寸';
  const [w,h]=value.split('x').map(Number);
  const ratio=w===h?'1:1':w*3===h*2?'2:3':w*2===h*3?'3:2':w*9===h*16?'16:9':w*16===h*9?'9:16':'自定义';
  return `${ratio} · ${w===h?'方图':w<h?'竖图':'横图'}`;
}

export function ModelChoice({value,shared,disabled,onChange,openConnection}){
  const [mode,setMode]=useState(value?'custom':'shared'),[draft,setDraft]=useState(value||'');
  return <ToolPopover label={value||shared||'选择模型'} icon="model" showLabel description={value?'单独指定':'共享模型'} triggerClassName="generation-model" className="desk-popover model-picker" onOpenChange={open=>{if(open){setMode(value?'custom':'shared');setDraft(value||'');}}}>
    <h3>选择模型</h3>
    <div className="choice-tabs" data-keep-open role="group" aria-label="模型来源">{[['shared','沿用共享'],['custom','单独指定']].map(([id,label])=><Button key={id} aria-pressed={mode===id} disabled={disabled} onClick={()=>setMode(id)}>{label}</Button>)}</div>
    {mode==='shared'?<div className="shared-model"><strong>{shared||'尚未配置模型'}</strong><small>来自模型连接，随共享设置更新</small></div>:<label>完整模型 ID<Input aria-label="生成台模型" value={draft} disabled={disabled} placeholder="填写服务商提供的模型 ID" onChange={e=>setDraft(e.target.value)}/></label>}
    <div className="node-popup-actions"><Button onClick={openConnection}>模型连接</Button><Button primary disabled={disabled||(mode==='custom'&&!draft.trim())} onClick={()=>onChange(mode==='shared'?'':draft.trim())}>应用模型</Button></div>
  </ToolPopover>;
}

export function GenerationChoice({kind,mode,value,disabled,onChange,'aria-label':label}){
  const [custom,setCustom]=useState(false),size=kind==='size',current=value||'auto';
  const options=size?[['auto','自动'],...(mode==='video'?videoSizes:imageSizes).map(v=>[v,v.replace('x',' × ')])]:qualities;
  const known=options.some(([v])=>v===current),editing=size&&(custom||!known);
  const [w,h]=current.split('x').map(Number),ratio=current==='auto'?'auto':w===h?'square':w<h?'portrait':'landscape';
  return <div className="generation-choice" style={{display:'grid',gap:10}}>
    {size&&<div className="ratio-choices" role="group" aria-label="画面比例" data-keep-open>{[['auto','自动',1,1],['square','1:1',1,1],['portrait',mode==='video'?'9:16':'2:3',2,3],['landscape',mode==='video'?'16:9':'3:2',3,2]].filter(([id])=>mode!=='video'||id!=='square').map(([id,text,rw,rh])=><button key={id} type="button" disabled={disabled} aria-pressed={!editing&&ratio===id} onClick={()=>{setCustom(false);onChange(id==='auto'?'auto':id==='square'?'1024x1024':mode==='video'?(id==='portrait'?'720x1280':'1280x720'):(id==='portrait'?'1024x1536':'1536x1024'));}}><i style={{width:Math.round(24*rw/Math.max(rw,rh)),height:Math.round(24*rh/Math.max(rw,rh))}}/><span>{text}</span></button>)}</div>}
    <Select aria-label={label} disabled={disabled} value={editing?'custom':current} onChange={e=>{setCustom(e.target.value==='custom');if(e.target.value!=='custom')onChange(e.target.value);}}>
      {options.map(([v,text])=><option key={v} value={v}>{text}</option>)}
      {!size&&!known&&<option value={current}>{current}（当前值）</option>}
      {size&&<option value="custom">自定义尺寸</option>}
    </Select>
    {editing&&<Input aria-label={`${label}（自定义）`} disabled={disabled} value={value||''} placeholder="宽 × 高，例如 2048x3072" onChange={e=>onChange(e.target.value)}/>}
  </div>;
}
