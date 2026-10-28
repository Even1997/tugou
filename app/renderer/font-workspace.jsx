import React,{useEffect,useRef,useState} from 'react';
import {Button,FormDialog,Input,Icon} from './components.jsx';
import {Select} from './select.jsx';
import {templates,group} from '../core/font-library.cjs';
import './font-workspace.css';
import {FontRecognition} from './font-recognition.jsx';

const api=window.tugou,call=(name,args={})=>api.fontCommand('font.'+name,args),request=()=>crypto.randomUUID();
const count=value=>[...(value||'')].length;
const live=job=>['queued','running'].includes(job.task?.status);
const operation={recognize:'识别文字',plan:'准备模板',process:'校正字形',build:'编译字体',refine:'平滑与加粗'};

export function FontWorkspace(){
  const [projects,setProjects]=useState([]),[selected,setSelected]=useState(null),[creating,setCreating]=useState(false),[error,setError]=useState('');
  const refresh=()=>call('project.list').then(r=>setProjects(r.projects)).catch(e=>setError(e.message));
  useEffect(()=>{refresh();},[selected]);
  return <section className="font-workspace" aria-label="字体工作区">
    {selected?<FontProject key={selected} id={selected} back={()=>setSelected(null)}/>:<>
      <header className="font-heading"><h1>我的字体</h1><Button primary icon="add" onClick={()=>setCreating(true)}>新建字体</Button></header>
      {error&&<p role="alert" className="font-error">{error}</p>}
      <div className="font-projects">{projects.map(p=><button className="font-project-card" key={p.id} onClick={()=>setSelected(p.id)}>
        <div className="font-card-specimen" aria-hidden="true">{[...p.characters].slice(0,4).join('')}<small>Aa</small></div>
        <strong>{p.name}</strong><span>{count(p.covered)} 字形</span>
      </button>)}<button className="font-project-card font-project-new" onClick={()=>setCreating(true)}><Icon name="add"/><span>新建字体</span></button></div>
    </>}
    {creating&&<CreateFont close={()=>setCreating(false)} created={p=>{setCreating(false);setSelected(p.id);}}/>}
  </section>;
}

function CreateFont({close,created}){
  const [name,setName]=useState(''),[template,setTemplate]=useState('common'),[custom,setCustom]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const characters=template==='custom'?[...new Set([...custom.replace(/\s/g,'')])].join(''):templates[template];
  return <FormDialog title="新建字体" close={()=>!busy&&close()} width={460}>
    <form className="font-create" onSubmit={async e=>{e.preventDefault();if(!name.trim()||busy)return;setBusy(true);try{created(await call('project.create',{name:name.trim(),characters,requestId:request()}));}catch(e){setError(e.message);setBusy(false);}}}>
      <label>字体名称<Input autoFocus aria-label="字体名称" maxLength={64} placeholder="例如：春日来信" value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>参考字符库<Select aria-label="参考字符库" value={template} onChange={e=>setTemplate(e.target.value)}><option value="common">常用字库 · 3,849 字</option><option value="sample">中文 100 字 + 英文字母 52 字</option><option value="latin">英文字母 · 52 字</option><option value="custom">自定义 / 空白字库</option></Select></label>
      {template==='custom'&&<textarea aria-label="自定义字符" value={custom} onChange={e=>setCustom(e.target.value)} placeholder="可留空；导入识别后自动加入字库"/>}
      <small>{count(characters).toLocaleString()} 参考字 · 无需全部生成</small>
      {error&&<p className="font-error" role="alert">{error}</p>}
      <footer><Button disabled={busy} onClick={close}>取消</Button><Button primary type="submit" loading={busy} disabled={!name.trim()}>创建字体</Button></footer>
    </form>
  </FormDialog>;
}

