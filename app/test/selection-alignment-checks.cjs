const L=require('../core/layers.cjs');
module.exports=async({w,js,delay,check,wait,click,set,shot,save,load,key,report,drag})=>{
  const layers=[L.createLayer('group',{id:'board',artboard:true,name:'画板 1',x:240,y:-120,width:1024,height:1536,background:'#ffffff'}),L.createLayer('shape',{id:'rect',name:'矩形',parentId:'board',shape:'rect',x:135,y:355,width:607,height:350,color:'#0033ff',strokeWidth:0})];
  const grouped=L.groupLayers(layers,['rect']);layers.splice(0,layers.length,...grouped.layers);
  report.id=await js(`(async()=>{const r=await tugou.create('选框跟随回归');await tugou.save(r.id,{...r.document,width:1024,height:1536,layers:${JSON.stringify(layers)}},r.revision);return r.id})()`);
  await load();await click('移动','.composition-primary-tools button');await js(`document.querySelector('[data-layer-id="rect"]').click()`);await delay(150);
  const alignment=async name=>{
    await wait('document.querySelector("canvas[aria-label=图层画布]").dataset.rendering==="false"');
    const result=await js(`(()=>{const c=document.querySelector('canvas[aria-label="图层画布"]'),r=c.getBoundingClientRect(),data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let left=c.width,top=c.height,right=0,bottom=0;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;if(data[i]<30&&data[i+1]<90&&data[i+2]>240&&data[i+3]>250){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x+1);bottom=Math.max(bottom,y+1)}}const poly=document.querySelector('.layer-overlay [data-handle="resize"]').parentElement.querySelector('polygon'),b=poly.getBoundingClientRect();return {pixels:[r.left+left*r.width/c.width,r.top+top*r.height/c.height,r.left+right*r.width/c.width,r.top+bottom*r.height/c.height],border:[b.left,b.top,b.right,b.bottom]}})()`);
    report.alignment??=[];report.alignment.push({name,...result});
    check(name+' pixels match selection border',result.pixels.every((v,i)=>Math.abs(v-result.border[i])<2));
  };
  await alignment('initial');await set('X',95);await set('Y',255);await alignment('property position');await shot('selection-position');
  await click('撤销');await alignment('undo position');await click('重做');await alignment('redo position');
  const center=await js(`(()=>{const r=document.querySelector('.layer-overlay [data-handle="resize"]').parentElement.querySelector('polygon').getBoundingClientRect();return {x:Math.round((r.left+r.right)/2),y:Math.round((r.top+r.bottom)/2)}})()`);
  await js(`window.pointerLog=[];for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])document.querySelector('.layer-stage').addEventListener(type,e=>pointerLog.push([type,e.clientX,e.clientY,e.buttons,e.target.tagName]));document.querySelector('.layer-stage').focus()`);
  w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...center});await delay(100);w.webContents.sendInputEvent({type:'mouseMove',x:center.x+40,y:center.y-60,modifiers:['leftButtonDown']});await delay(100);await w.capturePage();await delay(100);await alignment('during drag');w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:center.x+40,y:center.y-60});await delay(200);report.pointerLog=await js('pointerLog');await alignment('pointer move');await shot('selection-drag');
  check('pointer drag changes layer position',(await save()).layers.find(l=>l.id==='rect').x!==95);
  await key('Left');await alignment('keyboard move');await set('宽度',480);await set('高度',290);await alignment('resize');
  await click('聚焦画板');await alignment('fit zoom');await save();await load();await js(`document.querySelector('[data-layer-id="rect"]').click()`);await delay(150);await alignment('reload');
  await js(`document.querySelector('[data-layer-id="${grouped.ids[0]}"]').click()`);await delay(150);await shot('group-selection');await alignment('group after child moved');
  const before=report.alignment.at(-1).border;
  const handle=await js(`(()=>{const r=document.querySelector('.layer-overlay [data-handle="resize"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`);
  w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...handle});await delay(100);
  w.webContents.sendInputEvent({type:'mouseMove',x:handle.x+30,y:handle.y+25,modifiers:['leftButtonDown']});await delay(100);await w.capturePage();await delay(100);
  w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:handle.x+30,y:handle.y+25});await delay(200);await alignment('group resize');
  const after=report.alignment.at(-1).border;check('group resize keeps opposite corner fixed',Math.abs(after[0]-before[0])<1&&Math.abs(after[1]-before[1])<1&&after[2]>before[2]+20);
  await click('撤销');await alignment('undo group resize');await click('重做');await alignment('redo group resize');await shot('group-resized');
};
