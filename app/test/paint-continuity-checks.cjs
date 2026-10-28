const fs=require('node:fs'),path=require('node:path'),L=require('../core/layers.cjs');
module.exports=async({w,js,delay,check,wait,click,set,shot,save,load,key,report})=>{
  const bitmap=await js(`(async()=>{const c=document.createElement('canvas');c.width=c.height=4096;const x=c.getContext('2d'),g=x.createLinearGradient(0,0,4096,4096);g.addColorStop(0,'#315cf5');g.addColorStop(1,'#c6d1ff');x.fillStyle=g;x.fillRect(0,0,4096,4096);const blob=await new Promise(r=>c.toBlob(r));c.width=c.height=1;return tugou.storeRaster(new Uint8Array(await blob.arrayBuffer()),'连续绘画大图')})()`);
  const layers=[L.createLayer('group',{id:'board',artboard:true,name:'画板 1',width:600,height:600,background:'#fff'}),L.createLayer('image',{id:'image',name:'连续测试',parentId:'board',x:80,y:80,width:400,height:400,bitmap})];
  report.id=await js(`(async()=>{const r=await tugou.create('连续绘画补充验收');await tugou.save(r.id,{...r.document,width:600,height:600,layers:${JSON.stringify(layers)}},r.revision);return r.id})()`);await load();await click('选择 连续测试');await click('画笔','.composition-primary-tools button');await set('笔刷大小',100);await set('画笔颜色','#ff0000');await set('硬度',100);
  const screen=async(x,y)=>js(`(()=>{const p=new DOMPoint(${x},${y}).matrixTransform(document.querySelector('.layer-overlay>g').getScreenCTM());return {x:Math.round(p.x),y:Math.round(p.y)}})()`);
  const dot=point=>{w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});};
  // Wait until the real worker owns the bitmap, then cancel through the UI.
  await js(`window.__encoding=false;window.__post=Worker.prototype.postMessage;Worker.prototype.postMessage=function(data,...args){if(data.image)window.__encoding=true;return window.__post.call(this,data,...args)};void 0`);
  const resources=path.join(report.profile,'workspace/resources'),before=fs.readdirSync(resources).length;
  dot(await screen(280,240));await wait('window.__encoding');await key('Escape');await delay(1500);
  check('cancel during encoding leaves image unchanged',(await save()).layers[1].bitmap.resource===bitmap.resource);
  check('cancel during encoding creates no orphan PNG',fs.readdirSync(resources).length===before);
  await js('Worker.prototype.postMessage=window.__post;void 0');
  await click('画笔','.composition-primary-tools button');
  const stageBefore=await js(`document.querySelector('.layer-stage').getBoundingClientRect().top`);
  for(let i=0;i<20;i++){dot(await screen(200,115+i*17));await delay(8);}
  check('queued stroke count is visible while saving',await js('document.body.innerText.includes("笔等待")'));
  check('saving feedback does not move the canvas',await js(`document.querySelector('.layer-stage').getBoundingClientRect().top===${stageBefore}`));
  for(let i=0;i<600&&await js('document.body.innerText.includes("正在保存笔触")');i++)await delay(100);
  const doc=await save();
  const pixels=await js(`(async()=>{const i=new Image();i.crossOrigin='anonymous';i.src='tugou-media://original/'+${JSON.stringify(doc.layers[1].bitmap.resource)};await i.decode();const c=document.createElement('canvas');c.width=c.height=1;const x=c.getContext('2d');return Array.from({length:39},(_,n)=>{x.clearRect(0,0,1,1);x.drawImage(i,Math.round(120*4096/400),Math.round((35+n*8.5)*4096/400),1,1,0,0,1,1);return [...x.getImageData(0,0,1,1).data]})})()`);
  const red=p=>p[0]===255&&p[1]===0&&p[2]===0;
  check('twenty rapid 4K strokes all persist',pixels.filter((_,i)=>i%2===0).every(red));
  check('rapid dots leave untouched gaps between strokes',pixels.filter((_,i)=>i%2===1).every(p=>!red(p)));await shot('twenty-strokes');
  for(let i=0;i<20;i++)await click('撤销');check('twenty undos restore original image',(await save()).layers[1].bitmap.resource===bitmap.resource);
  for(let i=0;i<20;i++)await click('重做');await save();await load();check('twenty redos survive reopen',(await save()).layers[1].bitmap.resource===doc.layers[1].bitmap.resource);
  await click('选择 连续测试');await click('选区','.composition-primary-tools button');await wait('document.querySelector(".subject-status")&&!document.querySelector(".subject-status").textContent.includes("正在检查")');
  report.devicePixelRatio=await js('devicePixelRatio');
  for(const width of [1100,940]){w.setSize(width,800);await delay(250);check(`selection toolbar fits at ${width} and DPR ${report.devicePixelRatio}`,await js(`(()=>{const row=document.querySelector('.layer-parameter-row').getBoundingClientRect();return [...document.querySelectorAll('.selection-actions button,.subject-status')].every(e=>{const r=e.getBoundingClientRect();return r.right<=row.right+1&&r.bottom<=row.bottom+1})})()`));await shot('toolbar-'+width);}
  await click('画笔','.composition-primary-tools button');check('brush options wrap without horizontal clipping',await js(`(()=>{const row=document.querySelector('.layer-parameter-row'),r=row.getBoundingClientRect(),bar=document.querySelector('.composition-breadcrumb').getBoundingClientRect();return row.scrollWidth<=row.clientWidth+1&&r.bottom<=bar.top+1})()`));await shot('brush-compact');
  await click('编辑 连续测试 的蒙版');check('mask ink and brush controls fit narrow toolbar',await js(`(()=>{const row=document.querySelector('.layer-parameter-row');return row.scrollWidth<=row.clientWidth+1})()`));await shot('mask-brush-compact');
  await click('切换浅色主题');await shot('toolbar-light');
};
