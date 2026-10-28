import {findBuiltinFont} from '../core/builtin-fonts.cjs';
import {builtinFace,legacyBold} from '../core/font-weights.cjs';
const faces = new Map();
const fontBudget=64*1024*1024;
function trimFonts(keep){
  let bytes=[...faces.values()].reduce((n,entry)=>n+entry.bytes,0);
  for(const [key,entry] of faces){
    if(bytes<=fontBudget)break;
    if(key===keep||!entry.face)continue;
    document.fonts.delete(entry.face);faces.delete(key);bytes-=entry.bytes;
  }
}
export function textFontFamily(layer) {
  const resource=layer.fontResource?.resource;
  if(!resource){const builtin=findBuiltinFont(layer.fontFamily);return builtin?'Tugou_Builtin_'+builtin.id+(legacyBold(layer)?'_LegacyBold':''):layer.fontFamily||'Microsoft YaHei';}
  if(!/^[a-f0-9]{64}\.ttf$/.test(resource))throw Error('无效的字体资源');
  return 'Tugou_'+resource.slice(0,64);
}
export async function loadTextFont(layer) {
  const builtin=builtinFace(layer);
  if(!layer.fontResource&&!builtin)return;
  const family=textFontFamily(layer);
  const key=family+':'+(builtin?.weight||400);
  if(!faces.has(key)){
    const url=builtin?`tugou-media://builtin-font/${builtin.id}?v=${builtin.sha256}`:`tugou-media://original/${layer.fontResource.resource}`;
    const entry={bytes:builtin?.bytes||32*1024*1024,face:null};
    faces.set(key,entry);trimFonts(key);
    entry.promise=new FontFace(family,`url("${url}")`,{weight:String(builtin?.weight||400)}).load().then(face=>{entry.face=face;document.fonts.add(face);trimFonts(key);return face;}).catch(error=>{faces.delete(key);throw error;});
  }
  const entry=faces.get(key);faces.delete(key);faces.set(key,entry);
  return entry.promise;
}
