import React, {useEffect, useState} from 'react';
import {Popover} from 'antd';
import {compileRecipe} from '../core/prompts.cjs';
import './prompt-hover-preview.css';

export function PromptHoverPreview({document, item, type, children, disabled = false}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    if (!open) return;
    const close = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [open]);
  if (!['module', 'recipe'].includes(type)) return children;
  const result = open ? (type === 'recipe' ? compileRecipe(document, item) : {prompt:item.text || '', references:[]}) : null;
  return <Popover open={open && !disabled} onOpenChange={value => setOpen(value && !disabled)} trigger={['hover', 'focus']} mouseEnterDelay={0.35} mouseLeaveDelay={0.15}
    placement="right" destroyOnHidden classNames={{root:'prompt-hover-popover'}}
    content={<section className="prompt-hover-preview" aria-label={`${type === 'recipe' ? '配方' : '模块'}内容预览`}>
      <header><strong>{item.name}</strong><small>{type === 'recipe' ? '配方' : '模块'} · {result?.prompt.length || 0} 字{result?.references.length ? ` · ${result.references.length} 张参考图` : ''}</small></header>
      <div className="prompt-hover-text" tabIndex={0}>{result?.prompt || '暂无内容'}</div>
    </section>}>
    {React.cloneElement(children, {
      onClick:event => { setOpen(false); children.props.onClick?.(event); },
      onDragStart:event => { setOpen(false); children.props.onDragStart?.(event); },
    })}
  </Popover>;
}
