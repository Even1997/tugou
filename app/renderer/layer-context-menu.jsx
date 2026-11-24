import {inherited,descendants,roots,deleteLayers,duplicateLayers,groupLayers,ungroupLayers,reorder} from '../core/layers.cjs';
import {menuAction as item,menuDivider as divider} from './context-menu.jsx';

export function layerMenu({layers,target,ids,board,modify,transform,editor,rename,trace,svg,material,exportImage}){
  const byId=new Map(layers.map(l=>[l.id,l])),members=ids.map(id=>byId.get(id)).filter(Boolean);
  const parentLocked=members.some(l=>inherited(byId,byId.get(l.parentId),'locked'));
  const locked=parentLocked||members.some(l=>l.locked),multiple=members.length>1;
  const show=members.some(l=>l.visible===false),unlock=members.every(l=>l.locked);
  const chosen=roots(layers,ids),sameParent=chosen.every(l=>l.parentId===chosen[0]?.parentId);
  const branch=descendants(layers,ids),protectedBranch=layers.some(l=>branch.has(l.id)&&l.locked);
  const purePath=layers.some(l=>branch.has(l.id)&&l.shape==='path')&&layers.every(l=>!branch.has(l.id)||l.kind==='group'||l.shape==='path');
  const {mask}=target;
  return [
    ...(!multiple?[item('inspect','显示图层属性',()=>editor('inspect')),item('rename','重命名图层…',rename,{disabled:locked})]:[]),
    item('copy',multiple?'复制所选图层':'复制图层',()=>transform(ls=>duplicateLayers(ls,ids)),{disabled:locked}),
    item('visible',show?'显示图层':'隐藏图层',()=>modify({visible:show}),{disabled:parentLocked}),
    item('lock',unlock?'解锁图层':'锁定图层',()=>modify({locked:!unlock}),{disabled:parentLocked}),
    divider,
    {key:'stack',label:'叠放顺序',disabled:locked,children:[['up','上移一层'],['down','下移一层'],['top','置顶'],['bottom','置底']].map(([key,label])=>item(key,label,()=>transform(ls=>reorder(ls,ids,key))))},
    ...(multiple?[
      item('group','编组所选图层',()=>transform(ls=>groupLayers(ls,ids)),{disabled:locked||chosen.length<2||!sameParent}),
      item('merge','合并所选图层',()=>editor('merge',ids),{disabled:locked||protectedBranch||chosen.length<2||!sameParent||chosen[0]?.parentId!==board.id}),
    ]:target.kind==='group'?[item('ungroup','取消编组',()=>transform(ls=>ungroupLayers(ls,target.id)),{disabled:locked||protectedBranch})]:[]),
    ...(!multiple?[
      {key:'mask',label:'蒙版',children:mask?[
        item('edit-mask','编辑蒙版',()=>editor('mask'),{disabled:locked}),
        item('load-mask','从蒙版载入选区',()=>editor('load-mask'),{disabled:board.locked}),
        item('toggle-mask',mask.disabled?'启用蒙版':'停用蒙版',()=>modify({mask:{...mask,disabled:!mask.disabled}}),{disabled:locked}),
        item('remove-mask','删除蒙版',()=>modify({mask:undefined}),{disabled:locked,danger:true}),
      ]:[item('add-mask','添加蒙版',()=>modify({mask:{x:0,y:0,width:1,height:1}}),{disabled:locked})]},
      ...(target.kind==='image'?[item('replace','替换图片…',()=>editor('replace'),{disabled:locked}),
        item('liquify','液化',()=>editor('liquify'),{disabled:locked||inherited(byId,target,'hidden')}),
        item('trace','图片矢量化…',trace,{disabled:locked})]:[]),
      ...(target.shape==='path'?[item('anchors','编辑锚点',()=>editor('anchors'),{disabled:locked||!!target.warp})]:[]),
      ...(purePath?[item('svg','导出 SVG',svg)]:[]),
      ...(target.kind==='adjustment'?[]:[item('save','保存图片…',exportImage),item('material','保存到素材',material)]),
    ]:[]),
    divider,
    item('delete',multiple?'删除所选图层':target.kind==='group'?'删除分组及图层':'删除图层',()=>transform(ls=>deleteLayers(ls,ids)),{danger:true,disabled:locked||protectedBranch}),
  ];
}
