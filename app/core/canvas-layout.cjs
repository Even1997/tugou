const {nodeWidth}=require('./workflow-nodes.cjs');
const {fitGroups}=require('./canvas-groups.cjs');

const COL_GAP=108,ROW_GAP=36,COMP_GAP=88;

function defaultHeight(node){
  if(node.type==='text'||node.type==='module')return 220;
  if(node.type==='imageTool')return 320;
  if(node.type==='director')return 300;
  return 440;
}

function layoutSelection(nodes,ids){
  const selected=new Set(ids),byId=new Map(nodes.map(n=>[n.id,n]));
  return nodes.filter(n=>{
    if(!selected.has(n.id))return false;
    for(let parent=n.parentId;parent;parent=byId.get(parent)?.parentId)if(selected.has(parent))return false;
    return true;
  });
}

function rowsLayout(rects,columns,gapX=64,gapY=64){
  rects=[...rects].sort((a,b)=>a.y-b.y||a.x-b.x);
  const widths=Array(columns).fill(0),heights=[],placed=[];
  rects.forEach((n,i)=>{widths[i%columns]=Math.max(widths[i%columns],n.width);heights[Math.floor(i/columns)]=Math.max(heights[Math.floor(i/columns)]||0,n.height);});
  let y=0;
  for(let row=0;row<heights.length;row++){
    let x=0;
    for(let col=0;col<columns;col++){const n=rects[row*columns+col];if(n)placed.push({...n,x,y});x+=widths[col]+gapX;}
    y+=heights[row]+gapY;
  }
  return {rects:placed,width:widths.reduce((sum,w)=>sum+w,0)+(columns-1)*gapX,height:heights.length?y-gapY:0};
}

function placeColumn(col,centers){
  const placed=col.map((n,i)=>({n,target:centers[i]-n.height/2,y:centers[i]-n.height/2}));
  for(let i=1;i<placed.length;i++){
    const minY=placed[i-1].y+placed[i-1].n.height+ROW_GAP;
    if(placed[i].y<minY)placed[i].y=minY;
  }
  const drift=placed.reduce((sum,item)=>sum+(item.y-item.target),0)/placed.length;
  for(const item of placed)item.y=Math.round(item.y-drift);
  for(let i=1;i<placed.length;i++){
    const minY=placed[i-1].y+placed[i-1].n.height+ROW_GAP;
    if(placed[i].y<minY)placed[i].y=minY;
  }
  return placed;
}

