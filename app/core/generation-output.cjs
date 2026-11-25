const {nodeWidth}=require('./workflow-nodes.cjs');
const {emptyCanvas}=require('./prompts.cjs');

const OUTPUT_GAP_X=108,CARD_W=300,GRID_GAP_X=32,GRID_GAP_Y=32,CLEAR_X=28,CLEAR_Y=32;

function absolute(node,nodes){
  let x=node?.position.x||0,y=node?.position.y||0,parent=node?.parentId;
  const seen=new Set();while(parent&&!seen.has(parent)){seen.add(parent);const p=nodes.find(n=>n.id===parent);if(!p)break;x+=p.position.x;y+=p.position.y;parent=p.parentId;}
  return {x,y};
}
function parseSize(value){
  if(typeof value!=='string')return null;
  const m=value.match(/^(\d+)\s*[xX×]\s*(\d+)$/);
  return m?{width:Number(m[1]),height:Number(m[2])}:null;
}
function cardHeightFromDims(dims){
  if(!dims||!(dims.width>0&&dims.height>0))return 440;
  const preview=Math.max(140,Math.min(480,Math.round(276*dims.height/dims.width)));
  return preview+110;
}
function estimateNodeHeight(node,assets){
  if(!node)return 440;
  if(node.height||node.measured?.height)return node.height||node.measured.height;
  if(node.type==='asset'){
    const asset=node.data?.assetId&&assets?.find(a=>a.id===node.data.assetId);
    if(asset?.width&&asset?.height)return cardHeightFromDims(asset);
    return cardHeightFromDims(parseSize(node.data?.requestedSize));
  }
  if(node.type==='text'||node.type==='module')return 220;
  if(node.type==='imageTool')return 320;
  if(node.type==='director')return 300;
  return 460;
}
function outputPositions(nodes,source,count=1,options={}){
  const total=Math.max(1,count);
  const origin=absolute(source,nodes);
  const sourceW=source?.width||source?.measured?.width||nodeWidth(source?.type);
  const sourceH=estimateNodeHeight(source,options.assets);
  const dims=options.dims||parseSize(options.size||source?.data?.size);
  const cardH=cardHeightFromDims(dims);
  const cols=total<=2?1:total<=4?2:3;
  const rows=Math.ceil(total/cols);
  const batchW=cols*CARD_W+(cols-1)*GRID_GAP_X;
  const batchH=rows*cardH+(rows-1)*GRID_GAP_Y;
  const baseX=Math.round(origin.x+sourceW+OUTPUT_GAP_X);
  let startY=Math.round(origin.y+(sourceH-batchH)/2);
  const occupied=nodes.filter(n=>n.type!=='group').map(n=>({
    ...absolute(n,nodes),
    width:n.width||n.measured?.width||nodeWidth(n.type),
    height:estimateNodeHeight(n,options.assets),
  }));
  for(let i=0;i<=occupied.length;i++){
    const hit=occupied.find(r=>baseX<r.x+r.width+CLEAR_X&&baseX+batchW+CLEAR_X>r.x&&startY<r.y+r.height+CLEAR_Y&&startY+batchH+CLEAR_Y>r.y);
    if(!hit)break;
    startY=Math.round(hit.y+hit.height+40);
  }
  return Array.from({length:total},(_,index)=>({
    x:baseX+(index%cols)*(CARD_W+GRID_GAP_X),
    y:startY+Math.floor(index/cols)*(cardH+GRID_GAP_Y),
  }));
}
function outputPosition(nodes,source,options){
  return outputPositions(nodes,source,1,options)[0];
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
    const size=task.context.size||source.data?.size;
    const slots=outputPositions(nodes,source,count,{assets:document.assets,size});
    for(let index=0;index<count;index++){
      const id=`result-${task.id}-${index}`;reserved.add(id);
      if(!nodes.some(n=>n.id===id))nodes.push({id,type:'asset',position:slots[index],data:{assetId:'',role:'生成结果',name:`生成结果 · ${index+1}`,generationTaskId:task.id,generationIndex:index,sourceNodeId:source.id,...(size?{requestedSize:size}:{})}});
      outputEdge(edges,source,id);
    }changed=true;
  }
  return changed?{...document,generationOutputNodeIds:[...reserved],tugouCanvas:{...graph,nodes,edges}}:document;
}
function stageOutputs(document,tasks){if(!tasks.length)return document;const pages=require('./pages.cjs');let next=document;for(const p of pages.resident(document,'canvas'))next=pages.withCanvas(next,p.id,d=>stageActive(d,tasks));return next;}
module.exports={stageOutputs,outputPosition,outputPositions,outputEdge,cardHeightFromDims};
