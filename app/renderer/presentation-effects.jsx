import React,{useId} from 'react';
import {rectanglePath} from '../core/presentations.cjs';

export function PresentationEffects({element:e,children}){
  const id=useId().replace(/[^a-z0-9_-]/gi,''),active=(e.effects||[]).filter(f=>f.enabled&&f.opacity>0);
  const shadows=active.filter(f=>f.type!=='stroke'),border=active.find(f=>f.type==='stroke');
  const padding=Math.max(0,...shadows.map(f=>f.radius*4+f.distance))+(border?.size||0)+2;
  return <>
    {!!shadows.length&&<svg width="0" height="0" aria-hidden="true" className="ppt-effect-defs"><defs><filter id={id} filterUnits="userSpaceOnUse" x={-padding} y={-padding} width={e.w+padding*2} height={e.h+padding*2} colorInterpolationFilters="sRGB">
      {shadows.map(f=><React.Fragment key={f.type}>
        <feGaussianBlur in="SourceAlpha" stdDeviation={f.radius} result={`${f.type}-blur`}/>
        <feOffset in={`${f.type}-blur`} dx={Math.cos(f.angle*Math.PI/180)*f.distance} dy={Math.sin(f.angle*Math.PI/180)*f.distance} result={`${f.type}-offset`}/>
        <feFlood floodColor={f.color} floodOpacity={f.opacity/100} result={`${f.type}-color`}/>
        <feComposite in={`${f.type}-color`} in2={`${f.type}-offset`} operator={f.type==='innerShadow'?'out':'in'} result={`${f.type}-paint`}/>
        {f.type==='innerShadow'&&<feComposite in="innerShadow-paint" in2="SourceGraphic" operator="atop" result="inner-content"/>}
      </React.Fragment>)}
      <feMerge>{shadows.some(f=>f.type==='shadow')&&<feMergeNode in="shadow-paint"/>}<feMergeNode in={shadows.some(f=>f.type==='innerShadow')?'inner-content':'SourceGraphic'}/></feMerge>
    </filter></defs></svg>}
    <div className="ppt-element-content" style={{filter:shadows.length?`url(#${id})`:undefined}}>{children}
      {border&&border.size>0&&<svg className="ppt-element-border" width={e.w} height={e.h} aria-hidden="true">{e.kind==='ellipse'?<ellipse cx={e.w/2} cy={e.h/2} rx={e.w/2} ry={e.h/2} fill="none" stroke={border.color} strokeWidth={border.size} opacity={border.opacity/100}/>:e.kind==='rect'?<path d={rectanglePath(e)} fill="none" stroke={border.color} strokeWidth={border.size} opacity={border.opacity/100}/>:<rect width={e.w} height={e.h} fill="none" stroke={border.color} strokeWidth={border.size} opacity={border.opacity/100}/>}</svg>}
    </div>
  </>;
}