function layoutComponent(compRects,links,parents){
  const ids=new Set(compRects.map(n=>n.id)),inDeg=new Map(),depth=new Map();
  for(const n of compRects){
    inDeg.set(n.id,[...parents.get(n.id)].filter(p=>ids.has(p)).length);
    depth.set(n.id,0);
  }
  const order=[];
  for(const n of compRects)if(!inDeg.get(n.id))order.push(n.id);
  for(let i=0;i<order.length;i++){
    const id=order[i];
    for(const target of links.get(id)){
      if(!ids.has(target))continue;
      depth.set(target,Math.max(depth.get(target),depth.get(id)+1));
      inDeg.set(target,inDeg.get(target)-1);
      if(!inDeg.get(target))order.push(target);
    }
  }
  // Pull pure source leaves adjacent to their earliest consumer to avoid cross-canvas wires.
  for(let i=order.length-1;i>=0;i--){
    const id=order[i],children=[...links.get(id)].filter(c=>ids.has(c));
    const pars=[...parents.get(id)].filter(p=>ids.has(p));
    if(!pars.length&&children.length)depth.set(id,Math.min(...children.map(c=>depth.get(c)))-1);
  }
  const minDepth=Math.min(...depth.values()),layers=[];
  for(const n of compRects){
    const col=depth.get(n.id)-minDepth;
    (layers[col]||=[]).push(n);
  }
  const rank=new Map();
  const reindex=col=>layers[col].forEach((n,i)=>rank.set(n.id,i));
  layers.forEach((layer,c)=>{layer.sort((a,b)=>a.y-b.y||a.x-b.x);reindex(c);});
  // Two-pass barycenter sweep reduces crossings while staying deterministic.
  for(let pass=0;pass<2;pass++){
    for(let c=1;c<layers.length;c++){
      const prevIndex=new Map(layers[c].map((n,i)=>[n.id,i]));
      layers[c].sort((a,b)=>{
        const pa=[...parents.get(a.id)].filter(p=>rank.has(p)),pb=[...parents.get(b.id)].filter(p=>rank.has(p));
        const va=pa.length?pa.reduce((s,p)=>s+rank.get(p),0)/pa.length:prevIndex.get(a.id);
        const vb=pb.length?pb.reduce((s,p)=>s+rank.get(p),0)/pb.length:prevIndex.get(b.id);
        return va-vb||prevIndex.get(a.id)-prevIndex.get(b.id);
      });
      reindex(c);
    }
    for(let c=layers.length-2;c>=0;c--){
      const prevIndex=new Map(layers[c].map((n,i)=>[n.id,i]));
      layers[c].sort((a,b)=>{
        const ca=[...links.get(a.id)].filter(t=>rank.has(t)),cb=[...links.get(b.id)].filter(t=>rank.has(t));
        const va=ca.length?ca.reduce((s,t)=>s+rank.get(t),0)/ca.length:prevIndex.get(a.id);
        const vb=cb.length?cb.reduce((s,t)=>s+rank.get(t),0)/cb.length:prevIndex.get(b.id);
        return va-vb||prevIndex.get(a.id)-prevIndex.get(b.id);
      });
      reindex(c);
    }
  }
  const colWidths=layers.map(layer=>Math.max(...layer.map(n=>n.width)));
  const colHeights=layers.map(layer=>layer.reduce((s,n)=>s+n.height,0)+Math.max(0,layer.length-1)*ROW_GAP);
  let anchor=0;
  for(let c=1;c<layers.length;c++)if(colHeights[c]>colHeights[anchor])anchor=c;
  const placedY=new Map(),anchored=new Set();
  const stackColumn=(c,centerY)=>{
    let y=Math.round(centerY-colHeights[c]/2);
    for(const n of layers[c]){placedY.set(n.id,y);y+=n.height+ROW_GAP;}
  };
  stackColumn(anchor,colHeights[anchor]/2);
  for(const n of layers[anchor])anchored.add(n.id);
  const alignColumn=(c,neighborMap)=>{
    const centers=[];let anyUnanchored=false;
    let fallbackCursor=0;
    for(const n of layers[c]){
      const nbrs=[...neighborMap.get(n.id)].filter(id=>placedY.has(id));
      if(nbrs.length){
        const avg=nbrs.reduce((s,id)=>{const t=compRects.find(r=>r.id===id);return s+placedY.get(id)+t.height/2;},0)/nbrs.length;
        centers.push(avg);anchored.add(n.id);
      }else{
        anyUnanchored=true;
        centers.push(fallbackCursor+n.height/2);
      }
      fallbackCursor+=n.height+ROW_GAP;
    }
    for(const item of placeColumn(layers[c],centers))placedY.set(item.n.id,item.y);
    return anyUnanchored;
  };
  let needsBackfill=false;
  for(let c=anchor+1;c<layers.length;c++)if(alignColumn(c,parents))needsBackfill=true;
  for(let c=anchor-1;c>=0;c--)alignColumn(c,links);
  if(needsBackfill){
    for(let c=layers.length-2;c>anchor;c--){
      if(layers[c].some(n=>!anchored.has(n.id)))alignColumn(c,links);
    }
  }
  const minY=Math.min(...placedY.values());
  const placed=[];let x=0,maxBottom=0;
  layers.forEach((layer,c)=>{
    for(const n of layer){
      const y=Math.round(placedY.get(n.id)-minY);
      placed.push({...n,x,y});
      maxBottom=Math.max(maxBottom,y+n.height);
    }
    x+=colWidths[c]+COL_GAP;
  });
  return {rects:placed,width:x-COL_GAP,height:maxBottom};
}

