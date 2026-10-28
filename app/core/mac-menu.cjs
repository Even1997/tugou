const {bindings,accelerator}=require('./shortcuts.cjs');
function editMenu(shortcuts,send){
  const keys=bindings('darwin',shortcuts);
  return [['undo','撤销',accelerator(keys.undo)],['redo','重做',accelerator(keys.redo)],['cut','剪切','Cmd+X'],['copy','复制','Cmd+C'],['paste','粘贴','Cmd+V'],['selectAll','全选','Cmd+A']].map(([command,label,accelerator])=>({label,accelerator,click:()=>send(command)}));
}
module.exports={editMenu};
