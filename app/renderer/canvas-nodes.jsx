import React,{createContext,useContext,useMemo,useRef,useState,memo} from 'react';
import {Handle,Position,NodeResizer} from '@xyflow/react';
import {Button,Icon,IconButton,Input,TextArea,ToolPopover} from './components.jsx';
import {types,retiredMode,labels,nodeName,modeOf,compileWorkflow,nodeWidth,inputsOf} from '../core/workflow-nodes.cjs';
import {nodeStatus} from '../core/prompts.cjs';
import {analysisKinds} from '../core/analysis-draft.cjs';
import {MediaPreview} from './media-preview.jsx';
import {GenerationChoice,ModelChoice,sizeDescription} from './generation-choice.jsx';
import {GenerationProgress,GenerationOutput} from './generation-progress.jsx';
import {imageSettingsError,imageResultWarning} from '../core/image-settings.cjs';
import './canvas-nodes.css';

export const CanvasContext=createContext(null);
const modes=[['image','生图','assets'],['text','文本','text']];
const taskLabels={queued:'排队中',running:'生成中',completed:'已完成',failed:'生成失败',cancelled:'已取消',interrupted:'已中断'};
const numericLimits={count:{min:1,max:15,step:1}};

export function GroupNode({id,data}){
  const {patch,disabled}=useContext(CanvasContext),[editing,setEditing]=useState(false);
  return <div className="group-caption">{editing?<Input autoFocus className="nodrag nowheel" aria-label="组合名称" disabled={disabled} value={data.name} onChange={e=>patch(id,{name:e.target.value})} onBlur={()=>setEditing(false)} onKeyDown={e=>{if(!e.nativeEvent.isComposing&&['Enter','Escape'].includes(e.key)){e.preventDefault();e.stopPropagation();setEditing(false);}}}/>:<span title="双击修改组合名称" onDoubleClick={e=>{if(!disabled){e.stopPropagation();setEditing(true);}}}>{data.name||'分组'}</span>}</div>;
}

function NodeResults({node,disabled}){
  const {document,patch,run,showDetails}=useContext(CanvasContext);
  const [editing,setEditing]=useState(false),d=node.data;
  const panorama=node.type==='panorama';
  const results=(d.outputAssetIds||[d.outputAssetId]).map(id=>document.assets.find(a=>a.id===id)).filter(Boolean);
  const asset=document.assets.find(a=>a.id===d.outputAssetId)||results[0];
  if(!asset)return <div className={panorama?'panorama-placeholder':'desk-result-placeholder'}><Icon name={panorama?'camera':'assets'}/><strong>{panorama?'360° 全景':'生成结果将在这里呈现'}</strong><small>{panorama?'2:1 等距柱状投影 · 生成后可环视':'连接图片或文本节点，准备好后开始生成'}</small></div>;
  const text=d.resultText??asset.text??'';
  const image=!asset.kind||asset.kind==='image';
  return <section className={`node-results nodrag nowheel ${panorama?'panorama-results':''}`} aria-label="节点生成结果">
    {!image&&<div className="node-result-heading"><span>生成结果{results.length>1?` · ${results.length}`:''}</span><div>
      {asset.kind==='text'?<><IconButton label={editing?'完成编辑':'编辑生成文本'} icon={editing?'check':'edit'} disabled={disabled} onClick={()=>setEditing(!editing)}/><IconButton label="复制生成文本" icon="copy" onClick={()=>run(()=>window.tugou.copyText(text))}/></>:<IconButton label="预览生成结果" icon="maximize" onClick={()=>showDetails(asset.id,node.id)}/>}
    </div></div>}
    {image?<button className="node-result-preview" aria-label="预览生成结果" onClick={()=>showDetails(asset.id,node.id)}><MediaPreview asset={asset} style={asset.width&&asset.height?{aspectRatio:`${asset.width} / ${asset.height}`}:undefined}/>{panorama&&<span className="panorama-badge"><Icon name="camera"/>360°</span>}</button>:asset.kind==='text'&&editing?<TextArea aria-label="编辑生成文本" rows={5} value={text} disabled={disabled} onChange={e=>patch(node.id,{resultText:e.target.value})}/>:<MediaPreview asset={asset.kind==='text'?{...asset,text}:asset}/>}
    {results.length>1&&<><div className="node-result-picker" aria-label="选择引用结果">{results.map((a,i)=><button key={a.id} aria-label={`引用结果 ${i+1}`} aria-pressed={a.id===asset.id} disabled={disabled} onClick={()=>patch(node.id,{outputAssetId:a.id})}>{!a.kind||a.kind==='image'?<MediaPreview asset={a} thumbnail/>:<span>{i+1}</span>}</button>)}</div><small className="node-current-result">当前引用 · {results.findIndex(a=>a.id===asset.id)+1} / {results.length}</small></>}
  </section>;
}

