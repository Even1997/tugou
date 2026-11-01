// Compare the v0.8.8 compositor with the current engine in native Canvas2D.
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const out=path.resolve('test-results/composite-performance');
fs.mkdirSync(out,{recursive:true});
const baseline=require('node:child_process').execFileSync('git',['show','v0.8.8:app/renderer/composite.js'],{encoding:'utf8'});
const esbuild=require('esbuild');
// esbuild's sync API does not support plugins; a temporary entry keeps imports relative to the renderer.
const oldFile=path.resolve('renderer/.composite-performance-baseline.js');
try{
 fs.writeFileSync(oldFile,baseline);
 for(const [name,module] of [['before','./renderer/.composite-performance-baseline.js'],['after','./renderer/composite.js']])esbuild.buildSync({stdin:{contents:`import {Compositor} from '${module}';import * as Layers from './core/layers.cjs';window.layerQA={Compositor,Layers};`,resolveDir:path.resolve('.')},bundle:true,outfile:path.join(out,name+'.js'),platform:'browser',format:'iife'});
}finally{fs.rmSync(oldFile,{force:true});}
app.setPath('userData',fs.mkdtempSync(path.join(out,'profile-')));
const report={checks:[],errors:[]};
const check=(name,ok)=>{assert.ok(ok,name);report.checks.push(name);console.log('PASS '+name);};
app.whenReady().then(async()=>{
 const w=new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{backgroundThrottling:false}});
 w.webContents.on('console-message',e=>{if(e.level==='error')report.errors.push(e.message);});
 try{
  fs.writeFileSync(path.join(out,'test.html'),'<!doctype html><title>Composite performance</title>');await w.loadFile(path.join(out,'test.html'));
  for(const name of ['before','after'])await w.webContents.executeJavaScript(fs.readFileSync(path.join(out,name+'.js'),'utf8')+`;window.${name}=window.layerQA;void 0;`);
  const result=await w.webContents.executeJavaScript(`(async()=>{
   const L=after.Layers,make=()=>document.createElement('canvas');
   const image=make();image.width=image.height=128;const ink=image.getContext('2d');
   const gradient=ink.createLinearGradient(0,0,128,128);gradient.addColorStop(0,'#e87947');gradient.addColorStop(1,'#3284b688');ink.fillStyle=gradient;ink.fillRect(0,0,128,128);ink.clearRect(30,30,40,40);
   const asset={id:'sample',dataUrl:image.toDataURL(),width:128,height:128};
   const layers=Array.from({length:200},(_,i)=>L.createLayer('image',{id:'i'+i,assetId:asset.id,width:96,height:96,x:(i%20)*66,y:Math.floor(i/20)*78,rotation:i%5===0?13:0}));
   const doc={width:1400,height:900,background:'transparent',layers,assets:[asset]};
   const a=new before.Compositor(),b=new after.Compositor(),ca=make(),cb=make(),cases=[];
   const equal=async(name,d,opts={})=>{await a.render(d,ca,opts);await b.render(d,cb,opts);const pa=ca.getContext('2d').getImageData(0,0,ca.width,ca.height).data,pb=cb.getContext('2d').getImageData(0,0,cb.width,cb.height).data;let pixels=0,max=0;for(let i=0;i<pa.length;i++){const delta=Math.abs(pa[i]-pb[i]);if(delta){pixels++;max=Math.max(max,delta);}}cases.push({name,changedChannels:pixels,maxDelta:max});};
   await equal('200 transparent and rotated images',doc);
   await equal('pan and fractional zoom',doc,{x:113.5,y:71.25,width:1000,height:700,scale:.73});
   const group=L.createLayer('group',{id:'group',width:1400,height:900,opacity:.65});
   await equal('group opacity with transparent images',{...doc,layers:[group,...layers.map(l=>({...l,parentId:'group'}))]});
   await equal('artboard clipping',{...doc,layers:[{...group,opacity:1,artboard:true,clipContent:true,background:'#ffffff',width:700,height:600},...layers.map(l=>({...l,parentId:'group'}))]});
   await equal('mask blend and clipping fallback',{...doc,layers:layers.map((l,i)=>i===0?{...l,mask:{x:0,y:0,width:.5,height:1}}:i===1?{...l,clipping:true}:i===2?{...l,opacity:.5,blend:'multiply'}:l)});
   const override=new Map([['i0',image]]);await equal('painting preview override',doc,{overrides:override});
   const cachedA=await createImageBitmap(image),cachedB=await createImageBitmap(image);for(const bitmap of [cachedA,cachedB])Object.assign(bitmap,{naturalWidth:bitmap.width,naturalHeight:bitmap.height});a.prime(asset,cachedA);b.prime(asset,cachedB);await equal('cached bitmap after painting',doc);a.images.clear();b.images.clear();cachedA.close();cachedB.close();
   const outside={...doc,layers:layers.map(l=>({...l,x:l.x+10000}))};await equal('offscreen images',outside);
   const exportedA=await a.export(doc),exportedB=await b.export(doc);const ea=await createImageBitmap(new Blob([exportedA],{type:'image/png'})),eb=await createImageBitmap(new Blob([exportedB],{type:'image/png'}));ca.width=cb.width=ea.width;ca.height=cb.height=ea.height;ca.getContext('2d').drawImage(ea,0,0);cb.getContext('2d').drawImage(eb,0,0);const exportEqual=ca.toDataURL()===cb.toDataURL();ea.close();eb.close();
   const timing=async(engine,target)=>{let canvases=0,pixels=0;const original=document.createElement;document.createElement=function(tag,...args){const c=original.call(this,tag,...args);if(tag==='canvas'){canvases++;const get=c.getContext;let counted=false;c.getContext=function(...args){if(!counted){pixels+=c.width*c.height;counted=true;}return get.apply(this,args);};}return c};const ms=[];try{for(let i=0;i<9;i++){const start=performance.now();await engine.render(doc,target,{x:i*3,y:i*2,width:1400,height:900,scale:.8+i*.01});ms.push(performance.now()-start);}}finally{document.createElement=original;}ms.sort((a,b)=>a-b);return {medianMs:ms[4],maxMs:ms[8],canvases,allocatedPixels:pixels};};
   const timings=[];for(let round=0;round<2;round++)timings.push({before:await timing(a,ca),after:await timing(b,cb)});
   const abort=new AbortController();abort.abort();let cancelled=false;try{await b.render(doc,cb,{signal:abort.signal});}catch(e){cancelled=e.name==='AbortError';}
   a.dispose();b.dispose();return {cases,exportEqual,timings,cancelled};
  })()`);
  report.result=result;
  for(const c of result.cases)check(c.name+' pixel equivalence',c.changedChannels===0);
  check('export pixel equivalence',result.exportEqual);check('cancelled render rejects',result.cancelled);
  check('temporary canvas pixels reduced',result.timings.every(t=>t.after.allocatedPixels<t.before.allocatedPixels/2));
  check('warm render median improves',result.timings.every(t=>t.after.medianMs<t.before.medianMs));
  check('no renderer errors',report.errors.length===0);
 }catch(e){report.failure=e.stack;console.error(e);}
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));app.exit(report.failure?1:0);
});
setTimeout(()=>app.exit(2),120000);
