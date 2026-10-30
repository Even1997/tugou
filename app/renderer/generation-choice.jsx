import {Select} from './select.jsx';
import React,{useState} from 'react';
import {Input,Button,ToolPopover} from './components.jsx';
import {ratioOf} from './generation-sizes.js';
import {imageCapabilities,imageSettingsError,resolutionOf,sizeFor,qualityLabels} from '../core/image-settings.cjs';
export {sizeDescription} from './generation-sizes.js';

export function ModelChoice({value,shared,disabled,onChange,openConnection}){
  const [mode,setMode]=useState(value?'custom':'shared'),[draft,setDraft]=useState(value||'');
  return <ToolPopover label={value||shared||'选择模型'} icon="model" showLabel description={value?'单独指定':'共享模型'} triggerClassName="generation-model" className="desk-popover model-picker" onOpenChange={open=>{if(open){setMode(value?'custom':'shared');setDraft(value||'');}}}>
    <h3>选择模型</h3>
    <div className="choice-tabs" data-keep-open role="group" aria-label="模型来源">{[['shared','沿用共享'],['custom','单独指定']].map(([id,label])=><Button key={id} aria-pressed={mode===id} disabled={disabled} onClick={()=>setMode(id)}>{label}</Button>)}</div>
    {mode==='shared'?<div className="shared-model"><strong>{shared||'尚未配置模型'}</strong><small>来自模型连接，随共享设置更新</small></div>:<label>完整模型 ID<Input aria-label="生成台模型" value={draft} disabled={disabled} placeholder="填写服务商提供的模型 ID" onChange={e=>setDraft(e.target.value)}/></label>}
    <div className="node-popup-actions"><Button onClick={openConnection}>模型连接</Button><Button primary disabled={disabled||(mode==='custom'&&!draft.trim())} onClick={()=>onChange(mode==='shared'?'':draft.trim())}>应用模型</Button></div>
  </ToolPopover>;
}

export function GenerationChoice({kind,value,model='',disabled,onChange,'aria-label':label}){
  const [customSize,setCustomSize]=useState(null),size=kind==='size',current=value||'auto';
  const profile=imageCapabilities(model),ratio=ratioOf(current),resolution=resolutionOf(current,model);
  const custom=profile.custom&&customSize===current;
  const error=imageSettingsError(model,size?{size:current}:{quality:current});
  const dimensions=current.includes('x')?current.split('x'):['',''];
  const selectRatio=id=>{setCustomSize(id==='custom'?(current==='auto'?'1024x1024':current):null);if(id==='auto')onChange('auto');else if(id==='custom'){if(current==='auto')onChange('1024x1024');}else onChange(sizeFor(id,profile.resolutions.includes(resolution)?resolution:'1k',model));};
  return <div className="generation-choice">
    {size?<>
      <div className="ratio-choices" role="group" aria-label="画面比例" data-keep-open>{['auto',...Object.keys(profile.presets),'custom'].map(id=>{const [rw,rh]=id.includes(':')?id.split(':').map(Number):[1,1];return <button key={id} type="button" disabled={disabled||(id==='custom'&&!profile.custom)} aria-pressed={custom?id==='custom':ratio===id} onClick={()=>selectRatio(id)}><i aria-hidden="true" style={{width:Math.round(22*rw/Math.max(rw,rh)),height:Math.round(22*rh/Math.max(rw,rh))}}/><span>{id==='auto'?'自动':id==='custom'?'自定义':id}</span></button>;})}</div>
      <div className="generation-resolution"><span>分辨率{(custom||resolution==='custom')?' · 自定义':''}</span><div className="resolution-choices" role="group" aria-label={label.replace('尺寸','分辨率')} data-keep-open>
        {['auto',...profile.resolutions].map(tier=><button key={tier} type="button" disabled={disabled} aria-pressed={!custom&&resolution===tier} data-resolution={tier} onClick={()=>{setCustomSize(null);onChange(tier==='auto'?'auto':sizeFor(profile.presets[ratio]?ratio:'1:1',tier,model));}}>{tier==='auto'?'自动':tier.toUpperCase()}</button>)}
      </div></div>
      <div className="generation-dimensions">{['宽度','高度'].map((name,index)=><div key={name}><span>{name}</span><Input aria-label={`${label}（${name}）`} aria-invalid={!!error} status={error?'error':undefined} type="number" min={1} max={profile.limits?.maxEdge||99999} step={profile.limits?.step||1} required suffix="px" disabled={disabled||current==='auto'||!profile.custom} value={dimensions[index]||''} onChange={e=>{const next=dimensions.map((v,i)=>i===index?e.target.value:v).join('x');setCustomSize(next);onChange(next);}}/></div>)}</div>
      <small className="muted">分辨率为档位，实际输出请求以宽高为准。</small>
      {!profile.custom&&<small className="muted">当前模型使用固定尺寸。</small>}
      {profile.limits&&Number(dimensions[0])*Number(dimensions[1])>2560*1440&&<small className="muted">此尺寸属于模型实验范围。</small>}
    </>:<Select aria-label={label} aria-invalid={!!error} status={error?'error':undefined} disabled={disabled} value={current} onChange={e=>onChange(e.target.value)}>
      {profile.qualityValues.map(q=><option key={q} value={q}>{qualityLabels[q]||q}</option>)}
      {!profile.qualityValues.includes(current)&&<option value={current} disabled={profile.known}>{qualityLabels[current]||current}{profile.known?'（当前值不可用）':'（未验证）'}</option>}
    </Select>}
    {error&&<small className="node-warning" role="alert">{error}</small>}
    {size&&!profile.known&&<small className="muted">{profile.notice}</small>}
  </div>;
}
