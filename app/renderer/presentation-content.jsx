import React,{useEffect,useRef} from 'react';
import {Button,IconButton} from './components.jsx';
import {contentText,contentTitle,contentStatus} from '../core/presentation-content.cjs';

export function ContentField({label,value,onChange,disabled,rows=3,placeholder='',maxLength=10000}){
  const group=useRef(null);
  return <label>{label}<textarea aria-label={label} value={value} rows={rows} maxLength={maxLength} disabled={disabled} placeholder={placeholder} onChange={e=>{group.current??={};onChange(e.target.value,{group:group.current});}} onBlur={()=>{group.current=null;}}/></label>;
}

export function ContentPanel({slide,disabled,onChange,onRequest}){
  const text=contentText(slide),status=contentStatus(slide);
  return <div className="ppt-content-panel"><div className="ppt-content-fields">
    <div className="ppt-content-intro"><strong>本页内容</strong><span className={status.pending?'pending':''} role="status">{status.pending?'草稿待排版':'与页面一致'}</span><p>标题、正文、数据和配图要求，写在一起即可。</p></div>
    <ContentField label="页面内容" value={text} disabled={disabled} rows={18} maxLength={2040000} placeholder="写下这一页的标题和内容……" onChange={(text,options)=>onChange({text},options)}/>
    </div><div className="ppt-content-apply"><Button disabled={disabled} icon="copy" onClick={onRequest}>复制 AI 排版指令</Button><small>内容保存为草稿；将指令交给已连接的 AI 后排版。</small></div>
  </div>;
}

export function PresentationOutline({deck,currentId,disabled,onSelect,onChange,onMove,onRequest}){
  const root=useRef(null);
  useEffect(()=>{const container=root.current,card=[...container.children].find(e=>e.dataset.outlineId===currentId);if(!card)return;const r=card.getBoundingClientRect(),bounds=container.getBoundingClientRect();if(r.top<bounds.top||r.bottom>bounds.bottom)container.scrollTop+=r.top-bounds.top-12;},[currentId]);
  return <div className="ppt-outline-document" ref={root}><header><div><h2>内容大纲</h2><p>先确认大纲，再选择做设计或写讲稿。文字修改作为草稿保存。</p></div><Button icon="copy" disabled={disabled} onClick={onRequest}>AI 写稿指令</Button></header>
    {deck.slides.map((s,i)=>{const text=contentText(s),status=contentStatus(s),active=s.id===currentId;return <article key={s.id} data-outline-id={s.id} className={active?'active':''} onFocus={()=>onSelect(s.id)}>
      <div className="ppt-outline-card-title"><button aria-label={`编辑第 ${i+1} 页内容`} onClick={()=>onSelect(s.id)}><span>{String(i+1).padStart(2,'0')}</span><strong>{contentTitle(s)||'待填写标题'}</strong></button><div><small>{status.pending?'草稿待排版':'已同步'}</small><IconButton label={`大纲第 ${i+1} 页上移`} icon="up" disabled={disabled||!i} onClick={()=>onMove(s.id,i-1)}/><IconButton label={`大纲第 ${i+1} 页下移`} icon="down" disabled={disabled||i===deck.slides.length-1} onClick={()=>onMove(s.id,i+1)}/></div></div>
      {active?<div className="ppt-outline-card-body"><ContentField label={`第 ${i+1} 页内容`} value={text} rows={10} maxLength={2040000} disabled={disabled} placeholder="写下这一页的标题和内容……" onChange={(text,options)=>onChange(s.id,{text},options)}/></div>:<button className="ppt-outline-summary" onClick={()=>onSelect(s.id)}>{text.slice(0,200)||'点击整理本页内容'}</button>}
    </article>})}
  </div>;
}
