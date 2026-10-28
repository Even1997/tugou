const L=require('../core/layers.cjs');
module.exports=async({js,delay,check,wait,click,set,shot,save,load,report})=>{
  const layers=[L.createLayer('group',{id:'board',artboard:true,name:'画板 1',x:0,y:0,width:1024,height:1536,background:'#ffffff'}),L.createLayer('text',{id:'text',parentId:'board',name:'文字',text:'输入文字',x:155,y:230,width:600,height:160,fontFamily:'Microsoft YaHei',fontSize:48,color:'#000000'})];
  report.id=await js(`(async()=>{const r=await tugou.create('文字边缘验收');await tugou.save(r.id,{...r.document,width:1024,height:1536,layers:${JSON.stringify(layers)}},r.revision);return r.id})()`);await load();await click('移动','.composition-primary-tools button');await js(`document.querySelector('[data-layer-id="text"]').click()`);await delay(150);
  const verify=async name=>{
    await wait('document.querySelector("canvas[aria-label=图层画布]").dataset.rendering==="false"');
    const evidence=await js(`(()=>{const c=document.querySelector('canvas[aria-label="图层画布"]'),r=c.getBoundingClientRect(),p=document.querySelector('.layer-overlay [data-handle="resize"]').parentElement.querySelector('polygon').getBoundingClientRect(),sx=c.width/r.width,sy=c.height/r.height;const x=Math.floor((p.left-r.left)*sx),y=Math.floor((p.top-r.top)*sy),w=Math.ceil(p.width*sx),h=Math.ceil(p.height*sy),d=c.getContext('2d').getImageData(x,y,w,h).data;let ink=0,top=h;for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){const i=(yy*w+xx)*4;if(d[i]<150&&d[i+1]<150&&d[i+2]<150){ink++;top=Math.min(top,yy)}}return {ink,top}})()`);
    report.text??=[];report.text.push({name,...evidence});check(name+' renders text with an unclipped top edge',evidence.ink>50&&evidence.top>=1);
  };
  await verify('default Chinese');await shot('text-default');
  await set('高度',360);await set('图层文字','婚礼请柬\nÁgyp 输入文字');await set('字号',72);await set('文字字形','bold italic');await verify('multiline bold italic');await shot('text-multiline');
  await set('文字对齐','right');await verify('right aligned');await click('切换浅色主题');await shot('text-light');
  await save();await load();await js(`document.querySelector('[data-layer-id="text"]').click()`);await delay(150);await verify('reload');check('saved text settings retained',(await save()).layers.find(l=>l.id==='text').fontSize===72);
};
