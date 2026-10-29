// The active page stays in the existing editor fields; only inactive pages store content.
const kinds=['canvas','layers'];
const fields={canvas:['tugouCanvas'],layers:['width','height','background','layers','selection','layout','compositionView']};
const label=kind=>kind==='canvas'?'画布':'合成';
const initialId=kind=>kind==='canvas'?'canvas-main':'composition-main';
const blank=kind=>kind==='canvas'?{tugouCanvas:{version:1,nodes:[],edges:[],viewport:{x:0,y:0,zoom:1}}}:{width:1024,height:1536,background:'#fffdf8',layers:[]};
const pick=(doc,kind)=>Object.fromEntries(fields[kind].filter(key=>doc[key]!==undefined).map(key=>[key,doc[key]]));
function group(doc,kind){if(!kinds.includes(kind))throw Error('无效页面类型');return doc.pages?.[kind]||{activeId:initialId(kind),items:[{id:initialId(kind),name:label(kind)+' 1'}]};}
function list(doc,kind){const g=group(doc,kind);return g.items.map(p=>({id:p.id,name:p.name,kind,active:p.id===g.activeId}));}
function content(doc,kind,id){const g=group(doc,kind),p=g.items.find(p=>p.id===id);if(!p)throw Error('页面不存在');return p.id===g.activeId?{...blank(kind),...pick(doc,kind)}:p.content;}
function setGroup(doc,kind,g){return {...doc,pages:{...doc.pages,[kind]:g}};}
function activate(doc,kind,id){
  const g=group(doc,kind);if(g.activeId===id)return doc;
  const next=content(doc,kind,id),previous=content(doc,kind,g.activeId),result={...doc};
  for(const key of fields[kind])delete result[key];Object.assign(result,next);
  return setGroup(result,kind,{activeId:id,items:g.items.map(p=>p.id===id?{id:p.id,name:p.name}:p.id===g.activeId?{...p,content:previous}:p)});
}
function nameOf(value){if(typeof value!=='string'||!value.trim()||value.trim().length>80)throw Error('页面名称需为 1–80 个字符');return value.trim();}
function create(doc,kind,name){const g=group(doc,kind),id=globalThis.crypto.randomUUID();return {id,document:activate(setGroup(doc,kind,{...g,items:[...g.items,{id,name:nameOf(name||label(kind)+' '+(g.items.length+1)),content:blank(kind)}]}),kind,id)};}
function rename(doc,kind,id,name){const g=group(doc,kind);content(doc,kind,id);return setGroup(doc,kind,{...g,items:g.items.map(p=>p.id===id?{...p,name:nameOf(name)}:p)});}
function duplicate(doc,kind,id){
  const original=group(doc,kind).items.find(p=>p.id===id);if(!original)throw Error('页面不存在');
  const copy=structuredClone(content(doc,kind,id)),objects=kind==='canvas'?copy.tugouCanvas.nodes:copy.layers,ids=new Map(objects.map(n=>[n.id,globalThis.crypto.randomUUID()]));
  for(const n of objects){n.id=ids.get(n.id);if(n.parentId)n.parentId=ids.get(n.parentId);delete n.selected;
    if(n.maskSourceId)n.maskSourceId=ids.get(n.maskSourceId)||n.maskSourceId;
    if(n.data){if(n.data.inputOrder)n.data.inputOrder=n.data.inputOrder.map(id=>ids.get(id)||id);if(n.data.inputRoles)n.data.inputRoles=Object.fromEntries(Object.entries(n.data.inputRoles).map(([id,v])=>[ids.get(id)||id,v]));for(const key of ['sourceNodeId','promptNodeId'])if(n.data[key])n.data[key]=ids.get(n.data[key])||n.data[key];for(const key of ['text','prompt','negativePrompt','camera'])if(typeof n.data[key]==='string')n.data[key]=n.data[key].replace(/@\[node:([^\]]+)\]/g,(match,id)=>ids.has(id)?'@[node:'+ids.get(id)+']':match);delete n.data.generationTaskId;}}
  if(kind==='canvas')copy.tugouCanvas.edges=copy.tugouCanvas.edges.map(e=>({...e,id:globalThis.crypto.randomUUID(),source:ids.get(e.source),target:ids.get(e.target)}));
  const created=create(doc,kind,(original.name.slice(0,75)+' 副本'));let next={...created.document};for(const key of fields[kind])delete next[key];Object.assign(next,copy);return {...created,document:next};
}
function remove(doc,kind,id){let g=group(doc,kind);content(doc,kind,id);if(g.items.length===1)throw Error('至少保留一个'+label(kind));let next=doc;if(g.activeId===id)next=activate(doc,kind,g.items.find(p=>p.id!==id).id);g=group(next,kind);return setGroup(next,kind,{...g,items:g.items.filter(p=>p.id!==id)});}
function withCanvas(doc,id,fn){const current=group(doc,'canvas').activeId,projected=activate(doc,'canvas',id),result=fn(projected);return result===projected?doc:activate(result,'canvas',current);}
function nodePage(doc,nodeId){return list(doc,'canvas').find(p=>content(doc,'canvas',p.id).tugouCanvas.nodes.some(n=>n.id===nodeId))?.id;}
function undoFocus(before,after){
  for(const kind of kinds){const a=list(before,kind),b=list(after,kind);for(const p of b){const old=a.find(v=>v.id===p.id);if(!old||JSON.stringify(content(before,kind,p.id))!==JSON.stringify(content(after,kind,p.id)))return {kind,id:p.id};}}
}
function validate(doc,validateDocument){
  if(doc.pages===undefined)return;
  if(!doc.pages||Array.isArray(doc.pages)||Object.keys(doc.pages).some(k=>!kinds.includes(k)))throw Error('页面目录无效');
  const nodeIds=new Set();
  for(const kind of kinds){const g=group(doc,kind);if(!Array.isArray(g.items)||!g.items.length||!g.items.some(p=>p.id===g.activeId))throw Error('当前页面无效');const ids=new Set();
    for(const p of g.items){if(!p||typeof p.id!=='string'||!p.id||p.id.length>256||ids.has(p.id))throw Error('页面标识无效或重复');ids.add(p.id);nameOf(p.name);
      if(p.id===g.activeId&&p.content!==undefined)throw Error('当前页面不能重复存储内容');
      const data=content(doc,kind,p.id);if(!data||Object.keys(data).some(k=>!fields[kind].includes(k)))throw Error('页面内容无效');
      if(p.id!==g.activeId){const projected={...doc,...blank(kind),...data};delete projected.pages;validateDocument(projected);if(kind==='layers')require('./layers.cjs').validateLayers(projected.layers);}
      if(kind==='canvas')for(const n of data.tugouCanvas.nodes){if(nodeIds.has(n.id))throw Error('跨画布节点标识重复');nodeIds.add(n.id);}
    }
  }
}
module.exports={kinds,label,group,list,content,activate,create,rename,duplicate,remove,withCanvas,nodePage,undoFocus,validate};