function FontProject({id,back}){
  const [p,setProject]=useState(null),[runtime,setRuntime]=useState(null),[tab,setTab]=useState('library'),[atlasId,setAtlasId]=useState(null),[promptChars,setPromptChars]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[promptOpen,setPromptOpen]=useState(false),[exportOpen,setExportOpen]=useState(false),[inspectId,setInspectId]=useState(null),[detail,setDetail]=useState(null);
  const [threshold,setThreshold]=useState(128),[normalize,setNormalize]=useState(true),[smoothing,setSmoothing]=useState(14),[bold,setBold]=useState(4);
  const current=useRef(null),mounted=useRef(true),acting=useRef(false);
  const refresh=async()=>{const next=await call('project.get',{projectId:id});if(mounted.current){current.current=next;setProject(next);}return next;};
  useEffect(()=>{mounted.current=true;refresh().catch(e=>setError(e.message));call('status').then(setRuntime).catch(e=>setError(e.message));
    let fetching=false;const timer=setInterval(async()=>{if(fetching)return;fetching=true;try{await refresh();}catch(e){if(mounted.current)setError(e.message);}finally{fetching=false;}},1200);
    return()=>{mounted.current=false;clearInterval(timer);};},[id]);
  const action=async fn=>{if(acting.current)return;acting.current=true;setBusy(true);setError('');setNotice('');try{await fn();}catch(e){if(mounted.current)setError(e.message);}finally{if(mounted.current){await refresh().catch(()=>{});setBusy(false);}acting.current=false;}};
  const write=(name,args={})=>call(name,{projectId:id,fontRevision:current.current.fontRevision,requestId:request(),...args});
  const start=async(name,args)=>{const r=await write(name,args);await refresh();setInspectId(r.jobId);return r;};
  const chooseImport=()=>action(async()=>{
    const result=await api.fontImport({projectId:id,fontRevision:current.current.fontRevision,requestId:request()});
    if(result){await refresh();setAtlasId(result.atlas.id);setTab('import');setNotice('图片已导入');}
  });
  const saveReview=async(jobId,entries)=>{try{const latest=await refresh();await call('atlas.review',{projectId:id,fontRevision:latest.fontRevision,requestId:request(),jobId,entries});await refresh();}catch(e){if(mounted.current)setError('复核未保存：'+e.message);throw e;}};
  const active=p?.jobs.findLast(live),locked=busy||!!active;
  const lastProcess=p?.jobs.findLast(j=>j.operation==='process'),latest=p?.jobs.findLast(j=>['build','refine'].includes(j.operation)&&j.task?.status==='completed'&&j.sourceRevision===p.current);
  const shownId=inspectId||latest?.id||lastProcess?.id;
  const shownStatus=p?.jobs.find(j=>j.id===shownId)?.task?.status;
  useEffect(()=>{let disposed=false;if(!shownId){setDetail(null);return;}setDetail(null);call('job.get',{projectId:id,id:shownId}).then(r=>{if(!disposed)setDetail(r);}).catch(e=>!disposed&&setError(e.message));return()=>{disposed=true;};},[id,shownId,shownStatus]);
  if(!p)return <div className="font-empty">{error||'正在读取字体…'}</div>;
  const atlas=p.atlases.find(a=>a.id===atlasId)||p.atlases.at(-1);
  const selectedCharacters=[...new Set([...promptChars.replace(/\s/g,'')])].join('');
  const promptText=`为字体「${p.name}」生成以下 ${count(selectedCharacters)} 个字符的黑色字形图集：\n${selectedCharacters}\n\n保持同一套字体风格，每个字符完整、独立、间距充足；纯白或透明背景，无边框、编号和装饰。可根据字数自由排列和选择画幅，无需固定顺序或填满网格。不要遗漏或重复字符。`; 
  const recognition=p.jobs.findLast(j=>j.operation==='recognize'&&j.atlasId===atlas?.id);
  const processMapping=mapping=>action(async()=>{
    const started=await start('atlas.process',{atlasIds:[atlas.id],mapping,background:'light',threshold,merge:true,...(normalize?{normalization:{}}:{})});
    let result;
    do{await new Promise(r=>setTimeout(r,400));result=await call('job.get',{projectId:id,id:started.jobId});}while(live(result));
    if(result.task?.status!=='completed'){setTab('refine');throw Error(result.failure?.error||'字形尚未保存，请查看校正记录中的问题；原字体保持不变');}
    await refresh();await write('revision.apply',{candidateId:started.jobId});await refresh();setTab('library');setNotice('字形已保存到字体');
  });
  const recognize=()=>action(async()=>{await start('atlas.recognize',{atlasId:atlas.id});});
  const build=()=>action(async()=>{await start('build',{mode:'draft'});setTab('refine');});
  const publish=()=>action(async()=>{
    let jobId=latest?.id;
    if(!jobId){
      const started=await start('build',{mode:'draft'});jobId=started.jobId;
      let result;
      do{await new Promise(r=>setTimeout(r,400));result=await call('job.get',{projectId:id,id:jobId});}while(live(result));
      if(result.task?.status!=='completed')throw Error(result.failure?.error||'编译未完成，尚未发布；已有发布版本不变');
    }
    const latestProject=await call('project.get',{projectId:id});
    await call('publish',{projectId:id,fontRevision:latestProject.fontRevision,requestId:request(),jobId});
    if(mounted.current){await refresh();setNotice('已发布，可在文字的字体列表中选择');}
  });
  const refine=()=>action(async()=>{const source=p.jobs.findLast(j=>j.operation==='build'&&j.task?.status==='completed'&&j.sourceRevision===p.current);await start('outline.refine',{jobId:source.id,smoothing,bold});});
  const source=p.jobs.findLast(j=>j.operation==='build'&&j.task?.status==='completed'&&j.sourceRevision===p.current);
  const canApply=detail&&detail.id!==p.current&&p.jobs.find(j=>j.id===detail.id)?.operation==='process'&&detail.task?.status==='completed'&&detail.baseFontRevision===p.fontRevision;
  return <>
    <header className="font-heading"><div><Button disabled={busy} onClick={back}>← 我的字体</Button><div className="font-title"><h1>{p.name}</h1><span>{count(p.covered)} 字形</span></div></div><div className="font-publish"><small>自动保存</small><Button primary loading={busy} disabled={locked||!p.current||(!latest&&!runtime?.ready)||!!(latest&&p.published?.fontResource.jobId===latest.id)} onClick={publish}>{latest&&p.published?.fontResource.jobId===latest.id?'已发布':p.published?'更新发布':'发布'}</Button></div></header>
    <nav className="font-tabs" aria-label="字体页面">{[['library','字符库'],['import','导入图集'],['refine','校正与导出']].map(([key,label])=><Button key={key} disabled={busy} aria-current={tab===key?'page':undefined} onClick={()=>setTab(key)}>{label}</Button>)}</nav>
    {error&&<div className="font-error" role="alert">{error}<Button icon="close" iconOnly aria-label="关闭字体错误" onClick={()=>setError('')}/></div>}
    {notice&&<p role="status" className="font-notice">{notice}</p>}
    {runtime&&!runtime.ready&&<div className="font-runtime"><span>字体处理环境未就绪</span><Button onClick={()=>action(async()=>{const r=await api.fontConfigure();if(r)setRuntime(r);})}>选择已安装环境</Button><small>{runtime.reason}</small></div>}
    {active&&<div role="status" className="font-progress"><span>{operation[active.operation]} · {active.task.stage||'排队中'}</span><progress max="100" value={active.task.progress||0}/><span>{active.task.progress||0}%</span><Button onClick={()=>api.cancelTask(active.taskId).catch(e=>setError(e.message))}>取消</Button></div>}
    {tab==='library'?<div className="font-columns"><CharacterLibrary p={p} selected={selectedCharacters} toggle={c=>setPromptChars(selectedCharacters.includes(c)?[...selectedCharacters].filter(x=>x!==c).join(''):selectedCharacters+c)}/><aside className="font-side"><h2>生成素材</h2><FontSelectionPreview p={p} characters={selectedCharacters}/><label>需要的字符<textarea aria-label="需要的字符" value={promptChars} onChange={e=>setPromptChars(e.target.value)} placeholder="点选左侧字符，或直接输入"/></label><small>已选 {count(selectedCharacters)} 字 · 可自由增减</small><small>字库仅供选字，不限制导入数量与排列。</small><div className="font-side-bottom"><Button primary disabled={!selectedCharacters} onClick={()=>setPromptOpen(true)}>查看提示词</Button><Button disabled={locked||!runtime?.ready} onClick={chooseImport}>导入图片</Button></div></aside></div>
    :tab==='import'?<div className="font-columns"><div className="font-surface font-import"><header><h2>图片与字形</h2>{atlas&&<Select aria-label="导入记录" value={atlas.id} onChange={e=>setAtlasId(e.target.value)}>{p.atlases.map((a,i)=><option key={a.id} value={a.id}>图片 {i+1} · {a.width} × {a.height}</option>)}</Select>}</header>{atlas?(recognition?<FontRecognition key={recognition.id} project={p} atlas={atlas} job={recognition} locked={locked} apply={processMapping} saveReview={saveReview}/>:<AtlasPreview projectId={id} atlas={atlas}/>):<div className="font-empty"><Icon name="image"/><h2>导入字形图片</h2><p>字数、顺序不限，识别多少就处理多少</p><Button primary disabled={locked||!runtime?.ready} onClick={chooseImport}>选择图片</Button></div>}</div><aside className="font-side"><h2>自动校正</h2><small>本地识别，不上传图片。</small><label>黑白阈值 <b>{threshold}</b><input aria-label="黑白阈值" type="range" min="32" max="224" value={threshold} onChange={e=>setThreshold(+e.target.value)}/></label><label className="font-check"><input type="checkbox" checked={normalize} onChange={e=>setNormalize(e.target.checked)}/>统一重心、大小、基线和字重</label><small>保留原字形结构，已有字可替换，新字自动加入。</small><div className="font-side-bottom"><Button primary disabled={locked||!atlas||!runtime?.ready} onClick={recognize}>{recognition?'重新识别':'识别图片文字'}</Button><Button disabled={locked||!runtime?.ready} onClick={chooseImport}>导入图片</Button></div></aside></div>
    :<div className="font-columns"><div className="font-surface font-results"><header><h2>{detail?.result?.report?.parameters?.smoothing!==undefined?'平滑加粗对照':'字形预览'}</h2><Select aria-label="处理记录" value={shownId||''} onChange={e=>setInspectId(e.target.value)}><option value="" disabled>处理记录</option>{[...p.jobs].reverse().filter(j=>j.operation!=='plan').map((j,i)=><option value={j.id} key={j.id}>{operation[j.operation]} · {p.jobs.length-i} · {({completed:'完成',review:'待检查',failed:'失败',cancelled:'已取消',interrupted:'已中断',queued:'排队',running:'进行中'})[j.task?.status]||'等待'}</option>)}</Select></header>
      {detail?.failure&&<p className="font-error" role="alert">{detail.failure.error}</p>}
      {detail?.result?<><ArtifactPreview projectId={id} detail={detail}/><div className="font-result-info"><span>{detail.result.report?.glyphCount??detail.result.report?.glyphs?.length??0} 字</span>{detail.result.report?.normalization?.needsReview?.length>0&&<span>{detail.result.report.normalization.needsReview.length} 字校正受限，已保留结构</span>}{detail.result.report?.limitedCount>0&&<span>{detail.result.report.limitedCount} 字精修受保护限制</span>}</div>
        {detail.result.report?.errors?.length>0&&<details open><summary>{detail.result.report.errors.length} 项需检查</summary>{detail.result.report.errors.slice(0,24).map((e,i)=><p key={i}>{e.character} · {e.message}</p>)}</details>}
        {canApply&&<Button primary disabled={locked} onClick={()=>action(async()=>{await write('revision.apply',{candidateId:detail.id});await refresh();setTab('library');setNotice('字形已保存到字体');})}>保存到字体</Button>}
        {detail.task?.status==='completed'&&p.jobs.find(j=>j.id===detail.id)?.operation==='process'&&!canApply&&detail.id!==p.current&&<small>此候选基于旧版本，请重新校正后应用</small>}
      </>:<div className="font-empty"><Icon name="text"/><h2>{active?'正在处理…':'还没有字形'}</h2><Button onClick={()=>setTab('import')}>导入图集</Button></div>}
    </div><aside className="font-side"><h2>平滑与加粗</h2>{[['平滑',smoothing,setSmoothing,24],['加粗',bold,setBold,12]].map(([label,value,set,max])=><label key={label}>{label}<b>{value}</b><input aria-label={label} type="range" min="0" max={max} value={value} onChange={e=>set(+e.target.value)}/></label>)}<small>自动保护点画与字腔</small><Button disabled={locked||!source||!runtime?.ready} onClick={refine}>生成精修预览</Button><div className="font-side-bottom"><span>已完成 {count(p.covered)} 字形</span><Button disabled={locked||!p.current||!runtime?.ready} onClick={build}>编译字体预览</Button><Button primary disabled={locked||!latest} onClick={()=>setExportOpen(true)}>导出字体</Button></div></aside></div>}
    {promptOpen&&<FormDialog title="生成提示词" close={()=>setPromptOpen(false)} width={680}><div className="font-prompt"><textarea readOnly aria-label="生成提示词" value={promptText}/><Button primary onClick={()=>action(async()=>{await api.copyText(promptText);setNotice('已复制提示词');setPromptOpen(false);})}>复制提示词</Button></div></FormDialog>}
    {exportOpen&&latest&&<FormDialog title="导出字体" close={()=>setExportOpen(false)} width={460}><div className="font-export"><h2>{p.name}</h2><p>{count(p.covered)} 字可导出</p><small>请先核对错字和风格；导出不代表已通过人工审阅。</small>{['ttf','woff2'].map(ext=><Button primary key={ext} disabled={busy} onClick={()=>action(async()=>{const ok=await api.fontExport({projectId:id,jobId:latest.id,artifactId:'font.'+ext});if(ok)setNotice(ext.toUpperCase()+' 已导出');})}>导出 {ext.toUpperCase()}</Button>)}</div></FormDialog>}
  </>;
}

