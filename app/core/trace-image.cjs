const {validatePaths}=require('./vector-path.cjs');
function traceImage({width,height,data},threshold=128){
  if(!Number.isInteger(threshold)||threshold<1||threshold>254||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width*height>1048576||data.length!==width*height*4)throw Error('描摹图像或阈值无效');
  for(let i=0;i<data.length;i+=4){
    const lum=.2126*data[i]+.7152*data[i+1]+.0722*data[i+2],alpha=data[i+3]/255;
    const tone=lum*alpha+255*(1-alpha)<threshold?0:255;
    data[i]=data[i+1]=data[i+2]=tone;data[i+3]=255;
  }
  const result=require('imagetracerjs').imagedataToTracedata({width,height,data},{pal:[{r:0,g:0,b:0,a:255},{r:255,g:255,b:255,a:255}],colorquantcycles:1,pathomit:4,ltres:1,qtres:1});
  const paths=result.layers[0].filter(p=>p.segments.length>=2).map(({segments})=>{
    const nodes=segments.map(s=>({x:s.x1/width,y:s.y1/height}));
    for(let i=0;i<segments.length;i++){
      const s=segments[i];if(s.type!=='Q')continue;
      const a=nodes[i],b=nodes[(i+1)%nodes.length],qx=s.x2/width,qy=s.y2/height;
      a.out=[(a.x+2*qx)/3,(a.y+2*qy)/3];b.in=[(b.x+2*qx)/3,(b.y+2*qy)/3];
    }
    return {closed:true,nodes};
  });
  if(!paths.length)throw Error('没有找到深色轮廓，请调整阈值');
  validatePaths(paths);return paths;
}
module.exports={traceImage};