function NodeInputs({node,disabled}){
  const {document,locateNode,moveInput,removeInput}=useContext(CanvasContext),drag=useRef(null),[dropId,setDropId]=useState(null);
  const inputs=inputsOf(document.tugouCanvas,node).map(edge=>({edge,source:document.tugouCanvas.nodes.find(n=>n.id===edge.source)})).filter(input=>input.source);
  const targetAt=event=>event.currentTarget.ownerDocument.elementFromPoint(event.clientX,event.clientY)?.closest('[data-input-node]');
  const reset=()=>{drag.current=null;setDropId(null);};
  if(!inputs.length)return null;
  return <div className="node-inputs nodrag nowheel" aria-label="引入内容">{inputs.map(({edge,source},index)=>{
    const d=source.data,asset=document.assets.find(a=>a.id===(source.type==='asset'?d.assetId:d.outputAssetId));
    const text=source.type==='text'?d.text:source.type==='module'?(d.binding.overrideText??d.binding.snapshot.text):source.type==='recipe'?d.snapshot.output:asset?.kind==='text'?(d.resultText??asset.text):d.resultText||d.prompt;
    const media=asset&&asset.kind!=='text',name=d.binding?.snapshot.name||d.snapshot?.name||nodeName(source)||asset?.name||labels[source.type]||'文本';
    const role=node.data.inputRoles?.[source.id]||edge.role||d.role||'参考素材';
    return <div key={edge.id} data-input-node={source.id} className={`node-input-item ${media?'has-media':'has-text'} ${dropId===source.id?'drop-target':''}`}>
      <button className="node-input-content" aria-label={`定位引入 ${name}`} title={`${media?`${name} · ${role}`:text||'暂无内容'}\n点击定位原节点`} onClick={()=>locateNode(source.id)}>{media?['video','audio'].includes(asset.kind)?<span className="node-input-media-kind"><Icon name={asset.kind}/><small>{asset.kind==='video'?'视频':'音频'}</small></span>:<MediaPreview asset={asset} thumbnail/>:<span className="node-input-text">文本</span>}</button>
      <div className="node-input-actions"><IconButton label={`移动引入 ${name}`} icon="action" disabled={disabled} title="拖动排序，或用方向键移动" className="node-input-grip"
        onPointerDown={event=>{if(disabled||event.button!==0)return;event.preventDefault();event.stopPropagation();drag.current={id:source.id,x:event.clientX,y:event.clientY,moved:false};event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event=>{if(!drag.current||disabled)return;if(Math.hypot(event.clientX-drag.current.x,event.clientY-drag.current.y)<4)return;drag.current.moved=true;const target=targetAt(event);setDropId(target?.closest('.node-inputs')===event.currentTarget.closest('.node-inputs')?target.dataset.inputNode:null);}}
        onPointerUp={event=>{if(drag.current?.moved&&!disabled){const target=targetAt(event),to=inputs.findIndex(input=>input.source.id===target?.dataset.inputNode);if(target?.closest('.node-inputs')===event.currentTarget.closest('.node-inputs')&&to>=0)moveInput(node.id,source.id,to);}reset();}}
        onPointerCancel={reset} onLostPointerCapture={reset}
        onKeyDown={event=>{if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();moveInput(node.id,source.id,index+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1));}}}/>
        <IconButton label={`移除引入 ${name}`} icon="close" disabled={disabled} onClick={()=>removeInput(node.id,source.id)}/>
      </div>
    </div>;
  })}</div>;
}

