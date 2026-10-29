import React, { useEffect, useRef, useState } from 'react';
import { Button, FormDialog } from './components.jsx';
import { NumberField } from './number-field.jsx';
import { loadOriginal } from './image-processing.js';
import { surface, pngBytes } from './selection.js';
import { maskValue } from '../core/cloud-settings.cjs';

// Strokes stay in source-image coordinates; preview resolution never limits export resolution.
function drawMask(canvas, source, base, settings, actions) {
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.clearRect(0,0,canvas.width,canvas.height);
  if(base){
    ctx.drawImage(base,0,0,canvas.width,canvas.height);
    for(let y=0;y<canvas.height;y+=64){
      const pixels=ctx.getImageData(0,y,canvas.width,Math.min(64,canvas.height-y));
      for(let i=0;i<pixels.data.length;i+=4){
        const a=maskValue(pixels.data,i,settings.maskChannel,settings.invertMask);
        pixels.data.set([255,255,255,a],i);
      }
      ctx.putImageData(pixels,0,y);
    }
  }
  ctx.save();ctx.scale(canvas.width/source.width,canvas.height/source.height);
  ctx.lineCap=ctx.lineJoin='round';ctx.fillStyle=ctx.strokeStyle='#ffffff';
  for(const stroke of actions){
    if(stroke.mode==='clear'){ctx.clearRect(0,0,source.width,source.height);continue;}
    ctx.globalCompositeOperation=stroke.mode==='erase'?'destination-out':'source-over';
    ctx.lineWidth=stroke.size;ctx.beginPath();
    const [first,...rest]=stroke.points;
    if(!rest.length){ctx.arc(first.x,first.y,stroke.size/2,0,Math.PI*2);ctx.fill();}
    else{ctx.moveTo(first.x,first.y);for(const p of rest)ctx.lineTo(p.x,p.y);ctx.stroke();}
  }
  ctx.restore();
}

