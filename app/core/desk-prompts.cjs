const {inputsOf}=require('./workflow-nodes.cjs');

// Prepare the opened document in memory; the original project is only changed on Save.
function extractDeskPrompts(document){
  const graph=document.tugouCanvas;
  if(!graph?.nodes.some(n=>n.type==='config'&&n.data.prompt))return document;
  const nodes=[...graph.nodes],edges=[...graph.edges];
  for(const node of graph.nodes){
    if(node.type!=='config'||!node.data.prompt)continue;
    const id=crypto.randomUUID(),position={...node.position};
    let parent=graph.nodes.find(n=>n.id===node.parentId);
    while(parent){position.x+=parent.position.x;position.y+=parent.position.y;parent=graph.nodes.find(n=>n.id===parent.parentId);}
    position.x-=360;
    let collision;
    while((collision=nodes.find(n=>!n.parentId&&position.x<(n.position.x+(n.width||400)+24)&&position.x+300+24>n.position.x&&position.y<(n.position.y+(n.height||400)+24)&&position.y+400+24>n.position.y)))position.y=collision.position.y+(collision.height||400)+48;
    nodes.push({id,type:'text',position,data:{name:'生成要求',text:node.data.prompt}});
    edges.push({id:crypto.randomUUID(),source:id,target:node.id});
    const inputOrder=[...inputsOf(graph,node).map(e=>e.source),id];
    // Existing mention templates retain their substitution semantics in their visible text node.
    const template=/@\[node:[^\]]+\]/.test(node.data.prompt);
    nodes[nodes.findIndex(n=>n.id===node.id)]={...node,data:{...node.data,prompt:'',inputOrder,...(template?{promptNodeId:id}:{})}};
  }
  return {...document,tugouCanvas:{...graph,nodes,edges}};
}
module.exports={extractDeskPrompts};
