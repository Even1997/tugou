function groupNodes(nodes,ids){
  const selected=nodes.filter(n=>ids.includes(n.id));
  if(selected.length<2||selected.some(n=>n.type==='group'||n.parentId))throw Error('请选择至少两个未分组的节点');
  const x=Math.min(...selected.map(n=>n.position.x))-24,y=Math.min(...selected.map(n=>n.position.y))-48;
  const width=Math.max(...selected.map(n=>n.position.x+(n.width||n.measured?.width||230)))-x+24,height=Math.max(...selected.map(n=>n.position.y+(n.height||n.measured?.height||200)))-y+24;
  const id=crypto.randomUUID(),group={id,type:'group',position:{x,y},data:{name:'分组'},width,height,style:{width,height}};
  return [group,...nodes.map(n=>ids.includes(n.id)?{...n,parentId:id,position:{x:n.position.x-x,y:n.position.y-y}}:n)];
}
function ungroupNodes(nodes,id){const group=nodes.find(n=>n.id===id&&n.type==='group');if(!group)throw Error('请选择分组');return nodes.filter(n=>n.id!==id).map(n=>{if(n.parentId!==id)return n;const {parentId,...child}=n;return {...child,position:{x:child.position.x+group.position.x,y:child.position.y+group.position.y}};});}
module.exports={groupNodes,ungroupNodes};
