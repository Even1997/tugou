import * as pages from '../core/pages.cjs';

// Keep the persisted address alongside immutable editor data without pinning page bodies.
const saved=new WeakMap(),reading=new Map();
const keyOf=(kind,data)=>kind==='canvas'?data.tugouCanvas:data.layers;
const equal=(a,b)=>Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>a[key]===b[key]);

export function rememberPages(document,refs){
  for(const kind of pages.kinds)for(const item of pages.resident(document,kind)){
    if(!Object.hasOwn(refs?.[kind]||{},item.id)||!document.pages?.[kind])continue;
    const content=pages.content(document,kind,item.id);
    saved.set(keyOf(kind,content),{content,ref:refs[kind][item.id]});
  }
}

export function suspendPages(document,includeActive=false){
  let result=document;
  for(const kind of pages.kinds){
    const group=document.pages?.[kind];if(!group)continue;
    for(const item of group.items){
      if(item.ref||!includeActive&&item.id===group.activeId)continue;
      const content=pages.content(document,kind,item.id),previous=saved.get(keyOf(kind,content));
      if(previous&&equal(content,previous.content))result=pages.storagePage(result,kind,item.id,{ref:previous.ref});
    }
  }
  return result;
}

export async function loadPage(projectId,document,kind,id){
  const ref=pages.group(document,kind).items.find(p=>p.id===id)?.ref;
  if(!ref)return document;
  const key=`${projectId}:${ref.hash}`;
  let pending=reading.get(key);
  if(!pending){
    pending=window.tugou.readPage(projectId,ref.hash).finally(()=>reading.delete(key));
    reading.set(key,pending);
  }
  const content=await pending;
  saved.set(keyOf(kind,content),{content,ref});
  return pages.storagePage(document,kind,id,{content});
}

export async function loadPages(projectId,document,kind,ids){
  let result=document;
  const deferred=new Set(pages.group(document,kind).items.filter(p=>p.ref).map(p=>p.id));
  for(const id of ids)if(deferred.has(id))result=await loadPage(projectId,result,kind,id);
  return result;
}

export async function undoPageFocus(before,after){
  let a=suspendPages(before,true),b=suspendPages(after,true);
  for(let focus=pages.undoFocus(a,b);focus;focus=pages.undoFocus(a,b)){
    const {kind,id}=focus,old=pages.group(a,kind).items.find(p=>p.id===id),next=pages.group(b,kind).items.find(p=>p.id===id);
    if(!old||Boolean(old.ref)===Boolean(next.ref))return focus;
    const ref=old.ref||next.ref,body=pages.content(old.ref?b:a,kind,id);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(body)));
    if(Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('')!==ref.hash)return focus;
    if(old.ref)b=pages.storagePage(b,kind,id,{ref});else a=pages.storagePage(a,kind,id,{ref});
  }
}
