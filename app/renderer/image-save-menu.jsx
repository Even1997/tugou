import React from 'react';
import {Dropdown} from 'antd';
import {Icon} from './components.jsx';

export function ImageSaveMenu({asset,save,remove,disabled,children}){
  if(!asset)return children;
  const items=[];
  if(!asset.kind||asset.kind==='image')items.push({key:'save',label:'保存图片…',icon:<Icon name="export"/>});
  if(remove)items.push({key:'delete',label:'删除',icon:<Icon name="delete"/>,danger:true,disabled});
  if(!items.length)return children;
  return <Dropdown destroyOnHidden autoFocus trigger={['contextMenu']} classNames={{root:'image-save-menu'}} menu={{items,onClick:({key,domEvent})=>{domEvent.stopPropagation();if(key==='delete')remove(asset.id);else save(asset.id);}}}>{children}</Dropdown>;
}
