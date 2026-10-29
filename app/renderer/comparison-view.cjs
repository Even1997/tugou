function comparisonLayout(source, result) {
  const s=result.toolResult||{}, original={x:0,y:0,width:source.width,height:source.height}, output={x:0,y:0,width:result.width,height:result.height};
  if(['resize','upscale','cloudUpscale'].includes(s.operation)) Object.assign(output,original);
  else if(['extend','cloudExtend'].includes(s.operation)) {
    original.x=s.operation==='extend'&&s.sizeMode!=='size' ? s.padding||0 : s.left||0;
    original.y=s.operation==='extend'&&s.sizeMode!=='size' ? s.padding||0 : s.top||0;
  } else if(s.operation==='crop') {output.x=s.left||0;output.y=s.top||0;}
  else if(s.operation==='rotate') {
    const width=Math.max(source.width,result.width),height=Math.max(source.height,result.height);
    original.x=(width-source.width)/2;original.y=(height-source.height)/2;
    output.x=(width-result.width)/2;output.y=(height-result.height)/2;
  }
  return {original,output,width:Math.max(original.x+original.width,output.x+output.width),height:Math.max(original.y+original.height,output.y+output.height)};
}
function zoomCamera(camera, zoom, x=0, y=0) {
  zoom=Math.max(.01,Math.min(32,zoom));
  return {zoom,x:camera.x+x*(1/camera.zoom-1/zoom),y:camera.y+y*(1/camera.zoom-1/zoom)};
}
module.exports={comparisonLayout,zoomCamera};
