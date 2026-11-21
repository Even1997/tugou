import React from 'react';
import {AlignStartVertical,AlignCenterVertical,AlignEndVertical,AlignStartHorizontal,AlignCenterHorizontal,AlignEndHorizontal,AlignHorizontalSpaceBetween,AlignVerticalSpaceBetween} from 'lucide-react';
import {Select} from './select.jsx';
import './layer-alignment.css';

export const alignmentCommands=[
  ['x','start','左对齐',AlignStartVertical],['x','center','水平居中',AlignCenterVertical],['x','end','右对齐',AlignEndVertical],
  ['y','start','顶对齐',AlignStartHorizontal],['y','center','垂直居中',AlignCenterHorizontal],['y','end','底对齐',AlignEndHorizontal],
  ['x','space','水平等距',AlignHorizontalSpaceBetween],['y','space','垂直等距',AlignVerticalSpaceBetween],
];

export function LayerAlignment({box,view,size,boards,imageTools,target,choose,hasSelection,count,disabled,apply}){
  const inset=boards?26:5, width=Math.min(336,size.width-inset-5);
  if(width<=0||!size.height)return null;
  const compact=width<316,height=compact?66:34;
  const x=view.x+(box.x+box.width/2)*view.zoom;
  const above=view.y+box.y*view.zoom-34-height, below=view.y+(box.y+box.height)*view.zoom+36;
  const bottom=Math.max(inset,size.height-height-(imageTools?84:28));
  const left=Math.max(inset,Math.min(size.width-width-5,x-width/2));
  const labels=(boards||[]).filter(b=>{
    const start=view.x+b.x*view.zoom;
    return start<left+width&&start+Math.max(160,b.name.length*14)>left;
  }).map(b=>view.y+b.y*view.zoom);
  const candidates=[above,below,inset,bottom,...labels.map(y=>y+2)];
  const top=candidates.find(y=>y>=inset&&y<=bottom&&labels.every(edge=>y+height<=edge-32||y>=edge))??inset;
  const stop=e=>e.stopPropagation();
  return <div role="toolbar" aria-label="选中对象排版" className="layer-alignment" data-compact={compact||undefined}
    style={{left,top,width}} onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onDoubleClick={stop} onContextMenu={stop}>
    <Select aria-label="对齐到" value={target} onChange={e=>choose(e.target.value)}>
      <option value="objects" disabled={count<2}>所选对象</option>
      <option value="selection" disabled={!hasSelection}>选区</option>
      <option value="board">当前画布</option>
    </Select>
    <div className="layer-alignment-actions">{alignmentCommands.map(([axis,mode,label,Glyph])=>
      <button key={label} type="button" aria-label={label} title={label} disabled={disabled||(mode==='space'&&count<3)}
        onClick={()=>apply(axis,mode)}><Glyph size={17} strokeWidth={1.7} aria-hidden="true"/></button>
    )}</div>
  </div>;
}
