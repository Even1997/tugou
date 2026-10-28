import React from 'react';
import {rulerTicks,selectionMetrics} from '../core/workspace-geometry.cjs';
import './canvas-chrome.css';

export const CanvasRulers=React.memo(function CanvasRulers({view,size}) {
  return <div className="canvas-rulers" aria-label="画板标尺（像素）" onPointerDown={e=>e.stopPropagation()}>
    <svg className="ruler-horizontal" width={size.width} height="22" aria-hidden="true"><rect width="100%" height="22"/>{rulerTicks(size.width,view.x,view.zoom).map(t=><g key={t.value}><path d={`M ${t.position} ${t.major?12:17} V 22`}/>{t.major&&<text x={t.position+4} y="9">{t.value}</text>}</g>)}</svg>
    <svg className="ruler-vertical" width="22" height={size.height} aria-hidden="true"><rect width="22" height="100%"/>{rulerTicks(size.height,view.y,view.zoom).map(t=><g key={t.value}><path d={`M ${t.major?12:17} ${t.position} H 22`}/>{t.major&&<text transform={`translate(9 ${t.position-4}) rotate(-90)`}>{t.value}</text>}</g>)}</svg>
    <span className="ruler-origin" title="以当前画板左上角为原点">px</span>
  </div>;
});
export function SelectionSizeBadge({points,view,size}) {
  const bounds=selectionMetrics(points);
  if(!bounds)return null;
  const left=bounds.left*view.zoom+view.x,right=bounds.right*view.zoom+view.x,top=bounds.top*view.zoom+view.y,bottom=bounds.bottom*view.zoom+view.y;
  if(right<22||left>size.width||bottom<22||top>size.height)return null;
  return <div className="selection-size-badge" role="status" aria-label="选中对象尺寸" style={{left:Math.max(90,Math.min(size.width-90,(left+right)/2)),top:Math.max(26,Math.min(size.height-32,bottom+10))}}>{Math.round(bounds.width)} × {Math.round(bounds.height)} <span>px</span></div>;
}
export function CanvasSelection({points,zoom,editable,warp}) {
  return <g>
    <polygon points={points.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--accent)" strokeWidth={1.5/zoom}/>
    {editable&&(warp?points.map((p,i)=><circle key={i} data-handle={`warp-${i}`} cx={p.x} cy={p.y} r={5/zoom} fill="var(--accent)"/>):<>
      <circle data-handle="resize" cx={points[2].x} cy={points[2].y} r={5/zoom} fill="var(--accent)"/>
      <circle data-handle="rotate" cx={(points[0].x+points[1].x)/2} cy={(points[0].y+points[1].y)/2-24/zoom} r={5/zoom} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1.5/zoom}/>
    </>)}
  </g>;
}
