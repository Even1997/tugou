import React,{useEffect,useRef,useState} from 'react';
import {Button,Icon,IconButton,Input,FormDialog} from './components.jsx';
import {Select} from './select.jsx';
import {sizes,colors,create,slide as newSlide,element,duplicate,presentationFont} from '../core/presentations.cjs';
import {FontPicker} from './font-picker.jsx';
import {loadTextFont,textFontFamily} from './font-face.js';
import {textFontWeight} from '../core/font-weights.cjs';
import './presentations.css';
import {ElementEffects} from './element-effects.jsx';
import {PresentationEffects} from './presentation-effects.jsx';
import {useUiView} from './ui-view.js';

const source=a=>a?.resource?`tugou-media://original/${a.resource}`:a?.dataUrl;
const labels={text:'文字',image:'图片',rect:'矩形',ellipse:'圆形'};
export function SlideStage({deck,slide,assets,selected,onSelect,onGesture,onText,preview}){
  const root=useRef(null),[scale,setScale]=useState(.1),[fontError,setFontError]=useState(''),[w,h]=sizes[deck.ratio];
  const fontKey=JSON.stringify(slide.elements.filter(e=>e.kind==='text'&&e.visible!==false).map(presentationFont));
  useEffect(()=>{let alive=true;setFontError('');Promise.all(JSON.parse(fontKey).map(loadTextFont)).catch(e=>{if(alive)setFontError(e.message);});return()=>{alive=false;};},[fontKey]);
  useEffect(()=>{const observer=new ResizeObserver(([entry])=>setScale(entry.contentRect.width/w));observer.observe(root.current);return()=>observer.disconnect();},[w]);
  return <div ref={root} className="ppt-stage" style={{aspectRatio:`${w}/${h}`}} onPointerDown={e=>{if(e.target===root.current||e.target.classList.contains('ppt-page'))onSelect?.(null);}}>
    <div className="ppt-page" style={{width:w,height:h,background:slide.background,transform:`scale(${scale})`}}>
      {slide.elements.filter(e=>e.visible!==false).map(original=>{const e=preview?.id===original.id?preview:original;return <div key={e.id} data-element-id={e.id} className={'ppt-element '+(selected===e.id?'selected':'')} style={{left:e.x,top:e.y,width:e.w,height:e.h,transform:`rotate(${e.rotation}deg)`,cursor:onSelect?(e.locked?'default':'move'):undefined}}
        onPointerDown={event=>{if(!onSelect)return;event.stopPropagation();onSelect(e.id);onGesture?.(event,e,'move',scale);}} onDoubleClick={()=>e.kind==='text'&&onText?.(e.id)}>
        <PresentationEffects element={e}>{e.kind==='text'?<div className="ppt-text" style={{fontFamily:textFontFamily(presentationFont(e)),fontSize:e.fontSize,fontWeight:textFontWeight(presentationFont(e)),fontStyle:e.italic?'italic':'normal',color:e.color,textAlign:e.align}}>{e.text}</div>:e.kind==='image'?<img src={source(assets.find(a=>a.id===e.assetId))} alt="" draggable={false}/>:<div className="ppt-shape" style={{background:e.fill,borderRadius:e.kind==='ellipse'?'50%':0}}/>}</PresentationEffects>
        {selected===e.id&&onGesture&&!e.locked&&<button className="ppt-resize" aria-label="调整元素大小" style={{width:12/scale,height:12/scale,right:-6/scale,bottom:-6/scale}} onPointerDown={event=>{event.stopPropagation();onGesture(event,e,'resize',scale);}}/>}
      </div>})}
    </div>
    {fontError&&<span className="ppt-font-warning" role="status" title={fontError}>字体加载失败，暂用替代字体</span>}
  </div>;
}