function CharacterLibrary({p,selected,toggle}){
  const [filter,setFilter]=useState('all'),[search,setSearch]=useState(''),[page,setPage]=useState(0),covered=new Set(p.covered||'');
  const items=[...p.characters].map((c,i)=>({c,i})).filter(({c,i})=>(filter==='all'||group(c)===filter)&&(!search||search.includes(c)||String(i+1)===search));
  const pages=Math.ceil(items.length/256),visible=items.slice(page*256,page*256+256);
  const characters=visible.filter(({c})=>covered.has(c)).map(({c})=>c).join('');
  const {glyphs,error:previewError,retry}=useGlyphOutlines(p,characters);
  return <div className="font-surface font-library"><header><div className="font-filters">{[['all','全部'],['chinese','中文'],['latin','字母'],['other','数字与标点']].map(([key,label])=><Button aria-pressed={filter===key} key={key} onClick={()=>{setFilter(key);setPage(0);}}>{label}</Button>)}</div><Input aria-label="搜索字符或编号" placeholder="搜索字符 / 编号" value={search} onChange={e=>{setSearch(e.target.value);setPage(0);}}/></header>
    <div className="font-grid-title"><strong>字符库 · {items.length.toLocaleString()} 字</strong><small>已有字显示实际轮廓 · ● 已保存</small></div>
    {previewError&&<small role="alert">实际字形未能加载：{previewError}<Button onClick={retry}>重试</Button></small>}
    <div className="font-character-grid">{visible.map(({c,i})=>{const glyph=glyphs.get(c);return <button key={c} className={covered.has(c)?'complete':''} aria-label={c+(covered.has(c)?' · 已保存字形':' · 参考字')} aria-pressed={selected.includes(c)} title={`#${i+1} · U+${c.codePointAt(0).toString(16).toUpperCase()}`} onClick={()=>toggle(c)}>{glyph?<><svg viewBox={`-125 -900 ${Math.max(1000,glyph.advance)+250} 1200`} aria-label={c+'实际字形'}><path d={glyph.path} transform="scale(1 -1)" fill="currentColor"/></svg><small>{c}</small></>:covered.has(c)?<><span>{previewError?'!':'…'}</span><small>{c}</small></>:<span>{c}</span>}</button>;})}</div>
    {!items.length&&<small>字库为空，可直接导入图片识别。</small>}
    <footer><small>分页仅用于浏览</small><Button disabled={!page} onClick={()=>setPage(page-1)}>上一页</Button><span>{pages?page+1:0} / {pages}</span><Button disabled={!pages||page>=pages-1} onClick={()=>setPage(page+1)}>下一页</Button></footer>
  </div>;
}

