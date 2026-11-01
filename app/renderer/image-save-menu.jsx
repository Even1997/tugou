import React from 'react';
import {Dropdown} from 'antd';
import {Icon} from './components.jsx';

export function ImageSaveMenu({asset,save,children}){
  if(!asset||(asset.kind&&asset.kind!=='image'))return children;
  return <Dropdown destroyOnHidden autoFocus trigger={['contextMenu']} classNames={{root:'image-save-menu'}} menu={{items:[{key:'save',label:'保存图片…',icon:<Icon name="export"/>}],onClick:({domEvent})=>{domEvent.stopPropagation();save(asset.id);}}}>{children}</Dropdown>;
}
