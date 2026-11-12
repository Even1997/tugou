import React,{useState,useRef,useEffect} from 'react';
import {Button} from './components.jsx';
import {Select} from './select.jsx';
import {FontPicker} from './font-picker.jsx';
import {NumberField} from './number-field.jsx';
import {baseStyle} from '../core/rich-text.cjs';
import {useTextFormat} from './canvas-text-input.jsx';
import {loadTextFont} from './font-face.js';

export function TextFormatTools({element,disabled,onChange,ppt=false}){
  const editing=useTextFormat(element?.id),shown=editing?.style||baseStyle(element||{});
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const apply=patch=>editing?editing.apply(patch):onChange?.(patch);
  const font=<FontPicker compact layer={{...element,...shown,id:element?.id||'none',locked:disabled}} onChange={apply}/>;
  const size=<NumberField label="字号" shortLabel="字号" value={shown.fontSize} min={ppt?8:1} max={ppt?240:1000} disabled={disabled} onChange={fontSize=>apply({fontSize})}/>;
  const bold=<Button className="text-format-bold" aria-label="加粗" title={error||'加粗'} aria-pressed={shown.fontWeight>=600} disabled={disabled} aria-busy={loading} onClick={async()=>{if(loading)return;const fontWeight=shown.fontWeight>=600?400:700;setLoading(true);setError('');try{await loadTextFont({...shown,fontWeight});if(alive.current)apply({fontWeight});}catch(e){if(alive.current)setError('字体加载失败：'+e.message);}finally{if(alive.current)setLoading(false);}}}><b>B</b></Button>;
  const color=<label className={ppt?'ppt-text-color':'text-format-color'} title="文字颜色">颜色<input aria-label="文字颜色" type="color" disabled={disabled} value={shown.color} onChange={e=>apply({color:e.target.value})}/></label>;
  if(ppt)return <><div className="ppt-font-row">{font}{size}</div><div className="ppt-text-row">{bold}<Button aria-label="斜体" title="斜体" aria-pressed={shown.italic} disabled={disabled} onClick={()=>apply({italic:!shown.italic})}><i>I</i></Button>{color}<Select aria-label="文字对齐" disabled={disabled||!!editing} value={element?.align||'left'} onChange={e=>onChange({align:e.target.value})}><option value="left">左对齐</option><option value="center">居中对齐</option><option value="right">右对齐</option></Select></div></>;
  return <div className="layer-text-format" data-text-format aria-label="文字选区格式" onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>{font}{size}{bold}{color}</div>;
}
