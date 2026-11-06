const sharp=require('sharp');
const {readPsd,writePsdBuffer,initializeCanvas}=require('ag-psd');
const {MAX_PIXELS,MAX_BYTES,MAX_LAYERS,blends,dimensions,header}=require('./psd-format.cjs');
initializeCanvas(()=>{throw Error('PSD 内容需要不支持的画布转换');},(width,height)=>({width,height,data:new Uint8ClampedArray(width*height*4)}));
const png=async data=>sharp(Buffer.from(data.data.buffer,data.data.byteOffset,data.data.byteLength),{raw:{width:data.width,height:data.height,channels:4}}).png().toBuffer();
async function decode(bytes,merged=false){
  bytes=Buffer.from(bytes);const size=header(bytes);
  const psd=readPsd(bytes,{useImageData:true,skipThumbnail:true,skipLinkedFilesData:true,skipCompositeImageData:!merged,skipLayerImageData:merged,throwForMissingFeatures:!merged,totalMemoryLimit:MAX_PIXELS*8});
  const warnings=[];
  if(psd.imageResources?.iccProfile)warnings.push('内嵌 ICC 配置未转换，颜色按 sRGB 解释，可能与 Photoshop 不同');
  if(merged){
    if(!psd.imageData||psd.imageResources?.versionInfo?.hasRealMergedData===false)throw Error('PSD 没有可用的合并预览，请在 Photoshop 中启用最大兼容性后另存');
    return {...size,warnings:[...warnings,'仅导入文件中保存的合并预览，不保留图层；预览可能不是最新编辑结果'],layers:[{name:'合并预览',x:0,y:0,...size,bytes:await png(psd.imageData)}]};
  }
  let pixels=size.width*size.height,count=0;const layers=[];
  const ordinary=items=>(items||[]).every(l=>!l.clipping&&!l.adjustment&&(!l.blendMode||['normal','pass through'].includes(l.blendMode))&&(!l.children||ordinary(l.children)));
  async function visit(items,parent){
    for(const l of items||[]){
      if(++count>MAX_LAYERS)throw Error('PSD 最多支持 128 个图层（含分组）');
      const name=String(l.name||'图层').slice(0,256),fail=reason=>{throw Error(`“${name}”包含${reason}，暂不能可靠分层导入。可选择“合并预览”，或先在 Photoshop 中栅格化该内容。`);};
      if(l.artboard)fail('Photoshop 原生画板裁切');
      if(l.adjustment||l.vectorMask||l.vectorFill||l.vectorStroke||l.mask||l.realMask||l.effects||l.clipping||l.knockout||l.filterEffectsMasks)fail('调整、蒙版、特效或剪贴关系');
      if(l.fillOpacity!==undefined&&l.fillOpacity!==1)fail('填充不透明度');
      if(l.blendingRanges){
        const r=l.blendingRanges,channels=[r.compositeGrayBlendSource,r.compositeGraphBlendDestinationRange,...r.ranges.flatMap(c=>[c.sourceRange,c.destRange])];
        if(channels.some(c=>JSON.stringify(c)!=='[0,0,255,255]'))fail('混合颜色带');
      }
      let blend=blends[l.blendMode||'normal'];
      if(l.blendMode==='pass through'&&l.children&&ordinary(l.children)&&(l.opacity??1)===1)blend='source-over';
      if(!blend)fail(`不支持的混合模式 ${l.blendMode}`);
      const common={name,parent,opacity:l.opacity??1,visible:!l.hidden,blend};
      if(l.children){const index=layers.length;layers.push({...common,kind:'group',x:0,y:0,...size});await visit(l.children,index);}
      else {
        if(l.text||l.placedLayer)warnings.push(`“${name}”使用已保存的像素，文字或智能对象转为图片`);
        const data=l.imageData;
        if(!data){
          if((l.right||0)!==(l.left||0)&&(l.bottom||0)!==(l.top||0))fail('缺少像素的图层');
          layers.push({...common,x:l.left||0,y:l.top||0,width:1,height:1,bytes:await png({width:1,height:1,data:new Uint8ClampedArray(4)})});continue;
        }
        dimensions(data.width,data.height);pixels+=data.width*data.height;
        if(pixels>MAX_PIXELS)throw Error('PSD 画板及图层解码合计超过 3200 万像素，请减少图层或尺寸');
        layers.push({...common,x:l.left||0,y:l.top||0,width:data.width,height:data.height,bytes:await png(data)});
      }
    }
  }
  await visit(psd.children);
  if(!layers.length)throw Error('此 PSD 没有独立图层，请选择“合并预览”导入');
  return {...size,warnings:[...new Set(warnings)],layers};
}
async function encode(input){
  const {width,height,layers,composite}=input;dimensions(width,height);
  if(!Array.isArray(layers)||!layers.length||layers.length>MAX_LAYERS||width*height*(layers.length+1)>MAX_PIXELS)throw Error('PSD 图层与合并预览合计最多 3200 万像素、128 层，请减少尺寸或使用合并导出');
  if([composite,...layers.map(l=>l.bytes)].reduce((n,b)=>n+(b?.byteLength||0),0)>MAX_BYTES)throw Error('PSD 输入图片合计不能超过 128 MiB');
  const raster=async bytes=>{
    const image=sharp(Buffer.from(bytes),{limitInputPixels:MAX_PIXELS});const meta=await image.metadata();
    if(meta.format!=='png'||meta.width!==width||meta.height!==height)throw Error('PSD 图层必须是与画板同尺寸的 PNG');
    const data=await image.ensureAlpha().raw().toBuffer();return {width,height,data:new Uint8ClampedArray(data.buffer,data.byteOffset,data.byteLength)};
  };
  const children=[];
  for(const l of layers){
    if(!Object.hasOwn(blends,l.blendMode)||!Number.isFinite(l.opacity)||l.opacity<0||l.opacity>1||typeof l.name!=='string'||l.name.length>256)throw Error('PSD 图层参数无效');
    children.push({name:l.name,opacity:l.opacity,hidden:l.hidden===true,blendMode:l.blendMode,top:0,left:0,imageData:await raster(l.bytes)});
  }
  const bytes=writePsdBuffer({width,height,children,imageData:await raster(composite)},{generateThumbnail:false,trimImageData:true,noBackground:true});
  if(bytes.length>MAX_BYTES)throw Error('PSD 输出超过 128 MiB，请减少尺寸或图层');
  return bytes;
}
module.exports={decode,encode};
