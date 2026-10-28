import React,{useEffect,useRef,useState} from 'react';
import {Button,Input} from './components.jsx';
import {issue,initialize,draft,confidence,edit} from '../core/font-recognition.cjs';

export function FontRecognition({project,atlas,job,locked,apply,saveReview}){
  const [detail,setDetail]=useState(null),[image,setImage]=useState(null),[entries,setEntries]=useState([]),[selected,setSelected]=useState(0),[scope,setScope]=useState('review'),[error,setError]=useState(''),[zoom,setZoom]=useState(false),[saving,setSaving]=useState(false);
  const pending=useRef(null),latestDraft=useRef(null),timer=useRef(null),chain=useRef(Promise.resolve()),saveRef=useRef(saveReview),alive=useRef(true);
  saveRef.current=saveReview;
  const flush=()=>{clearTimeout(timer.current);const snapshot=pending.current;if(!snapshot)return chain.current;pending.current=null;
    if(alive.current)setSaving(true);
    chain.current=chain.current.catch(()=>{}).then(()=>saveRef.current(job.id,snapshot)).then(()=>{if(alive.current){setSaving(false);setError('');}}).catch(e=>{if(latestDraft.current===snapshot&&!pending.current)pending.current=snapshot;if(alive.current){setSaving(false);setError('复核未保存：'+e.message);}throw e;});return chain.current;
  };
  const change=next=>{setEntries(next);pending.current=draft(next);latestDraft.current=pending.current;clearTimeout(timer.current);timer.current=setTimeout(()=>flush().catch(()=>{}),450);};
  useEffect(()=>{let disposed=false;alive.current=true;setDetail(null);setEntries([]);setImage(null);setError('');
    Promise.all([window.tugou.fontCommand('font.job.get',{projectId:project.id,id:job.id}),window.tugou.fontCommand('font.atlas.preview',{projectId:project.id,atlasId:atlas.id,maxSize:2048})]).then(([d,p])=>{if(disposed)return;const rows=initialize(d.result?.report?.candidates||[],d.review?.entries,atlas.width,atlas.height,d.result?.report?.scorePrecision==='raw');setDetail(d);setEntries(rows);setImage('data:'+p.mimeType+';base64,'+p.data);setSelected(Math.max(0,rows.findIndex(e=>e.needsReview&&!e.reviewed)));}).catch(e=>!disposed&&setError(e.message));return()=>{disposed=true;alive.current=false;flush().catch(()=>{});};
  },[project.id,atlas.id,job.id,job.task?.status]);
  const issues=e=>issue(e,atlas.width,atlas.height),counts=new Map();entries.forEach(e=>{if(e.included)counts.set(e.character,(counts.get(e.character)||0)+1);});
  const chosen=entries.filter(e=>e.included),invalid=chosen.some(e=>issues(e)||counts.get(e.character)>1),current=entries[selected];
  const queue=entries.map((e,i)=>i).filter(i=>scope==='all'||entries[i].needsReview),position=queue.indexOf(selected),page=Math.floor(Math.max(0,position)/24),visible=queue.slice(page*24,page*24+24),remaining=entries.filter(e=>e.needsReview&&!e.reviewed).length;
  const update=(index,patch)=>change(edit(entries,index,patch,atlas.width,atlas.height));
  const move=direction=>{if(!queue.length)return;if(direction>0&&current){if(current.included&&(issues(current)||counts.get(current.character)>1)){setError('请修正当前字符，或取消使用后继续');return;}change(entries.map((e,i)=>i===selected?{...e,reviewed:true}:e));setError('');}setSelected(queue[Math.max(0,Math.min(queue.length-1,position+direction))]);};
  useEffect(()=>{const key=e=>{if(locked||!current||e.ctrlKey||e.altKey||e.metaKey||e.shiftKey||e.isComposing||e.target.closest?.('[role="dialog"]'))return;const typing=e.target.matches?.('input,textarea,[contenteditable="true"]');if(typing){if(e.key==='Enter'&&e.target.getAttribute('aria-label')==='对应字符'){e.preventDefault();move(1);}return;}if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);});
  return <div className="font-recognition">
    <header><div><h3>核对字形</h3><small>{entries.length} 个候选 · 默认保留 {chosen.length} 字 · {saving||pending.current?'保存中…':remaining?'待复核 '+remaining+' 字':'复核完成'}</small></div><Button disabled={locked||job.task?.status!=='completed'} onClick={()=>{const i=entries.length;change([...entries,{character:'',recognizedText:'',score:0,box:[0,0,Math.min(100,atlas.width),Math.min(100,atlas.height)],warnings:[],included:false,reviewed:false,needsReview:true}]);setSelected(i);}}>补一个字</Button></header>
    {error&&<p role="alert">{error}<Button onClick={()=>flush().catch(()=>{})}>重试保存</Button></p>}{detail?.failure&&<p role="alert">{detail.failure.error}</p>}
    {!entries.length?<p>{['queued','running'].includes(job.task?.status)?'正在本地识别…':'未检测到字形，请更换清晰图片，或补充字符与裁切框。'}</p>:<>
      <div className="font-review-tools"><Button aria-pressed={scope==='review'} onClick={()=>{setScope('review');setSelected(Math.max(0,entries.findIndex(e=>e.needsReview&&!e.reviewed)));}}>需复核 {remaining}</Button><Button aria-pressed={scope==='all'} onClick={()=>setScope('all')}>全部 {entries.length}</Button><small>← 上一个　→ 确认并继续</small></div>
      <div className="font-recognition-body"><div className="font-recognition-image"><button className="font-image-zoom" onClick={()=>setZoom(!zoom)}>{zoom?'适合窗口':'放大图片'}</button><svg style={zoom?{height:'auto',minHeight:0,aspectRatio:`${atlas.width}/${atlas.height}`,flexShrink:0}:undefined} viewBox={`0 0 ${atlas.width} ${atlas.height}`} aria-label="原图与文字裁切框">
        {image&&<image href={image} width={atlas.width} height={atlas.height}/>}
        {[...new Set([...visible,selected])].filter(i=>entries[i]).map(i=>{const e=entries[i];return <rect key={i} x={e.box[0]} y={e.box[1]} width={Math.max(1,e.box[2]-e.box[0])} height={Math.max(1,e.box[3]-e.box[1])} className={i===selected?'selected':e.included?'checked':''} vectorEffect="non-scaling-stroke" onClick={()=>setSelected(i)}/>;})}</svg></div>
        <div className="font-recognition-editor">{current&&<>
          <svg className="font-glyph-crop" viewBox={current.box[0]+' '+current.box[1]+' '+Math.max(1,current.box[2]-current.box[0])+' '+Math.max(1,current.box[3]-current.box[1])} aria-label="当前裁切预览">{image&&<image href={image} width={atlas.width} height={atlas.height}/>}</svg>
          <label>对应字符<Input aria-label="对应字符" value={current.character} maxLength={2} disabled={locked} onChange={e=>update(selected,{character:e.target.value})}/></label>
          <small>OCR：{current.recognizedText||'未识别'} · {confidence(current.score,detail?.result?.report?.scorePrecision==='raw')}{current.reviewed?' · 已核对':''}</small>
          <Button className="font-exclude-glyph" disabled={locked} onClick={()=>update(selected,{included:!current.included})}>{current.included?'排除此字':'恢复此字'}</Button>
          <Button disabled={locked} onClick={()=>move(1)}>确认并继续 →</Button>
          <small className="font-mapping-warning">{issues(current)||(counts.get(current.character)>1?'重复字符，请只保留一个':!current.included?'此字形已排除，可修改后重新保留':current.warnings?.includes('CROP_EDGE')?'请检查裁切边缘':current.warnings?.length?'请核对相似字与笔画':'')}{project.covered?.includes(current.character)?' · 将替换已有字形':''}</small>
          <details><summary>调整裁切</summary><div className="font-crop-fields">{['左','上','右','下'].map((label,i)=><label key={label}>{label}<Input type="number" aria-label={'裁切'+label} disabled={locked} min={0} max={i%2?atlas.height:atlas.width} value={current.box[i]} onChange={e=>{const box=[...current.box];box[i]=Math.max(0,Math.min(i%2?atlas.height:atlas.width,Math.round(Number(e.target.value)||0)));update(selected,{box});}}/></label>)}</div></details>
        </>}</div></div>
      <div className="font-recognition-list" aria-label="识别候选">{visible.map(i=>{const e=entries[i];return <button key={i} aria-pressed={i===selected} onClick={()=>setSelected(i)} title={`#${i+1} · ${e.recognizedText||''} · ${confidence(e.score,detail?.result?.report?.scorePrecision==='raw')}`} className={e.needsReview&&!e.reviewed?'uncertain':''}><span>{e.character||'?'}</span><small>{e.reviewed?'✓':e.included?'保留':'排除'}</small></button>;})}</div>
      <footer><Button disabled={!page} onClick={()=>setSelected(queue[(page-1)*24])}>上一页</Button><span>{queue.length?page+1:0}/{Math.ceil(queue.length/24)}</span><Button disabled={(page+1)*24>=queue.length} onClick={()=>setSelected(queue[(page+1)*24])}>下一页</Button><Button primary disabled={locked||!chosen.length||invalid||saving} onClick={async()=>{try{await flush();await apply({jobId:job.id,glyphs:chosen.map(({character,box})=>({character,box}))});}catch(e){setError(e.message);}}}>保存到字体 · {chosen.length} 字</Button></footer>
      {invalid&&<small role="alert">保留项中存在重复字符或无效裁切，请修改或排除。</small>}
      <small>低于 100% 的结果单独复核，默认保留；复核草稿自动保存，完成后点「保存到字体」。输入框内 Enter 确认。</small>
    </>}
  </div>;
}