function GenerationDesk({node}){
  const {document,patch,runNode,cancelNode,disabled,tasks,submittingIds,connection,refreshConnection,openConnection,nodeErrors,locateNode,openNodeScene}=useContext(CanvasContext);
  const {id,data:d}=node,mode=modeOf(node),assembling=node.type==='config',panorama=node.type==='panorama',task=tasks.filter(t=>t.context?.nodeId===id).at(-1);
  const submitting=submittingIds.has(id),active=['queued','running'].includes(task?.status),busy=submitting||active;
  const compiled=useMemo(()=>{try{return {result:compileWorkflow(document,id)};}catch(e){return {error:e.message};}},[document,id]);
  const inherited=compiled.result?.parameterSourceId,settings=inherited?compiled.result:d;
  const shared=connection?.[`${mode}Model`]||(mode==='image'?connection?.model:mode==='text'?connection?.analysisModel:'');
  const locked=disabled||busy,hasModel=!!(settings.model||shared),sizeLabel=(panorama?'2048x1024':settings.size||'auto').replace('auto','自动').replace('x',' × ');
  const parameterLabel=mode==='image'?`${sizeLabel} · ${settings.count??1} 张`:'更多参数';
  const field=(label,key,type='text')=><label>{label}<Input aria-label={`生成台${label}`} type={type} {...numericLimits[key]} disabled={locked||!!inherited||(panorama&&key==='size')} value={panorama&&key==='size'?'2048x1024':settings[key]??''} placeholder={key==='size'?'auto 或 1024x1536':undefined} onChange={e=>patch(id,{[key]:type==='number'?Number(e.target.value):e.target.value})}/></label>;
  const choice=(label,key)=><div className="generation-field"><span>{label}</span><GenerationChoice kind={key} model={settings.model||shared} mode={mode} aria-label={`生成台${label}`} disabled={locked||!!inherited} value={settings[key]} onChange={value=>patch(id,{[key]:value})}/></div>;
  const error=nodeErrors[id]||(task?.status==='failed'?task.message:'');
  const parameterError=mode==='image'?imageSettingsError(settings.model||shared,settings):'';
  const readiness=compiled.error||parameterError||(connection&&!hasModel?'选择模型后即可生成':'');
  const output=document.assets.find(a=>a.id===d.outputAssetId);
  const outputWarning=output&&imageResultWarning(output.generation?.requestedSize,output.width,output.height);
  const resultNode=document.tugouCanvas.nodes.find(n=>n.data.generationTaskId===task?.id&&n.data.sourceNodeId===id)||document.tugouCanvas.nodes.find(n=>n.type==='asset'&&n.data.assetId===d.outputAssetId);
  const prompt=<TextArea className="desk-prompt nodrag" aria-label={assembling?'生成台补充要求':'节点内提示词'} rows={panorama?2:1} value={d.prompt||''} disabled={locked} placeholder={panorama?'描述环绕场景、光线与地平线…':assembling?'补充本次要求，上游内容会自动拼入…':'描述你想生成的内容，或连接提示词节点…'} onChange={e=>patch(id,{prompt:e.target.value})}/>;
  const generate=<Button primary={!busy&&!panorama} className="desk-run nodrag" icon={submitting?'loading':active?'stop':error?'sync':'generate'} disabled={disabled||submitting||(!active&&!!(compiled.error||parameterError))} onClick={()=>active?cancelNode(id):runNode(id)}>{submitting?'提交中':active?(task.status==='queued'?'取消排队':'取消生成'):error?'重新生成':panorama?(output?'重新生成':'生成全景'):'开始生成'}</Button>;
  if(retiredMode(node))return <div className="generation-desk nowheel"><header className="desk-heading"><strong>{nodeName(node)||labels[node.type]}</strong></header><p className="desk-hint">视频和音频生成已移除，已有结果仍可查看。</p>{(d.outputAssetId||d.outputAssetIds?.length)?<NodeResults node={node} disabled={disabled}/>:null}</div>;
  return <div className={`generation-desk nowheel ${panorama?'panorama-desk':''}`} data-mode={mode}>
    <header className="desk-heading"><Icon name={panorama?'camera':'generate'}/><strong title={nodeName(node)}>{nodeName(node)||labels[node.type]}</strong><div className={`node-status ${error?'node-warning':''}`} role="status"><span className={`node-status-dot ${busy?'is-active':task?.status==='completed'||(!task&&output)?'is-complete':''}`}/>{submitting?'正在提交':error?'生成失败':taskLabels[task?.status]||(output?'已有结果':readiness?'待完善':'就绪')}{active&&Number.isFinite(task.progress)?` · ${task.progress}%`:''}</div><div className="nodrag"><ToolPopover label={panorama?'全景设置':'节点选项'} className="desk-popover">
      {assembling&&<><h3>生成类型</h3><div role="tablist" aria-label="生成模式" className="desk-modes nodrag">{modes.map(([key,label,icon])=><Button iconOnly icon={icon} key={key} role="tab" aria-selected={mode===key} disabled={locked} onClick={()=>patch(id,{mode:key,model:''})}>{label}</Button>)}</div></>}
      {panorama&&<>{field('模型','model')}<small className="muted">共享模型：{shared||'尚未配置'}</small><div className="desk-parameter-grid">{field('尺寸','size')}{field('数量','count','number')}</div>{choice('质量','quality')}{field('镜头要求','camera')}{field('负面提示词','negativePrompt')}<Button onClick={openConnection}>模型连接</Button></>}
      <Button icon="settings" onClick={()=>locateNode(id)}>查看节点设置</Button>
    </ToolPopover></div></header>
    {panorama?<NodeResults node={node} disabled={locked}/>:!assembling&&prompt}
    {!panorama&&<NodeInputs node={node} disabled={locked}/>}
    {panorama?prompt:<>{active&&<GenerationProgress task={task} compact/>}<small className="desk-hint">生成结果将在右侧节点显示{resultNode&&<> · <button className="inline-link nodrag" onClick={()=>locateNode(resultNode.id)}>定位结果</button></>}</small></>}
    {panorama?<div className="panorama-view"><small>{output?`${output.width} × ${output.height}`:'2:1 · 2048 × 1024 请求尺寸'}</small><div>{output&&<Button iconOnly icon="camera" onClick={()=>openNodeScene(id)}>环视全景</Button>}{generate}</div></div>:<div className="desk-controls nodrag" onFocus={refreshConnection}>
      <ModelChoice value={settings.model} shared={shared} disabled={locked||!!inherited} onChange={model=>patch(id,{model})} openConnection={openConnection}/>
      <div className="desk-output-row">
        <ToolPopover downward label={(mode==='image')?sizeDescription(settings.size):parameterLabel} description={(mode==='image')?sizeLabel:'输出设置'} icon="selection" showLabel triggerClassName="generation-size" className="desk-popover">
          <h3>输出规格</h3>
          {(mode==='image')&&<>{choice('尺寸','size')}{choice('质量','quality')}</>}
          {mode==='text'&&field('负面提示词','negativePrompt')}
        </ToolPopover>
        {mode==='image'&&<Input className="generation-count nowheel" aria-label="生成台数量" title="生成数量（1–15 张）" type="number" {...numericLimits.count} suffix="张" disabled={locked||!!inherited} value={settings.count??1} onChange={e=>patch(id,{count:Number(e.target.value)})}/>}
        <ToolPopover label="更多生成参数" icon="settings" className="desk-popover">{field('负面提示词','negativePrompt')}</ToolPopover>
      </div>
      {generate}
    </div>}
    {inherited&&<p className="desk-hint">参数沿用上游「{nodeName(document.tugouCanvas.nodes.find(n=>n.id===inherited))||'生成台'}」，<button className="inline-link nodrag" onClick={()=>locateNode(inherited)}>定位来源</button></p>}
    {!busy&&outputWarning&&<p className="node-warning" role="status">{outputWarning}</p>}
    {(error||(!busy&&readiness))&&<p className={error?'node-warning':'desk-hint'} role={error?'alert':undefined}>{error||readiness}</p>}
  </div>;
}

