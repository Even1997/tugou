import React,{useEffect,useState} from 'react';
import {Button,Icon} from './components.jsx';
const labels={queued:'等待排队',running:'等待模型返回',completed:'正在载入结果',failed:'生成失败',cancelled:'已取消',interrupted:'生成已中断'};
const titles={queued:'等待排队中',running:'正在生成结果',completed:'正在载入结果',failed:'生成未成功',cancelled:'已取消本次生成',interrupted:'生成已中断'};
const stages={'request-queued':'等待请求名额',generating:'等待模型返回',receiving:'接收模型响应',downloading:'下载生成结果',saving:'保存生成结果'};
const formatElapsed=seconds=>seconds>=60?`${Math.floor(seconds/60)} 分 ${seconds%60} 秒`:`${seconds} 秒`;

export function GenerationProgress({task,compact=false}){
  const active=['queued','running'].includes(task?.status),[now,setNow]=useState(Date.now());
  useEffect(()=>{if(!active)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[active,task?.id]);
  const start=Date.parse(task?.startedAt||task?.createdAt),end=Date.parse(task?.finishedAt),seconds=Number.isFinite(start)?Math.max(0,Math.floor(((Number.isFinite(end)?end:now)-start)/1000)):0;
  const percent=active&&Number.isFinite(task?.progress)?Math.max(0,Math.min(100,task.progress)):null;
  const label=task?.status==='running'?(stages[task.stage]||labels.running):labels[task?.status]||'任务记录暂不可用';
  return <div className={`generation-progress ${compact?'is-compact':''}`} role="status">
    <div className="generation-progress-row"><span>{label}</span><span className="generation-progress-time">{percent!==null?`${percent}% · `:''}{formatElapsed(seconds)}</span></div>
    {active&&<div className={`generation-progress-track ${percent===null?'is-indeterminate':''}`} role="progressbar" aria-label="生成进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent??undefined} aria-valuetext={percent===null?`${label}，模型未提供百分比`:`${percent}%`}><span style={percent!==null?{width:`${percent}%`}:undefined}/></div>}
    {!compact&&active&&percent===null&&<small>模型未提供进度，完成后自动呈现</small>}
  </div>;
}

export function GenerationOutput({task,disabled,sourceExists,busy,retry,cancel,locate}){
  const status=task?.status||'missing';
  const active=['queued','running'].includes(status);
  const failed=status==='failed';
  const cancelled=status==='cancelled'||status==='interrupted';
  const stateClass=active?'is-active':failed?'is-failed':cancelled?'is-cancelled':status==='completed'?'is-loading':'is-missing';
  const iconName=active||status==='completed'?'loading':failed?'info':cancelled?'stop':'assets';
  return <section className={`generation-output-placeholder ${stateClass} nodrag`} aria-label="生成结果占位">
    <div className="generation-output-emblem" aria-hidden="true"><Icon name={iconName}/></div>
    <div className="generation-output-heading">
      <strong>{titles[status]||'本次生成未完成'}</strong>
    </div>
    <GenerationProgress task={task}/>
    {!active&&task?.message&&<p className={`generation-output-note ${failed?'is-danger':'is-muted'}`} role="status">{task.message}</p>}
    <div className="generation-output-actions">
      <Button icon="fit" disabled={!sourceExists} onClick={locate}>定位生成台</Button>
      {active?<Button icon="stop" disabled={disabled} onClick={cancel}>取消生成</Button>:status!=='completed'&&<Button primary icon="sync" disabled={disabled||!sourceExists||busy} onClick={retry}>重新生成</Button>}
    </div>
  </section>;
}
