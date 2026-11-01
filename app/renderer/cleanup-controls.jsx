import React, {useEffect, useState} from 'react';
import {Select} from './select.jsx';
import {Button} from './components.jsx';
import {NumberField} from './number-field.jsx';
import {ToolDownload} from './tool-download.jsx';
import {localToolReadiness} from '../core/local-readiness.cjs';

export function CleanupControls({operation,value,update,disabled,onStatus,source,projectId,document,result,paint,editRegion}) {
  const [runtime,setRuntime]=useState(null),[refresh,setRefresh]=useState(0),[error,setError]=useState('');
  const [inspection,setInspection]=useState(null),[reading,setReading]=useState(false);
  useEffect(()=>{
    let alive=true;
    window.tugou.localToolsStatus().then(r=>{if(alive){setRuntime(r);onStatus(r);}}).catch(e=>{if(alive)setError(e.message);});
    return()=>{alive=false;};
  },[refresh,onStatus]);
  const ready=localToolReadiness(runtime,{operation,...value},source);
  const report=result?.toolResult?.operation===operation&&result.toolResult.source?.id===source?.id?result.toolResult.report:null;
  const inspect=async()=>{
    setReading(true);setError('');
    try {setInspection(await window.tugou.inspectMetadata(projectId,document,source.id));}
    catch(e){setError(e.message);}finally{setReading(false);}
  };
  const statuses={manual:'已按选区修复，请检查纹理和边缘',partial:'仍有残留，请检查结果',unvalidated:'已修复，无法自动确认效果，请对比检查',no_watermark:'未检测到支持的水印，原图未改动',cleaned:operation==='metadata'?'元数据已清理':'已处理检测到的水印，请检查结果',no_metadata:'没有可清理的元数据'};
  return <fieldset className="image-tool-parameters cleanup-controls" disabled={disabled}>
    <ToolDownload operation={operation} runtime={runtime} disabled={disabled} onInstalled={()=>setRefresh(n=>n+1)}/>
    {operation==='watermark'?<>
      <label>修复方式<Select aria-label="水印修复方式" value={value.mode} onChange={e=>update({mode:e.target.value})}>
        <option value="auto">自动识别</option><option value="region">框选区域</option><option value="mask">涂画区域</option>
      </Select></label>
      {value.mode==='auto'?<p className="muted">识别支持的可见水印；没有识别到时可框选或涂画。复杂纹理可能模糊，处理后请对比检查。</p>:<>
        <Button disabled={!source||disabled} onClick={value.mode==='mask'?paint:editRegion}>{value.mode==='mask'?'涂画修复区域':'调整框选区域'}</Button>
        {value.mode==='mask'&&<p className="muted">{value.maskId?'修复区域已保存，可继续调整':'先涂画，再开始处理。未涂区域保持原样。'}</p>}
        <NumberField label="修复半径（px）" value={value.radius} min={1} max={20} step={1} onChange={n=>update({radius:Math.round(n)})}/>
      </>}
    </>:<>
      <p className="muted">清理 EXIF、GPS、XMP、注释与生成信息；保留色彩配置和显示方向。不会重绘图片。</p>
      <Button disabled={!source||!runtime?.cleanup?.metadata?.ready||reading} onClick={inspect}>{reading?'读取中…':'查看原图元数据'}</Button>
      {inspection&&<details open={!report}><summary>可清理字段 · {inspection.count}</summary>{inspection.count===0?<p>没有可清理的字段</p>:<dl className="cleanup-fields">{inspection.fields.map(field=><React.Fragment key={field.key}><dt>{field.key}</dt><dd>{field.value}</dd></React.Fragment>)}</dl>}{inspection.truncated&&<p>仅展示前 200 项</p>}</details>}
    </>}
    <p role="status">{error||ready.reason}</p>
    {report&&<section className="cleanup-report" aria-label="清理报告"><strong>{statuses[report.status]||'处理完成，请检查结果'}</strong>{operation==='metadata'&&<><p>已移除 {report.removed?.length||0} 项 · 剩余 {report.remaining?.length||0} 项</p>{report.remaining?.length>0&&<details><summary>剩余字段</summary><p>{report.remaining.join('、')}</p></details>}</>}</section>}
  </fieldset>;
}
