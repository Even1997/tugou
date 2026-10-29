const {nodeWidth}=require('./workflow-nodes.cjs');
const {fitGroups}=require('./canvas-groups.cjs');

function layoutSelection(nodes,ids){
  const selected=new Set(ids),byId=new Map(nodes.map(n=>[n.id,n]));
  return nodes.filter(n=>{
    if(!selected.has(n.id))return false;
    for(let parent=n.parentId;parent;parent=byId.get(parent)?.parentId)if(selected.has(parent))return false;
    return true;
  });
}

function rowsLayout(rects,columns){
  rects=[...rects].sort((a,b)=>a.y-b.y||a.x-b.x);
  const widths=Array(columns).fill(0),heights=[],placed=[];
  rects.forEach((n,i)=>{widths[i%columns]=Math.max(widths[i%columns],n.width);heights[Math.floor(i/columns)]=Math.max(heights[Math.floor(i/columns)]||0,n.height);});
  let y=0;
  for(let row=0;row<heights.length;row++){
    let x=0;
    for(let col=0;col<columns;col++){const n=rects[row*columns+col];if(n)placed.push({...n,x,y});x+=widths[col]+64;}
    y+=heights[row]+64;
  }
  return {rects:placed,width:widths.reduce((sum,w)=>sum+w,0)+(columns-1)*64,height:y-64};
}

function arrangeNodes(nodes,ids,mode,edges=[]){
  const selected=layoutSelection(nodes,ids);
  if(selected.length<2)throw Error('请至少选择两个节点或组合');
  if(new Set(selected.map(n=>n.parentId||null)).size>1)throw Error('请选择同一组合内的节点，或选择整个组合一起整理');
  const rects=selected.map(n=>({id:n.id,...n.position,width:n.width||n.measured?.width||nodeWidth(n.type),height:n.height||n.measured?.height||400}));
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
    const byId=new Map(nodes.map(n=>[n.id,n])),links=new Map(rects.map(n=>[n.id,new Set()])),incoming=new Map(rects.map(n=>[n.id,0])),depth=new Map(rects.map(n=>[n.id,0]));
    const owner=id=>{while(id&&!links.has(id))id=byId.get(id)?.parentId;return id;};
    for(const edge of edges){
      const source=owner(edge.source),target=owner(edge.target);
      if(!source||!target||source===target||links.get(source).has(target))continue;
      links.get(source).add(target);incoming.set(target,incoming.get(target)+1);
    }
    const queue=rects.filter(n=>!incoming.get(n.id)).map(n=>n.id);
    for(let i=0;i<queue.length;i++)for(const target of links.get(queue[i])){
      depth.set(target,Math.max(depth.get(target),depth.get(queue[i])+1));
      incoming.set(target,incoming.get(target)-1);if(!incoming.get(target))queue.push(target);
    }
    if(queue.length!==rects.length)throw Error('所选节点的连线形成循环，无法按连接整理');
    const layers=[];
    for(const n of rects)(layers[depth.get(n.id)]||=[]).push(n);
    const blocks=layers.map(layer=>{
      if(layer.length===1){const block=rowsLayout(layer,1);return {...block,center:block.height/2};}
      const ranked=[...layer].sort((a,b)=>a.height-b.height),split=Math.floor(layer.length/2);
      const side=rowsLayout(ranked.slice(0,split),1),main=rowsLayout(ranked.slice(split),1);
      // Keep every left-column output below the side column, leaving curves a clear corridor.
      const offset=Math.max(0,side.height+64-main.rects[0].height/2),height=main.height+offset;
      return {rects:[...main.rects.map(n=>({...n,y:n.y+offset})),...side.rects.map(n=>({...n,x:n.x+main.width+64}))],width:main.width+64+side.width,height,center:Math.max(side.height+64,height/2)};
    }),center=Math.max(...blocks.map(b=>b.center));
    let x=left;
    for(const block of blocks){for(const n of block.rects)positions.set(n.id,{x:x+n.x,y:top+center-block.center+n.y});x+=block.width+112;}
  }else throw Error('未知整理方式');
  let next=nodes.map(n=>{const p=positions.get(n.id);return p&&(p.x!==n.position.x||p.y!==n.position.y)?{...n,position:p}:n;});
  if(selected[0].parentId)next=fitGroups(next);
  return next.every((n,i)=>n===nodes[i])?nodes:next;
}
module.exports={layoutSelection,arrangeNodes};
