const fs=require('node:fs/promises');
const PptxGenJS=require('pptxgenjs');
const {sizes,validate,presentationFont,rectangleRadii,rectangleOutline,presentationLineEndpoints}=require('./presentations.cjs');
const {textFontWeight}=require('./font-weights.cjs');
const {safePath,resourcePattern,hash}=require('./storage.cjs');
const {applyPresentationEffects}=require('./presentation-effects.cjs');
async function exportPresentation(deck,assets,root){
  validate([deck],assets);
  const pptx=new PptxGenJS(),[width,height]=sizes[deck.ratio];
  pptx.defineLayout({name:'TUGOU',width:width/96,height:height/96});pptx.layout='TUGOU';pptx.author='Tugou';pptx.subject='土狗演示文稿';pptx.title=deck.name;pptx.lang='zh-CN';
  const images=new Map();let total=0,totalPixels=0;
  for(const source of deck.slides){const s=pptx.addSlide();s.background={color:source.background.slice(1)};
    for(const e of source.elements){if(e.visible===false)continue;const box={x:e.x/96,y:e.y/96,w:e.w/96,h:e.h/96,rotate:e.rotation};
      if(e.kind==='text')s.addText(require('./rich-text.cjs').styledRuns(e).map(r=>({text:r.text,options:{fontFace:r.fontFamily,fontSize:r.fontSize*.75,bold:r.fontWeight>=600,italic:r.italic,color:r.color.slice(1)}})),{...box,fontFace:e.fontFamily,fontSize:e.fontSize*.75,bold:textFontWeight(presentationFont(e))>=600,italic:e.italic,color:e.color.slice(1),align:e.align,valign:'top',margin:0,breakLine:false,paraSpaceAfter:0});
      else if(e.kind==='line'){
        const [a,b]=presentationLineEndpoints(e);
        s.addShape(pptx.ShapeType.line,{x:Math.min(a.x,b.x)/96,y:Math.min(a.y,b.y)/96,w:Math.abs(b.x-a.x)/96,h:Math.abs(b.y-a.y)/96,flipH:b.x<a.x,flipV:b.y<a.y,line:{color:e.stroke.slice(1),width:e.strokeWidth*.75}});
      }
      else if(e.kind==='image'){
        let data=images.get(e.assetId);
        if(!data){const asset=assets.find(a=>a.id===e.assetId);if(!resourcePattern.test(asset.resource||'')||!(/\.(png|jpe?g|webp|gif)$/i.test(asset.resource)))throw Error('请使用已保存到素材库的图片');
          const file=await safePath(root,'resources',asset.resource),stat=await fs.stat(file);total+=stat.size;if(total>128*1024*1024)throw Error('PPT 图片总量超过 128 MiB，请压缩图片');const bytes=await fs.readFile(file);
          if(hash(bytes)!==asset.resource.split('.')[0])throw Error('PPT 图片校验失败，请重新导入');
          const metadata=await require('sharp')(bytes,{limitInputPixels:40000000}).metadata();if(totalPixels+metadata.width*metadata.height>64000000)throw Error('PPT 图片累计超过 6400 万像素，请缩小图片后导出');
          const {data:png,info}=await require('sharp')(bytes,{limitInputPixels:40000000}).png().toBuffer({resolveWithObject:true});data={src:'data:image/png;base64,'+png.toString('base64'),w:info.width,h:info.height};images.set(e.assetId,data);
        }
        totalPixels+=data.w*data.h;if(totalPixels>64000000)throw Error('PPT 图片累计超过 6400 万像素，请缩小图片后导出');
        const scale=Math.min(e.w/data.w,e.h/data.h),w=data.w*scale/96,h=data.h*scale/96;
        s.addImage({data:data.src,x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,w,h,rotate:e.rotation});
      }else{const radii=rectangleRadii(e),radius=radii[0],independent=!radii.every(r=>r===radius);
        const points=independent?rectangleOutline(e).map(p=>p.close?{close:true}:{x:p.x/96,y:p.y/96,...(p.moveTo?{moveTo:true}:p.r?{curve:{type:'arc',wR:p.r/96,hR:p.r/96,stAng:p.angle,swAng:90}}:{})}):undefined;
        s.addShape(e.kind==='ellipse'?pptx.ShapeType.ellipse:independent?pptx.ShapeType.custGeom:radius?pptx.ShapeType.roundRect:pptx.ShapeType.rect,{...box,points,rectRadius:radius/96,fill:{color:e.fill.slice(1)},line:{transparency:100}});}
    }
    if(source.notes)s.addNotes(source.notes);
  }
  return applyPresentationEffects(Buffer.from(await pptx.write({outputType:'nodebuffer',compression:true})),deck,images);
}
module.exports={exportPresentation};
