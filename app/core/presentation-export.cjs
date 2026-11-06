const fs=require('node:fs/promises');
const PptxGenJS=require('pptxgenjs');
const {sizes,validate,presentationFont}=require('./presentations.cjs');
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
      if(e.kind==='text')s.addText(e.text,{...box,fontFace:e.fontFamily,fontSize:e.fontSize*.75,bold:textFontWeight(presentationFont(e))>=600,italic:e.italic,color:e.color.slice(1),align:e.align,valign:'top',margin:0,breakLine:false,paraSpaceAfter:0});
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
      }else s.addShape(e.kind==='ellipse'?pptx.ShapeType.ellipse:pptx.ShapeType.rect,{...box,fill:{color:e.fill.slice(1)},line:{transparency:100}});
    }
    if(source.notes)s.addNotes(source.notes);
  }
  return applyPresentationEffects(Buffer.from(await pptx.write({outputType:'nodebuffer',compression:true})),deck,images);
}
module.exports={exportPresentation};
