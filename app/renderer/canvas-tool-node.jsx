import React,{useContext,useState,useRef,useEffect} from 'react';
import {Handle,Position} from '@xyflow/react';
import {Button,Icon,Input} from './components.jsx';
import {CanvasContext} from './canvas-nodes.jsx';
import {LocalAIControls} from './local-ai-controls.jsx';
import {compileTool,toolOutput,settingsOf,toolInputs,inputLimit,icons} from '../core/canvas-tools.cjs';
import {ImageToolControls} from './image-tool-controls.jsx';
import {GeometryControls} from './geometry-controls.jsx';
import {CompositionControls,RegionPreview} from './composition-controls.jsx';
import {CleanupControls} from './cleanup-controls.jsx';
import {CloudControls} from './cloud-controls.jsx';
import {CloudMaskEditor} from './cloud-mask-editor.jsx';
import {CloudMaskPreview} from './cloud-mask-preview.jsx';
import {NumberField} from './number-field.jsx';
import {Select} from './select.jsx';
import {parseCube} from '../core/image-tools.cjs';
import {originalUrl} from './image-processing.js';

export function CanvasToolNode({id,data,selected}){
  const {document,tasks,disabled,submittingIds,runNode,cancelNode,nodeErrors}=useContext(CanvasContext);
  const node={id,data,type:'imageTool'},task=tasks.filter(t=>t.context?.nodeId===id).at(-1);
  const active=['running','queued'].includes(task?.status),busy=disabled||active||submittingIds.has(id);
  const asset=document.assets.find(a=>a.id===data.outputAssetId);
  let error='',stale=false,source;
  try{source=compileTool(document,id).asset;}catch(e){error=e.message;}
  if(asset)try{toolOutput(document,node);}catch{stale=true;}
  const settings=settingsOf(node,source);
  return <div className={`canvas-card node-shell node-picture canvas-tool-node ${selected?'selected':''}`} style={{'--node-width':'320px'}}>
    <header className="node-caption"><Icon name={icons[data.operation]||'tools'}/><strong>{data.name}</strong><small>{data.operation==='cloudExtend'?'模型工具':'本地工具'}</small></header>
    <Handle type="target" position={Position.Left} aria-label="工具图片输入" title={inputLimit(data.operation)>1?"连接多张图片，在参数中调整顺序":"连接一张图片或上游工具结果"}/>
    <div className="canvas-tool-status nodrag nowheel">
      <span className="muted">{source?`输入：${source.name} · ${source.width} × ${source.height}`:'连接图片后开始处理'}</span>
      <span className="muted">{data.operation==='upscale'?`${{general:'通用',illustration:'插画',anime:'动漫'}[settings.model]} · ${settings.scale}×`:data.operation==='cutout'?`${settings.model==='u2netp'?'轻量':'精细'}抠图 · 透明背景`:data.operation==='cloudExtend'?'调用已配置的生图模型，可能产生费用':data.operation==='gif'?'多图合并 · 可调整帧顺序与时长':'使用工具参数处理原图'}</span>
      <span className="muted">新图生成在右侧，可连接多个工具</span>
      {stale&&<span className="node-warning" role="status">输入或参数已变化，可重新处理；已有结果保留</span>}
      {(nodeErrors[id]||error)&&<span role="alert">{nodeErrors[id]||error}</span>}
      {task&&<span role="status">{{queued:'等待处理',running:'正在处理',completed:'处理完成',failed:'处理失败',cancelled:'已取消',interrupted:'处理已中断',review:'待确认结果，请在任务面板继续处理'}[task.status]}{task.message?` · ${task.message}`:''}</span>}
      {active&&<progress aria-label="图像处理进度" max="100" value={Number.isFinite(task.progress)?task.progress:undefined}/>}
      <div className="canvas-tool-actions"><Button primary disabled={busy||!!error} icon="tools" onClick={()=>runNode(id)}>{submittingIds.has(id)?'提交中':asset?'重新处理':'开始处理'}</Button>{active&&<Button onClick={()=>cancelNode(id)}>取消处理</Button>}</div>
    </div>
    <Handle type="source" position={Position.Right} aria-label="工具图片输出" title="连接到下一个工具或生成台"/>
  </div>;
}

