// A gesture may show completed frames while newer positions wait. Other edits
// invalidate the active frame, including the final document after pointerup.
export function createLayerPreviewQueue(){
  let active,pending,frame;
  const schedule=(atFrame=true)=>{
    if(active||!pending||frame!==undefined)return;
    const drawNext=async()=>{
      frame=undefined;
      const {gesture,draw}=pending;pending=undefined;
      const controller=new AbortController();
      active={gesture,controller};
      try{await draw(controller.signal,()=>!pending&&!controller.signal.aborted);}
      finally{active=undefined;schedule();}
    };
    if(atFrame)frame=requestAnimationFrame(drawNext);
    else void drawNext();
  };
  return {
    request(gesture,draw){
      pending={gesture,draw};
      if(active&&(!gesture||active.gesture!==gesture))active.controller.abort();
      // Motion drafts already arrive on an animation frame.
      schedule(!gesture);
    },
    cancel(){
      pending=undefined;cancelAnimationFrame(frame);frame=undefined;
      active?.controller.abort();
    },
  };
}

export function previewRegion(bounds,padding,current,previous,view,ratio,width,height){
  const scale=view.zoom*ratio;
  const left=Math.max(0,Math.floor((bounds.x+Math.min(current.dx,previous.dx))*scale+view.x*ratio)-padding);
  const top=Math.max(0,Math.floor((bounds.y+Math.min(current.dy,previous.dy))*scale+view.y*ratio)-padding);
  const right=Math.min(width,Math.ceil((bounds.x+bounds.width+Math.max(current.dx,previous.dx))*scale+view.x*ratio)+padding);
  const bottom=Math.min(height,Math.ceil((bounds.y+bounds.height+Math.max(current.dy,previous.dy))*scale+view.y*ratio)+padding);
  return {left,top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