function useGlyphOutlines(p,characters){
  const [preview,setPreview]=useState(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{let disposed=false;setPreview(null);setError('');if(p.current&&characters)call('glyph.preview',{projectId:p.id,characters}).then(r=>{if(!disposed)setPreview({revision:r.sourceRevision,characters,glyphs:new Map(r.glyphs.map(g=>[g.character,g]))});}).catch(e=>!disposed&&setError(e.message));return()=>{disposed=true;};},[p.id,p.current,characters,attempt]);
  return {glyphs:preview?.revision===p.current&&preview.characters===characters?preview.glyphs:new Map(),error,retry:()=>setAttempt(n=>n+1)};
}
function FontSelectionPreview({p,characters}){
  const saved=[...characters].filter(c=>p.covered?.includes(c)).slice(0,16).join(''),{glyphs,error,retry}=useGlyphOutlines(p,saved);
  if(!saved)return null;
  return <div className="font-selection-preview" aria-label="已选字形预览">{error?<Button onClick={retry}>重试字形预览</Button>:[...saved].map(c=>{const g=glyphs.get(c);return <div key={c} title={c}>{g?<svg viewBox={`-125 -900 ${Math.max(1000,g.advance)+250} 1200`} aria-label={c+'已选字形'}><path d={g.path} transform="scale(1 -1)" fill="currentColor"/></svg>:<span>…</span>}<small>{c}</small></div>;})}</div>;
}