export function CanvasToolSettings({node,document,projectId,change,patch,disabled,task}){
  const busy=disabled||['queued','running'].includes(task?.status),operation=node.data.operation;
  const [paintOpen,setPaintOpen]=useState(false),[error,setError]=useState(''),[,setRuntime]=useState(null);
  const latest=useRef(document),alive=useRef(true);latest.current=document;
  useEffect(()=>()=>{alive.current=false;},[]);
  let inputs=[],inputError='';try{inputs=toolInputs(document,node);}catch(e){inputError=e.message;}
  const source=inputs[0]?.asset,secondary=inputs[1]?.asset,value=settingsOf(node,source),mask=document.assets.find(a=>a.id===value.maskId);
  const update=values=>patch({parameters:{...node.data.parameters,...values}});
  const persist=async(make)=>{
    setError('');try{const edit=await make();if(alive.current&&change(edit)===false)throw Error('工程正在保存，请稍后重试');}catch(e){if(alive.current)setError(e.message);}
  };
  const reorder=(index,delta)=>{const order=inputs.map(i=>i.nodeId);[order[index],order[index+delta]]=[order[index+delta],order[index]];patch({inputOrder:order});};
  const imported=async file=>persist(async()=>{
    const text=await file.text();parseCube(text);
    const lut={id:crypto.randomUUID(),name:file.name,text},d=latest.current;
    return {...d,imageToolLuts:[...(d.imageToolLuts||[]),lut],tugouCanvas:{...d.tugouCanvas,nodes:d.tugouCanvas.nodes.map(n=>n.id===node.id?{...n,data:{...n.data,parameters:{...n.data.parameters,lutId:lut.id}}}:n)}};
  });
  return <div className="generation-inspector canvas-tool-inspector">
    <label>节点名称<Input aria-label="工具节点名称" value={node.data.name} disabled={busy} onChange={e=>patch({name:e.target.value})}/></label>
    <p className="muted">{source?`输入：${source.name} · ${source.width} × ${source.height}`:inputError||'连接图片后设置参数'}。新图生成在右侧，可继续连接多个工具。</p>
    {operation==='cloudExtend'&&<p className="node-warning">使用模型连接中配置的生图模型，点击处理将发起模型请求，可能产生费用。</p>}
    {inputLimit(operation)>1&&<section className="canvas-tool-inputs" aria-label="工具输入顺序">
      <strong>{operation==='gif'?'帧顺序与时长':operation==='mattePair'?'输入顺序：黑底 → 白底':'输入顺序：原图 → 材质'}</strong>
      {!inputs.length&&<p className="muted">连接图片到左侧输入端口。</p>}
      {inputs.map((input,index)=><div className="canvas-tool-input" key={input.nodeId}>
        <img src={originalUrl(input.asset)} alt=""/><span title={input.asset.name}>{index+1}. {input.asset.name}</span>
        {operation==='gif'&&<NumberField label={`第 ${index+1} 帧时长（毫秒）`} shortLabel="毫秒" value={value.frameDelays[input.nodeId]??value.delay} min={20} max={60000} step={10} disabled={busy} onChange={n=>update({frameDelays:{...value.frameDelays,[input.nodeId]:Math.max(20,Math.round(n/10)*10)}})}/>}
        <Button iconOnly icon="up" aria-label={`前移输入 ${index+1}`} disabled={busy||index===0} onClick={()=>reorder(index,-1)}/><Button iconOnly icon="down" aria-label={`后移输入 ${index+1}`} disabled={busy||index===inputs.length-1} onClick={()=>reorder(index,1)}/>
      </div>)}
    </section>}
    {['upscale','cutout'].includes(operation)?<LocalAIControls operation={operation} value={value} source={source} disabled={busy} update={update}/>
      :operation==='gif'?<>
        <NumberField label="GIF 宽度" value={value.width} min={1} max={4096} disabled={busy} onChange={n=>update({width:Math.round(n)})}/>
        <NumberField label="GIF 高度" value={value.height} min={1} max={4096} disabled={busy} onChange={n=>update({height:Math.round(n)})}/>
        <NumberField label="统一帧时长（毫秒）" value={value.delay} min={20} max={60000} step={10} disabled={busy} onChange={n=>update({delay:Math.max(20,Math.round(n/10)*10)})}/>
        <Button disabled={busy} onClick={()=>update({frameDelays:{}})}>应用到全部帧</Button>
        <label>播放次数<Select aria-label="GIF 播放次数" value={value.loop} disabled={busy} onChange={e=>update({loop:+e.target.value})}><option value={0}>无限循环</option><option value={1}>播放一次</option></Select></label>
        <p className="muted">2–240 帧，合计不超过 6400 万像素；等比缩放、透明补边。GIF 输入取首帧。</p>
      </>:['resize','extend'].includes(operation)?<GeometryControls operation={operation} source={source} value={value} update={update} disabled={busy} scale={value.scale} setScale={scale=>update({scale})} padding={value.padding} setPadding={padding=>update({padding})}/>
      :operation==='cloudExtend'?<CloudControls operation={operation} source={source} value={value} update={update} disabled={busy}/>
      :['mattePair','texture','split','crop'].includes(operation)?<CompositionControls operation={operation} value={value} update={update} source={source} secondary={secondary} assets={inputs.map(i=>i.asset)} disabled={busy} connected/>
      :['watermark','metadata'].includes(operation)?<CleanupControls operation={operation} source={source} value={value} update={update} disabled={busy} onStatus={setRuntime} projectId={projectId} document={document} paint={()=>setPaintOpen(true)} editRegion={()=>globalThis.document.querySelector('.canvas-tool-inspector .tool-region')?.scrollIntoView({block:'nearest'})}/>
      :<ImageToolControls operation={operation} value={Object.keys(value).length>1?value:undefined} update={update} luts={document.imageToolLuts||[]} importLut={imported} disabled={busy}/>}
    {source&&(['crop','texture'].includes(operation)||operation==='watermark'&&value.mode==='region')&&<RegionPreview source={source} region={value} update={update} disabled={busy} label="工具框选区域"/>}
    {source&&operation==='watermark'&&value.mode==='mask'&&<CloudMaskPreview source={source} mask={mask} settings={{...value,maskChannel:'alpha'}}/>}
    {paintOpen&&source&&<CloudMaskEditor source={source} mask={mask} settings={{...value,maskChannel:'alpha'}} close={()=>setPaintOpen(false)} description="蓝色区域将在本机修复，未涂区域保留。" apply={async bytes=>{
      const asset=await window.tugou.storeRaster(bytes,`修复区域 · ${source.name}`),d=latest.current,n=d.tugouCanvas.nodes.find(n=>n.id===node.id);
      if(!alive.current||!n||toolInputs(d,n)[0]?.asset.id!==source.id)throw Error('输入图片已变化，请重新涂画');
      if(change({...d,assets:[...d.assets,asset],tugouCanvas:{...d.tugouCanvas,nodes:d.tugouCanvas.nodes.map(n=>n.id===node.id?{...n,data:{...n.data,parameters:{...n.data.parameters,maskId:asset.id}}}:n)}})===false)throw Error('工程正在保存，请稍后重试');
    }}/>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
