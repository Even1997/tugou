const faces = new Map();
export function textFontFamily(layer) {
  const resource=layer.fontResource?.resource;
  if(!resource)return layer.fontFamily||'Microsoft YaHei';
  if(!/^[a-f0-9]{64}\.ttf$/.test(resource))throw Error('无效的字体资源');
  return 'Tugou_'+resource.slice(0,64);
}
export async function loadTextFont(layer) {
  if(!layer.fontResource)return;
  const family=textFontFamily(layer);
  if(!faces.has(family)){
    const promise=new FontFace(family,`url("tugou-media://original/${layer.fontResource.resource}")`).load().then(face=>{document.fonts.add(face);return face;}).catch(error=>{faces.delete(family);throw error;});
    faces.set(family,promise);
  }
  await faces.get(family);
}
