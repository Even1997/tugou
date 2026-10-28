import React from 'react';
import {Collapse} from 'antd';
import {Button,Input,TextArea} from './components.jsx';
import {modeOf,retiredMode,inputsOf,nodeName} from '../core/workflow-nodes.cjs';
import {MediaPreview} from './media-preview.jsx';
import {GenerationChoice} from './generation-choice.jsx';

export function WorkflowSettings({node,document,compiled,patch,run,openScene,disabled,task}){
  const d={...node.data,name:nodeName(node)},mode=modeOf(node),inputs=inputsOf(document.tugouCanvas,node);
  if(retiredMode(node))return <p className="muted">视频和音频生成已移除，已有结果保留在工程中。</p>;
  const compact=['config','image','panorama'].includes(node.type),busy=disabled||['queued','running'].includes(task?.status);
  const inherited=!!compiled?.parameterSourceId,settings=inherited?compiled:d;
  const field=(label,key,type='text')=><label key={key}>{label}<Input aria-label={label} type={type} value={(key==='name'?d:settings)[key]??''} disabled={busy||(inherited&&key!=='name')} onChange={e=>patch({[key]:type==='number'?Number(e.target.value):e.target.value})}/></label>;
  const choice=(label,key)=><label>{label}<GenerationChoice kind={key} mode={mode} aria-label={label} value={settings[key]} disabled={disabled||inherited||['queued','running'].includes(task?.status)} onChange={value=>patch({[key]:value})}/></label>;
  const move=(index,step)=>{const ids=inputs.map(e=>e.source);[ids[index],ids[index+step]]=[ids[index+step],ids[index]];patch({inputOrder:ids});};
  const outputs=(d.outputAssetIds||[d.outputAssetId]).map(id=>document.assets.find(a=>a.id===id)).filter(Boolean);
  const basics=<>
    {field('模型（留空使用共享连接）','model')}
    {node.type==='panorama'?<label>全景请求尺寸<Input aria-label="全景请求尺寸" disabled value="2048 × 1024（2:1）"/></label>:(mode==='image')&&choice('生成尺寸','size')}
    {mode==='image'&&field('生成数量','count','number')}
  </>;
  return <>
    {field('节点名称','name')}
    {node.type==='director'?<><Button onClick={openScene}>打开 3D 导演台</Button><p className="muted">连接图片或全景作为场景背景。场景、角色与机位保存在工程中。</p></>:<>
      {(!compact||node.type==='panorama')&&<label>提示词<TextArea aria-label="节点提示词" rows={4} value={d.prompt||''} disabled={busy} onChange={e=>patch({prompt:e.target.value})}/></label>}
      {compact?<details className="inspector-generation-params"><summary>生成参数</summary>{basics}</details>:basics}
      <Collapse ghost size="small" items={[{key:'advanced',label:'更多参数',children:<>
        {(mode==='image')&&choice('质量','quality')}
        {field('负面提示词','negativePrompt')}{field('镜头要求','camera')}
        {node.type!=='config'&&<label><input type="checkbox" checked={!!d.excludeUpstreamText} onChange={e=>patch({excludeUpstreamText:e.target.checked})}/>不拼入上游文字</label>}
      </>}]} />
      {task&&<p role="status">{{queued:'等待中',running:'生成中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'}[task.status]}{task.progress!==undefined?` ${task.progress}%`:''}{task.message?' · '+task.message:''}</p>}
    </>}
    {inputs.length>0&&<Collapse ghost size="small" defaultActiveKey={compact?[]:['inputs']} items={[{key:'inputs',label:`输入顺序 · ${inputs.length}`,children:inputs.map((e,i)=>{const n=document.tugouCanvas.nodes.find(n=>n.id===e.source);return <div key={e.id} style={{marginBottom:10}}><div style={{display:'flex',gap:4,alignItems:'center'}}><span style={{flex:1}}>{n?.data.name||n?.data.binding?.snapshot?.name||document.assets.find(a=>a.id===n?.data.assetId)?.name||n?.type}</span><Button iconOnly icon="up" aria-label={`输入 ${i+1} 上移`} disabled={busy||!i} onClick={()=>move(i,-1)}>↑</Button><Button iconOnly icon="down" aria-label={`输入 ${i+1} 下移`} disabled={busy||i===inputs.length-1} onClick={()=>move(i,1)}>↓</Button>{node.type!=='config'&&<Button iconOnly icon="prompts" title="在提示词中插入此输入" disabled={busy} onClick={()=>patch({prompt:(d.prompt||'')+` @[node:${e.source}]`})}>引用</Button>}</div><Input aria-label={`输入 ${i+1} 职责`} placeholder="参考职责" disabled={busy} value={d.inputRoles?.[e.source]||e.role||''} onChange={event=>patch({inputRoles:{...d.inputRoles,[e.source]:event.target.value}})}/></div>;})}]} />}
    {!compact&&d.resultText!==undefined&&<label>节点文本（可继续编辑）<TextArea aria-label="节点文本" value={d.resultText} onChange={e=>patch({resultText:e.target.value})}/></label>}
    {!compact&&outputs.length>0&&<><p className="muted">结果 · {outputs.length}</p>{outputs.map(asset=><div key={asset.id} style={{marginBottom:12}}><MediaPreview asset={asset} style={{width:'100%',maxHeight:160,objectFit:'contain'}}/>{outputs.length>1&&<Button aria-pressed={d.outputAssetId===asset.id} onClick={()=>patch({outputAssetId:asset.id})}>设为引用结果</Button>}{asset.kind==='text'&&<Button iconOnly icon="copy" onClick={()=>run(()=>window.tugou.copyText(d.resultText??asset.text))}>复制文本结果</Button>}</div>)}</>}
  </>;
}