function Player({deck,assets,index,setIndex,full,onClose}){
  const [hint,setHint]=useState(''),root=useRef(null);
  const fullscreen=()=>root.current.requestFullscreen().catch(()=>setHint('未能进入全屏，仍可在窗口内演示。'));
  useEffect(()=>{const node=root.current;node.focus();if(full)fullscreen();let wasFull=false;
    const changed=()=>{if(document.fullscreenElement===node)wasFull=true;else if(wasFull)onClose();};document.addEventListener('fullscreenchange',changed);
    return()=>{document.removeEventListener('fullscreenchange',changed);if(document.fullscreenElement===node)document.exitFullscreen().catch(()=>{});};
  },[]);
  const key=e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();onClose();}else if(['ArrowRight','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();setIndex(i=>Math.min(deck.slides.length-1,i+1));}else if(['ArrowLeft','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();setIndex(i=>Math.max(0,i-1));}else if(e.key==='Home'){e.preventDefault();setIndex(0);}else if(e.key==='End'){e.preventDefault();setIndex(deck.slides.length-1);}else if(e.key==='Tab'){const buttons=[...root.current.querySelectorAll('button:not(:disabled)')],at=buttons.indexOf(document.activeElement);e.preventDefault();buttons[(at+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus();}};
  return <div className="ppt-player" ref={root} role="dialog" aria-modal="true" aria-label="PPT 演示" tabIndex={-1} onKeyDown={key}>
    <header><span>{deck.name}</span><span>{hint||'← → 翻页 · Esc 退出'}</span><IconButton label="退出演示" icon="close" onClick={onClose}/></header>
    <div className="ppt-player-content"><div className="ppt-player-page" style={{'--ppt-ratio':deck.ratio==='16:9'?16/9:4/3}}><SlideStage deck={deck} slide={deck.slides[index]} assets={assets}/></div></div>
    <footer><Button disabled={!index} onClick={()=>setIndex(index-1)}>上一页</Button><span>{index+1} / {deck.slides.length}</span><Button disabled={index===deck.slides.length-1} onClick={()=>setIndex(index+1)}>下一页</Button><Button icon="maximize" onClick={fullscreen}>全屏</Button></footer>
  </div>;
}

export function PresentationsWorkspace({record,change,disabled,createProject,save,undo,redo,canUndo,canRedo}){
  const doc=record?.document,decks=doc?.presentations||[],assets=doc?.assets||[];
  const [active,setActive]=useState(null),[pageId,setPageId]=useState(null),[selection,setSelection]=useState(null),[dialog,setDialog]=useState(null),[query,setQuery]=useState(''),[listPage,setListPage]=useState(0),[player,setPlayer]=useState(null),[failure,setFailure]=useState(''),[notice,setNotice]=useState(''),[working,setWorking]=useState(false),[preview,setPreview]=useState(null),[picker,setPicker]=useState(false);
  const gesture=useRef(null),latest=useRef(null),textInput=useRef(null),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const deck=decks.find(d=>d.id===active),current=deck?.slides.find(s=>s.id===pageId)||deck?.slides[0],chosen=current?.elements.find(e=>e.id===selection),busy=disabled||working;
  latest.current={doc,deck,current,busy};
  useEffect(()=>{if(player&&!deck)setPlayer(null);else if(player&&player.start>=deck.slides.length)setPlayer(p=>p?{...p,start:deck.slides.length-1}:null);},[deck,player]);
  const viewState=()=>({presentationId:deck?.id||null,slideId:(player?deck?.slides[Math.min(player.start,deck.slides.length-1)]:current)?.id||null,elementId:chosen?.id||null,mode:player&&deck?'present':deck?'edit':'library',fullscreen:!!document.fullscreenElement?.classList.contains('ppt-player')});
  const navigatePresentation=({command,args={}})=>{
    const fail=(code,message)=>{throw Object.assign(Error(message),{code})};
    const locate=(id,sid)=>{const d=decks.find(p=>p.id===id);if(!d)fail('NOT_FOUND','PPT 不存在');const s=sid?d.slides.find(s=>s.id===sid):d.slides[0];if(!s)fail('NOT_FOUND','PPT 页面不存在');return {d,s};};
    if(busy||gesture.current)fail('UI_EDITING','PPT 正在编辑或处理操作');
    if(command==='ppt.close'){setPlayer(null);setActive(null);setSelection(null);return;}
    if(command==='ppt.present'&&args.action!=='start'){
      if(args.presentationId||args.fullscreen!==undefined||args.action!=='goto'&&args.slideId)fail('INVALID_ARGUMENT','当前演示控制不接受这些参数');
      if(args.action==='stop'){setPlayer(null);return;}
      if(!player||!deck)fail('INVALID_TARGET','请先开始演示');
      if(args.action==='goto'){if(!args.slideId)fail('INVALID_ARGUMENT','请指定 slideId');const {s}=locate(deck.id,args.slideId);setPlayer({...player,start:deck.slides.indexOf(s)});}
      else setPlayer({...player,start:Math.max(0,Math.min(deck.slides.length-1,player.start+(args.action==='next'?1:-1)))});
      return;
    }
    if(player)fail('UI_BLOCKED','请先用 ppt.present stop 结束当前演示');
    const {d,s}=locate(args.presentationId||deck?.id,args.slideId);
    if(args.elementId&&!s.elements.some(e=>e.id===args.elementId))fail('NOT_FOUND','PPT 元素不属于该页');
    setActive(d.id);setPageId(s.id);setSelection(args.elementId||null);
    if(command==='ppt.preview'||command==='ppt.present')setPlayer({start:d.slides.indexOf(s),full:command==='ppt.present'&&!!args.fullscreen});
  };
  useUiView('ppt',{get:viewState,navigate:navigatePresentation,restore:v=>navigatePresentation(v.presentationId?{command:'ppt.open',args:{presentationId:v.presentationId,slideId:v.slideId,elementId:v.elementId}}:{command:'ppt.close'}),blocked:()=>busy||gesture.current?'请先完成 PPT 当前操作':null});

  useEffect(()=>{setSelection(id=>current?.elements.some(e=>e.id===id)?id:null);setPreview(null);gesture.current=null;},[active,current?.id]);
  useEffect(()=>{setPreview(null);gesture.current=null;},[doc]);
  const run=async fn=>{setFailure('');setNotice('');setWorking(true);try{await fn();}catch(e){setFailure(e.message);}finally{setWorking(false);}};
  const updateDeck=next=>{if(busy)return false;return change({...doc,presentations:decks.map(d=>d.id===next.id?next:d)});};
  const updateSlide=next=>updateDeck({...deck,slides:deck.slides.map(s=>s.id===next.id?next:s)});
  const patchElement=(id,patch)=>{const {doc:now,deck:d,current:s,busy:blocked}=latest.current,e=s?.elements.find(e=>e.id===id);if(!mounted.current||blocked||!e||e.locked&&!Object.keys(patch).every(k=>['locked','visible'].includes(k)))return;
    change({...now,presentations:now.presentations.map(p=>p.id===d.id?{...p,slides:p.slides.map(p=>p.id===s.id?{...p,elements:p.elements.map(e=>e.id===id?{...e,...patch,...(patch.fontWeight!==undefined?{bold:patch.fontWeight>=600}:{})}:e)}:p)}:p)});
  };
  const updateElement=patch=>{if(chosen)patchElement(chosen.id,patch);};
  const orderElement=to=>{if(!chosen||chosen.locked||busy)return;const list=current.elements.filter(e=>e.id!==chosen.id);list.splice(Math.max(0,Math.min(list.length,to)),0,chosen);updateSlide({...current,elements:list});};
  const addElement=e=>{if(current.elements.length>=200){setFailure('每页最多 200 个元素');return;}updateSlide({...current,elements:[...current.elements,e]});setSelection(e.id);};
  const addPage=layout=>{if(deck.slides.length>=200){setFailure('每份 PPT 最多 200 页');return;}const next=newSlide(layout,sizes[deck.ratio][0],deck.accent),index=deck.slides.indexOf(current);updateDeck({...deck,slides:[...deck.slides.slice(0,index+1),next,...deck.slides.slice(index+1)]});setPageId(next.id);};
  const movePage=offset=>{const list=[...deck.slides],i=list.indexOf(current),j=i+offset;if(j<0||j>=list.length)return;[list[i],list[j]]=[list[j],list[i]];updateDeck({...deck,slides:list});};
  const removeElement=()=>chosen&&!chosen.locked&&updateSlide({...current,elements:current.elements.filter(e=>e.id!==chosen.id)});
  const startGesture=(event,e,mode,scale)=>{if(busy||e.locked||event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);gesture.current={id:e.id,mode,scale,startX:event.clientX,startY:event.clientY,original:e,slideId:current.id,deckId:deck.id,doc};setPreview(e);};
  const moveGesture=event=>{const g=gesture.current;if(!g)return;const dx=(event.clientX-g.startX)/g.scale,dy=(event.clientY-g.startY)/g.scale,o=g.original;
    const angle=o.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),w=Math.max(8,Math.min(5000,Math.round(o.w+c*dx+s*dy))),h=Math.max(8,Math.min(5000,Math.round(o.h-s*dx+c*dy))),dw=w-o.w,dh=h-o.h;
    const next=g.mode==='move'?{...o,x:Math.max(-o.w+8,Math.min(sizes[deck.ratio][0]-8,Math.round(o.x+dx))),y:Math.max(-o.h+8,Math.min(712,Math.round(o.y+dy)))}:{...o,w,h,x:Math.max(-5000,Math.min(5000,o.x+(c*dw-s*dh-dw)/2)),y:Math.max(-5000,Math.min(5000,o.y+(s*dw+c*dh-dh)/2))};
    gesture.current.next=next;setPreview(next);
  };
  const endGesture=()=>{const g=gesture.current;gesture.current=null;setPreview(null);if(!g?.next||g.doc!==latest.current.doc||latest.current.busy)return;updateSlide({...current,elements:current.elements.map(e=>e.id===g.id?g.next:e)});};
  const exportDeck=target=>run(async()=>{const choice=await window.tugou.chooseExport(target.name,'pptx');if(!choice)return;const result=await window.tugou.presentationExport(choice.token,target,assets);setNotice(`已导出 ${result.name}`);});
  const imageElement=a=>{if(!Number.isFinite(a.width)||!Number.isFinite(a.height)||a.width<=0||a.height<=0)throw Error('图片尺寸无效，请重新导入');if(a.width*a.height>40000000)throw Error('请先缩小图片到 4000 万像素以内');const k=Math.min(600/a.width,400/a.height);return element('image',{assetId:a.id,x:120,y:160,w:Math.max(8,Math.round(a.width*k)),h:Math.max(8,Math.round(a.height*k))});};
  const importImage=()=>run(async()=>{const imported=await window.tugou.importImage();if(!mounted.current||!imported?.length)return;const {doc:now,deck:d,current:s}=latest.current;if(d?.id!==deck.id||s?.id!==current.id)throw Error('页面已切换，请重新选择图片');if(s.elements.length+imported.length>200)throw Error('每页最多 200 个元素');const items=imported.map(imageElement);change({...now,assets:[...now.assets,...imported],presentations:now.presentations.map(p=>p.id===d.id?{...p,slides:p.slides.map(p=>p.id===s.id?{...p,elements:[...p.elements,...items]}:p)}:p)});setSelection(items[0].id);});
  const openDeck=d=>{setActive(d.id);setPageId(d.slides[0].id);setFailure('');setNotice('');};
  const submit=e=>{e.preventDefault();const data=new FormData(e.currentTarget),name=String(data.get('name')).trim();if(!name)return;const next=dialog.id?{...decks.find(d=>d.id===dialog.id),name}:create(name,String(data.get('ratio')),String(data.get('accent')));if(dialog.id)updateDeck(next);else {if(decks.length>=100){setFailure('每个工程最多 100 份 PPT');return;}change({...doc,presentations:[...decks,next]});openDeck(next);}setDialog(null);};
  const filtered=decks.filter(d=>d.name.toLowerCase().includes(query.toLowerCase())),pages=Math.max(1,Math.ceil(filtered.length/12)),visiblePage=Math.min(listPage,pages-1);
  return <section className="ppt-workspace" aria-label="PPT 工作区">
    {!doc?<div className="ppt-empty"><Icon name="ppt"/><h1>把想法，做成一份演示。</h1><p>创建工程后，可以在其中制作和管理多个 PPT。</p><Button primary disabled={disabled} onClick={createProject}>新建工程</Button></div>:<>
    <header className="ppt-toolbar"><div className="ppt-heading">{deck&&<IconButton label="返回 PPT 列表" icon="back" onClick={()=>setActive(null)}/>}<Icon name="ppt"/><div><h1>{deck?deck.name:'PPT'}</h1><small>{deck?`${deck.slides.length} 页 · ${deck.ratio}`:`${record.document.name} · ${decks.length} 份演示文稿`}</small></div>{deck&&<IconButton label="重命名 PPT" icon="edit" disabled={busy} onClick={()=>setDialog({id:deck.id})}/>}</div>
      <div className="ppt-actions">{deck?<><IconButton label="撤销 PPT 修改" icon="undo" disabled={busy||!canUndo} onClick={undo}/><IconButton label="重做 PPT 修改" icon="redo" disabled={busy||!canRedo} onClick={redo}/><Button icon="save" disabled={busy} onClick={save}>保存</Button><Button icon="export" disabled={busy} onClick={()=>exportDeck(deck)}>导出 PPTX</Button><Button icon="visible" disabled={busy} onClick={()=>setPlayer({start:deck.slides.indexOf(current),full:false})}>预览</Button><Button primary icon="play" disabled={busy} onClick={()=>setPlayer({start:deck.slides.indexOf(current),full:true})}>演示</Button></>:<Button primary icon="add" disabled={busy||decks.length>=100} onClick={()=>setDialog({})}>新建 PPT</Button>}</div>
    </header>
    {(failure||notice)&&<div className={'ppt-notice '+(failure?'error':'')} role={failure?'alert':'status'}>{failure||notice}<IconButton label="关闭提示" icon="close" onClick={()=>{setFailure('');setNotice('');}}/></div>}
    {!deck?<div className="ppt-library"><div className="ppt-library-bar"><span>我的演示文稿</span><Input aria-label="搜索 PPT" placeholder="搜索 PPT 名称" value={query} onChange={e=>{setQuery(e.target.value);setListPage(0);}}/></div>
      {!filtered.length?<div className="ppt-empty"><Icon name="ppt"/><h2>{query?'没有找到匹配的 PPT':'从第一份 PPT 开始'}</h2><p>{query?'试试其他关键词。':'文字、图片与形状，让每一页表达更清晰。'}</p>{!query&&<Button primary disabled={busy} onClick={()=>setDialog({})}>创建 PPT</Button>}</div>:<div className="ppt-deck-grid">{filtered.slice(visiblePage*12,visiblePage*12+12).map(d=><article className="ppt-deck-card" key={d.id}><button className="ppt-cover" aria-label={`打开 ${d.name}`} onClick={()=>openDeck(d)}><div className="ppt-cover-frame"><div style={{width:d.ratio==='4:3'?'75%':'100%'}}><SlideStage deck={d} slide={d.slides[0]} assets={assets}/></div></div></button><div className="ppt-deck-bottom"><div className="ppt-deck-meta"><button onClick={()=>openDeck(d)}>{d.name}</button><span>{d.slides.length} 页 · {d.ratio}</span></div><footer><Button disabled={busy} onClick={()=>{openDeck(d);setPlayer({start:0,full:false});}}>查看</Button><IconButton label={`复制 ${d.name}`} icon="copy" disabled={busy||decks.length>=100} onClick={()=>{const copy=duplicate(d);copy.name=(d.name+' 副本').slice(0,120);change({...doc,presentations:[...decks,copy]});}}/><IconButton label={`删除 ${d.name}`} icon="delete" disabled={busy} onClick={()=>{if(confirm(`删除「${d.name}」？可以通过撤销恢复。`))change({...doc,presentations:decks.filter(p=>p.id!==d.id)});}}/></footer></div></article>)}</div>}
      <div className="ppt-pagination"><span>共 {filtered.length} 份</span><Button disabled={!visiblePage} onClick={()=>setListPage(visiblePage-1)}>上一页</Button><span>{visiblePage+1} / {pages}</span><Button disabled={visiblePage===pages-1} onClick={()=>setListPage(visiblePage+1)}>下一页</Button></div>
    </div>:<div className="ppt-editor">
      <aside className="ppt-slides"><div className="ppt-section-title"><strong>幻灯片</strong><Button icon="add" disabled={busy} onClick={()=>addPage('content')}>新增</Button></div><div className="ppt-slide-list">{deck.slides.map((s,i)=><button key={s.id} aria-label={`第 ${i+1} 页`} aria-current={s.id===current.id?'page':undefined} onClick={()=>setPageId(s.id)}><span>{String(i+1).padStart(2,'0')}</span><SlideStage deck={deck} slide={s} assets={assets}/></button>)}</div><div className="ppt-slide-actions"><IconButton label="页面上移" icon="up" disabled={busy||current===deck.slides[0]} onClick={()=>movePage(-1)}/><IconButton label="页面下移" icon="down" disabled={busy||current===deck.slides.at(-1)} onClick={()=>movePage(1)}/><IconButton label="复制页面" icon="copy" disabled={busy||deck.slides.length>=200} onClick={()=>{const s=duplicate(current),list=[...deck.slides];list.splice(list.indexOf(current)+1,0,s);updateDeck({...deck,slides:list});setPageId(s.id);}}/><IconButton label="删除页面" icon="delete" disabled={busy||deck.slides.length===1} onClick={()=>{if(confirm('删除当前幻灯片？可以撤销恢复。')){const list=deck.slides.filter(s=>s.id!==current.id);updateDeck({...deck,slides:list});setPageId(list[0].id);}}}/></div></aside>
      <div className="ppt-center" onKeyDown={e=>{if(e.target.closest('input,textarea,[contenteditable]')||busy)return;if(['Delete','Backspace'].includes(e.key)&&chosen){e.preventDefault();removeElement();}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&chosen){e.preventDefault();const n=e.shiftKey?10:1;updateElement({x:Math.max(-5000,Math.min(5000,chosen.x+(e.key==='ArrowRight'?n:e.key==='ArrowLeft'?-n:0))),y:Math.max(-5000,Math.min(5000,chosen.y+(e.key==='ArrowDown'?n:e.key==='ArrowUp'?-n:0)))});}}}>
        <div className="ppt-insert"><Button icon="text" disabled={busy} onClick={()=>addElement(element('text'))}>文字</Button><Button icon="assets" disabled={busy} onClick={importImage}>图片</Button><Button icon="open" disabled={busy} onClick={()=>setPicker(true)}>素材库</Button><Button icon="rectangle" disabled={busy} onClick={()=>addElement(element('rect'))}>矩形</Button><Button icon="circle" disabled={busy} onClick={()=>addElement(element('ellipse'))}>圆形</Button><Button disabled={busy} onClick={()=>addPage('blank')}>空白页</Button></div>
        <div className="ppt-edit-surface" tabIndex={0} aria-label="幻灯片编辑画布" onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={()=>{gesture.current=null;setPreview(null);}}><div className="ppt-edit-page"><SlideStage deck={deck} slide={current} assets={assets} selected={selection} onSelect={id=>{setSelection(id);document.querySelector('.ppt-edit-surface')?.focus({preventScroll:true});}} onGesture={startGesture} preview={preview} onText={()=>textInput.current?.focus()}/></div></div>
        <div className="ppt-notes"><label htmlFor="ppt-notes">演讲备注</label><textarea id="ppt-notes" maxLength={10000} value={current.notes} disabled={busy} placeholder="备注不会显示在演示画面中" onChange={e=>updateSlide({...current,notes:e.target.value})}/></div>
      </div>
      <aside className="ppt-inspector"><div className="ppt-properties"><div className="ppt-section-title"><strong>{chosen?labels[chosen.kind]+'属性':'页面设置'}</strong>{chosen&&<IconButton label="取消选择" icon="close" onClick={()=>setSelection(null)}/>}</div>
        <fieldset disabled={busy}><label>页面背景<input aria-label="页面背景" type="color" value={current.background} onChange={e=>updateSlide({...current,background:e.target.value})}/></label></fieldset><fieldset disabled={busy||chosen?.locked}>
        {chosen?<><div className="ppt-fields">{[['x','X',-5000,5000],['y','Y',-5000,5000],['w','宽度',8,5000],['h','高度',8,5000],['rotation','旋转',-360,360]].map(([key,label,min,max])=><label key={key}>{label}<input aria-label={label} type="number" min={min} max={max} value={chosen[key]} onChange={e=>{if(e.target.value!==''&&Number.isFinite(e.target.valueAsNumber))updateElement({[key]:Math.max(min,Math.min(max,e.target.valueAsNumber))});}}/></label>)}</div>
          {chosen.kind==='text'?<><label>文字内容<textarea ref={textInput} aria-label="文字内容" maxLength={10000} value={chosen.text} onChange={e=>updateElement({text:e.target.value})}/></label><FontPicker key={chosen.id} layer={{...chosen,...presentationFont(chosen),locked:busy||chosen.locked}} onChange={patch=>patchElement(chosen.id,patch)}/><div className="ppt-fields"><label>字号<input aria-label="字号" type="number" min={8} max={240} value={chosen.fontSize} onChange={e=>{if(e.target.value)updateElement({fontSize:Math.max(8,Math.min(240,e.target.valueAsNumber))});}}/></label><label>文字颜色<input aria-label="文字颜色" type="color" value={chosen.color} onChange={e=>updateElement({color:e.target.value})}/></label></div><div className="ppt-format"><Button aria-pressed={chosen.italic} onClick={()=>updateElement({italic:!chosen.italic})}>斜体</Button></div><Select aria-label="文字对齐" value={chosen.align} onChange={e=>updateElement({align:e.target.value})}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></Select></>:chosen.kind!=='image'&&<label>填充颜色<input aria-label="填充颜色" type="color" value={chosen.fill} onChange={e=>updateElement({fill:e.target.value})}/></label>}
          <ElementEffects presentation effects={chosen.effects} onChange={effects=>updateElement({effects})}/>
          <div className="ppt-property-actions"><Button icon="up" onClick={()=>orderElement(current.elements.length-1)}>置顶</Button><Button icon="down" onClick={()=>orderElement(0)}>置底</Button><Button icon="copy" onClick={()=>addElement({...chosen,id:crypto.randomUUID(),x:Math.min(5000,chosen.x+20),y:Math.min(5000,chosen.y+20)})}>复制</Button><Button icon="delete" onClick={removeElement}>删除</Button></div>
        </>:<div className="ppt-inspector-hint"><Icon name="ppt"/><p>选择页面上的元素，调整内容、样式和位置。</p><p>拖动可移动，右下角控制点可缩放。方向键微调，Shift 加速。</p></div>}</fieldset>
        <p className="ppt-export-hint">PPTX 保留字体名称，粗细转换为常规或粗体；字体未嵌入，换设备可能替换。GIF 导出首帧。</p></div>
        <section className="ppt-layer-panel" aria-label="页面图层">
          <div className="ppt-section-title"><strong>图层 <small>{current.elements.length}</small></strong><div><IconButton label="图层上移" icon="up" disabled={busy||!chosen||chosen.locked||current.elements.at(-1)===chosen} onClick={()=>orderElement(current.elements.indexOf(chosen)+1)}/><IconButton label="图层下移" icon="down" disabled={busy||!chosen||chosen.locked||current.elements[0]===chosen} onClick={()=>orderElement(current.elements.indexOf(chosen)-1)}/></div></div>
          <div className="ppt-layer-list">{[...current.elements].reverse().map((e,i)=>{const name=(e.kind==='text'?e.text.split('\n')[0]:e.kind==='image'?assets.find(a=>a.id===e.assetId)?.name:'')||`${labels[e.kind]} ${current.elements.length-i}`;return <div key={e.id} data-layer-id={e.id} className={'ppt-layer-row'+(selection===e.id?' selected':'')+(e.visible===false?' is-hidden':'')}>
            <button className="ppt-layer-select" aria-label={`选择图层 ${name}`} aria-pressed={selection===e.id} title={name} onClick={()=>setSelection(e.id)}><Icon name={{text:'text',image:'assets',rect:'rectangle',ellipse:'circle'}[e.kind]}/><span>{name}</span></button>
            <IconButton label={e.visible===false?'显示图层':'隐藏图层'} icon={e.visible===false?'hidden':'visible'} disabled={busy} onClick={()=>patchElement(e.id,{visible:e.visible===false})}/>
            <IconButton label={e.locked?'解锁图层':'锁定图层'} icon={e.locked?'locked':'unlocked'} disabled={busy} onClick={()=>patchElement(e.id,{locked:!e.locked})}/>
          </div>})}{!current.elements.length&&<p className="ppt-layer-empty">添加文字、图片或形状后显示图层</p>}</div>
        </section>
      </aside>
    </div>}
    </>}
    {dialog&&<FormDialog title={dialog.id?'重命名 PPT':'新建 PPT'} close={()=>setDialog(null)}><form onSubmit={submit}><label className="ppt-form-label">名称<Input name="name" aria-label="PPT 名称" autoFocus required maxLength={120} defaultValue={dialog.id?decks.find(d=>d.id===dialog.id)?.name:'未命名 PPT'}/></label>{!dialog.id&&<><label className="ppt-form-label">页面比例<select name="ratio" defaultValue="16:9"><option>16:9</option><option>4:3</option></select></label><label className="ppt-form-label">主题色<select name="accent" defaultValue={colors[0]}>{colors.map((c,i)=><option key={c} value={c}>{['经典蓝','极简黑','暖橙'][i]}</option>)}</select></label></>}<div className="dialog-footer"><Button onClick={()=>setDialog(null)}>取消</Button><Button primary type="submit" disabled={busy}>{dialog.id?'保存名称':'创建 PPT'}</Button></div></form></FormDialog>}
    {picker&&<FormDialog title="选择工程图片" close={()=>setPicker(false)}><div className="ppt-image-picker">{assets.filter(a=>(!a.kind||a.kind==='image')&&a.resource).map(a=><button key={a.id} onClick={()=>{try{addElement(imageElement(a));setPicker(false);}catch(e){setFailure(e.message);setPicker(false);}}}><img src={source(a)} alt=""/><span>{a.name||'图片'}</span></button>)}{!assets.some(a=>(!a.kind||a.kind==='image')&&a.resource)&&<p>素材库暂无图片，可先使用“图片”按钮导入。</p>}</div></FormDialog>}
    {player&&deck&&<Player deck={deck} assets={assets} index={Math.min(player.start,deck.slides.length-1)} setIndex={value=>setPlayer(p=>p?{...p,start:typeof value==='function'?value(p.start):value}:null)} full={player.full} onClose={()=>setPlayer(null)}/>}
  </section>;
}
