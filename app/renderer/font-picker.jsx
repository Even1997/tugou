import React, {useEffect,useRef,useState} from 'react';
import {Select} from 'antd';
import {loadTextFont} from './font-face.js';
import {findBuiltinFont} from '../core/builtin-fonts.cjs';
import {fontFaces,requestedWeight,textFontWeight,nearestWeight,weightLabel} from '../core/font-weights.cjs';
import './controls.css';

export function FontPicker({layer,onChange}) {
  const [library,setLibrary]=useState({custom:[],system:[]}),[loading,setLoading]=useState(false),[applying,setApplying]=useState(false),[error,setError]=useState('');
  const alive=useRef(true),request=useRef(0),select=useRef(null);
  async function refresh(){
    const id=++request.current;setLoading(true);
    try{const result=await window.tugou.fontCommand('font.library',{});if(alive.current&&id===request.current){setLibrary(result);setError(result.warning||'');}}
    catch(e){if(alive.current)setError(e.message);}
    finally{if(alive.current&&id===request.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;refresh();return()=>{alive.current=false;};},[]);
  const custom=library.custom.map(f=>({value:`custom:${f.projectId}:${f.jobId||''}`,label:f.name+(f.ready?'':' · 未生成'),searchText:f.name,disabled:!f.ready,font:f}));
  const builtin=(library.builtin||[]).map(f=>({value:'builtin:'+f.family,label:f.name,searchText:[f.family,f.name,...f.aliases].join(' ')}));
  const system=library.system.map(f=>({value:'local:'+f.family,label:f.name,searchText:[f.family,f.name,...f.aliases].join(' ')}));
  const currentBuiltin=findBuiltinFont(layer.fontFamily);
  function weightsFor(font){
    if(font.fontResource)return [400];
    const builtin=findBuiltinFont(font.fontFamily);
    return builtin?fontFaces(builtin).map(f=>f.weight).sort((a,b)=>a-b):library.system.find(f=>f.family===font.fontFamily)?.weights||[400];
  }
  const weights=weightsFor(layer),weight=textFontWeight(layer);
  const weightOptions=weights.map(value=>({value,label:weightLabel(value)}));
  if(!weights.includes(weight))weightOptions.push({value:weight,label:weightLabel(weight)+'（现有）',disabled:true});
  const value=layer.fontResource?`custom:${layer.fontResource.projectId}:${layer.fontResource.jobId}`:currentBuiltin?'builtin:'+currentBuiltin.family:'local:'+(layer.fontFamily||'Microsoft YaHei');
  if(![...custom,...builtin,...system].some(f=>f.value===value))(layer.fontResource?custom:currentBuiltin?builtin:system).unshift({value,label:currentBuiltin?.name||layer.fontFamily||'Microsoft YaHei',searchText:layer.fontFamily||'Microsoft YaHei'});
  const options=[...(custom.length?[{label:'自定义字体',options:custom}]:[]),...(builtin.length?[{label:'内置字体',options:builtin}]:[]),{label:'本机字体',options:system}];
  async function choose(next){
    setApplying(true);setError('');
    try{
      let patch;
      if(next.startsWith('local:'))patch={fontFamily:next.slice(6),fontResource:null};
      else if(next.startsWith('builtin:'))patch={fontFamily:next.slice(8),fontResource:null};
      else {const f=custom.find(f=>f.value===next)?.font;if(!f)return;patch=await window.tugou.fontCommand('font.face',{projectId:f.projectId,jobId:f.jobId});}
      patch.fontWeight=nearestWeight(weightsFor(patch),requestedWeight(layer));
      await loadTextFont(patch);
      if(alive.current)onChange(patch);
    }catch(e){if(alive.current)setError('字体加载失败：'+e.message);}
    finally{if(alive.current)setApplying(false);}
  }
  async function chooseWeight(fontWeight){
    setApplying(true);setError('');
    try{await loadTextFont({...layer,fontWeight});if(alive.current)onChange({fontWeight});}
    catch(e){if(alive.current)setError('字重加载失败：'+e.message);}
    finally{if(alive.current)setApplying(false);}
  }
  return <div className="font-picker" onKeyDown={e=>e.stopPropagation()}>
    <label>字体
    <span className="studio-select"><Select ref={select} aria-label="字体" value={value} options={options} disabled={layer.locked||applying} loading={loading||applying}
      showSearch={{optionFilterProp:'searchText'}} placeholder="搜索字体" virtual listHeight={280}
      classNames={{popup:{root:'studio-select-popup'}}} notFoundContent={loading?'正在读取字体…':'没有匹配的字体'}
      onOpenChange={open=>{if(open)refresh().then(()=>requestAnimationFrame(()=>select.current?.scrollTo({index:0})));}} onChange={choose}/></span>
    </label>
    <label>粗细
      <span className="studio-select"><Select aria-label="字体粗细" value={weight} options={weightOptions} disabled={layer.locked||applying||weights.length===1} loading={applying}
        classNames={{popup:{root:'studio-select-popup'}}} onChange={chooseWeight}/></span>
    </label>
    {error&&<small role="alert">{error}</small>}
  </div>;
}
