// AppKit is available on macOS without Python, Xcode or a shell startup profile.
const script=`ObjC.import('AppKit');
var manager=$.NSFontManager.sharedFontManager;
var families=ObjC.deepUnwrap(manager.availableFontFamilies);
JSON.stringify(families.filter(function(f){return f.charAt(0)!=='.';}).map(function(family){
  var aliases=[family],weights=[];
  var members=ObjC.deepUnwrap(manager.availableMembersOfFontFamily(family))||[];
  members.forEach(function(member){
    var font=$.NSFont.fontWithNameSize(member[0],12);
    if(!font)return;
    aliases.push(member[0],ObjC.unwrap(font.displayName));
    if(member[3]&1)return;
    var traits=font.fontDescriptor.objectForKey($.NSFontTraitsAttribute);
    var weight=ObjC.unwrap(traits.objectForKey($.NSFontWeightTrait));
    if(typeof weight==='number')weights.push(weight);
  });
  return {family:family,name:family,aliases:aliases,traits:weights};
}));`;
// AppKit normalized weights -> CSS named weights, as used for native font matching.
const weights=[[-.8,100],[-.6,200],[-.4,300],[0,400],[.23,500],[.3,600],[.4,700],[.56,800],[.62,900]];
function macFonts(items){
  if(!Array.isArray(items))throw Error('本机字体数据无效');
  return items.map(item=>({...item,weights:(item.traits?.length?item.traits:[0]).filter(Number.isFinite).map(value=>weights.reduce((best,next)=>Math.abs(next[0]-value)<Math.abs(best[0]-value)?next:best)[1])}));
}
module.exports={script,macFonts};
