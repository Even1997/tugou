import {Compositor} from '../renderer/composite.js';
import {createLayer} from '../core/layers.cjs';
import {defaults as adjustment} from '../core/adjustments.cjs';
import {defaults as effect} from '../core/effects.cjs';
import {surface,pngBytes} from '../renderer/selection.js';
const shape=(patch={})=>createLayer('shape',{x:0,y:0,width:100,height:100,color:'#cc6644',...patch});
window.complexQA={Compositor,surface};
window.complexQA.clipping=async()=>{
  const e=new Compositor(),c=surface(1,1),layers=[
    shape({color:'#ff0000',opacity:.5}),
    createLayer('adjustment',{x:0,y:0,width:100,height:100,clipping:true,adjustment:adjustment('invert')}),
    shape({x:120,color:'#0000ff',opacity:.5}),
    createLayer('adjustment',{x:120,y:0,width:100,height:100,clipping:true,adjustment:adjustment('invert')}),
    shape({x:240,color:'#00ff00',opacity:.5}),
  ];
  await e.render({width:360,height:120,background:'transparent',assets:[],layers},c,{transparent:true});
  const pixels=[10,130,250].map(x=>[...c.getContext('2d').getImageData(x,10,1,1).data]);c.width=c.height=1;e.dispose();return pixels;
};
window.complexQA.fixture=async(id)=>{
  const r=await tugou.open(id),tile=surface(96,96),ctx=tile.getContext('2d');
  ctx.fillStyle='#4686c4';ctx.fillRect(0,0,96,96);ctx.clearRect(24,24,24,24);
  const asset=await tugou.storeRaster(await pngBytes(tile),'复杂工程原图');tile.width=tile.height=1;
  const layers=[];
  for(let i=0;i<8;i++){
    const g=createLayer('group',{x:500+(i%4)*2300,y:400+Math.floor(i/4)*4800,width:1500,height:1800,rotation:i%2?4:-3,opacity:.9});layers.push(g);
    layers.push(shape({parentId:g.id,width:1400,height:500,color:'#6375a3',gradient:{angle:30,endColor:'#d7a8ad'},opacity:.6}));
    layers.push(shape({parentId:g.id,x:120,y:300,width:600,height:700,color:'#efb780',clipping:true,opacity:.7}));
    layers.push(createLayer('adjustment',{parentId:g.id,x:0,y:0,width:1500,height:1800,clipping:true,adjustment:adjustment('invert'),opacity:.3}));
    const nested=createLayer('group',{parentId:g.id,x:350,y:600,width:800,height:900,rotation:-5,opacity:.8});layers.push(nested);
    layers.push(createLayer('image',{parentId:nested.id,x:0,y:0,width:700,height:700,assetId:asset.id,warp:[0,0,1,0,.92,1,.08,.9],mask:{x:0,y:0,width:.9,height:1,feather:2},effects:[{...effect('stroke'),size:3,color:'#ffffff'}]}));
    layers.push(createLayer('text',{parentId:nested.id,x:0,y:720,width:750,height:100,text:'图构 · 复杂工程 '+i,fontSize:36,color:'#aaccee'}));
  }
  layers.push(shape({id:'seam',x:980,y:980,width:240,height:240,color:'#ff3300',mask:{paths:[{operation:'add',points:[0,0,1,0,1,1,0,1]},{operation:'subtract',points:[.4,.4,.6,.4,.6,.6,.4,.6]}],feather:2},effects:[{...effect('shadow'),radius:4,distance:8,angle:45},{...effect('outerGlow'),radius:3}]}));
  layers.push(shape({id:'far',x:9940,y:9940,width:40,height:40,color:'#123456'}));
  const document={...r.document,width:10000,height:10000,background:'transparent',assets:[asset],layers,futureComplex:{keep:42}};
  await tugou.save(id,document,r.revision);return {layers:layers.length,asset};
};
window.complexQA.export=async(id)=>{
  const r=await tugou.open(id),e=new Compositor(),start=performance.now(),progress=[];
  try {
    const bytes=await e.export(r.document,{transparent:true,progress:p=>progress.push(p)});
    const result=await tugou.storeRaster(bytes,'复杂100MP导出');
    const crops=[];
    for(const [x,y] of [[960,960],[1984,960],[8128,1984],[9872,9872]]){
      const c=surface(1,1);await e.render(r.document,c,{x,y,width:128,height:128,transparent:true});
      crops.push({x,y,bytes:[...await pngBytes(c)]});c.width=c.height=1;
    }
    return {result,crops,elapsedMs:performance.now()-start,tiles:progress.length};
  } finally {e.dispose();}
};
window.complexQA.largeSources=async(id)=>{
  const r=await tugou.open(id),assets=[],layers=[...r.document.layers];
  for(let i=0;i<layers.length;i++)if(layers[i].kind==='image'){
    const tile=surface(2048,2048),ctx=tile.getContext('2d');
    ctx.fillStyle=`hsl(${assets.length*43},55%,55%)`;ctx.fillRect(0,0,2048,2048);ctx.clearRect(512,512,512,512);
    const asset=await tugou.storeRaster(await pngBytes(tile),'独立4MP原图'+assets.length);tile.width=tile.height=1;
    assets.push(asset);layers[i]={...layers[i],assetId:asset.id};
  }
  await tugou.save(id,{...r.document,assets,layers},r.revision);
  return {count:assets.length,unique:new Set(assets.map(a=>a.resource)).size,totalPixels:assets.reduce((n,a)=>n+a.width*a.height,0)};
};
window.complexQA.cancel=async(id)=>{
  const r=await tugou.open(id),e=new Compositor(),controller=new AbortController();let cancelled=false,progress=0;
  try {await e.export(r.document,{signal:controller.signal,progress:p=>{progress=p;if(p>=.02)controller.abort()}})}catch(error){cancelled=error.name==='AbortError'}finally{e.dispose()}
  return {cancelled,progress};
};