function AtlasPreview({projectId,atlas}){
  const [image,setImage]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let disposed=false;setImage(null);setError('');call('atlas.preview',{projectId,atlasId:atlas.id,maxSize:1200}).then(r=>!disposed&&setImage('data:'+r.mimeType+';base64,'+r.data)).catch(e=>!disposed&&setError(e.message));return()=>{disposed=true;};},[projectId,atlas.id]);
  return <div className="font-atlas-preview">{image?<img src={image} alt="原始字形图片"/>:<p>{error||'读取图集…'}</p>}<small>{atlas.width} × {atlas.height} · 原图已保存</small></div>;
}
function ArtifactPreview({projectId,detail}){
  const pictures=(detail.result.artifacts||[]).filter(a=>a.mimeType==='image/png'&&!a.id.startsWith('corrected-'));
  const [index,setIndex]=useState(0),[image,setImage]=useState(null),[error,setError]=useState('');const asset=pictures[Math.min(index,pictures.length-1)];
  useEffect(()=>{setIndex(0);},[detail.id]);
  useEffect(()=>{let disposed=false;setImage(null);setError('');if(asset)call('artifact.preview',{projectId,jobId:detail.id,artifactId:asset.id,maxSize:1600}).then(r=>!disposed&&setImage('data:'+r.mimeType+';base64,'+r.data)).catch(e=>!disposed&&setError(e.message));return()=>{disposed=true;};},[projectId,detail.id,asset?.id]);
  return <div className="font-artifact"><small>{detail.result.report?.normalization||detail.result.report?.parameters?.smoothing!==undefined?'每对字形：左为处理前，右为处理后':'实际导出字体试排'}</small>{image?<img src={image} alt="实际字形处理效果"/>:<p>{error||(asset?'读取预览…':'此记录无对照图，请编译字体预览')}</p>}{pictures.length>1&&<footer><Button disabled={index===0} onClick={()=>setIndex(index-1)}>上一页</Button><span>{index+1} / {pictures.length}</span><Button disabled={index>=pictures.length-1} onClick={()=>setIndex(index+1)}>下一页</Button></footer>}</div>;
}