export function CloudMaskEditor({source,mask,settings,close,apply}){
  const canvas=useRef(null),original=useRef(null),base=useRef(null),overlay=useRef(null);
  const actions=useRef([]),redo=useRef([]),draft=useRef(null),frame=useRef(null),alive=useRef(true);
  const [revision,setRevision]=useState(0),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState('');
  const [mode,setMode]=useState('paint'),[size,setSize]=useState(Math.max(1,Math.min(2048,Math.round(Math.min(source.width,source.height)/12))));
  const repaint=()=>{
    if(!original.current||!canvas.current)return;
    const c=canvas.current,o=overlay.current,ctx=c.getContext('2d');
    drawMask(o,source,base.current,settings,[...actions.current,...(draft.current?[draft.current]:[])]);
    const tint=o.getContext('2d');tint.globalCompositeOperation='source-in';tint.fillStyle='#508cff';tint.fillRect(0,0,o.width,o.height);tint.globalCompositeOperation='source-over';
    ctx.clearRect(0,0,c.width,c.height);ctx.drawImage(original.current,0,0,c.width,c.height);
    ctx.globalAlpha=.45;ctx.drawImage(o,0,0);ctx.globalAlpha=1;
  };
  const schedule=()=>{cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(repaint);};
  useEffect(()=>{
    let active=true;
    (async()=>{
      const image=await loadOriginal(source),existing=mask?await loadOriginal(mask):null;
      if(!active)return;
      if(existing&&(existing.width!==source.width||existing.height!==source.height))throw Error('蒙版与原图尺寸不同');
      original.current=image;base.current=existing;
      const scale=1024/Math.max(source.width,source.height),c=canvas.current;
      c.width=Math.max(1,Math.round(source.width*scale));c.height=Math.max(1,Math.round(source.height*scale));
      overlay.current=surface(c.width,c.height);setReady(true);repaint();
    })().catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;alive.current=false;cancelAnimationFrame(frame.current);if(overlay.current)overlay.current.width=overlay.current.height=1;};
  },[]);
  const changed=()=>{setError('');setRevision(n=>n+1);schedule();};
  const undo=()=>{if(draft.current||saving)return;if(actions.current.length)redo.current.push(actions.current.pop());changed();};
  const point=e=>{const r=canvas.current.getBoundingClientRect();return{x:Math.max(0,Math.min(source.width,(e.clientX-r.left)*source.width/r.width)),y:Math.max(0,Math.min(source.height,(e.clientY-r.top)*source.height/r.height))};};
  const pointCount=()=>actions.current.reduce((n,a)=>n+(a.points?.length||1),0)+(draft.current?.points.length||0);
  const end=e=>{
    if(!draft.current||draft.current.pointerId!==e.pointerId)return;
    actions.current.push(draft.current);draft.current=null;redo.current=[];
    canvas.current.releasePointerCapture(e.pointerId);changed();
  };
  const save=async()=>{
    if(!ready||saving||draft.current)return;
    setSaving(true);setError('');let output;
    try{
      output=surface(source.width,source.height);drawMask(output,source,base.current,settings,actions.current);
      const ctx=output.getContext('2d',{willReadFrequently:true});let nonempty=false;
      for(let y=0;y<output.height&&!nonempty;y+=64){
        const data=ctx.getImageData(0,y,output.width,Math.min(64,output.height-y)).data;
        for(let i=3;i<data.length;i+=4)if(data[i]){nonempty=true;break;}
      }
      if(!nonempty)throw Error('请先涂画需要修改的区域');
      const bytes=await pngBytes(output);if(!alive.current)return;
      await apply(bytes);if(alive.current)close();
    }catch(e){if(alive.current)setError(e.message);}
    finally{if(output)output.width=output.height=1;if(alive.current)setSaving(false);}
  };
  return <FormDialog title="涂画修改区域" width={920} close={()=>{if(!saving)close();}}>
    <div className="cloud-mask-editor" onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){e.preventDefault();e.stopPropagation();undo();}}}>
      <p>蓝色区域将交给 AI 修改，未涂区域保留原图。应用只保存区域，不会立即调用模型。</p>
      <div className="mask-paint-toolbar">
        <Button disabled={!ready||saving} aria-pressed={mode==='paint'} onClick={()=>setMode('paint')}>涂画</Button>
        <Button disabled={!ready||saving} aria-pressed={mode==='erase'} onClick={()=>setMode('erase')}>擦除</Button>
        <NumberField label="涂画笔刷大小（原图 px）" value={size} min={1} max={Math.max(1,Math.min(2048,Math.max(source.width,source.height)))} disabled={saving} onChange={n=>setSize(Math.round(n))}/>
        <Button disabled={saving||!actions.current.length} onClick={undo}>撤销涂画</Button>
        <Button disabled={saving||!redo.current.length} onClick={()=>{actions.current.push(redo.current.pop());changed();}}>重做涂画</Button>
        <Button disabled={!ready||saving} onClick={()=>{actions.current.push({mode:'clear'});redo.current=[];changed();}}>清空区域</Button>
      </div>
      <div className="mask-paint-stage"><canvas ref={canvas} aria-label="涂画修改区域画布" data-ready={ready} data-revision={revision}
        onPointerDown={e=>{if(!ready||saving||e.button!==0||draft.current)return;e.preventDefault();if(pointCount()>=20000){setError('笔迹较多，请先应用区域，再继续编辑');return;}draft.current={mode,size,points:[point(e)],pointerId:e.pointerId};canvas.current.setPointerCapture(e.pointerId);setError('');schedule();}}
        onPointerMove={e=>{if(!draft.current||draft.current.pointerId!==e.pointerId)return;if(pointCount()>=20000){end(e);setError('笔迹较多，请先应用区域，再继续编辑');return;}draft.current.points.push(point(e));schedule();}}
        onPointerUp={end} onPointerCancel={()=>{draft.current=null;schedule();}} onLostPointerCapture={()=>{draft.current=null;schedule();}}/>
      </div>
      {error&&<p role="alert">{error}</p>}
      <footer><Button disabled={saving} onClick={close}>取消</Button><Button primary disabled={!ready||saving} onClick={save}>{saving?'正在保存区域…':'应用修改区域'}</Button></footer>
    </div>
  </FormDialog>;
}
