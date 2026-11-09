const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../renderer/use-ppt-zoom.js'),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function','function');
function setup(){
  const slots=[],effects=[],frames=new Map();let cursor=0,dirty=true,result,now=0,nextFrame=0,resize,enabled=true,deck={id:'deck',ratio:'16:9'};
  const target=()=>({listeners:new Map(),addEventListener(k,fn){this.listeners.set(k,fn);},removeEventListener(k,fn){if(this.listeners.get(k)===fn)this.listeners.delete(k);}});
  const win=target(),doc={...target(),hidden:false,activeElement:null},gesture={current:null};win.matchMedia=()=>({matches:win.reducedMotion||false});
  const node={...target(),clientWidth:800,clientHeight:600,scrollWidth:0,scrollHeight:0,dataset:{},left:0,top:0,captured:null,hover:true,
    get scrollLeft(){return this.left;},set scrollLeft(v){this.left=Math.round(Math.max(0,Math.min(this.scrollWidth-this.clientWidth,v)));},
    get scrollTop(){return this.top;},set scrollTop(v){this.top=Math.round(Math.max(0,Math.min(this.scrollHeight-this.clientHeight,v)));},
    closest(){return null;},matches(){return this.hover;},contains(e){return e===this;},focus(){doc.activeElement=this;},
    setPointerCapture(id){this.captured=id;},hasPointerCapture(id){return this.captured===id;},releasePointerCapture(){this.captured=null;}};
  const page={getBoundingClientRect:()=>({left:result.pageStyle.left-node.scrollLeft,top:result.pageStyle.top-node.scrollTop,width:result.pageStyle.width,height:result.pageStyle.width*(deck.ratio==='4:3'?3/4:9/16)})};
  const hooks={useRef:value=>{const i=cursor++;return slots[i]??=( {current:value});},useState:value=>{const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],v=>{if(!Object.is(v,slots[i])){slots[i]=v;dirty=true;}}];},useLayoutEffect:(fn,deps)=>{const i=cursor++,old=slots[i];if(!old||deps.some((v,k)=>v!==old.deps[k])){slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{slots[i].cleanup?.();slots[i].cleanup=fn();});}}};
  const hook=vm.runInNewContext(source+';usePptZoom',{...hooks,sizes:require('../core/presentations.cjs').sizes,window:win,document:doc,performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),ResizeObserver:class{constructor(fn){resize=fn;}observe(){}disconnect(){}}});
  const flush=()=>{let count=0;while(dirty){assert.ok(++count<20,'render converges');dirty=false;cursor=0;result=hook(deck,enabled,gesture);result.surface.current=node;result.page.current=page;node.scrollWidth=result.space.width;node.scrollHeight=result.space.height;node.scrollLeft=node.scrollLeft;node.scrollTop=node.scrollTop;while(effects.length)effects.shift()();}};
  const fire=(element,name,props={})=>{const event={target:node,code:'',key:'',ctrlKey:false,metaKey:false,altKey:false,deltaY:0,deltaMode:0,clientX:460,clientY:320,button:0,buttons:1,pointerId:1,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...props};element.listeners.get(name)?.(event);flush();return event;};
  const advance=(ms=16)=>{now+=ms;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(now));flush();};
  const settle=()=>{for(let i=0;frames.size&&i<120;i++)advance();assert.equal(frames.size,0,'animation settles');};
  flush();return {node,page,win,doc,gesture,fire,advance,settle,frames,get view(){return result;},wheel:deltaY=>fire(node,'wheel',{ctrlKey:true,deltaY}),key:()=>fire(win,'keydown',{code:'Space',key:' '}),fit:()=>{result.fit();flush();},resize:(w,h)=>{node.clientWidth=w;node.clientHeight=h;resize();flush();},disable:()=>{enabled=false;dirty=true;flush();}};
}
test('Ctrl wheel advances through intermediate frames and preserves the mouse anchor',()=>{
  const h=setup(),start=h.view.scale,before=h.page.getBoundingClientRect(),x=(460-before.left)/before.width,y=(320-before.top)/before.height;
  const event=h.wheel(-100);assert.ok(event.defaultPrevented);assert.equal(h.view.scale,start);h.advance();assert.ok(h.view.scale>start&&h.view.scale<start*Math.exp(.15));
  h.settle();assert.ok(Math.abs(h.view.scale-start*Math.exp(.15))<1e-8);const after=h.page.getBoundingClientRect();assert.ok(Math.abs(after.left+x*after.width-460)<1);assert.ok(Math.abs(after.top+y*after.height-320)<1);
});
test('continuous wheel input shares one animation and settles at bounds',()=>{
  const h=setup();for(let i=0;i<80;i++)h.wheel(-100);assert.equal(h.frames.size,1);h.settle();assert.equal(h.view.scale,4);
  for(let i=0;i<80;i++)h.wheel(100);h.settle();assert.equal(h.view.scale,.1);
  assert.equal(h.fire(h.node,'wheel',{deltaY:100}).defaultPrevented,undefined);
});
test('opposite input retargets smoothly; reduced motion bypasses interpolation',()=>{
  const h=setup(),start=h.view.scale;h.wheel(-100);h.advance();h.wheel(100);h.settle();assert.ok(Math.abs(h.view.scale-start)<1e-10);
  h.win.reducedMotion=true;h.wheel(-100);assert.equal(h.frames.size,0);assert.ok(h.view.scale>start);
});
test('fit restores a centered page after panning, resizing and zooming',()=>{
  const h=setup();h.key();h.fire(h.node,'pointerdown',{clientX:400,clientY:300});h.fire(h.node,'pointermove',{clientX:480,clientY:340});h.fire(h.win,'keyup',{code:'Space'});
  h.wheel(-100);h.advance();h.fit();assert.equal(h.frames.size,0);let r=h.page.getBoundingClientRect();assert.ok(Math.abs(r.left+r.width/2-400)<.01);assert.ok(Math.abs(r.top+r.height/2-300)<.01);
  h.resize(600,400);r=h.page.getBoundingClientRect();assert.ok(Math.abs(r.left+r.width/2-300)<.01);assert.ok(Math.abs(r.top+r.height/2-200)<.01);
});
test('Space plus left drag pans at fitted scale and captures events before element editing',()=>{
  const h=setup(),before=h.page.getBoundingClientRect(),scale=h.view.scale;assert.ok(h.key().defaultPrevented);assert.equal(h.node.dataset.pan,'ready');
  assert.ok(h.fire(h.node,'pointerdown',{clientX:400,clientY:300}).stopped);assert.equal(h.node.dataset.pan,'dragging');assert.equal(h.node.captured,1);
  assert.ok(h.fire(h.node,'pointermove',{clientX:470,clientY:350}).stopped);const after=h.page.getBoundingClientRect();assert.equal(after.left-before.left,70);assert.equal(after.top-before.top,50);assert.equal(h.view.scale,scale);assert.equal(h.gesture.current,null);
  h.fire(h.node,'pointerup');assert.equal(h.node.captured,null);assert.equal(h.node.dataset.pan,'ready');h.fire(h.win,'keyup',{code:'Space'});assert.equal(h.node.dataset.pan,undefined);assert.equal(h.fire(h.node,'pointerdown').stopped,undefined);
});
test('releasing Space, Escape, blur and pointer cancellation safely end dragging',()=>{
  for(const end of ['keyup','Escape','blur','pointercancel','lostpointercapture']){const h=setup();h.key();h.fire(h.node,'pointerdown');
    if(end==='Escape')h.fire(h.win,'keydown',{key:'Escape'});else h.fire(end.startsWith('pointer')||end==='lostpointercapture'?h.node:h.win,end,{code:'Space'});
    const left=h.node.scrollLeft;h.fire(h.node,'pointermove',{clientX:100});assert.equal(h.node.scrollLeft,left);assert.equal(h.node.captured,null);assert.notEqual(h.node.dataset.pan,'dragging');}
});
test('Space stays available for text, buttons, dialogs and other panels',()=>{
  for(const control of ['input','textarea','select','button','contenteditable','dialog']){const h=setup();assert.equal(h.fire(h.win,'keydown',{code:'Space',target:{closest:()=>control}}).defaultPrevented,undefined);assert.equal(h.node.dataset.pan,undefined);}
  const h=setup();h.node.hover=false;assert.equal(h.key().defaultPrevented,undefined);h.node.focus();assert.ok(h.key().defaultPrevented);
});
test('panning and element gestures exclude wheel animation; pointer down stops interpolation',()=>{
  const h=setup();h.wheel(-100);h.advance();h.fire(h.node,'pointerdown');const scale=h.view.scale;assert.equal(h.frames.size,0);
  h.gesture.current={mode:'move'};h.wheel(-100);assert.equal(h.frames.size,0);assert.equal(h.key().defaultPrevented,undefined);h.gesture.current=null;
  h.key();h.fire(h.node,'pointerdown');h.wheel(-100);assert.equal(h.view.scale,scale);assert.equal(h.frames.size,0);
});
test('unmount removes listeners, pointer capture and pending animation',()=>{
  const h=setup();h.key();h.fire(h.node,'pointerdown');h.disable();assert.equal(h.node.captured,null);assert.equal(h.node.listeners.size,0);assert.equal(h.win.listeners.size,0);assert.equal(h.doc.listeners.size,0);
  const other=setup();other.wheel(-100);other.disable();assert.equal(other.frames.size,0);
});
test('ordinary scrolling interrupts interpolation without preventing the scroll event',()=>{
  const h=setup();h.wheel(-100);h.advance();const scale=h.view.scale;assert.equal(h.fire(h.node,'wheel',{deltaY:100}).defaultPrevented,undefined);assert.equal(h.frames.size,0);h.advance();assert.equal(h.view.scale,scale);
});
test('hiding the window releases the hand tool and cancels pending animation',()=>{
  const h=setup();h.key();h.fire(h.node,'pointerdown');h.doc.hidden=true;h.fire(h.doc,'visibilitychange');assert.equal(h.node.dataset.pan,undefined);assert.equal(h.node.captured,null);
  h.doc.hidden=false;h.wheel(-100);h.doc.hidden=true;h.fire(h.doc,'visibilitychange');assert.equal(h.frames.size,0);
});
