import React, {useEffect,useRef,useState} from 'react';
import {Progress} from 'antd';
import {CloudDownloadOutlined,CheckCircleOutlined} from '@ant-design/icons';
import {Button} from './components.jsx';
import manifest from '../runtime/components.json';

// Status reads never initiate or resume downloads. Only the explicit buttons below do.
export function ToolDownload({operation,model,runtime,provider,disabled,onInstalled}) {
  const [tasks,setTasks]=useState([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const latest=useRef(onInstalled),seen=useRef(null);latest.current=onInstalled;
  const active=tasks.find(t=>['queued','running'].includes(t.status));
  const task=tasks.filter(t=>t.context.components?.includes(operation)).at(-1);
  const running=task&&['queued','running'].includes(task.status);
  const installed=operation==='upscale'?runtime?.models?.includes(model):runtime?.cutout&&runtime?.cutoutModels?.includes(model||'birefnet');
  useEffect(()=>{
    let alive=true,timer;
    const poll=async()=>{
      try {
        const values=(await window.tugou.tasks()).filter(t=>t.context?.kind==='runtime-install');
        if(!alive)return;setTasks(values);
        const done=values.filter(t=>t.status==='completed').at(-1);
        if(done&&done.id!==seen.current){seen.current=done.id;latest.current();}
      }catch(e){if(alive)setError(e.message);}
      if(alive)timer=setTimeout(poll,900);
    };poll();return()=>{alive=false;clearTimeout(timer);};
  },[]);
  const act=async fn=>{setBusy(true);setError('');try{await fn();setTasks((await window.tugou.tasks()).filter(t=>t.context?.kind==='runtime-install'));}catch(e){setError(e.message);}finally{setBusy(false);}};
  const retry=task&&['failed','interrupted','cancelled'].includes(task.status);
  const size=operation==='upscale'?`${((manifest.upscale[window.tugou.platform]?.bytes||0)/1e6).toFixed(1)} MB`:'494.2 MB 模型＋独立运行环境';
  return <section className="tool-download" aria-label="工具下载" data-installed={Boolean(installed)}>
    <div className="tool-download-heading">
      {running?<span role="progressbar" aria-label="工具下载进度" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress||0}><Progress type="circle" percent={task.progress||0} size={34} strokeColor="var(--accent)" trailColor="var(--line)" showInfo={false}/></span>:installed?<CheckCircleOutlined aria-label="工具已下载"/>:<CloudDownloadOutlined aria-label="工具在云端"/>}
      <strong>{running?'正在下载并安装':installed?'已下载 · 离线可用':'云端组件 · 未下载'}</strong>
    </div>
    {!installed&&!running&&<p>{size}。{operation==='cutout'?'含轻量与精细模型，需预留 3 GB。':'包含三种超分模型，需预留 256 MB。'}只在点击下载后联网。</p>}
    {running&&<p role="status">{task.message||'等待下载'} · {task.progress||0}%</p>}
    {!running&&retry&&!installed&&<p role="status">{task.message||'下载已暂停'}，点击继续才会联网。</p>}
    {active&&!running&&<p role="status">其他组件正在下载，完成后可下载此工具。</p>}
    {!installed&&runtime?.downloadFolder&&<details><summary>下载位置与来源</summary><p>{runtime.downloadFolder}</p><p>从固定版本的开源项目下载并校验 SHA-256；抠图还需下载独立 Python 运行环境和 PyPI 依赖。</p></details>}
    {error&&<p role="alert">{error}</p>}
    {!installed&&!running&&<Button primary disabled={disabled||busy||!!active||!runtime} onClick={()=>act(()=>retry?window.tugou.retryRuntimeInstall(task.id):window.tugou.installLocalTools({cutout:operation==='cutout',upscale:operation==='upscale',provider,destination:'default'}))}>{busy?'准备中…':retry?'继续下载':'下载工具'}</Button>}
    {running&&<Button disabled={busy} onClick={()=>act(()=>window.tugou.cancelTask(task.id))}>取消下载</Button>}
  </section>;
}
