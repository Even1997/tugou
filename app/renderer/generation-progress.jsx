import React,{useEffect,useState} from 'react';
import {Button,Icon} from './components.jsx';
const labels={queued:'等待排队',running:'等待模型返回',completed:'正在载入结果',failed:'生成失败',cancelled:'已取消',interrupted:'生成已中断'};
const stages={generating:'等待模型返回',downloading:'下载生成结果',saving:'保存生成结果'};
export function GenerationProgress({task,compact=false}){
  const active=['queued','running'].includes(task?.status),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active,task?.id]);
  const start=Date.parse(task?.startedAt||task?.createdAt),end=Date.parse(task?.finishedAt),seconds=Number.isFinite(start)?Math.max(0,Math.floor(((Number.isFinite(end)?end:now)-start)/1000)):0;
  const percent=active&&Number.isFinite(task?.progress)?Math.max(0,Math.min(100,task.progress)):null;
  const label=task?.status==='running'?(stages[task.stage]||labels.running):labels[task?.status]||'任务记录暂不可用';
  return <div className={`generation-progress ${compact?'is-compact':''}`} role="status">
    <div><span>{label}</span><span>{percent!==null?`${percent}% · `:''}{seconds>=60?`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`:`${seconds} 秒`}</span></div>
    {active&&<div className={`generation-progress-track ${percent===null?'is-indeterminate':''}`} role="progressbar" aria-label="生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent??undefined} aria-valuetext={percent===null?`${label}，模型未提供百分比`:`${percent}%`}><span style={percent!==null?{width:`${percent}%`}:undefined}/></div>}
    {!compact&&active&&percent===null&&<small>模型未提供百分比，完成后自动显示结果</small>}
  </div>;
}
export function GenerationOutput({task,disabled,sourceExists,busy,retry,cancel,locate}){
  const active=['queued','running'].includes(task?.status);
  return <section className="generation-output-placeholder nodrag" aria-label="生成结果占位">
    <Icon name={active?'loading':'assets'}/>
    <strong>{active?'正在准备生成结果':task?.status==='completed'?'正在载入结果':'本次生成未完成'}</strong>
    <GenerationProgress task={task}/>
    {!active&&task?.message&&<small className="node-warning">{task.message}</small>}
    <div className="generation-output-actions"><Button disabled={!sourceExists} onClick={locate}>定位生成台</Button>{active?<Button disabled={disabled} onClick={cancel}>取消生成</Button>:task?.status!=='completed'&&<Button disabled={disabled||!sourceExists||busy} onClick={retry}>重新生成</Button>}</div>
  </section>;
}