function arrangeNodes(nodes,ids,mode,edges=[]){
  const selected=layoutSelection(nodes,ids);
  if(selected.length<2)throw Error('请至少选择两个节点或组合');
  if(new Set(selected.map(n=>n.parentId||null)).size>1)throw Error('请选择同一组合内的节点，或选择整个组合一起整理');
  const rects=selected.map(n=>({id:n.id,...n.position,width:n.width||n.measured?.width||nodeWidth(n.type),height:n.height||n.measured?.height||defaultHeight(n)}));
  const left=Math.min(...rects.map(n=>n.x)),top=Math.min(...rects.map(n=>n.y)),positions=new Map();
  if(mode==='left'||mode==='top'){
    for(const n of rects)positions.set(n.id,{x:mode==='left'?left:n.x,y:mode==='top'?top:n.y});
  }else if(mode==='horizontal'||mode==='vertical'){
    if(selected.length<3)throw Error('等间距整理需要至少三个节点或组合');
    const axis=mode==='horizontal'?'x':'y',size=axis==='x'?'width':'height';
    rects.sort((a,b)=>a[axis]-b[axis]);
    const start=rects[0][axis],end=Math.max(...rects.map(n=>n[axis]+n[size]));
    const gap=Math.max(40,(end-start-rects.reduce((sum,n)=>sum+n[size],0))/(rects.length-1));
    let cursor=start;
    for(const n of rects){positions.set(n.id,{x:n.x,y:n.y,[axis]:cursor});cursor+=n[size]+gap;}
  }else if(mode==='grid'){
    for(const n of rowsLayout(rects,Math.ceil(Math.sqrt(rects.length))).rects)positions.set(n.id,{x:left+n.x,y:top+n.y});
  }else if(mode==='flow'){
    const byId=new Map(nodes.map(n=>[n.id,n])),rectById=new Map(rects.map(n=>[n.id,n]));
    const links=new Map(rects.map(n=>[n.id,new Set()])),parents=new Map(rects.map(n=>[n.id,new Set()])),incoming=new Map(rects.map(n=>[n.id,0]));
    const owner=id=>{while(id&&!links.has(id))id=byId.get(id)?.parentId;return id;};
    for(const edge of edges){
      const source=owner(edge.source),target=owner(edge.target);
      if(!source||!target||source===target||links.get(source).has(target))continue;
      links.get(source).add(target);parents.get(target).add(source);incoming.set(target,incoming.get(target)+1);
    }
    const queue=rects.filter(n=>!incoming.get(n.id)).map(n=>n.id);
    for(let i=0;i<queue.length;i++)for(const target of links.get(queue[i])){
      incoming.set(target,incoming.get(target)-1);if(!incoming.get(target))queue.push(target);
    }
    if(queue.length!==rects.length)throw Error('所选节点的连线形成循环，无法按连接整理');
    const visited=new Set(),workflows=[],isolated=[];
    for(const n of rects){
      if(visited.has(n.id))continue;
      const comp=[],stack=[n.id];visited.add(n.id);
      while(stack.length){
        const cur=stack.pop();comp.push(rectById.get(cur));
        for(const next of [...links.get(cur),...parents.get(cur)])if(!visited.has(next)){visited.add(next);stack.push(next);}
      }
      if(comp.length===1)isolated.push(comp[0]);
      else workflows.push(comp);
    }
    const blocks=workflows.map(comp=>({
      sortY:Math.min(...comp.map(n=>n.y)),
      sortX:Math.min(...comp.map(n=>n.x)),
      layout:layoutComponent(comp,links,parents),
    }));
    if(isolated.length){
      const cols=Math.min(4,Math.ceil(Math.sqrt(isolated.length)));
      blocks.push({
        sortY:Math.min(...isolated.map(n=>n.y)),
        sortX:Math.min(...isolated.map(n=>n.x)),
        layout:rowsLayout(isolated,cols,36,36),
      });
    }
    blocks.sort((a,b)=>a.sortY-b.sortY||a.sortX-b.sortX);
    let y=Math.round(top);
    for(const block of blocks){
      for(const n of block.layout.rects)positions.set(n.id,{x:Math.round(left+n.x),y:Math.round(y+n.y)});
      y+=Math.round(block.layout.height)+COMP_GAP;
    }
  }else throw Error('未知整理方式');
  let next=nodes.map(n=>{const p=positions.get(n.id);return p&&(p.x!==n.position.x||p.y!==n.position.y)?{...n,position:p}:n;});
  if(selected[0].parentId)next=fitGroups(next);
  return next.every((n,i)=>n===nodes[i])?nodes:next;
}
module.exports={layoutSelection,arrangeNodes};
