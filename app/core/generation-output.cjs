const {nodeWidth}=require('./workflow-nodes.cjs');
const {emptyCanvas}=require('./prompts.cjs');
function absolute(node,nodes){
  let x=node?.position.x||0,y=node?.position.y||0,parent=node?.parentId;
  const seen=new Set();while(parent&&!seen.has(parent)){seen.add(parent);const p=nodes.find(n=>n.id===parent);if(!p)break;x+=p.position.x;y+=p.position.y;parent=p.parentId;}
  return {x,y};
}
function outputPosition(nodes,source){
  const origin=absolute(source,nodes),position={x:origin.x+(source?.width||nodeWidth(source?.type))+70,y:origin.y};
  const occupied=nodes.filter(n=>n.type!=='group').map(n=>({...absolute(n,nodes),width:n.width||nodeWidth(n.type),height:n.height||600}));
  // Reserve a full image card, so a completed portrait cannot cover the next result.
  for(let i=0;i<=occupied.length;i++){
    const hit=occupied.find(r=>position.x<r.x+r.width+32&&position.x+332>r.x&&position.y<r.y+r.height+32&&position.y+632>r.y);
    if(!hit)break;position.y=hit.y+hit.height+48;
  }
  return position;
}
function outputEdge(edges,source,target){
  if(source&&!edges.some(e=>e.source===source.id&&e.target===target))edges.push({id:`output-${target}`,source:source.id,target});
}
function stageActive(document,tasks){
  const graph=document.tugouCanvas||emptyCanvas(),reserved=new Set(document.generationOutputNodeIds||[]),received=new Set(document.generationResultIds||[]);
  const nodes=[...graph.nodes],edges=[...graph.edges];let changed=false;
  for(const task of tasks){
    if(task.context?.kind!=='workflow'||received.has(task.id)||reserved.has(`result-${task.id}-0`))continue;
    if(!task.context.outputNodes&&!['queued','running'].includes(task.status))continue;
    const source=nodes.find(n=>n.id===task.context.nodeId);if(!source)continue;
    const count=task.context.mode==='image'?Math.max(1,Math.min(15,Number(task.context.count)||1)):1;
    for(let index=0;index<count;index++){
      const id=`result-${task.id}-${index}`;reserved.add(id);
      if(!nodes.some(n=>n.id===id))nodes.push({id,type:'asset',position:outputPosition(nodes,source),data:{assetId:'',role:'生成结果',name:`生成结果 · ${index+1}`,generationTaskId:task.id,generationIndex:index,sourceNodeId:source.id}});
      outputEdge(edges,source,id);
    }changed=true;
  }
  return changed?{...document,generationOutputNodeIds:[...reserved],tugouCanvas:{...graph,nodes,edges}}:document;
}
function stageOutputs(document,tasks){const pages=require('./pages.cjs');let next=document;for(const p of pages.list(document,'canvas'))next=pages.withCanvas(next,p.id,d=>stageActive(d,tasks));return next;}
module.exports={stageOutputs,outputPosition,outputEdge};
