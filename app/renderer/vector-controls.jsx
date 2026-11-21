import React,{useImperativeHandle,useMemo,useState} from 'react';
import {Button} from './components.jsx';
import {Select} from './select.jsx';
import {NumberField} from './number-field.jsx';
import {pathData} from '../core/vector-path.cjs';
import {point} from '../core/layers.cjs';

export function PenPreview({nodes,zoom}){
  if(!nodes.length)return null;
  const last=nodes.at(-1);
  return <g pointerEvents="none">{last.in&&last.out&&<g stroke="var(--accent)" strokeWidth={1/zoom}><line x1={last.in[0]} y1={last.in[1]} x2={last.out[0]} y2={last.out[1]}/>{[last.in,last.out].map(([x,y],i)=><circle key={i} cx={x} cy={y} r={3/zoom} fill="var(--panel)"/>)}</g>}<path d={pathData([{nodes,closed:false}],1,1)} fill="none" stroke="var(--accent)" strokeWidth={1.5/zoom}/>{nodes.map((n,i)=><circle key={i} cx={n.x} cy={n.y} r={4/zoom} fill="var(--panel)" stroke="var(--accent)" strokeWidth={1/zoom}/>)}</g>;
}
export function VectorNodeOptions({layer,contour,active,locked,selectContour,selectAnchor,edit,done}){
  const path=layer?.paths?.[contour],count=path?.nodes.length||0;
  return <div>{path&&<>
    {layer.paths.length>1&&<Select aria-label="编辑轮廓" value={contour} onChange={e=>selectContour(+e.target.value)}>{layer.paths.map((_,i)=><option key={i} value={i}>轮廓 {i+1}</option>)}</Select>}
    <NumberField label="锚点编号" value={active+1} min={1} max={count} onChange={v=>selectAnchor(Math.round(v)-1)}/>
    <Button disabled={locked||(!path.closed&&active===count-1)||layer.paths.reduce((n,p)=>n+p.nodes.length,0)>=12000} onClick={()=>edit(true)}>在此点后插入</Button>
    <Button disabled={locked||count<=2} onClick={()=>edit(false)}>删除锚点</Button>
  </>}<Button onClick={done}>完成编辑</Button></div>;
}

const denseLimit=160;
export const denseContour=nodes=>nodes?.length>denseLimit;

export function nearestAnchor(layer,nodes,matrix,p,zoom){
  let closest=-1,best=(6/zoom)**2;
  for(let i=0;i<nodes.length;i++){
    const n=nodes[i],a=point(matrix,n.x*layer.width,n.y*layer.height);
    const distance=(a.x-p.x)**2+(a.y-p.y)**2;
    if(distance<best){best=distance;closest=i;}
  }
  return closest;
}

// One decorative mark per screen cell. Picking and editing still use every original anchor.
function overview(nodes,m,w,h,scale,tileX,tileY,size,active){
  const cells=new Set(),marks=[];
  nodes.forEach((n,i)=>{
    if(i===active)return;
    const a=point(m,n.x*w,n.y*h),x=a.x*scale-tileX*size.width,y=a.y*scale-tileY*size.height;
    if(x< -8||y< -8||x>size.width*2+8||y>size.height*2+8)return;
    const cell=Math.floor(x/8)+Math.floor(y/8)*(Math.ceil(size.width/4)+4);
    if(cells.has(cell))return;
    cells.add(cell);marks.push('M'+a.x+' '+a.y+'h.0001');
  });
  return marks.join('');
}

export function AnchorControls({ref,layer,base,matrix,view,size,contour,active}){
  const [preview,setPreview]=useState(null);
  useImperativeHandle(ref,()=>setPreview,[]);
  const nodes=layer.paths[contour]?.nodes,original=base.paths[contour]?.nodes,dense=denseContour(nodes),zoom=view.zoom;
  // Keep a padded overview in world coordinates while the viewport moves inside this tile.
  const scale=2**Math.floor(Math.log2(zoom));
  const tileX=Math.floor(-view.x*scale/zoom/Math.max(1,size.width)),tileY=Math.floor(-view.y*scale/zoom/Math.max(1,size.height));
  const marks=useMemo(()=>dense&&original?overview(original,matrix,layer.width,layer.height,scale,tileX,tileY,size,active):'',
    [original,dense,...matrix,layer.width,layer.height,scale,tileX,tileY,size,active]);
  const at=(x,y)=>point(matrix,x*layer.width,y*layer.height);
  function control(n,i){
    const a=at(n.x,n.y),handle=(p,type)=><circle data-handle={`vector:${contour}:${i}:${type}`} aria-label={type==='anchor'?`锚点 ${i+1}`:'曲线手柄'} cx={p.x} cy={p.y} r={(type==='anchor'?4:3)/zoom} fill={type==='anchor'&&i!==active?'var(--panel)':'var(--accent)'} stroke="var(--accent)" strokeWidth={1.5/zoom} style={{cursor:'crosshair',pointerEvents:'all'}}/>;
    return <g key={i}>{['in','out'].map(type=>{if(!n[type])return null;const h=at(...n[type]);return <g key={type}><line x1={a.x} y1={a.y} x2={h.x} y2={h.y} stroke="var(--accent)" strokeWidth={1/zoom} pointerEvents="none"/>{handle(h,type)}</g>})}{handle(a,'anchor')}</g>;
  }
  const node=preview?.base===base&&preview.index===active&&preview.contour===contour?preview.node:nodes?.[active];
  let segment;
  if(node&&node===preview?.node){
    const closed=layer.paths[contour].closed,adjacent=[];
    if(preview.handle!=='out'&&(active>0||closed))adjacent.push(nodes[(active+nodes.length-1)%nodes.length]);
    adjacent.push(node);
    if(preview.handle!=='in'&&(active+1<nodes.length||closed))adjacent.push(nodes[(active+1)%nodes.length]);
    if(adjacent.length>1)segment=pathData([{nodes:adjacent,closed:false}],layer.width,layer.height);
  }
  return <g>{dense?<>
    <path d={marks} fill="none" stroke="var(--accent)" strokeWidth={3.5/zoom} strokeLinecap="round" pointerEvents="none"/>
    {segment&&<path className="edited-vector-segment" d={segment} transform={`matrix(${matrix.join(' ')})`} fill="none" stroke="var(--accent)" strokeWidth="1" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
    {node&&control(node,active)}
  </>:nodes?.map(control)}</g>;
}
