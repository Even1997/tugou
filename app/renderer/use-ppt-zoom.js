import {useLayoutEffect,useRef,useState} from 'react';
import {sizes} from '../core/presentations.cjs';

export function usePptZoom(deck,enabled,gesture){
  const surface=useRef(null),page=useRef(null),anchor=useRef(null),actions=useRef(null),scaleRef=useRef(1);
  const [scale,setScale]=useState(1),[viewport,setViewport]=useState({width:0,height:0});
  const [width,height]=sizes[deck?.ratio]||sizes['16:9'];
  const space={width:Math.max(viewport.width,width*scale)+viewport.width,height:Math.max(viewport.height,height*scale)+viewport.height};
  const pageStyle={width:width*scale,left:(space.width-width*scale)/2,top:(space.height-height*scale)/2};
  useLayoutEffect(()=>{
    const node=surface.current;if(!enabled||!deck||!node)return;
    let fitted=true,target=scaleRef.current,frame=0,last=0,mouse=null,spaceDown=false,pan=null;
    const stop=()=>{cancelAnimationFrame(frame);frame=0;target=scaleRef.current;anchor.current=null;};
    const cursor=()=>{if(spaceDown)node.dataset.pan=pan?'dragging':'ready';else delete node.dataset.pan;};
    const endPan=()=>{const id=pan?.id;pan=null;if(id!==undefined&&node.hasPointerCapture(id))node.releasePointerCapture(id);cursor();};
    const reset=()=>{spaceDown=false;endPan();stop();};
    const fit=()=>{
      if(gesture.current)return;
      reset();fitted=true;anchor.current={center:true};
      scaleRef.current=target=Math.max(.1,Math.min(4,(node.clientWidth-48)/width,(node.clientHeight-48)/height));
      setScale(target);setViewport({width:node.clientWidth,height:node.clientHeight});
    };
    const resize=()=>{if(fitted)fit();else setViewport({width:node.clientWidth,height:node.clientHeight});};
    const apply=next=>{
      anchor.current={x:mouse.pageX,y:mouse.pageY,clientX:mouse.x,clientY:mouse.y};
      scaleRef.current=next;setScale(next);
    };
    const animate=time=>{
      frame=0;if(gesture.current||pan)return stop();
      const next=scaleRef.current+(target-scaleRef.current)*(1-Math.exp(-Math.max(0,Math.min(64,time-last))/45));last=time;
      if(Math.abs(target-next)<.0001){apply(target);return;}
      apply(next);frame=requestAnimationFrame(animate);
    };
    const wheel=event=>{
      if(!event.ctrlKey){stop();return;}
      event.preventDefault();event.stopPropagation();
      if(!event.deltaY||gesture.current||pan)return;
      const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?node.clientHeight:1);
      target=Math.max(.1,Math.min(4,target*Math.exp(-Math.max(-100,Math.min(100,delta))*.0015)));
      const rect=page.current.getBoundingClientRect();
      fitted=false;mouse={x:event.clientX,y:event.clientY,pageX:(event.clientX-rect.left)/rect.width,pageY:(event.clientY-rect.top)/rect.height};
      if(window.matchMedia('(prefers-reduced-motion: reduce)').matches){cancelAnimationFrame(frame);frame=0;apply(target);}
      else if(!frame){last=performance.now();frame=requestAnimationFrame(animate);}
    };
    const keydown=event=>{
      if(event.key==='Escape'&&spaceDown){event.preventDefault();reset();return;}
      if(event.code!=='Space'||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.defaultPrevented||gesture.current)return;
      if(event.target.closest?.('input,textarea,select,button,[contenteditable="true"],[role="dialog"]')||(!node.matches(':hover')&&!node.contains(document.activeElement)))return;
      event.preventDefault();spaceDown=true;cursor();
    };
    const keyup=event=>{if(event.code==='Space'){spaceDown=false;endPan();}};
    const down=event=>{
      stop();if(!spaceDown||event.button!==0||gesture.current)return;
      event.preventDefault();event.stopPropagation();node.focus({preventScroll:true});
      fitted=false;pan={id:event.pointerId,x:event.clientX,y:event.clientY,left:node.scrollLeft,top:node.scrollTop};node.setPointerCapture(event.pointerId);cursor();
    };
    const move=event=>{
      if(!pan||event.pointerId!==pan.id)return;
      event.preventDefault();event.stopPropagation();if(!(event.buttons&1))return endPan();
      node.scrollLeft=pan.left+pan.x-event.clientX;node.scrollTop=pan.top+pan.y-event.clientY;
    };
    const up=event=>{if(!pan||event.pointerId!==pan.id)return;event.preventDefault();event.stopPropagation();endPan();};
    const click=event=>{if(spaceDown){event.preventDefault();event.stopPropagation();}};
    const visibility=()=>{if(document.hidden)reset();};
    actions.current={fit};
    resize();const observer=new ResizeObserver(resize);observer.observe(node);
    node.addEventListener('wheel',wheel,{passive:false});
    const pointerEvents={pointerdown:down,pointermove:move,pointerup:up,pointercancel:up,lostpointercapture:endPan,click,dblclick:click};
    for(const [name,handler] of Object.entries(pointerEvents))node.addEventListener(name,handler,true);
    window.addEventListener('keydown',keydown);window.addEventListener('keyup',keyup);window.addEventListener('blur',reset);document.addEventListener('visibilitychange',visibility);
    return()=>{reset();actions.current=null;observer.disconnect();node.removeEventListener('wheel',wheel);for(const [name,handler] of Object.entries(pointerEvents))node.removeEventListener(name,handler,true);window.removeEventListener('keydown',keydown);window.removeEventListener('keyup',keyup);window.removeEventListener('blur',reset);document.removeEventListener('visibilitychange',visibility);};
  },[deck?.id,width,height,enabled]);
  useLayoutEffect(()=>{
    const point=anchor.current,node=surface.current;if(!point||!node||!page.current)return;
    if(point.center){node.scrollLeft=(node.scrollWidth-node.clientWidth)/2;node.scrollTop=(node.scrollHeight-node.clientHeight)/2;anchor.current=null;return;}
    const rect=page.current.getBoundingClientRect();
    node.scrollLeft+=rect.left+point.x*rect.width-point.clientX;
    node.scrollTop+=rect.top+point.y*rect.height-point.clientY;
    anchor.current=null;
  },[scale,viewport]);
  return {surface,page,scale,space,pageStyle,fit:()=>actions.current?.fit()};
}
