const sharp=require('sharp');
const MAX_FRAMES=240,MAX_PIXELS=64*1024*1024;
function limits(width,height,count){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096||!Number.isInteger(count)||count<1||count>MAX_FRAMES||width*height*count>MAX_PIXELS)throw Error('GIF 支持单边 4096 像素、最多 240 帧，全部帧合计不超过 6400 万像素，请减少帧数或尺寸');
}
async function inspectGif(bytes){
  const m=await sharp(bytes,{animated:true,limitInputPixels:MAX_PIXELS}).metadata();
  if(m.format!=='gif')throw Error('不是有效的 GIF 图片');
  const count=m.pages||1,height=m.pageHeight||m.height;limits(m.width,height,count);
  // Decode once on import to reject truncated frames before publishing the resource.
  await sharp(bytes,{animated:true,limitInputPixels:MAX_PIXELS}).stats();
  return {width:m.width,height,gif:{frames:count,delays:Array.from({length:count},(_,i)=>Math.max(20,m.delay?.[i]||100)),loop:m.loop??1}};
}
async function encodeGif(frames,{width,height,delays,loop=0}={}){
  if(!Array.isArray(frames))throw Error('请选择图片帧');
  limits(width,height,frames.length);
  if(!Array.isArray(delays)||delays.length!==frames.length||delays.some(n=>!Number.isInteger(n)||n<10||n>655350||n%10)||![0,1].includes(loop))throw Error('帧时长须为 10–655350 毫秒且为 10 的倍数，循环可选无限或一次');
  if(frames.reduce((n,b)=>n+(b?.length||0),0)>128*1024*1024)throw Error('图片帧文件合计不能超过 128 MiB');
  const pixels=Buffer.alloc(width*height*frames.length*4);
  for(let i=0;i<frames.length;i++){
    const raw=await sharp(frames[i],{limitInputPixels:100000000}).rotate().resize(width,height,{fit:'contain',background:'#00000000'}).ensureAlpha().raw().toBuffer();
    raw.copy(pixels,i*width*height*4);
  }
  return sharp(pixels,{raw:{width,height:height*frames.length,channels:4,pageHeight:height}}).gif({loop,delay:delays,effort:3}).toBuffer();
}
module.exports={inspectGif,encodeGif,limits};
