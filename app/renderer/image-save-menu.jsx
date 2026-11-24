import React from 'react';
import {Dropdown} from 'antd';
import {Icon} from './components.jsx';

export function ImageSaveMenu({asset,save,remove,disabled,actions=[],children}){
  if(!asset)return children;
  const items=[];
  if(save)items.push({key:'save',label:!asset.kind||asset.kind==='image'?'保存图片…':'导出原文件…',icon:<Icon name="export"/>,onClick:()=>save(asset.id)});
  items.push(...actions);
  if(remove&&actions.length)items.push({type:'divider'});
  if(remove)items.push({key:'delete',label:'删除',icon:<Icon name="delete"/>,danger:true,disabled,onClick:()=>remove(asset.id)});
  if(!items.length)return children;
  return <Dropdown destroyOnHidden autoFocus trigger={['contextMenu']} classNames={{root:'image-save-menu'}} menu={{items,onClick:({domEvent})=>domEvent.stopPropagation()}}>{children}</Dropdown>;
}
