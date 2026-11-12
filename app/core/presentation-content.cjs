const fields=['objective','chartData','visuals'];
const error=(message,code='INVALID_ARGUMENT')=>{throw Object.assign(Error(message),{code});};
function contentOf(slide){
  const saved=slide.content||{},text=slide.elements.filter(e=>e.kind==='text'),seen=new Set();
  const blocks=(saved.blocks||[]).flatMap(b=>{
    if(!b.elementId)return [{...b}];
    const e=text.find(e=>e.id===b.elementId);if(!e)return [];
    seen.add(e.id);
    if(!b.draft&&b.text===b.baseText||b.text===e.text){const {draft,...clean}=b;return [{...clean,text:e.text,baseText:e.text}];}
    return [{...b}];
  });
  for(const e of text)if(!seen.has(e.id))blocks.push({id:e.id,label:blocks.length?'正文':'标题',text:e.text,elementId:e.id,baseText:e.text});
  return {...Object.fromEntries(fields.map(k=>[k,saved[k]||''])),blocks,...(saved.text!==undefined?{text:saved.text}:{})};
}
function contentText(slide){const c=contentOf(slide);return c.text??[...c.blocks.map(b=>b.text),c.objective&&`核心观点：\n${c.objective}`,c.chartData&&`图表数据与依据：\n${c.chartData}`,c.visuals&&`配图需求：\n${c.visuals}`].filter(Boolean).join('\n\n');}
function contentTitle(slide){return (slide.content?.text!==undefined?slide.content.text.split('\n')[0]:contentOf(slide).blocks[0]?.text||'').slice(0,120);}
function contentStatus(slide){
  const blocks=contentOf(slide).blocks,pending=blocks.filter(b=>!b.elementId||b.text!==slide.elements.find(e=>e.id===b.elementId)?.text);
  return {pending:pending.length+(slide.content?.text!==undefined?1:0),conflicts:pending.filter(b=>b.elementId&&b.baseText!==slide.elements.find(e=>e.id===b.elementId)?.text).length};
}
function setContent(slide,patch){
  const current=contentOf(slide),next={...current,...patch};
  if(patch.text===null)delete next.text;
  if(patch.blocks)next.blocks=patch.blocks.map(b=>{
    const old=current.blocks.find(x=>x.id===b.id||b.elementId&&x.elementId===b.elementId),elementId=b.elementId||old?.elementId,e=elementId&&slide.elements.find(e=>e.id===elementId&&e.kind==='text');
    if(elementId&&!e)error('内容只能关联当前页的文字元素');
    if(old?.elementId&&b.elementId&&old.elementId!==b.elementId)error('不能更换已关联文字的元素');
    return {id:b.id||old?.id||globalThis.crypto.randomUUID(),label:b.label,text:b.text,...(e?{elementId,baseText:old?.baseText??e.text,...(b.text!==e.text?{draft:true}:{})}:{})};
  });
  const ids=new Set(),links=new Set();
  for(const b of next.blocks){if(ids.has(b.id)||b.elementId&&links.has(b.elementId))error('内容块或关联元素重复');ids.add(b.id);if(b.elementId)links.add(b.elementId);}
  const result={...slide,content:next};result.content=contentOf(result);
  validateContent(result);return result;
}
function applyContent(slide,{confirmConflicts=false}={}){
  if(slide.content?.text!==undefined)error('整页草稿需先由 AI 整理为页面文字，核对完成后清除 text 草稿，再应用文字块','CONTENT_REQUIRES_LAYOUT');
  const content=contentOf(slide),status=contentStatus(slide);
  if(status.conflicts&&!confirmConflicts)error('页面文字与内容草稿均已修改，请核对差异后确认覆盖', 'CONTENT_CONFLICT');
  const pending=content.blocks.filter(b=>!b.elementId||b.text!==slide.elements.find(e=>e.id===b.elementId)?.text);
  if(pending.some(b=>b.elementId&&slide.elements.find(e=>e.id===b.elementId).locked))error('待更新的文字已锁定，请先解锁','LOCKED');
  const elements=slide.elements.map(e=>({...e}));
  if(elements.length+content.blocks.filter(b=>!b.elementId).length>200)error('每页最多 200 个元素');
  content.blocks=content.blocks.map((b,i)=>{
    let e=elements.find(e=>e.id===b.elementId);
    if(!e){e=require('./presentations.cjs').element('text',{x:72,y:56+(i%5)*120,w:800,h:100,fontSize:i?28:42,bold:!i});elements.push(e);}
    Object.assign(e,require('./rich-text.cjs').patchText(e,{text:b.text}));const {draft,...clean}=b;return {...clean,elementId:e.id,baseText:b.text};
  });
  return {...slide,content,elements};
}
function validateContent(slide){
  const c=slide.content;if(c===undefined)return;
  const str=(v,n)=>typeof v==='string'&&v.length<=n;
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>![...fields,'blocks','text'].includes(k))||!fields.every(k=>str(c[k],10000))||c.text!==undefined&&!str(c.text,2040000)||!Array.isArray(c.blocks)||c.blocks.length>200)error('PPT 页面内容无效');
  const ids=new Set(),links=new Set();
  for(const b of c.blocks){
    if(!b||Object.keys(b).some(k=>!['id','label','text','elementId','baseText','draft'].includes(k))||!str(b.id,100)||!b.id||ids.has(b.id)||!str(b.label,80)||!str(b.text,10000)||b.draft!==undefined&&typeof b.draft!=='boolean')error('PPT 内容块无效');
    ids.add(b.id);
    if(b.elementId!==undefined){if(!str(b.elementId,100)||!b.elementId||links.has(b.elementId)||!str(b.baseText,10000)||!slide.elements.some(e=>e.id===b.elementId&&e.kind==='text'))error('PPT 内容关联无效');links.add(b.elementId);}
    else if(b.baseText!==undefined||b.draft!==undefined)error('未关联内容不能包含页面文字快照');
  }
  const blocks=contentOf(slide).blocks;
  if(blocks.length>200)error('每页最多 200 个内容文字块（含页面文字与未应用草稿）');
  if(new Set(blocks.map(b=>b.id)).size!==blocks.length)error('内容块 ID 与页面文字 ID 重复');
}
// Persist clean text changes and remove deleted links; preserve conflicting drafts for explicit review.
function syncContent(slide){return slide.content?{...slide,content:contentOf(slide)}:slide;}
module.exports={contentOf,contentText,contentTitle,contentStatus,setContent,applyContent,validateContent,syncContent};