export const ContentNode=memo(function ContentNode({id,type,data,selected}){
  const {document,resize,previewResize,sizedIds,disabled,tasks,patch,importNodeImage,openNodeScene,showDetails,replaceImage,run,updateReference,openRecipe,runNode,cancelNode,locateNode,submittingIds}=useContext(CanvasContext);
  const [editing,setEditing]=useState(false),node={id,type,data},status=nodeStatus(document,node),generative=types.includes(type)&&type!=='director';
  const asset=document.assets.find(a=>a.id===(type==='asset'?data.assetId:data.outputAssetId));
  const title=type==='module'?data.binding.snapshot.name:type==='recipe'?data.snapshot.name:type==='asset'?(asset?.name||data.name||'图片'):nodeName(node);
  const label={text:'文本',module:'模块',recipe:'配方',asset:asset?.kind==='video'?'视频':asset?.kind==='audio'?'音频':asset?.kind==='text'?'文本':'图片'}[type]||labels[type];
  const category=type==='module'?data.binding.snapshot.kind:type==='text'?data.kind:undefined;
  const text=type==='module'?(data.binding.overrideText??data.binding.snapshot.text):type==='recipe'?data.snapshot.output:type==='text'?data.text:asset?.kind==='text'?(data.resultText??asset.text):data.prompt;
  const editable=['text','module','recipe'].includes(type)||(type==='asset'&&asset?.kind==='text'),isImage=asset&&(!asset.kind||asset.kind==='image');
  const updateText=value=>patch(id,type==='module'?{binding:{...data.binding,overrideText:value}}:type==='recipe'?{snapshot:{...data.snapshot,output:value}}:type==='asset'?{resultText:value}:{text:value});
  const task=data.generationTaskId?tasks.find(t=>t.id===data.generationTaskId):tasks.filter(t=>t.context?.nodeId===id).at(-1);
  const pendingOutput=type==='asset'&&!asset&&!!data.generationTaskId;
  return <div style={{'--node-width':`${nodeWidth(type)}px`}} className={`canvas-card node-shell ${generative?'node-desk':'node-content'} ${type==='asset'&&(!asset||isImage)?'node-picture':''} ${asset&&!generative?'node-media':''} ${selected?'selected':''} ${sizedIds.has(id)?'canvas-card-sized':''}`}>
    {!generative&&<header className="node-caption"><Icon name={category||({text:'text',module:'prompts',recipe:'prompts',asset:asset?.kind==='video'?'video':asset?.kind==='audio'?'audio':'assets',director:'layers'}[type])}/><strong title={title}>{title&&title!=='自由提示词'?title:label}</strong>{category&&<span className="node-kind">{analysisKinds[category]||category}</span>}{type==='module'&&<small title="引用工作台模块">关联模块</small>}</header>}
    <NodeResizer isVisible={selected&&!disabled} minWidth={generative?320:220} minHeight={generative?260:isImage&&asset.generation?.requestedSize?200:140} maxWidth={10000} maxHeight={10000} keepAspectRatio={!!isImage&&!generative&&!data.freeResize} onResize={(_,rect)=>previewResize(id,rect)} onResizeEnd={(_,rect)=>resize(id,rect)}/>
    <Handle type="target" position={Position.Left} title="输入：连接上游节点" aria-label="节点输入"/>
    {generative?<GenerationDesk node={node}/>:<>
      {pendingOutput?<GenerationOutput task={task} disabled={disabled} sourceExists={document.tugouCanvas.nodes.some(n=>n.id===data.sourceNodeId)} busy={submittingIds.has(data.sourceNodeId)||tasks.some(t=>t.context?.nodeId===data.sourceNodeId&&['queued','running'].includes(t.status))} retry={()=>runNode(data.sourceNodeId)} cancel={()=>cancelNode(data.sourceNodeId)} locate={()=>locateNode(data.sourceNodeId)}/>:editing&&editable?<TextArea autoFocus className="node-text-editor nodrag nowheel" aria-label="节点内文本" value={text||''} onChange={e=>updateText(e.target.value)} onBlur={()=>setEditing(false)} onKeyDown={e=>{if(!e.nativeEvent.isComposing&&(e.key==='Escape'||(e.key==='Enter'&&(e.ctrlKey||e.metaKey)))){e.preventDefault();e.stopPropagation();setEditing(false);}}}/>:asset?<div className="node-media-preview" onDoubleClick={()=>showDetails(asset.id,id)}><MediaPreview asset={asset.kind==='text'?{...asset,text}:asset} style={isImage&&asset.width&&asset.height?{aspectRatio:`${asset.width} / ${asset.height}`}:undefined}/></div>:type==='asset'?<button aria-label="添加图片" className="node-empty" disabled={disabled} onClick={()=>importNodeImage(id)} onDragOver={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.stopPropagation();}}} onDrop={e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();e.stopPropagation();importNodeImage(id,Array.from(e.dataTransfer.files));}}}><Icon name="assets"/><strong>{data.assetId?'重新选择图片':'添加图片'}</strong><small>{data.assetId?'原素材不可用':'拖入图片，或点击导入'}</small></button>:type==='director'?<button className="node-empty" disabled={disabled} onClick={()=>openNodeScene(id)}><Icon name="layers"/><strong>打开导演台</strong><small>布置场景与机位</small></button>:<div className={`node-text nowheel ${text?'':'muted'}`} onDoubleClick={e=>{if(editable&&!disabled){e.stopPropagation();setEditing(true);}}}>{text||'双击编辑文字'}</div>}
      {!pendingOutput&&<footer className="node-meta nowheel"><span>{type==='asset'&&(!asset||isImage)&&<strong className="node-image-role">{data.role||'参考图片'}</strong>}{asset?(isImage?`${asset.width} × ${asset.height}`:label):type==='asset'?'添加图片后可连接生成台':type==='director'?'场景与机位':`${(text||'').length} 字`}</span><div className={`node-actions nodrag ${type==='asset'&&(!asset||isImage)?'image-node-tools':''}`}>
        {editable&&<IconButton label={editing?'完成编辑':'编辑文字'} icon={editing?'check':'edit'} disabled={disabled} onMouseDown={e=>e.preventDefault()} onClick={()=>setEditing(!editing)}/>}
        {!!text&&type!=='director'&&<IconButton label="复制文字" icon="copy" onClick={()=>run(()=>window.tugou.copyText(text))}/>}
        {asset&&<IconButton label="预览素材" icon="maximize" onClick={()=>showDetails(asset.id,id)}/>}
        {isImage&&<IconButton label="替换图片" icon="replace" disabled={disabled} onClick={()=>replaceImage(id,asset.id)}/>}
        {type==='asset'&&<ToolPopover label="参考用途" icon="settings" className="desk-popover"><label>参考用途<Input aria-label="节点参考用途" value={data.role||''} disabled={disabled} onChange={e=>patch(id,{role:e.target.value})}/></label></ToolPopover>}
        {type==='recipe'&&<IconButton label="编辑配方" icon="open" onClick={()=>openRecipe(data.recipeId)}/>}
        {type==='director'&&asset&&<IconButton label="打开导演台" icon="layers" onClick={()=>openNodeScene(id)}/>}
      </div></footer>}
      {isImage&&asset.generation?.requestedSize&&<div className="node-output-spec nodrag" role="status"><span>请求 {asset.generation.requestedSize.replace('auto','自动').replace('x',' × ')} · 实际 {asset.width} × {asset.height}</span>{imageResultWarning(asset.generation.requestedSize,asset.width,asset.height)&&<strong className="node-warning">尺寸不符 · 原图已保留</strong>}</div>}
      {(!pendingOutput&&(task||['outdated','conflict','missing'].includes(status)))&&<div className="node-reference-state nodrag"><span>{({outdated:'模块有更新',conflict:'本地修改与来源有冲突',missing:'来源已移除，保留快照'})[status]||taskLabels[task?.status]}</span>{status==='outdated'&&<Button iconOnly icon="sync" disabled={disabled} onClick={()=>updateReference(id)}>更新引用</Button>}</div>}
    </>}
    <Handle type="source" position={Position.Right} title="输出：拖向其他节点，或依次点击两个连接点" aria-label="节点输出"/>
  </div>;
},(a,b)=>a.id===b.id&&a.type===b.type&&a.data===b.data&&a.selected===b.selected);
