import React, {useEffect,useRef,useState} from 'react';
import {Select} from 'antd';
import {loadTextFont} from './font-face.js';
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
  const system=library.system.map(f=>({value:'local:'+f.family,label:f.name,searchText:[f.family,f.name,...f.aliases].join(' ')}));
  const value=layer.fontResource?`custom:${layer.fontResource.projectId}:${layer.fontResource.jobId}`:'local:'+(layer.fontFamily||'Microsoft YaHei');
  if(![...custom,...system].some(f=>f.value===value))(layer.fontResource?custom:system).unshift({value,label:layer.fontFamily||'Microsoft YaHei',searchText:layer.fontFamily||'Microsoft YaHei'});
  const options=[...(custom.length?[{label:'自定义字体',options:custom}]:[]),{label:'本机字体',options:system}];
  async function choose(next){
    setApplying(true);setError('');
    try{
      let patch;
      if(next.startsWith('local:'))patch={fontFamily:next.slice(6),fontResource:null};
      else {const f=custom.find(f=>f.value===next)?.font;if(!f)return;patch=await window.tugou.fontCommand('font.face',{projectId:f.projectId,jobId:f.jobId});await loadTextFont(patch);}
      if(alive.current)onChange(patch);
    }catch(e){if(alive.current)setError('字体加载失败：'+e.message);}
    finally{if(alive.current)setApplying(false);}
  }
  return <span className="font-picker" onKeyDown={e=>e.stopPropagation()}>
    <span className="studio-select"><Select ref={select} aria-label="字体" value={value} options={options} disabled={layer.locked||applying} loading={loading||applying}
      showSearch={{optionFilterProp:'searchText'}} placeholder="搜索字体" virtual listHeight={280}
      classNames={{popup:{root:'studio-select-popup'}}} notFoundContent={loading?'正在读取字体…':'没有匹配的字体'}
      onOpenChange={open=>{if(open)refresh().then(()=>requestAnimationFrame(()=>select.current?.scrollTo({index:0})));}} onChange={choose}/></span>
    {error&&<small role="alert">{error}</small>}
  </span>;
}
