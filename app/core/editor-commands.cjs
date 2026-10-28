function deleteTarget({selection,mask,hasMask}) {
  return selection ? 'selection' : mask ? (hasMask ? 'mask' : 'none') : 'layers';
}
function editorShortcut(e,platform) {
  const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  if(e.altKey)return null;
  if(key==='delete'||(platform==='darwin'&&key==='backspace'))return 'delete';
  if(mod&&key==='d'&&!e.shiftKey)return 'deselect';
  if(mod&&key==='i'&&e.shiftKey)return 'inverse';
  if(mod&&key==='j'&&!e.shiftKey)return 'duplicate';
  if(!mod&&key==='x')return 'swapMaskInk';
  return null;
}
module.exports={deleteTarget,editorShortcut};
