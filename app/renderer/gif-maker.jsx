import React,{useEffect,useRef,useState} from 'react';
import {Button,EmptyState} from './components.jsx';
import {NumberField} from './number-field.jsx';
import {Select} from './select.jsx';
import {useImageImport,hasImageFiles} from './use-image-import.js';
import {originalUrl,exportMaterial} from './image-processing.js';
import './gif.css';

export function GifMaker({document,change,addToLayers,addToCanvas,onBusy}){
  const [frames,setFrames]=useState([]),[duration,setDuration]=useState(100),[width,setWidth]=useState(512),[height,setHeight]=useState(512),[loop,setLoop]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[result,setResult]=useState(null),[preview,setPreview]=useState(0),[playing,setPlaying]=useState(true);
  const latest=useRef(document),alive=useRef(true);latest.current=document;
  useEffect(()=>()=>{alive.current=false;},[]);
  useEffect(()=>{onBusy(busy);return()=>onBusy(false);},[busy,onBusy]);
  const add=assets=>{if(frames.length+assets.length>240){setMessage('最多添加 240 帧');return;}setResult(null);setFrames(old=>[...old,...assets.map(asset=>({id:crypto.randomUUID(),asset,delay:duration}))]);if(!frames.length&&assets.length){setWidth(Math.min(4096,assets[0].width));setHeight(Math.min(4096,assets[0].height));}};
  const imageImport=useImageImport(assets=>{if(change({...latest.current,assets:[...latest.current.assets,...assets]})===false)throw Error('工程正在保存，请稍后重试');add(assets);},setMessage,busy);
  useEffect(()=>{if(!playing||frames.length<2)return;const timer=setTimeout(()=>setPreview(i=>(i+1)%frames.length),frames[preview%frames.length]?.delay||100);return()=>clearTimeout(timer);},[playing,preview,frames]);
  const update=fn=>{setResult(null);setFrames(fn);setPreview(0);};
  const move=(index,offset)=>update(old=>{const next=[...old];[next[index],next[index+offset]]=[next[index+offset],next[index]];return next;});
  const create=async()=>{
    setBusy(true);setMessage('正在合并图片…');const snapshot=latest.current;
    try{
      const bytes=await window.tugou.encodeGif(frames.map(f=>f.asset.resource),{width,height,loop,delays:frames.map(f=>f.delay)});
      const asset=await window.tugou.storeRaster(bytes,'GIF 动图');
      if(!alive.current)return;
      if(latest.current!==snapshot)throw Error('工程已变化，请重新制作');
      if(change({...snapshot,assets:[...snapshot.assets,asset]})===false)throw Error('工程正在保存，请稍后重试');
      setResult(asset);setMessage(`已生成 ${asset.gif.frames} 帧 GIF，并加入素材库`);
    }catch(e){if(alive.current)setMessage(e.message);}finally{if(alive.current)setBusy(false);}
  };
  const assets=document.assets.filter(a=>(!a.kind||a.kind==='image')&&a.resource);
  return <div className="gif-maker" data-dev-update-blocked={busy?'GIF 正在制作':undefined} onDragOver={imageImport.over} onDrop={e=>{if(hasImageFiles(e))imageImport.drop(e);}}>
    <aside className="gif-materials"><header className="gif-source-heading"><h3>素材</h3><Button icon="import" disabled={busy||imageImport.importing} onClick={imageImport.open}>添加图片</Button></header><p className="muted">点击素材追加为一帧，也可拖入本地图片。</p><div className="gif-material-grid">{assets.map(a=><button key={a.id} disabled={busy} title={`添加 ${a.name}`} onClick={()=>add([a])}><img src={originalUrl(a)} alt="" loading="lazy"/><span>{a.name}</span></button>)}</div></aside>
    <main className="gif-main"><header><h2>GIF 动图制作</h2><span className="muted">{frames.length} 帧 · {(frames.reduce((sum,f)=>sum+f.delay,0)/1000).toFixed(2)} 秒</span></header><div className="gif-preview">{result?<img src={originalUrl(result)} alt="生成的 GIF 动图"/>:frames.length?<img src={originalUrl(frames[preview%frames.length].asset)} alt={`第 ${preview%frames.length+1} 帧预览`}/>:<EmptyState icon="assets" title="把图片连成动图" description="添加两张或更多图片，调整顺序与帧时长。"><Button primary onClick={imageImport.open}>选择图片</Button></EmptyState>}</div>
      {!result&&frames.length>0&&<div className="gif-playback"><Button disabled={busy} onClick={()=>setPlaying(v=>!v)}>{playing?'暂停预览':'播放预览'}</Button><span>第 {preview%frames.length+1} / {frames.length} 帧</span></div>}
      <ol className="gif-frame-list">{frames.map((f,i)=><li key={f.id}><img src={originalUrl(f.asset)} alt=""/><span className="gif-frame-name">{i+1}. {f.asset.name}</span><NumberField label={`第 ${i+1} 帧时长（毫秒）`} shortLabel="毫秒" value={f.delay} min={20} max={60000} step={10} disabled={busy} onChange={value=>update(old=>old.map(row=>row.id===f.id?{...row,delay:Math.max(20,Math.round(value/10)*10)}:row))}/><Button aria-label={`前移第 ${i+1} 帧`} disabled={busy||i===0} onClick={()=>move(i,-1)}>↑</Button><Button aria-label={`后移第 ${i+1} 帧`} disabled={busy||i===frames.length-1} onClick={()=>move(i,1)}>↓</Button><Button aria-label={`移除第 ${i+1} 帧`} iconOnly icon="close" disabled={busy} onClick={()=>update(old=>old.filter(row=>row.id!==f.id))}/></li>)}</ol>
    </main>
    <aside className="gif-settings"><h3>输出设置</h3><NumberField label="GIF 宽度" value={width} min={1} max={4096} disabled={busy} onChange={n=>{setResult(null);setWidth(Math.round(n))}}/><NumberField label="GIF 高度" value={height} min={1} max={4096} disabled={busy} onChange={n=>{setResult(null);setHeight(Math.round(n))}}/><p className="muted">图片等比缩放，透明补边。GIF 素材作为输入时取首帧。</p><NumberField label="统一帧时长（毫秒）" value={duration} min={20} max={60000} step={10} disabled={busy} onChange={n=>setDuration(Math.max(20,Math.round(n/10)*10))}/><Button disabled={busy||!frames.length} onClick={()=>update(old=>old.map(f=>({...f,delay:duration})))}>应用到全部帧</Button><label>播放次数<Select aria-label="GIF 播放次数" value={loop} disabled={busy} onChange={e=>{setResult(null);setLoop(+e.target.value)}}><option value={0}>无限循环</option><option value={1}>播放一次</option></Select></label><p className="muted">最多 240 帧，总计 6400 万像素。GIF 为 256 色，透明边缘可能与 PNG 略有差异。</p><Button primary disabled={busy||frames.length<2||imageImport.importing} onClick={create}>{busy?'正在制作…':'生成 GIF'}</Button>{result&&<><Button icon="export" onClick={()=>exportMaterial(result).catch(e=>setMessage(e.message))}>保存 GIF</Button><Button onClick={()=>addToLayers([result])}>加入图层</Button><Button onClick={()=>addToCanvas('asset',[result.id])}>加入画布</Button></>}{message&&<p role="status">{message}</p>}</aside>
  </div>;
}
