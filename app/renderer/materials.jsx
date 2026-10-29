import {Select} from './select.jsx';
import React, { useState, useRef, useMemo } from "react";
import {filterMaterials,materialSource} from '../core/materials.cjs';
import {dragMaterial} from './material-drag.js';
import {useImageImport,hasImageFiles} from './use-image-import.js';
import { MaterialDetails } from "./material-details.jsx";
import { MaterialGrid } from "./material-grid.jsx";
import {MediaPreview} from './media-preview.jsx';
import {useUiView} from './ui-view.js';

import {
  Button,
  PanelHeader,
  SearchField,
  EmptyState,
  ToolPopover,
} from "./components.jsx";

export function AssetLibrary({ projectId, document, change, addToCanvas, addToLayers, editImages, analyzeImage, replaceLayer, replacementTarget, disabled }) {
  const [source,setSource]=useState('all'),[shape,setShape]=useState('all'),[sort,setSort]=useState('newest');
  const [query, setQuery] = useState(""),
    [preview, setPreview] = useState(null),
    [focused,setFocused]=useState(null),
    [error, setError] = useState(""),
    [selected, setSelected] = useState([]),
    [density, setDensity] = useState("medium");
  const latest = useRef(document);
  useUiView('assets',{get:()=>({source,shape,sort,query,focused,selected,density}),restore:v=>{setSource(v.source);setShape(v.shape);setSort(v.sort);setQuery(v.query);setFocused(v.focused);setSelected(v.selected);setDensity(v.density);}});
  latest.current = document;
  const run = async (operation) => {
    setError('');
    try { await operation(); } catch(e) { setError(e.message); }
  };
  const assets = useMemo(()=>filterMaterials(document.assets,{query,source,shape,sort}),[document.assets,query,source,shape,sort]);
  const detail=assets.find(a=>a.id===focused)||assets[0];
  const assetIds=useMemo(()=>new Set(document.assets.map(a=>a.id)),[document.assets]);
  const chosen=selected.filter(id=>assetIds.has(id));
  const imageImport = useImageImport(added => {
      setError('');
        change({
          ...latest.current,
          assets: [...latest.current.assets, ...added],
        });
    },setError,disabled);
  const remove = () => {
    const { assets, ...content } = document;
    const source = JSON.stringify(content);
    const used = selected.filter((id) => source.includes(JSON.stringify(id)));
    if (used.length) {
      setError(`${used.length} 项素材仍被图层、画布或配方引用，请先解除引用。`);
      return;
    }
    if (confirm(`从素材库移除 ${selected.length} 项素材？原文件不会删除。`)) {
      change({
        ...document,
        assets: assets.filter((a) => !selected.includes(a.id)),
      });
      setSelected([]);
    }
  };
  return (
    <section className={`asset-library density-${density}`} onDragOver={imageImport.over} onDrop={e=>{if(hasImageFiles(e))imageImport.drop(e);}}>
      <div className="library-toolbar">
        <PanelHeader title="素材库" count={document.assets.length} />
        <SearchField label="搜索素材" value={query} onChange={setQuery} />
        <ToolPopover label={source!=='all'||shape!=='all'?'筛选 · 已启用':'筛选与排序'} icon="filter">
          <div className="image-tool-detail">
            <label>来源<Select aria-label="素材来源" value={source} onChange={e=>setSource(e.target.value)}><option value="all">全部来源</option><option value="imported">导入素材</option><option value="generated">生成结果</option><option value="processed">处理结果</option></Select></label>
            <label>比例<Select aria-label="素材比例" value={shape} onChange={e=>setShape(e.target.value)}><option value="all">全部比例</option><option value="portrait">竖图</option><option value="landscape">横图</option><option value="square">方图</option></Select></label>
            <label>排序<Select aria-label="素材排序" value={sort} onChange={e=>setSort(e.target.value)}><option value="newest">最近加入</option><option value="oldest">最早加入</option><option value="name">名称</option><option value="pixels">像素从大到小</option></Select></label>
            <Button onClick={()=>{setSource('all');setShape('all');setQuery('');setSort('newest');}}>重置筛选</Button>
            <Button onClick={()=>setSelected(assets.map(a=>a.id))}>选择当前结果</Button>
            <Button disabled={!chosen.length} onClick={()=>setSelected([])}>清空选择</Button>
          </div>
        </ToolPopover>
        <Select
          aria-label="缩略图大小"
          value={density}
          onChange={(e) => setDensity(e.target.value)}
        >
          <option value="small">小缩略图</option>
          <option value="medium">中缩略图</option>
          <option value="large">大缩略图</option>
        </Select>
        <Button iconOnly aria-label={`移除${selected.length ? ` (${selected.length})` : ""}`} disabled={!selected.length} icon="delete" onClick={remove}>
          移除{selected.length ? ` (${selected.length})` : ""}
        </Button>
        <Button iconOnly aria-label={`处理所选${selected.length ? ` (${selected.length})` : ""}`} disabled={!selected.length||selected.some(id=>document.assets.some(a=>a.id===id&&a.kind&&a.kind!=='image'))} icon="tools" onClick={()=>editImages(selected)}>处理所选{selected.length ? ` (${selected.length})` : ""}</Button>
        {replacementTarget&&<Button iconOnly icon="replace" disabled={chosen.length!==1||replacementTarget.locked||document.assets.some(a=>a.id===chosen[0]&&a.kind&&a.kind!=="image")} title={`替换「${replacementTarget.name}」`} onClick={()=>run(()=>replaceLayer(chosen[0]))}>替换图层</Button>}
        <Button aria-label={imageImport.importing?"导入中":"导入图片"} primary icon="import" disabled={imageImport.importing||disabled} onClick={imageImport.open}>
          {imageImport.importing?'导入中':'导入图片'}
        </Button>
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <div className="library-filters" role="group" aria-label="素材来源筛选">{[["all","全部"],["imported","导入素材"],["generated","生成结果"],["processed","处理结果"]].map(([id,label])=><Button key={id} aria-pressed={source===id} onClick={()=>setSource(id)}>{label}</Button>)}</div>
      <div className="library-content">
      {assets.length ? (
        <MaterialGrid items={assets} density={density}>
          {(asset) => (
            <article
              className={`asset-card ${selected.includes(asset.id)||detail?.id===asset.id ? "selected" : ""}`}
              key={asset.id}
            >
              <div className="asset-image">
                <Button
                  className="asset-preview"
                  aria-label={`预览 ${asset.name}`}
                  draggable
                  title="点击查看详情，双击预览；可拖到左侧工作区放入画布"
                  onDragStart={event=>dragMaterial(event,projectId,asset.id)}
                  onClick={() => setFocused(asset.id)}
                  onDoubleClick={()=>setPreview(asset.id)}
                >
                  <MediaPreview thumbnail asset={asset} loading="lazy"/>
                </Button>
                <input
                  type="checkbox"
                  aria-label={`选择 ${asset.name}`}
                  checked={selected.includes(asset.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, asset.id]
                        : selected.filter((id) => id !== asset.id),
                    )
                  }
                />
              </div>
              <div className="asset-caption">
                <strong title={asset.name}>{asset.name}</strong>
                <span>
                  {asset.kind&&asset.kind!=='image'?{text:'文本',audio:'音频',video:'视频'}[asset.kind]:`${asset.width} × ${asset.height}`}
                </span>
                <div className="asset-actions">
                  <Button iconOnly icon="layers" size="small" disabled={asset.kind&&asset.kind!=='image'} onClick={() => addToLayers(asset)}>
                    加入画面
                  </Button>
                  <Button iconOnly icon="canvas"
                    size="small"
                    onClick={() => addToCanvas("asset", asset.id)}
                  >
                    加入画布
                  </Button>
                </div>
              </div>
            </article>
          )}
        </MaterialGrid>
      ) : (
        <EmptyState
          title={query||source!=='all'||shape!=='all' ? "没有匹配的素材" : "暂无素材"}
          description={
            query||source!=='all'||shape!=='all' ? "调整关键词或顶部筛选条件。" : "拖入本机图片，或在工作台生成素材。"
          }
        >
          <Button primary icon="import" disabled={imageImport.importing||disabled} onClick={imageImport.open}>
            导入图片
          </Button>
        </EmptyState>
      )}
      {detail&&<aside className="library-details" aria-label="素材详情"><div className="panel-heading"><h2>素材详情</h2><Button iconOnly icon="maximize" aria-label="放大预览" onClick={()=>setPreview(detail.id)}/></div><MediaPreview asset={detail} className="material-preview"/><h3>{detail.name}</h3><dl><dt>尺寸</dt><dd>{detail.width&&detail.height?detail.width+' × '+detail.height:detail.kind}</dd><dt>来源</dt><dd>{({processed:'处理结果',generated:'生成结果',imported:'导入素材'})[materialSource(detail)]}</dd></dl><div className="detail-actions"><Button primary icon="canvas" onClick={()=>addToCanvas('asset',detail.id)}>添加到画布</Button><Button icon="layers" disabled={!!detail.kind&&detail.kind!=='image'} onClick={()=>addToLayers(detail)}>添加到合成</Button><Button icon="tools" disabled={!!detail.kind&&detail.kind!=='image'} onClick={()=>editImages([detail.id])}>处理图片</Button><Button onClick={()=>setPreview(detail.id)}>查看完整详情</Button></div></aside>}
      </div>
      {preview&&<MaterialDetails projectId={projectId} document={document} assetId={preview} change={change} close={()=>setPreview(null)} editImages={editImages} analyzeImage={analyzeImage} addToCanvas={addToCanvas} addToLayers={addToLayers}/>}
    </section>
  );
}
