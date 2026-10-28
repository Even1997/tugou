import React, {Children, isValidElement, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Select as AntSelect, AutoComplete, Input} from 'antd';
import {DownOutlined} from '@ant-design/icons';
import './controls.css';

const textOf=value=>Children.toArray(value).map(child=>isValidElement(child)?textOf(child.props.children):String(child)).join('');
function optionsOf(children) {
  return Children.toArray(children).flatMap(child=>{
    if(!isValidElement(child))return [];
    if(child.type===React.Fragment)return optionsOf(child.props.children);
    const label=textOf(child.props.children);
    return [{value:String(child.props.value??label),label,title:label,disabled:child.props.disabled}];
  });
}

// Keep native-select string values and event callbacks at existing call sites.
export function Select({children,value,onChange,disabled,className='',showSearch,notFoundContent='没有匹配的选项',...props}) {
  const host=useRef(null),[inheritedDisabled,setInheritedDisabled]=useState(false);
  const options=useMemo(()=>optionsOf(children),[children]);
  useLayoutEffect(()=>{setInheritedDisabled(!!host.current?.closest('fieldset:disabled'))});
  return <span ref={host} className={`studio-select ${className}`} data-value={String(value??'')} data-option-count={options.length} onKeyDown={event=>event.stopPropagation()}>
    <AntSelect {...props} value={String(value??'')} options={options} disabled={disabled||inheritedDisabled}
      showSearch={showSearch??(options.length>=8?{optionFilterProp:'label'}:false)}
      classNames={{popup:{root:'studio-select-popup'}}}
      notFoundContent={notFoundContent} virtual={options.length>50}
      optionRender={option=><span data-option-value={option.value}>{option.label}</span>}
      onChange={next=>onChange?.({target:{value:next},currentTarget:{value:next}})}/>
  </span>;
}

// A single editable value: typing also works when the provider has no model list.
export function EditableSelect({value='',options=[],onChange,disabled,id,'aria-label':label}) {
  const [open,setOpen]=useState(false),[query,setQuery]=useState('');
  const choices=useMemo(()=>{
    const found=options.filter(item=>item.toLowerCase().includes(query.toLowerCase())).map(item=>({value:item,label:item}));
    if(query.trim()&&!options.includes(query.trim()))found.unshift({value:query.trim(),label:`使用「${query.trim()}」`});
    return found;
  },[options,query]);
  return <AutoComplete className="studio-editable-select" value={value} options={choices} open={open} disabled={disabled}
    onOpenChange={setOpen} onFocus={()=>{setQuery('');setOpen(true);}} onBlur={()=>setOpen(false)}
    onChange={onChange} showSearch={{onSearch:setQuery}} onSelect={()=>setOpen(false)} virtual={options.length>50}
    classNames={{popup:{root:'studio-select-popup'}}}
    onKeyDown={e=>{if(e.key==='Enter')e.preventDefault();if(e.key==='Escape'&&open){e.stopPropagation();setOpen(false);}}}>
    <Input id={id} aria-label={label} autoComplete="off" placeholder="选择或直接输入模型 ID"
      suffix={<DownOutlined onMouseDown={e=>e.preventDefault()} onClick={()=>{setQuery('');setOpen(!open);}}/>}/>
  </AutoComplete>;
}
