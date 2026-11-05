import React,{useContext} from 'react';
import {Handle,Position} from '@xyflow/react';
import {Button,Icon,Input} from './components.jsx';
import {CanvasContext} from './canvas-nodes.jsx';
import {LocalAIControls} from './local-ai-controls.jsx';
import {compileTool,toolOutput,settingsOf} from '../core/canvas-tools.cjs';

export function CanvasToolNode({id,data,selected}){
  const {document,tasks,disabled,submittingIds,runNode,cancelNode,nodeErrors}=useContext(CanvasContext);
  const node={id,data,type:'imageTool'},task=tasks.filter(t=>t.context?.nodeId===id).at(-1);
  const active=['running','queued'].includes(task?.status),busy=disabled||active||submittingIds.has(id);
  const asset=document.assets.find(a=>a.id===data.outputAssetId);
  let error='',stale=false,source;
  try{source=compileTool(document,id).asset;}catch(e){error=e.message;}
  if(asset)try{toolOutput(document,node);}catch{stale=true;}
  const settings=settingsOf(node);
  return <div className={`canvas-card node-shell node-picture canvas-tool-node ${selected?'selected':''}`} style={{'--node-width':'320px'}}>
    <header className="node-caption"><Icon name={data.operation==='upscale'?'zoomIn':'mask'}/><strong>{data.name}</strong><small>本地工具</small></header>
    <Handle type="target" position={Position.Left} aria-label="工具图片输入" title="连接一张图片或上游工具结果"/>
    <div className="canvas-tool-status nodrag nowheel">
      <span className="muted">{source?`输入：${source.name} · ${source.width} × ${source.height}`:'连接图片后开始处理'}</span>
      <span className="muted">{data.operation==='upscale'?`${{general:'通用',illustration:'插画',anime:'动漫'}[settings.model]} · ${settings.scale}×`:`${settings.model==='u2netp'?'轻量':'精细'}抠图 · 透明背景`}</span>
      <span className="muted">新图生成在右侧，可连接多个工具</span>
      {stale&&<span className="node-warning" role="status">输入或参数已变化，可重新处理；已有结果保留</span>}
      {(nodeErrors[id]||error)&&<span role="alert">{nodeErrors[id]||error}</span>}
      {task&&<span role="status">{{queued:'等待处理',running:'正在处理',completed:'处理完成',failed:'处理失败',cancelled:'已取消',interrupted:'处理已中断'}[task.status]}{task.message?` · ${task.message}`:''}</span>}
      {active&&<progress aria-label="图像处理进度" max="100" value={Number.isFinite(task.progress)?task.progress:undefined}/>}
      <div className="canvas-tool-actions"><Button primary disabled={busy||!!error} icon="tools" onClick={()=>runNode(id)}>{submittingIds.has(id)?'提交中':asset?'重新处理':'开始处理'}</Button>{active&&<Button onClick={()=>cancelNode(id)}>取消处理</Button>}</div>
    </div>
    <Handle type="source" position={Position.Right} aria-label="工具图片输出" title="连接到下一个工具或生成台"/>
  </div>;
}

export function CanvasToolSettings({node,document,patch,disabled,task}){
  const busy=disabled||['queued','running'].includes(task?.status);
  let source,error='';try{source=compileTool(document,node.id).asset;}catch(e){error=e.message;}
  return <div className="generation-inspector canvas-tool-inspector">
    <label>节点名称<Input aria-label="工具节点名称" value={node.data.name} disabled={busy} onChange={e=>patch({name:e.target.value})}/></label>
    <p className="muted">{source?`输入：${source.name} · ${source.width} × ${source.height}`:error}。每次处理在右侧新增图片，可连接多个工具；已有图片和连线保留。</p>
    <LocalAIControls operation={node.data.operation} value={settingsOf(node)} source={source} disabled={busy} update={value=>patch({parameters:{...node.data.parameters,...value}})}/>
  </div>;
}
