import {ColorControl} from './color-control.jsx';
import {Select} from './select.jsx';
import React from 'react';
import {Button,Icon} from './components.jsx';
import {NumberField} from './number-field.jsx';
import {shapes,shapePoints} from '../core/shapes.cjs';

export const shapeDefaults={shape:'rect',color:'#b0bff2',fill:true,stroke:'#333333',strokeWidth:0,radius:0};
export function ShapePath({shape,width,height,radius=0,...props}) {
  const points=shapePoints(shape);
  if(shape==='line')return <line x1={0} y1={0} x2={width} y2={height} {...props}/>;
  if(points)return <polygon points={points.map(([x,y])=>`${x*width},${y*height}`).join(' ')} {...props}/>;
  if(shape==='ellipse')return <ellipse cx={width/2} cy={height/2} rx={width/2} ry={height/2} {...props}/>;
  return <rect width={width} height={height} rx={Math.min(radius,width/2,height/2)} {...props}/>;
}
export function ShapePicker({active,options,choose,disabled}) {
  return <details className="shape-picker">
    <summary aria-label="形状" aria-pressed={active}><span className="shape-trigger-icon"><svg viewBox="-2 -2 24 24" aria-hidden="true"><ShapePath shape={options.shape} width={20} height={20} radius={options.radius?4:0} fill="none" stroke="currentColor" strokeWidth={1.5}/></svg></span><span>形状</span><Icon name="collapse"/></summary>
    <div className="shape-picker-menu"><div className="shape-picker-title">绘制形状 <span>U</span></div><div className="shape-picker-grid">{shapes.map(([shape,label])=><Button key={shape} disabled={disabled} aria-pressed={options.shape===shape} onClick={e=>{choose({...options,shape,radius:shape==='rounded'?24:0});e.currentTarget.closest('details').open=false}}><span className="shape-option-icon"><svg viewBox="-2 -2 24 24" aria-hidden="true"><ShapePath shape={shape} width={20} height={20} radius={shape==='rounded'?4:0} fill="none" stroke="currentColor" strokeWidth={1.5}/></svg></span><span>{label}</span></Button>)}</div><small>拖拽绘制 · Shift 等比 · Esc 取消</small></div>
  </details>;
}
export function ShapeOptions({options,change,disabled}) {
  const patch=values=>change({...options,...values});
  return <fieldset className="shape-tool-options" disabled={disabled}>
    <Select aria-label="绘制形状类型" value={options.shape} onChange={e=>patch({shape:e.target.value,radius:e.target.value==='rounded'?24:0})}>{options.shape==='line'&&<option value="line">直线</option>}{shapes.map(([id,label])=><option key={id} value={id}>{label}</option>)}</Select>
    <label className="shape-swatch"><input aria-label="启用形状填充" type="checkbox" checked={options.fill} onChange={e=>patch({fill:e.target.checked})}/>填充<ColorControl aria-label="绘制填充颜色" disabled={!options.fill} value={options.color} onChange={e=>patch({color:e.target.value})}/></label>
    <label className="shape-swatch">描边<ColorControl aria-label="绘制描边颜色" value={options.stroke} onChange={e=>patch({stroke:e.target.value})}/></label>
    <NumberField label="绘制描边宽度" shortLabel="px" value={options.strokeWidth} min={0} max={500} onChange={strokeWidth=>patch({strokeWidth})}/>
    {['rect','rounded'].includes(options.shape)&&<NumberField label="绘制圆角" shortLabel="圆角" min={0} max={10000} value={options.radius} onChange={radius=>patch({radius})}/>}
    <span className="shape-hint">Shift 等比</span>
  </fieldset>;
}
