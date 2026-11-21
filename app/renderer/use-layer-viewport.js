import {useEffect,useRef,useState} from 'react';

const REFRESH_MS=100, WHEEL_IDLE_MS=150;

export function useLayerViewport(initial,canRefresh){
  const [view,setDisplayView]=useState(initial),[raster,setRaster]=useState({view:initial,draft:false});
  const state=useRef({view,rasterView:initial});
  const cancel=()=>{
    const s=state.current;
    cancelAnimationFrame(s.frame);clearTimeout(s.refresh);clearTimeout(s.idle);
    s.frame=s.refresh=s.idle=undefined;
  };
  useEffect(()=>cancel,[]);

  const setView=update=>{
    const s=state.current;
    cancel();
    const next=typeof update==='function'?update(s.view):update??s.view;
    s.view=s.rasterView=next;
    setDisplayView(next);setRaster({view:next,draft:false});
  };
  const refresh=()=>{
    const s=state.current;
    s.refresh=undefined;
    if(s.view===s.rasterView)return;
    if(!canRefresh(s.rasterView,s.view))return;
    s.rasterView=s.view;
    setRaster({view:s.rasterView,draft:true});
  };
  const moveView=(update,wheel=false)=>{
    const s=state.current;
    s.view=typeof update==='function'?update(s.view):update;
    if(s.frame===undefined)s.frame=requestAnimationFrame(()=>{s.frame=undefined;setDisplayView(s.view);});
    if(s.refresh===undefined)s.refresh=setTimeout(refresh,REFRESH_MS);
    clearTimeout(s.idle);
    if(wheel)s.idle=setTimeout(()=>setView(),WHEEL_IDLE_MS);
  };
  return {view,rasterView:raster.view,rasterDraft:raster.draft,setView,moveView,getView:()=>state.current.view};
}

export function placeLayerBitmap(canvas,drawn,view){
  if(!canvas||!drawn)return;
  const scale=view.zoom/drawn.zoom,x=view.x-drawn.x*scale,y=view.y-drawn.y*scale;
  canvas.style.transform=x||y||scale!==1?`translate3d(${x}px, ${y}px, 0) scale(${scale})`:'';
}

export function needsLayerViewportRefresh(drawn,view,{width,height}){
  // Small movements can keep using the existing bitmap until input settles.
  const scale=view.zoom/drawn.zoom,x=view.x-drawn.x*scale,y=view.y-drawn.y*scale;
  const exposed=(offset,length)=>Math.max(0,offset)+Math.max(0,length*(1-scale)-offset);
  return exposed(x,width)>width*.2||exposed(y,height)>height*.2;
}
