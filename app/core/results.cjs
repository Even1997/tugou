const { emptyCanvas } = require('./prompts.cjs');
const { outputPosition, outputEdge } = require('./generation-output.cjs');
function mergeActive(document, results) {
  let assets = [...document.assets], graph = document.tugouCanvas || emptyCanvas();
  let nodes = [...graph.nodes],edges=[...graph.edges];
  const reserved=new Set(document.generationOutputNodeIds||[]);
  const received = new Set(document.generationResultIds || []);
  for (const result of results) {
    if (received.has(result.id)) continue;
    for (const asset of result.assets) {
    if (!assets.some(a => a.id === asset.id)) assets.push(asset);
    const id = `result-${asset.id}`;
    const source = nodes.find(n => n.id === result.nodeId),existing=nodes.find(n=>n.id===id);
    if(existing?.data.generationTaskId===result.id){
      nodes=nodes.map(n=>n.id===id?{...n,data:{...n.data,assetId:asset.id,name:asset.name}}:n);
    }else if (result.kind !== 'local-tool' && !existing&&!reserved.has(id)) {
      nodes.push({ id, type: 'asset', position: outputPosition(nodes,source), data: { assetId: asset.id, role: '生成结果' } });
    }
    if(result.kind!=='local-tool'&&source&&nodes.some(n=>n.id===id))outputEdge(edges,source,id);
    if(result.kind==='workflow')nodes=nodes.map(n=>n.id===result.nodeId?{...n,data:{...n.data,outputAssetId:result.assets[0]?.id,outputAssetIds:result.assets.map(a=>a.id),...(result.mode==='text'?{resultText:result.assets[0]?.text||''}:{})}}:n);
    }
    const unused=new Set(nodes.filter(n=>n.data?.generationTaskId===result.id&&!n.data.assetId).map(n=>n.id));
    nodes=nodes.filter(n=>!unused.has(n.id));edges=edges.filter(e=>!unused.has(e.source)&&!unused.has(e.target));
    received.add(result.id);
  }
  return { ...document, assets, generationResultIds: [...received], tugouCanvas: { ...graph, nodes,edges } };
}
function mergeResults(document,results){
  if(!document.pages?.canvas)return mergeActive(document,results);
  const pages=require('./pages.cjs');let next=document;
  for(const result of results){if((next.generationResultIds||[]).includes(result.id))continue;const pageId=pages.nodePage(next,result.nodeId);
    if(pageId)next=pages.withCanvas(next,pageId,d=>mergeActive(d,[result]));
    else next={...next,assets:[...new Map([...next.assets,...result.assets].map(a=>[a.id,a])).values()],generationResultIds:[...(next.generationResultIds||[]),result.id]};
  }return next;
}
// Local outputs are one undoable edit, but the receipt survives undo and restart.
function applyResults(document, history, results) {
  const fresh = results.filter(r => !(document.generationResultIds || []).includes(r.id));
  const remote = fresh.filter(r => r.kind !== 'local-tool');
  const local = fresh.filter(r => r.kind === 'local-tool');
  const receipt = doc => ({ ...doc, generationResultIds: [...new Set([...(doc.generationResultIds || []), ...local.map(r => r.id)])] });
  const baseline = doc => receipt(mergeResults(doc, remote));
  const past = history.past.map(baseline), future = history.future.map(baseline);
  let current = baseline(document);
  for (const result of local) {
    past.push(current);
    const assets = new Map(current.assets.map(a => [a.id, a]));
    for (const asset of result.assets) if (!assets.has(asset.id)) assets.set(asset.id, asset);
    current = { ...current, assets: [...assets.values()] };
  }
  return { document: current, history: { past: past.slice(-60), future: local.length ? [] : future } };
}
module.exports = { mergeResults, applyResults };
