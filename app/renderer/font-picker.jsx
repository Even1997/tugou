import React, {useEffect,useRef,useState} from 'react';
import {Select,Progress} from 'antd';
import {CloudDownloadOutlined,ReloadOutlined} from '@ant-design/icons';
import {loadTextFont} from './font-face.js';
import {findBuiltinFont} from '../core/builtin-fonts.cjs';
import {fontFaces,builtinFace,requestedWeight,textFontWeight,nearestWeight,weightLabel} from '../core/font-weights.cjs';
import './controls.css';

export function FontPicker({layer,onChange}) {
  const [library,setLibrary]=useState({custom:[],system:[]}),[loading,setLoading]=useState(false),[pending,setPending]=useState(null),[error,setError]=useState(''),[downloads,setDownloads]=useState({});
  const alive=useRef(true),request=useRef(0),select=useRef(null),currentLayer=useRef(layer.id);currentLayer.current=layer.id;
  const applying=!!pending,shown=pending?.layerId===layer.id?pending.font:layer;
  async function refresh(){
    const id=++request.current;setLoading(true);
    try{const result=await window.tugou.fontCommand('font.library',{});if(alive.current&&id===request.current){setLibrary(result);setDownloads(previous=>({...Object.fromEntries((result.builtin||[]).flatMap(f=>f.faces||[]).map(f=>[f.id,f])),...previous}));setError(result.warning||'');}}
    catch(e){if(alive.current)setError(e.message);}
    finally{if(alive.current&&id===request.current)setLoading(false);}
  }
  useEffect(()=>{alive.current=true;refresh();const off=window.tugou.onFontDownload(state=>setDownloads(previous=>({...previous,[state.id]:state})));return()=>{alive.current=false;off();};},[]);
  function label(text,face,family=shown.fontFamily){
    const state=face&&downloads[face.id];
    return <span className="font-option-label"><span>{text}</span>{face&&state?.status!=='ready'&&(state?.status==='downloading'?<span role="progressbar" aria-label="字体下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={state.percent} title={`下载中 ${state.percent}%`}><Progress type="circle" strokeColor="var(--accent)" trailColor="var(--line)" percent={state.percent} size={18} strokeWidth={10} showInfo={false}/></span>:<button type="button" className="font-cloud" data-font-id={face.id} disabled={layer.locked||applying} title={state?.status==='error'?'下载失败，点击重试':'点击下载，完成后离线可用'} aria-label={state?.status==='error'?'重试字体下载':'下载字体'} onMouseDown={e=>{e.preventDefault();e.stopPropagation();}} onClick={e=>{e.stopPropagation();choose('builtin:'+family,face.weight);}}>{state?.status==='error'?<ReloadOutlined/>:<CloudDownloadOutlined/>}</button>)}</span>;
  }
  const custom=library.custom.map(f=>({value:`custom:${f.projectId}:${f.jobId||''}`,label:f.name+(f.ready?'':' · 未生成'),searchText:f.name,disabled:!f.ready,font:f}));
  const builtin=(library.builtin||[]).map(f=>({value:'builtin:'+f.family,label:label(f.name,builtinFace({fontFamily:f.family,fontWeight:requestedWeight(shown)}),f.family),title:f.name,searchText:[f.family,f.name,...f.aliases].join(' ')}));
  const system=library.system.map(f=>({value:'local:'+f.family,label:f.name,searchText:[f.family,f.name,...f.aliases].join(' ')}));
  const currentBuiltin=findBuiltinFont(shown.fontFamily);
  function weightsFor(font){
    if(font.fontResource)return [400];
    const builtin=findBuiltinFont(font.fontFamily);
    return builtin?fontFaces(builtin).map(f=>f.weight).sort((a,b)=>a-b):library.system.find(f=>f.family===font.fontFamily)?.weights||[400];
  }
  const weights=weightsFor(shown),weight=textFontWeight(shown);
  const weightOptions=weights.map(value=>({value,label:label(weightLabel(value),builtinFace({...shown,fontWeight:value})),title:weightLabel(value)}));
  if(!weights.includes(weight))weightOptions.push({value:weight,label:weightLabel(weight)+'（现有）',disabled:true});
  const value=shown.fontResource?`custom:${shown.fontResource.projectId}:${shown.fontResource.jobId}`:currentBuiltin?'builtin:'+currentBuiltin.family:'local:'+(shown.fontFamily||'Microsoft YaHei');
  if(![...custom,...builtin,...system].some(f=>f.value===value))(layer.fontResource?custom:currentBuiltin?builtin:system).unshift({value,label:currentBuiltin?.name||layer.fontFamily||'Microsoft YaHei',searchText:layer.fontFamily||'Microsoft YaHei'});
  const options=[...(custom.length?[{label:'自定义字体',options:custom}]:[]),...(builtin.length?[{label:'字体目录',options:builtin}]:[]),{label:'本机字体',options:system}];
  async function choose(next,desiredWeight){
    const layerId=layer.id;setError('');
    try{
      let patch;
      if(next.startsWith('local:'))patch={fontFamily:next.slice(6),fontResource:null};
      else if(next.startsWith('builtin:'))patch={fontFamily:next.slice(8),fontResource:null};
      else {const f=custom.find(f=>f.value===next)?.font;if(!f)return;patch=await window.tugou.fontCommand('font.face',{projectId:f.projectId,jobId:f.jobId});}
      patch.fontWeight=nearestWeight(weightsFor(patch),desiredWeight??requestedWeight(layer));
      setPending({layerId,font:patch});
      await loadTextFont(patch);
      if(alive.current&&currentLayer.current===layerId)onChange(patch);
    }catch(e){if(alive.current)setError('字体加载失败：'+e.message);}
    finally{if(alive.current)setPending(null);}
  }
  async function chooseWeight(fontWeight){
    const layerId=layer.id;setPending({layerId,font:{...layer,fontWeight}});setError('');
    try{await loadTextFont({...layer,fontWeight});if(alive.current&&currentLayer.current===layerId)onChange({fontWeight});}
    catch(e){if(alive.current)setError('字重加载失败：'+e.message);}
    finally{if(alive.current)setPending(null);}
  }
  return <div className="font-picker" onKeyDown={e=>e.stopPropagation()}>
    <label>字体
    <span className="studio-select"><Select ref={select} aria-label="字体" value={value} options={options} disabled={layer.locked||applying} loading={loading}
      showSearch={{optionFilterProp:'searchText'}} placeholder="搜索字体" virtual listHeight={280}
      classNames={{popup:{root:'studio-select-popup'}}} notFoundContent={loading?'正在读取字体…':'没有匹配的字体'}
      onOpenChange={open=>{if(open)refresh().then(()=>requestAnimationFrame(()=>select.current?.scrollTo({index:0})));}} onSelect={next=>choose(next)}/></span>
    </label>
    <label>粗细
      <span className="studio-select"><Select aria-label="字体粗细" value={weight} options={weightOptions} disabled={layer.locked||applying||weights.length===1}
        classNames={{popup:{root:'studio-select-popup'}}} onSelect={chooseWeight}/></span>
    </label>
    {error&&<small role="alert">{error}</small>}
  </div>;
}
