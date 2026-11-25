import {useImageImport} from './use-image-import.js';
import {createLayer} from '../core/layers.cjs';
import {ImageCache} from '../core/image-cache.cjs';
import {ColorControl} from './color-control.jsx';
import {useUiView,views} from './ui-view.js';
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Modal} from 'antd';
import {VectorTraceDialog} from './vector-trace-dialog.jsx';
import {addTracedLayer} from './vector-trace.js';
import {worldMatrix,decompose,inherited,descendants} from '../core/layers.cjs';
import {BoardExport} from './board-export.jsx';
import {DataMergeDialog} from './data-merge.jsx';
import {PsdDialog} from './psd-dialog.jsx';
import {Button, Input, Icon, EmptyState, FormDialog} from './components.jsx';
import {ContextMenu,useContextMenu,menuAction as item,menuDivider as divider} from './context-menu.jsx';
import {layerMenu} from './layer-context-menu.jsx';
import {NumberField} from './number-field.jsx';
import {LayerEditor} from './layers.jsx';
import * as artboards from '../core/artboards.cjs';
import './composite-workspace.css';
import {BoardSizeControl} from './board-size.jsx';
import {saveCompositionMaterial} from './save-composition-material.js';
import {materialPlan} from '../core/composition-material.cjs';
import {Compositor} from './composite.js';

import {dimensions,sizePatch} from '../core/board-measure.cjs';

