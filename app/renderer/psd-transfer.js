import {Compositor} from './composite.js';
import {descendants} from '../core/layers.cjs';
import {MAX_PIXELS,MAX_LAYERS,blends,dimensions} from '../core/psd-format.cjs';
export async function renderPsd(document,merged,signal,progress){
  dimensions(document.width,document.height);
  const roots=document.layers.filter(l=>!l.parentId),lookup=Object.fromEntries(Object.entries(blends).map(([a,b])=>[b,a]));
  if(!merged&&roots.some(l=>l.kind==='adjustment'||l.clipping||l.maskSourceId||!lookup[l.blend||'source-over']))throw Error('此画板含跨图层调整、剪贴、关联蒙版或不兼容混合模式，请选择“合并 PSD”或先合并相关图层');
  const count=merged?1:roots.length+(document.background==='transparent'?0:1);
  if(!count)throw Error('画板没有可导出的图层');
  if(count>MAX_LAYERS||document.width*document.height*(count+1)>MAX_PIXELS)throw Error('PSD 图层与预览合计最多 3200 万像素，请缩小画板或选择“合并 PSD”');
  const engine=new Compositor(),layers=[];
  const render=doc=>engine.export(doc,{signal,time:0,progress:part=>progress((layers.length+part)/(count+1))});
  try{
    if(!merged){
      if(document.background!=='transparent')layers.push({name:'画板背景',blendMode:'normal',opacity:1,hidden:false,bytes:await render({...document,layers:[]})});
      for(const root of roots){
        signal.throwIfAborted();const ids=descendants(document.layers,[root.id]);
        if(document.layers.some(l=>ids.has(l.id)&&l.maskSourceId&&!ids.has(l.maskSourceId)))throw Error('分组引用了外部蒙版，请选择“合并 PSD”或先合并相关图层');
        const slice={...document,background:'transparent',layers:document.layers.filter(l=>ids.has(l.id)).map(l=>l.id===root.id?{...l,visible:true,opacity:1,blend:'source-over'}:l)};
        layers.push({name:root.name.slice(0,256),blendMode:lookup[root.blend||'source-over'],opacity:root.opacity,hidden:root.visible===false,bytes:await render(slice)});
      }
    }
    const composite=await render(document);
    if(merged)layers.push({name:document.name.slice(0,256),blendMode:'normal',opacity:1,hidden:false,bytes:composite});
    return {width:document.width,height:document.height,layers,composite};
  }finally{engine.dispose();}
}
