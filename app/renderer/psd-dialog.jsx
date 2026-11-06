import React,{useEffect,useRef,useState} from 'react';
import {Modal} from 'antd';
import {Button} from './components.jsx';
import {Select} from './select.jsx';
import {renderPsd} from './psd-transfer.js';

export function PsdDialog({document,apply,close,complete}){
  const importing=!document,[merged,setMerged]=useState(false),[result,setResult]=useState(null),[busy,setBusy]=useState(''),[progress,setProgress]=useState(0),[error,setError]=useState('');
  const active=useRef(null),alive=useRef(true);
  useEffect(()=>()=>{alive.current=false;active.current?.control.abort();if(active.current)window.tugou.psdCancel(active.current.id).catch(()=>{});},[]);
  const start=async()=>{
    if(active.current)return;
    const job={id:crypto.randomUUID(),control:new AbortController()};active.current=job;let token;
    setError('');setProgress(0);setBusy(importing?'选择并读取 PSD…':'选择保存位置…');
    try{
      if(importing){
        const data=await window.tugou.psdRead(job.id,merged);job.control.signal.throwIfAborted();
        if(alive.current&&data)setResult(data);
      }else{
        const target=await window.tugou.chooseExport(document.name,'psd');if(!target)return;token=target.token;job.control.signal.throwIfAborted();
        setBusy('正在渲染图层…');
        const input=await renderPsd(document,merged,job.control.signal,p=>{if(alive.current)setProgress(p);});
        job.control.signal.throwIfAborted();setBusy('正在编码并保存 PSD…');
        const saved=await window.tugou.psdWrite(job.id,token,input);
        if(alive.current){complete(`已保存 ${saved.name}`);close();}
      }
    }catch(e){if(alive.current)setError(job.control.signal.aborted?'已取消，工程内容未更改':e.message);}
    finally{if(token)await window.tugou.cancelExport(token);active.current=null;if(alive.current)setBusy('');}
  };
  const cancel=()=>{if(active.current){active.current.control.abort();window.tugou.psdCancel(active.current.id).catch(()=>{});}else close();};
  return <Modal open centered title={importing?'导入 Photoshop 文档':'导出 Photoshop 文档'} width={540} getContainer={()=>window.document.getElementById('dialogs')} transitionName="" maskTransitionName="" onCancel={()=>{if(!busy)close();}} maskClosable={!busy} closable={!busy} styles={{body:{maxHeight:'calc(100vh - 240px)',overflowY:'auto'}}} footer={<><Button onClick={cancel}>{busy?'取消处理':'取消'}</Button><Button primary disabled={!!busy} onClick={()=>{if(result){try{apply(result);close();}catch(e){setError(e.message);}}else start();}}>{result?'添加为新画板':importing?'选择 PSD 文件':'保存 PSD'}</Button></>}>
    <label>处理方式<Select aria-label="PSD 处理方式" value={merged?'merged':'layers'} disabled={!!busy||!!result} onChange={e=>setMerged(e.target.value==='merged')}><option value="layers">{importing?'分层导入':'分层像素 PSD'}</option><option value="merged">{importing?'合并预览':'合并 PSD'}</option></Select></label>
    <p className="muted">{importing?'8 位 RGB PSD。基础像素图层、普通分组、位置、透明度和支持的混合模式可保留。文字和智能对象使用文件中保存的像素；蒙版、调整层、复杂特效等不兼容内容会阻止分层导入，可改用合并预览。':'导出当前画板的第 1 帧。分层模式保留顶层的顺序、名称、显隐、透明度和支持的混合模式；文字、形状、蒙版、特效会烘焙到像素，每个分组合并成一层。合并模式保存全部可见内容。原工程保持可编辑。'}</p>
    <p className="muted">最多 128 MiB、128 层；画板与解码图层合计最多 3200 万像素。暂不支持 PSB、16 / 32 位及专业 ICC 色彩转换。</p>
    {result&&<div role="status"><p><strong>{result.name}</strong> · {result.width} × {result.height} · {result.layers.length} 层</p><p>将新增一个画板，不覆盖现有内容，可一次撤销。</p>{result.warnings.length>0&&<ul>{result.warnings.map((text,i)=><li key={i}>{text}</li>)}</ul>}<Button onClick={()=>setResult(null)}>重新选择文件</Button></div>}
    {busy&&<div role="status"><p>{busy}</p>{!importing&&<progress aria-label="PSD 导出进度" max={1} value={progress}/>}</div>}
    {error&&<p role="alert">{error}</p>}
  </Modal>;
}