function BoardInspector({board,patch,resize,scaleContent,setScaleContent,createBoard,applySize,duplicate,remove,canRemove,disabled,openDataMerge,openBatchExport}) {
  const [name,setName]=useState(board.name);
  const unit=board.printSize?.unit||'px',display=dimensions(board),step=unit==='px'?1:'any';
  return <fieldset className="layer-properties board-properties" disabled={disabled||board.locked}>
    <Input className="inspector-name" aria-label="画板名称" value={name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(name.trim()&&name.trim()!==board.name)patch({name:name.trim()});else if(!name.trim())setName(board.name)}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/>
    <p className="inspector-caption">画板 / {display.width} × {display.height} {unit}{board.printSize&&' · '+board.printSize.ppi+' PPI'}</p>
    <div className="property-grid"><NumberField label="画板属性宽度" shortLabel="W" min={0} step={step} value={display.width} onChange={width=>resize({width,unit})}/><NumberField label="画板属性高度" shortLabel="H" min={0} step={step} value={display.height} onChange={height=>resize({height,unit})}/><NumberField label="画板 X" shortLabel="X" value={board.x} onChange={x=>patch({x})}/><NumberField label="画板 Y" shortLabel="Y" value={board.y} onChange={y=>patch({y})}/></div>
    <div className="board-actions"><Button icon="replace" onClick={()=>resize({width:display.height,height:display.width,unit})}>交换宽高</Button><label className="check"><input type="checkbox" checked={scaleContent} onChange={e=>setScaleContent(e.target.checked)}/>缩放内容</label></div>
    <label className="check"><input type="checkbox" checked={board.clipContent!==false} onChange={e=>patch({clipContent:e.target.checked})}/>裁切画板外内容</label>
    <div className="board-background"><span>背景</span><ColorControl aria-label="画板背景" value={board.background==='transparent'?'#ffffff':board.background} onChange={e=>patch({background:e.target.value})}/><span>{board.background==='transparent'?'透明':board.background.replace('#','').toUpperCase()}</span><label className="check"><input aria-label="透明背景" type="checkbox" checked={board.background==='transparent'} onChange={e=>patch({background:e.target.checked?'transparent':'#ffffff'})}/>透明</label></div>
    <div className="board-actions board-management"><BoardSizeControl board={board} apply={applySize} disabled={disabled||board.locked}><Button className="board-size-trigger">尺寸预设</Button></BoardSizeControl><BoardSizeControl board={board} creating apply={createBoard} disabled={disabled||board.locked}><Button icon="add">新建画板</Button></BoardSizeControl><Button icon="copy" onClick={duplicate} disabled={disabled}>复制画板</Button><Button icon="table" onClick={openDataMerge} disabled={disabled}>批量套版</Button><Button icon="export" onClick={openBatchExport} disabled={disabled}>导出 / 审稿拼图</Button><Button icon="delete" onClick={remove} disabled={disabled||!canRemove}>删除画板</Button></div>
  </fieldset>;
}
export function CompositeWorkspace({document,change,selected,setSelected,initialPageView,onPageView,...props}) {
  const normalized=useMemo(()=>artboards.normalize(document),[document]);
  const list=useMemo(()=>artboards.boards(normalized),[normalized.layers]);
  const images=useMemo(()=>({imageCache:new ImageCache(160*1024*1024),previewCache:new ImageCache(32*1024*1024)}),[props.projectId]);
  useEffect(()=>()=>{images.imageCache.clear();images.previewCache.clear();},[images]);
  const [activeId,setActiveId]=useState(null),[dialog,setDialog]=useState(null),[error,setError]=useState('');
  const [maskId,setMaskId]=useState(null);
  const menu=useContextMenu(),[renameId,setRenameId]=useState(null),[editorRequest,setEditorRequest]=useState(null);
  const [exportRequest,setExportRequest]=useState(null),[mergeBoardId,setMergeBoardId]=useState(null),[notice,setNotice]=useState('');
  const [trace,setTrace]=useState(null);
  const [psdRequest,setPsdRequest]=useState(null);
  const [materialSaving,setMaterialSaving]=useState(''),materialControl=useRef(null);
  useEffect(()=>()=>materialControl.current?.abort(),[]);
  const [scaleContent,setScaleContent]=useState(false);
  const [propertiesOpen,setPropertiesOpen]=useState(true);
  const view=useRef(initialPageView||null), latest=useRef(null);
  const previewCanvas=useRef(null),hasBoards=list.length>0;
  const pendingPick=useRef(null);
  const selectionOptions=useState({});
  useLayoutEffect(()=>{if(!hasBoards)previewCanvas.current=null;},[hasBoards]);
  useUiView('boards',{get:()=>({activeId,maskId,scaleContent,view:view.current}),restore:v=>{view.current=v.view;setActiveId(v.activeId);setMaskId(v.maskId);setScaleContent(v.scaleContent);},blocked:()=>materialControl.current?'正在保存图层或画板，请稍后切换':null});
  const selectedOwner=selected.length ? artboards.owner(normalized,selected[0]) : null;
  const board=selectedOwner || list.find(b=>b.id===activeId) || list[0];
  const local=useMemo(()=>board?artboards.extract(normalized,board.id):null,[normalized,board?.id]);
  const preview=useMemo(()=>local?artboards.display(normalized,board.id,local):null,[normalized,board?.id,local]);
  latest.current={normalized,board,source:document,disabled:props.disabled,projectId:props.projectId};
  const run=fn=>{try{setError('');return fn()}catch(e){setError(e.message);return false}};
  const activate=(id,ids=[])=>{setActiveId(id);setSelected(ids)};
  const save=(next,options)=>{artboards.validate(next);return change(next,options)};
  const saveMaterial=async(id,time)=>{
    if(materialControl.current||latest.current.disabled)return;
    const reason=views.get('layers')?.blocked();
    if(reason){setError(reason);return;}
    const controller=new AbortController();materialControl.current=controller;setMaterialSaving('正在保存到素材…');setError('');setNotice('');
    try{
      const asset=await saveCompositionMaterial(id,{time,signal:controller.signal,
        read:()=>({document:latest.current.normalized,projectId:latest.current.projectId,disabled:latest.current.disabled||Boolean(views.get('layers')?.blocked())}),commit:save});
      setNotice(`“${asset.name}”已保存到素材库`);
    }catch(e){if(!controller.signal.aborted)setError(e.message);}
    finally{materialControl.current=null;if(!controller.signal.aborted)setMaterialSaving('');}
  };
  const edit=(next,options)=>run(()=>{if(latest.current.board.locked)throw Error('请先解锁画板');return save(artboards.replace(latest.current.normalized,latest.current.board.id,next),options)});
  const patch=values=>run(()=>{if(board.locked)throw Error('请先解锁画板');return save(artboards.update(normalized,board.id,values))});
  const resize=values=>run(()=>{if(board.locked)throw Error('请先解锁画板');return save(artboards.update(normalized,board.id,sizePatch(board,values),{scaleContent}))});
  const applySize=(width,height,scaleContent,printSize)=>run(()=>{if(board.locked)throw Error('请先解锁画板');return save(artboards.update(normalized,board.id,{width,height,printSize},{scaleContent}))});
  const createBoard=(width,height,_scale,printSize)=>run(()=>{const result=artboards.create(normalized,{width,height,printSize});if(save(result.document)===false)return false;view.current=null;activate(result.id)});
  const choose=(id,extend)=>{
    setMaskId(null);
    const b=artboards.owner(normalized,id);if(!b)return;
    if(b.id===id){activate(id);return}
    activate(b.id,extend&&b.id===board.id ? selected.includes(id)?selected.filter(n=>n!==id):[...selected,id] : [id]);
  };
  const relocate=(ids,targetId,placement,options)=>run(()=>{
    targetId=targetId || board.id;
    const next=artboards.relocate(normalized,ids,targetId,placement);
    if(save(next,options)!==false)activate(artboards.owner(next,ids[0]).id,ids);
  });
  const emptyImport=useImageImport(assets=>run(()=>{
    const result=artboards.create(normalized,{width:assets[0].width,height:assets[0].height});
    const next={...result.document,assets:[...result.document.assets,...assets],layers:[...result.document.layers,...assets.map(a=>createLayer('image',{parentId:result.id,name:a.name,assetId:a.id,width:a.width,height:a.height,x:0,y:0}))]};
    if(save(next)!==false)activate(result.id);
  }),setError,props.disabled);
  const exportPath=async id=>{
    const layer=normalized.layers.find(l=>l.id===id);
    let choice;
    try{
      choice=await window.tugou.chooseExport(layer.name,'svg');if(!choice)return;
      const ids=descendants(normalized.layers,[id]),root={...layer,...decompose(worldMatrix(normalized.layers,layer)),parentId:undefined};
      await window.tugou.exportPathSvg(choice.token,normalized.layers.filter(l=>ids.has(l.id)).map(l=>l.id===id?root:l),id);
      setNotice('已保存 SVG');
    }catch(e){setError(e.message);}finally{if(choice)await window.tugou.cancelExport(choice.token);}
  };
  const openPsd=exporting=>setPsdRequest({source:document,document:exporting?local:null});
  const exportLayer=async(id,time)=>{
    const controller=new AbortController();materialControl.current=controller;setMaterialSaving('正在保存图片…');setError('');setNotice('');
    const engine=new Compositor();let token;
    try{
      const plan=materialPlan(normalized,id),choice=await window.tugou.chooseExport(plan.name,'png');if(!choice)return;
      token=choice.token;const bytes=await engine.export(plan.document,{time,signal:controller.signal});
      controller.signal.throwIfAborted();await window.tugou.writeExport(token,bytes);
      setNotice(`已保存 ${plan.name}`);
    }catch(error){if(!controller.signal.aborted)setError(error.message);}
    finally{engine.dispose();if(token)await window.tugou.cancelExport(token).catch(()=>{});materialControl.current=null;if(!controller.signal.aborted)setMaterialSaving('');}
  };
  const psdDialog=psdRequest&&<PsdDialog document={psdRequest.document} close={()=>setPsdRequest(null)} complete={setNotice} apply={data=>{
    if(latest.current.disabled||latest.current.source!==psdRequest.source)throw Error('当前工程已变化，请关闭窗口后重新导入，避免覆盖编辑');
    const result=artboards.create(latest.current.normalized,{width:data.width,height:data.height,name:data.name});
    const next=artboards.replace(result.document,result.id,{...data,background:'transparent',assets:[...result.document.assets,...data.assets]});
    if(save(next)===false)throw Error('当前无法修改工程，请稍后重试');
    view.current=null;activate(result.id);setNotice(`已导入 ${data.name}，可撤销恢复`);
  }}/>;
  if(!board)return <div className="composite-workspace composite-empty" data-dev-update-blocked={psdRequest?'请先完成 PSD 导入':undefined} onDragOver={emptyImport.over} onDrop={emptyImport.drop} onContextMenu={e=>{if(!props.disabled&&!emptyImport.importing&&!psdRequest)menu.open(e,{id:null});}}>
    <div className="composition-tools"><BoardSizeControl board={normalized} creating apply={createBoard} disabled={props.disabled||emptyImport.importing||!!psdRequest}><Button icon="add" disabled={props.disabled||emptyImport.importing||!!psdRequest}>新建画板</Button></BoardSizeControl></div>
    <EmptyState className="layer-start" icon="layers" title="开始创作">
      <div className="layer-start-actions">
        <Button className="layer-start-action layer-start-primary" aria-label="导入图片 / GIF" icon={emptyImport.importing?'loading':'assets'} disabled={props.disabled||emptyImport.importing||!!psdRequest} onClick={emptyImport.open}>{emptyImport.importing?'正在导入…':'导入图片 / GIF'}</Button>
        <Button className="layer-start-action" aria-label="导入 PSD" icon="layers" disabled={props.disabled||emptyImport.importing||!!psdRequest} onClick={()=>openPsd(false)}>导入 PSD</Button>
        <BoardSizeControl board={normalized} creating apply={createBoard} disabled={props.disabled||emptyImport.importing||!!psdRequest}><Button className="layer-start-action" aria-label="新建空白画板" icon="add" disabled={props.disabled||emptyImport.importing||!!psdRequest}>新建画板</Button></BoardSizeControl>
      </div>
      <p className="layer-start-hint" role="status">{emptyImport.importing?'正在读取图片…':'支持拖入图片 / GIF'}</p>
    </EmptyState>
    {error&&<div className="message error" role="alert">{error}</div>}
    <ContextMenu context={menu.context} close={menu.close} className="board-context-menu" items={props.disabled||emptyImport.importing||psdRequest?[]:[
      item('new','新建空白画板',()=>createBoard(normalized.width,normalized.height,false)),
      item('image','导入图片 / GIF…',emptyImport.open),item('psd','导入 PSD…',()=>openPsd(false)),
    ]}/>
    {psdDialog}
  </div>;
  const workspace={
    propertiesOpen,setPropertiesOpen,pendingPick,selectionOptions,
    importPsd:()=>openPsd(false),exportPsd:()=>openPsd(true),
    export:frame=>{setNotice('');setExportRequest({document:normalized,id:board.id,single:true,frame});},
    contextMenu:(event,id,time=0,importImage)=>{if(!props.disabled&&!materialControl.current)menu.open(event,{id,time,importImage,ids:selected.includes(id)?[...selected]:[id]});},
    editorRequest,clearEditorRequest:()=>setEditorRequest(null),
    board,boards:list.map(b=>({...b,x:b.x-board.x,y:b.y-board.y})),layers:normalized.layers,images,preview,previewCanvas,
    initialView:view.current ? {...view.current,x:view.current.x+board.x*view.current.zoom,y:view.current.y+board.y*view.current.zoom}:null,
    onView:v=>{view.current={...v,x:v.x-board.x*v.zoom,y:v.y-board.y*v.zoom};onPageView?.(view.current)},
    compose:(edited,drag)=>edited===local&&!drag?preview:artboards.display(normalized,board.id,edited,drag),
    addShape:(layer,id)=>run(()=>{if(list.find(b=>b.id===id)?.locked)throw Error('请先解锁画板');const result=save({...normalized,layers:[...normalized.layers,{...layer,parentId:id}]});if(result!==false)activate(id,[layer.id]);return result}),
    activate,choose,relocate,maskId,selectMask:id=>{const b=artboards.owner(normalized,id);if(b){setMaskId(id);activate(b.id,[id])}},
    move:(id,dx,dy)=>run(()=>{const b=list.find(b=>b.id===id);return save(artboards.update(normalized,id,{x:b.x+dx,y:b.y+dy}),{deferSave:true})}),
    patchLayer:(id,values)=>run(()=>save({...normalized,layers:normalized.layers.map(l=>l.id===id?{...l,...values}:l)})),
    inspector:<BoardInspector key={`${board.id}-${board.name}`} board={board} patch={patch} resize={resize} scaleContent={scaleContent} setScaleContent={setScaleContent} createBoard={createBoard} applySize={applySize} disabled={props.disabled} canRemove={list.length>1}
      openDataMerge={()=>setMergeBoardId(board.id)}
      openBatchExport={()=>setExportRequest({document:normalized,id:board.id,single:false})}
      duplicate={()=>run(()=>{const result=artboards.duplicate(normalized,board.id);if(save(result.document)!==false){view.current=null;activate(result.id)}})}
      remove={()=>setDialog(board.id)}/>,
  };
  const target=menu.context?.id?normalized.layers.find(l=>l.id===menu.context.id):null;
  const renameTarget=renameId?normalized.layers.find(l=>l.id===renameId):null,deleteBoard=dialog?list.find(b=>b.id===dialog):null;
  const contextItems=()=>{
    if(!menu.context||props.disabled||materialControl.current)return [];
    if(menu.context.id===null)return [item('new','新建同尺寸画板',()=>createBoard(board.width,board.height,false,board.printSize)),
      item('image','导入图片 / GIF…',menu.context.importImage,{disabled:board.locked}),item('psd','导入 PSD…',()=>openPsd(false))];
    if(!target)return [];
    const {id,time}=menu.context;
    if(target.artboard)return [
      item('save','保存图片',()=>setExportRequest({document:normalized,id,single:true}),{icon:<Icon name="export"/>}),
      item('material','保存到素材',()=>void saveMaterial(id,time),{icon:<Icon name="assets"/>}),
      item('batch','批量保存 / 审稿拼图…',()=>setExportRequest({document:normalized,id,single:false})),
      item('merge','批量套版生成…',()=>setMergeBoardId(id),{icon:<Icon name="table"/>}),divider,
      item('edit','编辑画板',()=>{activate(id);setPropertiesOpen(true);}),
      item('rename','重命名画板…',()=>setRenameId(id),{disabled:target.locked}),
      item('lock',target.locked?'解锁画板':'锁定画板',()=>workspace.patchLayer(id,{locked:!target.locked})),
      item('copy','复制画板',()=>run(()=>{const result=artboards.duplicate(normalized,id);if(save(result.document)!==false)activate(result.id);}),{disabled:target.locked}),
      item('delete','删除画板',()=>setDialog(id),{danger:true,disabled:list.length<2||target.locked}),
    ];
    const owner=artboards.owner(normalized,id);
    const ids=menu.context.ids.filter(id=>artboards.owner(normalized,id)?.id===owner.id);
    const chosen=new Set(ids);
    return layerMenu({layers:normalized.layers,target,ids,board:owner,
      modify:values=>run(()=>save({...normalized,layers:normalized.layers.map(l=>chosen.has(l.id)?{...l,...values}:l)})),
      transform:fn=>run(()=>{
        const source=artboards.extract(normalized,owner.id),result=fn(source.layers),layers=result.layers||result;
        if(layers.length===source.layers.length&&layers.every((l,i)=>l===source.layers[i]))return;
        const next=artboards.replace(normalized,owner.id,{...source,layers});
        if(save(next)===false)return;
        if(result.ids)activate(owner.id,result.ids);
        else if(layers.length<source.layers.length){const remaining=new Set(next.layers.map(l=>l.id));setSelected(selected.filter(id=>remaining.has(id)));}
      }),
      editor:(action,ids=[id])=>{setEditorRequest({id,action});activate(owner.id,ids);},
      rename:()=>setRenameId(id),trace:()=>setTrace({source:normalized,id}),svg:()=>void exportPath(id),
      material:()=>void saveMaterial(id,time),exportImage:()=>void exportLayer(id,time),
    });
  };
  return <div className="composite-workspace" data-dev-update-blocked={exportRequest||psdRequest||materialSaving||trace?'请先完成画板文件处理':undefined}>
    {error&&<div className="message error" role="alert">{error}<Button iconOnly icon="close" onClick={()=>setError('')}>关闭错误</Button></div>}
    {notice&&<div className="message" role="status">{notice}<Button iconOnly icon="close" onClick={()=>setNotice('')}>关闭保存提示</Button></div>}
    {materialSaving&&<div className="message" role="status">{materialSaving}</div>}
    <LayerEditor key={`${props.projectId}:${board.id}`} {...props} disabled={props.disabled||!!exportRequest||!!psdRequest||!!trace||!!materialSaving} document={local} change={edit} selected={selected.filter(id=>local.layers.some(l=>l.id===id))} setSelected={setSelected} workspace={workspace}/>
    {psdDialog}
    {trace&&<VectorTraceDialog source={trace.source} id={trace.id} close={()=>setTrace(null)} apply={paths=>{setTrace(null);run(()=>{if(latest.current.normalized!==trace.source||latest.current.disabled)throw Error('工程已变化，请重新描摹');const result=addTracedLayer(trace.source,trace.id,paths);if(save(result.document)!==false)activate(artboards.owner(result.document,result.id).id,[result.id]);});}}/>}
    <ContextMenu context={menu.context} close={menu.close} items={contextItems()} className="board-context-menu"/>
    {renameTarget&&<FormDialog title={renameTarget.artboard?'重命名画板':'重命名图层'} close={()=>setRenameId(null)} width={420}>
      <form onSubmit={e=>{e.preventDefault();const name=String(new FormData(e.currentTarget).get('name')).trim();if(!name||props.disabled||inherited(normalized.layers,renameTarget,'locked'))return;if(workspace.patchLayer(renameId,{name})!==false)setRenameId(null);}}>
        <label>名称 <Input autoFocus required maxLength={120} name="name" aria-label="图层或画板名称" defaultValue={renameTarget.name}/></label>
        <div className="dialog-footer"><Button onClick={()=>setRenameId(null)}>取消</Button><Button primary type="submit" disabled={props.disabled}>保存名称</Button></div>
      </form>
    </FormDialog>}
    {exportRequest&&<BoardExport document={exportRequest.document} initialId={exportRequest.id} single={exportRequest.single} initialFrame={exportRequest.frame} close={()=>setExportRequest(null)} complete={setNotice}/>}
    {mergeBoardId&&<DataMergeDialog document={normalized} boardId={mergeBoardId} change={save} close={()=>setMergeBoardId(null)} complete={setNotice}/>}
    {deleteBoard&&<Modal open getContainer={()=>window.document.getElementById('dialogs')} transitionName="" maskTransitionName="" title={`删除“${deleteBoard.name}”？`} onCancel={()=>setDialog(null)} onOk={()=>run(()=>{if(props.disabled||save(artboards.remove(normalized,deleteBoard.id))===false)return;if(board.id===deleteBoard.id)activate(list.find(b=>b.id!==deleteBoard.id).id);setDialog(null)})} okText="删除画板" cancelText="取消" okButtonProps={{danger:true,disabled:props.disabled}}><p>画板内的图层会一起删除。可通过撤销恢复。</p></Modal>}
  </div>;
}
