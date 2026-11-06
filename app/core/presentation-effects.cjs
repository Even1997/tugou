const JSZip=require('jszip');
const {DOMParser,XMLSerializer}=require('@xmldom/xmldom');
const drawing='http://schemas.openxmlformats.org/drawingml/2006/main';
const presentation='http://schemas.openxmlformats.org/presentationml/2006/main';
const activeEffects=e=>(e.effects||[]).filter(f=>f.enabled&&f.opacity>0&&(f.type!=='stroke'||f.size>0));

// PptxGenJS accepts only one shadow. Add the DrawingML effect list through an XML DOM
// so inner and outer shadows coexist without flattening editable elements.
async function applyPresentationEffects(bytes,deck,imageSizes){
  if(!deck.slides.some(s=>s.elements.some(e=>e.visible!==false&&activeEffects(e).length)))return bytes;
  const zip=await JSZip.loadAsync(bytes);
  for(const [index,slide] of deck.slides.entries()){
    const elements=slide.elements.filter(e=>e.visible!==false);
    if(!elements.some(e=>activeEffects(e).length))continue;
    const name=`ppt/slides/slide${index+1}.xml`,doc=new DOMParser().parseFromString(await zip.file(name).async('string'),'application/xml');
    const tree=doc.getElementsByTagNameNS(presentation,'spTree')[0];
    const shapes=Array.from(tree.childNodes).filter(n=>n.namespaceURI===presentation&&['sp','pic'].includes(n.localName));
    if(shapes.length!==elements.length)throw Error('PPT 样式导出元素数量不一致');
    const node=(tag,attrs={})=>{const n=doc.createElementNS(drawing,`a:${tag}`);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
    const child=(parent,tag)=>Array.from(parent.childNodes).find(n=>n.namespaceURI===drawing&&n.localName===tag);
    const remove=(parent,tag)=>{const n=child(parent,tag);if(n)parent.removeChild(n);};
    const color=(hex,opacity)=>{const n=node('srgbClr',{val:hex.slice(1)});n.appendChild(node('alpha',{val:Math.round(opacity*1000)}));return n;};
    for(const [i,e] of elements.entries()){
      const effects=activeEffects(e);if(!effects.length)continue;
      const shape=shapes[i],props=shape.getElementsByTagNameNS(presentation,'spPr')[0];
      // Keep a picture's element box (and rotation centre), fitting its pixels inside
      // the fill rectangle. This makes image borders match the editor's outer frame.
      if(e.kind==='image'){
        const image=imageSizes.get(e.assetId),scale=Math.min(e.w/image.w,e.h/image.h);
        const xfrm=child(props,'xfrm'),off=child(xfrm,'off'),ext=child(xfrm,'ext');
        off.setAttribute('x',Math.round(e.x*9525));off.setAttribute('y',Math.round(e.y*9525));ext.setAttribute('cx',Math.round(e.w*9525));ext.setAttribute('cy',Math.round(e.h*9525));
        const fill=shape.getElementsByTagNameNS(drawing,'fillRect')[0],x=Math.round((1-image.w*scale/e.w)*50000),y=Math.round((1-image.h*scale/e.h)*50000);
        for(const [key,v] of Object.entries({l:x,r:x,t:y,b:y}))fill.setAttribute(key,v);
      }
      remove(props,'effectLst');
      const border=effects.find(f=>f.type==='stroke');
      if(border){remove(props,'ln');const line=node('ln',{w:Math.round(border.size*9525),algn:'ctr'}),fill=node('solidFill');fill.appendChild(color(border.color,border.opacity));line.appendChild(fill);props.appendChild(line);}
      const shadows=effects.filter(f=>f.type!=='stroke').sort((a,b)=>a.type==='innerShadow'?-1:b.type==='innerShadow'?1:0);
      if(shadows.length){const list=node('effectLst');for(const f of shadows){const n=node(f.type==='shadow'?'outerShdw':'innerShdw',{blurRad:Math.round(f.radius*9525),dist:Math.round(f.distance*9525),dir:Math.round(((f.angle+360)%360)*60000),...(f.type==='shadow'?{rotWithShape:1}:{})});n.appendChild(color(f.color,f.opacity));list.appendChild(n);}props.appendChild(list);}
    }
    zip.file(name,new XMLSerializer().serializeToString(doc));
  }
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
module.exports={applyPresentationEffects,activeEffects};
