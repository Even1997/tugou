const {findBuiltinFont}=require('./builtin-fonts.cjs');
const labels={100:'极细',200:'特细',250:'特细',300:'细体',350:'次细',400:'常规',500:'中等',600:'半粗',700:'粗体',800:'特粗',900:'超粗'};
function requestedWeight(layer){return layer.fontWeight??(layer.fontStyle?.includes('bold')?700:400);}
function legacyBold(layer){return layer.fontWeight===undefined&&!!layer.fontStyle?.includes('bold');}
function fontFaces(font){return [{...font,weight:font.weight||400},...(font.variants||[])];}
function nearestWeight(weights,value){return [...weights].sort((a,b)=>Math.abs(a-value)-Math.abs(b-value)||a-b)[0]||400;}
function builtinFace(layer){
  const font=!layer.fontResource&&findBuiltinFont(layer.fontFamily);
  if(!font)return;
  if(legacyBold(layer))return {...font,weight:font.weight||400};
  const faces=fontFaces(font),weight=nearestWeight(faces.map(f=>f.weight),requestedWeight(layer));
  return faces.find(f=>f.weight===weight);
}
function textFontWeight(layer){return legacyBold(layer)?700:builtinFace(layer)?.weight??requestedWeight(layer);}
function weightLabel(weight){return `${labels[weight]||'字重'} · ${weight}`;}
module.exports={requestedWeight,legacyBold,fontFaces,nearestWeight,builtinFace,textFontWeight,weightLabel};
