function deleteTarget({selection,mask,hasMask}) {
  return selection ? 'selection' : mask ? (hasMask ? 'mask' : 'none') : 'layers';
}
function editorShortcut(e,platform,settings) {
  const command=require('./shortcuts.cjs').commandFor(e,platform,settings);
  return ['delete','deselect','inverse','duplicate','swapMaskInk'].includes(command)?command:null;
}
module.exports={deleteTarget,editorShortcut};
