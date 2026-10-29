const {nodeWidth}=require('./workflow-nodes.cjs');
const width=n=>Math.max(n.width||0,n.measured?.width||0,Number(n.style?.width)||0)||nodeWidth(n.type);
const height=n=>Math.max(n.height||0,n.measured?.height||0,Number(n.style?.height)||0)||400;

function groupNodes(nodes,ids){
  const selected=nodes.filter(n=>ids.includes(n.id));
  if(selected.length<2||selected.some(n=>n.type==='group'||n.parentId))throw Error('请选择至少两个未分组的节点');
  const x=Math.min(...selected.map(n=>n.position.x))-24,y=Math.min(...selected.map(n=>n.position.y))-48;
  const w=Math.ceil(Math.max(...selected.map(n=>n.position.x+width(n)))-x+24),h=Math.ceil(Math.max(...selected.map(n=>n.position.y+height(n)))-y+24);
  const id=crypto.randomUUID(),group={id,type:'group',position:{x,y},data:{name:'分组'},width:w,height:h,style:{width:w,height:h}};
  return [group,...nodes.map(n=>ids.includes(n.id)?{...n,parentId:id,position:{x:n.position.x-x,y:n.position.y-y}}:n)];
}
function fitGroups(nodes){
  const children=new Map(),updates=new Map();
  for(const n of nodes)if(n.parentId){if(!children.has(n.parentId))children.set(n.parentId,[]);children.get(n.parentId).push(n);}
  for(const group of nodes){
    const members=children.get(group.id);if(group.type!=='group'||!members?.length)continue;
    const dx=Math.floor(Math.min(...members.map(n=>n.position.x))-24),dy=Math.floor(Math.min(...members.map(n=>n.position.y))-48);
    const w=Math.ceil(Math.max(...members.map(n=>n.position.x+width(n)+24))-dx),h=Math.ceil(Math.max(...members.map(n=>n.position.y+height(n)+24))-dy);
    if(!dx&&!dy&&w===group.width&&h===group.height)continue;
    updates.set(group.id,{...group,position:{x:group.position.x+dx,y:group.position.y+dy},width:w,height:h,style:{...group.style,width:w,height:h}});
    // Moving the frame's origin must not move its contents in world coordinates.
    if(dx||dy)for(const n of members)updates.set(n.id,{...n,position:{x:n.position.x-dx,y:n.position.y-dy}});
  }
  return updates.size?nodes.map(n=>updates.get(n.id)||n):nodes;
}
function ungroupNodes(nodes,id){const group=nodes.find(n=>n.id===id&&n.type==='group');if(!group)throw Error('请选择分组');return nodes.filter(n=>n.id!==id).map(n=>{if(n.parentId!==id)return n;const {parentId,...child}=n;return {...child,position:{x:child.position.x+group.position.x,y:child.position.y+group.position.y}};});}
module.exports={groupNodes,ungroupNodes,fitGroups};
