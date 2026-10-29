import {views} from './ui-view.js';
import {group} from '../core/pages.cjs';
const regions={main:'main',canvas:'.flow-surface',palette:'.canvas-palette',inspector:'.canvas-inspector,.layer-inspector',modules:'.module-list',prompt:'.module-editor',recipe:'.recipe-sidebar',settings:'.settings-content',fonts:'.font-workspace',assets:'.library-content',dialog:'.ant-modal-wrap:not([style*="display: none"]) .ant-modal-content'};
const privateSelector='[data-ui-private],.ant-input-password,input[type="password"],.settings-config-code,.settings-connection-fields';
const ids=new WeakMap(),elements=new Map(),checkpoints=new Map();let serial=0,viewRevision=0,started=false,pointerDown=false;
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function start(){if(started)return;started=true;new MutationObserver(()=>viewRevision++).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});for(const name of ['scroll','resize','input','change','toggle'])window.addEventListener(name,()=>viewRevision++,true);window.addEventListener('pointerdown',()=>pointerDown=true,true);for(const name of ['pointerup','pointercancel','blur'])window.addEventListener(name,()=>pointerDown=false,true);}
function id(e){if(!ids.has(e)){const value='ui-'+(++serial);ids.set(e,value);elements.set(value,new WeakRef(e));}return ids.get(e);}
function rect(e){
  const r=e.getBoundingClientRect();let left=Math.max(0,r.left),top=Math.max(0,r.top),right=Math.min(innerWidth,r.right),bottom=Math.min(innerHeight,r.bottom);
  for(let p=e.parentElement;p;p=p.parentElement){const style=getComputedStyle(p),b=p.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(style.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}if(/auto|scroll|hidden|clip/.test(style.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}}
  return {x:Math.ceil(left),y:Math.ceil(top),width:Math.max(0,Math.floor(right)-Math.ceil(left)),height:Math.max(0,Math.floor(bottom)-Math.ceil(top))};
}
function visible(e){const r=rect(e);if(!r.width||!r.height)return false;for(let p=e;p;p=p.parentElement){if(p.tagName==='DETAILS'&&!p.open&&e!==p&&!p.querySelector(':scope > summary')?.contains(e))return false;const s=getComputedStyle(p);if(s.visibility==='hidden'||s.display==='none'||Number(s.opacity)===0)return false;}return true;}
function text(e){if(e.closest(privateSelector))return '[已隐藏]';const copy=e.cloneNode(true);copy.querySelectorAll(privateSelector+',input,textarea,[contenteditable="true"]').forEach(n=>n.remove());return (e.getAttribute('aria-label')||copy.textContent||'').replace(/\s+/g,' ').trim().slice(0,160);}
function target(key='window'){
  if(key==='window')return null;
  const e=regions[key]?Array.from(document.querySelectorAll(regions[key])).find(visible):elements.get(key)?.deref();
  if(!e?.isConnected||!visible(e))fail('UI_TARGET_NOT_VISIBLE','区域不存在或不在当前可见范围，请重新 ui.inspect');return e;
}
const scrollInfo=e=>({x:e.scrollLeft,y:e.scrollTop,width:e.clientWidth,height:e.clientHeight,totalWidth:e.scrollWidth,totalHeight:e.scrollHeight,more:{left:e.scrollLeft>1,up:e.scrollTop>1,right:e.scrollLeft+e.clientWidth<e.scrollWidth-1,down:e.scrollTop+e.clientHeight<e.scrollHeight-1}});
function scrollable(e){const s=getComputedStyle(e);return (/auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+1)||(/auto|scroll/.test(s.overflowX)&&e.scrollWidth>e.clientWidth+1);}
function path(e){const parts=[];while(e&&e!==document.body){const parent=e.parentElement;if(!parent)return null;parts.unshift(e.tagName.toLowerCase()+':nth-child('+(Array.from(parent.children).indexOf(e)+1)+')');e=parent;}return 'body>'+parts.join('>');}
function renderedElements(){const all=Array.from(document.querySelectorAll('#root *,#dialogs *'));return {all:all.slice(0,10000),truncated:all.length>10000};}
function loading(){return {fonts:document.fonts.status!=='loaded',images:Array.from(document.images).filter(e=>visible(e)&&!e.complete).length,canvases:Array.from(document.querySelectorAll('canvas[data-rendering="true"]')).filter(visible).length,indicators:Array.from(document.querySelectorAll('[aria-busy="true"],.ant-spin-spinning')).filter(visible).length};}
export async function settle(){
  start();const until=Date.now()+2500;let stable=0,last=-1;
  while(Date.now()<until){await pause(60);const load=loading();if(!load.fonts&&!load.images&&!load.canvases&&viewRevision===last){if(++stable>=2)return {stable:true,ready:!load.indicators,...load};}else stable=0;last=viewRevision;}
  const load=loading();return {stable:false,ready:false,...load};
}
export function inspectUi(state,{offset=0,limit=80}={}){
  start();for(const [key,ref] of elements)if(!ref.deref()?.isConnected)elements.delete(key);
  const {all,truncated}=renderedElements(),shown=all.filter(visible),dialogs=Array.from(document.querySelectorAll('[role="dialog"]')).filter(visible),activeDialog=dialogs.at(-1),available=activeDialog?shown.filter(e=>activeDialog.contains(e)):shown,scroll=available.filter(scrollable),controls=available.filter(e=>e.matches('button,input,textarea,select,summary,[role="button"],[role="combobox"],[role="tab"],[role="switch"]'));
  const found=Object.entries(regions).flatMap(([key,selector])=>{const e=Array.from(document.querySelectorAll(selector)).find(visible);return e?[{id:key,rect:rect(e),scroll:scrollInfo(e)}]:[];});
  const canvas=state.document?.tugouCanvas?.nodes||[],nodes=Array.from(document.querySelectorAll('.react-flow__node')).filter(visible).map(e=>{const clipped=rect(e),full=e.getBoundingClientRect();return {id:e.dataset.id,rect:clipped,fullyVisible:clipped.width>=full.width-2&&clipped.height>=full.height-2,selected:e.classList.contains('selected')};});
  return {revision:state.revision,projectId:state.projectId,workspace:state.workspace,activePages:state.document?{canvas:group(state.document,'canvas').activeId,layers:group(state.document,'layers').activeId}:null,viewRevision,viewport:{width:innerWidth,height:innerHeight,deviceScaleFactor:devicePixelRatio},regions:found,
    scrollAreas:scroll.slice(0,100).map(e=>({id:id(e),name:text(e).slice(0,60),rect:rect(e),...scrollInfo(e)})),
    controls:{total:controls.length,offset,nextOffset:offset+limit<controls.length?offset+limit:null,items:controls.slice(offset,offset+limit).map(e=>({id:id(e),role:e.getAttribute('role')||e.tagName.toLowerCase(),name:text(e),disabled:!!e.disabled||e.getAttribute('aria-disabled')==='true',expanded:e.getAttribute('aria-expanded'),checked:e.getAttribute('aria-checked'),rect:rect(e)}))},
    details:available.filter(e=>e.tagName==='DETAILS').slice(0,100).map(e=>({id:id(e),name:text(e.querySelector('summary')||e),expanded:e.open})),
    dialogs:dialogs.map(e=>({name:text(e.querySelector('.ant-modal-title')||e).slice(0,100),rect:rect(e)})),
    alerts:Array.from(document.querySelectorAll('[role="alert"]')).filter(visible).map(text).slice(0,20),loading:loading(),
    canvas:state.workspace==='canvas'?{totalNodes:canvas.length,visibleNodes:nodes,outsideViewport:Math.max(0,canvas.length-nodes.length),nodeIdsComplete:false}:null,
    coverage:{scope:'visible-viewport',scanTruncated:truncated,scrollAreasTruncated:scroll.length>100,obscuredByDialog:!!activeDialog,controlsScope:activeDialog?'top-dialog':'viewport',foldedContentIncluded:false,offscreenContentIncluded:false,nativeDialogsIncluded:false,nativeWindowFrameIncluded:false},redactedRegions:Array.from(document.querySelectorAll(privateSelector)).filter(visible).map(rect)};
}
export function navigationGuard(context){
  if(pointerDown)fail('UI_EDITING','正在拖拽或绘制，请先完成当前操作');
  if(context.busyRef.current)fail('BUSY','界面正在处理操作');
  if(Array.from(document.querySelectorAll('[role="dialog"],.ant-popover,.ant-select-dropdown')).some(visible))fail('UI_BLOCKED','请先完成或关闭当前弹窗/下拉菜单');
  if(document.activeElement?.matches('input,textarea,[contenteditable="true"],[role="combobox"]'))fail('UI_EDITING','当前正在输入，请先完成编辑并离开输入框');
  for(const v of views.values()){const reason=v.blocked();if(reason)fail('UI_EDITING',reason);}
}
export function leaveGuard(context,destination){if(destination!==context.workspace&&(context.workspace==='tools'||context.workspace==='fonts'&&document.querySelector('.font-tabs')))fail('UI_EDITING','请先退出当前工具或字体编辑页，避免丢失局部草稿');}
async function waitView(name){for(let n=0;n<50;n++){if(views.has(name))return views.get(name);await pause(30);}fail('UI_NOT_READY','目标工作区尚未就绪');}
function checkpoint(context,state){
  const {all}=renderedElements();return {projectId:state.projectId,createdAt:Date.now(),workspace:context.workspace,localPage:context.workspace==='tools'||context.workspace==='fonts'?document.querySelector('main')?.firstElementChild:null,layerSelection:[...context.layerSelection],moduleId:context.moduleId,recipeId:context.recipeId,
    pages:state.document?{canvas:group(state.document,'canvas').activeId,layers:group(state.document,'layers').activeId}:null,views:Object.fromEntries([...views].map(([key,v])=>[key,v.get()])),scroll:all.filter(e=>visible(e)&&scrollable(e)).map(e=>({path:path(e),className:e.className,x:e.scrollLeft,y:e.scrollTop})),details:all.filter(e=>e.tagName==='DETAILS'&&visible(e)).map(e=>({path:path(e),open:e.open}))};
}
async function applyCheckpoint(saved,context){
  if(saved.pages)for(const [kind,id] of Object.entries(saved.pages)){if(!group(context.present.current.document,kind).items.some(p=>p.id===id))fail('VIEW_EXPIRED','原页面已删除，无法恢复该视图');}
  if(saved.pages)for(const [kind,id] of Object.entries(saved.pages)){if(group(context.present.current.document,kind).activeId!==id)context.activatePage(kind,id,false);}
  context.setWorkspace(saved.workspace);context.setLayerSelection(saved.layerSelection);context.setModuleId(saved.moduleId);context.setRecipeId(saved.recipeId);
  await settle();for(const [key,value] of Object.entries(saved.views).sort(([a],[b])=>(a==='boards'?-1:b==='boards'?1:0))){await (await waitView(key)).restore(value);await settle();}
  const missing=[];for(const v of saved.details){const e=document.querySelector(v.path);if(e?.tagName==='DETAILS')e.open=v.open;else missing.push(v.path);}
  for(const v of saved.scroll){const e=document.querySelector(v.path);if(e&&e.className===v.className){e.scrollTo(v.x,v.y);if(Math.abs(e.scrollLeft-v.x)>1||Math.abs(e.scrollTop-v.y)>1)missing.push(v.path);}else missing.push(v.path);}
  await settle();return {complete:!missing.length,missingRegions:missing.length};
}
export async function navigateUi(action,args,context,state){
  navigationGuard(context);
  let original;
  if(args.restoreToken){
    const saved=checkpoints.get(args.restoreToken);if(!saved||Date.now()-saved.createdAt>600000)fail('VIEW_EXPIRED','视图令牌已过期，请重新导航');
    if(saved.projectId!==state.projectId)fail('CONFLICT','工程已切换，不能恢复其他工程的视图');
    original=saved;
  }
  if(action==='ui.restore'){
    const saved=original;
    leaveGuard(context,saved.workspace);
    if(saved.localPage&&!saved.localPage.isConnected)fail('VIEW_EXPIRED','原工具或字体页面已关闭，无法恢复其局部草稿');
    return {...await applyCheckpoint(saved,context),restored:true};
  }
  const destination=args.nodeId||args.overview?'canvas':args.settingsTab?'settings':args.workspace||context.workspace;
  if(args.workspace&&args.workspace!==destination)fail('INVALID_ARGUMENT','工作区与定位目标不匹配');
  if((args.scroll&&!args.region)||(!args.scroll&&args.region)||(args.detailsId&&typeof args.expanded!=='boolean')||(!args.detailsId&&args.expanded!==undefined))fail('INVALID_ARGUMENT','滚动需同时指定 region；折叠需同时指定 detailsId 和 expanded');
  if((args.nodeId||args.overview||args.settingsTab||args.workspace)&&(args.scroll||args.detailsId))fail('INVALID_ARGUMENT','请先切换或定位，再 inspect 获取当前区域后滚动或展开');
  if(args.nodeId&&args.overview)fail('INVALID_ARGUMENT','节点定位与概览不能同时指定');
  if(!args.workspace&&!args.settingsTab&&!args.nodeId&&!args.overview&&!args.scroll&&!args.detailsId)fail('INVALID_ARGUMENT','请指定导航目标');
  if(args.nodeId&&!state.document?.tugouCanvas?.nodes.some(n=>n.id===args.nodeId))fail('NOT_FOUND','画布节点不存在');
  if(!state.document&&['canvas','layers','prompts','assets'].includes(destination))fail('NO_PROJECT','请先打开工程');
  leaveGuard(context,destination);
  const scrollTarget=args.scroll?target(args.region):null,details=args.detailsId?target(args.detailsId):null;
  if(scrollTarget&&!scrollable(scrollTarget))fail('INVALID_TARGET','该区域不可滚动，请使用 inspect.scrollAreas 中的 ID');
  if(details&&details.tagName!=='DETAILS')fail('INVALID_TARGET','请使用 inspect.details 返回的 ID');
  const restoreToken=args.restoreToken||crypto.randomUUID();if(!original){checkpoints.set(restoreToken,checkpoint(context,state));while(checkpoints.size>10)checkpoints.delete(checkpoints.keys().next().value);}
  try{
    if(destination!==context.workspace){context.setWorkspace(destination);await settle();}
    if(args.settingsTab)await (await waitView('settings')).navigate(args);
    if(args.nodeId||args.overview)await (await waitView('canvas')).navigate(args);
    if(scrollTarget){const horizontal=scrollTarget.scrollHeight<=scrollTarget.clientHeight+1,key=horizontal?'left':'top',position=horizontal?scrollTarget.scrollLeft:scrollTarget.scrollTop,total=horizontal?scrollTarget.scrollWidth:scrollTarget.scrollHeight,page=Math.max(1,Math.floor((horizontal?scrollTarget.clientWidth:scrollTarget.clientHeight)*.85));scrollTarget.scrollTo({[key]:args.scroll==='start'?0:args.scroll==='end'?total:position+(args.scroll==='next'?page:-page),behavior:'instant'});}
    if(details)details.open=args.expanded;
    const readiness=await settle();return {restoreToken,expiresInMs:Math.max(0,600000-(Date.now()-checkpoints.get(restoreToken).createdAt)),readiness};
  }catch(error){error.message+='；可用 ui.restore 恢复视图，令牌：'+restoreToken;throw error;}
}
export async function prepareCapture(state,args){
  const readiness=await settle();if(!readiness.stable)fail('UI_NOT_READY','界面仍在加载或变化，请稍后重试');
  const element=target(args.region),snapshot=inspectUi(state);return {...snapshot,readiness,rect:element?rect(element):{x:0,y:0,width:innerWidth,height:innerHeight},region:args.region||'window'};
}
