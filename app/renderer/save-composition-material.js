import {Compositor} from './composite.js';
import {materialPlan} from '../core/composition-material.cjs';

export async function saveCompositionMaterial(id,{read,commit,signal,time=0}){
  const source=read(),plan=materialPlan(source.document,id),engine=new Compositor();
  try{
    signal.throwIfAborted();
    const bytes=await engine.export(plan.document,{time,signal});
    signal.throwIfAborted();
    const stored=await window.tugou.storeRaster(bytes,plan.name);
    signal.throwIfAborted();
    const current=read();
    if(current.projectId!==source.projectId||current.disabled)throw Error('当前工程已切换或暂不可编辑，请重新保存到素材');
    const asset={...stored,layerSnapshot:{layerId:id,boardId:plan.boardId,kind:plan.kind}};
    if(commit({...current.document,assets:[...current.document.assets,asset]})===false)throw Error('素材未加入工程，请稍后重试');
    return asset;
  }finally{engine.dispose();}
}
