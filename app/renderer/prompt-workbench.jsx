import {Select} from './select.jsx';
import {useUiView} from './ui-view.js';
import React, { useState } from "react";
import {
  editModule,
  removeModule,
  compileRecipe,
  isGlobal,
} from "../core/prompts.cjs";
import { RecipeWorkbench, PromptPreview } from "./recipes.jsx";
import {PromptHoverPreview} from './prompt-hover-preview.jsx';
import {ContextMenu,useContextMenu,menuAction as item,menuDivider as divider} from './context-menu.jsx';
import {RemovalDialog} from './removal-dialog.jsx';
import {
  Button,
  Icon,
  IconButton,
  PanelHeader,
  SearchField,
  EmptyState,
  Input,
  TextArea,
} from "./components.jsx";

import { analysisKinds as kinds } from "../core/analysis-draft.cjs";
export function PromptWorkbench({
  document,
  change,
  addToCanvas,
  activeId,
  onSelect,
  recipeId,
  onRecipeSelect,
  generateRecipe,
  openConnection,
  analyzeImage,
  busy,
}) {
  const [query, setQuery] = useState("");
  const menu=useContextMenu(),[removing,setRemoving]=useState(null),[error,setError]=useState('');
  useUiView('prompts',{get:()=>({query}),restore:v=>setQuery(v.query)});
  const selectedId = activeId ?? document.modules[0]?.id,
    selected = document.modules.find((m) => m.id === selectedId),
    recipe = document.recipes.find(
      (r) => r.id === (recipeId ?? document.recipes[0]?.id),
    );
  const update = (patch) => change(editModule(document, selectedId, patch));
  const copyModule=module=>{
    const copy={...module,id:crypto.randomUUID(),name:`${module.name} 副本`,global:false};
    if(change({...document,modules:[...document.modules,copy]})!==false)onSelect(copy.id);
  };
  const target=document.modules.find(m=>m.id===menu.context?.id);
  const add = () => {
    const module = {
      id: crypto.randomUUID(),
      name: "新模块",
      kind: "other",
      text: "",
      global: false,
    };
    change({ ...document, modules: [...document.modules, module] });
    onSelect(module.id);
  };
  return (
    <div className="workbench prompt-workbench">
      <aside className="module-list">
        <PanelHeader title="模块" count={document.modules.length}>
          <IconButton label="参考图分析" icon="analyze" disabled={busy} onClick={()=>analyzeImage()} />
          <IconButton label="新建模块" icon="add" onClick={add} />
        </PanelHeader>
        <SearchField label="搜索模块" value={query} onChange={setQuery} />
        <div className="module-items">
          {query && !document.modules.some(m=>`${m.name} ${m.text}`.includes(query)) && <EmptyState compact icon="search" title="没有匹配的模块" description="试试其他关键词。" />}
          {document.modules
            .filter((m) => `${m.name} ${m.text}`.includes(query))
            .map((m) => (
              <PromptHoverPreview key={m.id} document={document} item={m} type="module">
              <Button
                className={`module ${m.id === selectedId ? "selected" : ""}`}
                onClick={() => onSelect(m.id)}
                onContextMenu={e=>{if(!busy)menu.open(e,{id:m.id});}}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    "application/x-tugou",
                    JSON.stringify({ type: "module", id: m.id }),
                  )
                }
              >
                <span className="module-glyph">
                  <Icon name={m.kind} />
                </span>
                <strong>{m.name}</strong>
                {isGlobal(m) && <span className="scope">全局</span>}
              </Button>
              </PromptHoverPreview>
            ))}
        </div>
      </aside>
      <section className="module-editor">
        {error&&<p role="alert">{error}</p>}
        <ContextMenu context={menu.context} close={menu.close} className="prompt-context-menu" items={target&&!busy?[
          item('edit','编辑模块',()=>onSelect(target.id)),item('copy','复制模块',()=>copyModule(target)),
          item('text','复制提示词',()=>void window.tugou.copyText(target.text).catch(e=>setError(e.message))),
          item('canvas','添加到画布',()=>addToCanvas('module',target.id)),divider,
          item('delete','删除模块',()=>setRemoving(target),{danger:true}),
        ]:[]}/>
        {removing&&<RemovalDialog title={`删除「${removing.name}」？`} description="已使用的引用会保留快照。可通过撤销恢复。" close={()=>setRemoving(null)} remove={()=>{
          if(busy||change(removeModule(document,removing.id))===false)throw Error('当前无法编辑，请稍后重试');if(selectedId===removing.id)onSelect(null);
        }}/>}
        {selected ? (
          <>
            <div className="editor-heading">
              <span className="module-glyph">
                <Icon
                  name={
                    Object.entries(kinds).find(
                      ([id, label]) =>
                        id === selected.kind || label === selected.kind,
                    )?.[0]
                  }
                />
              </span>
              <Input
                variant="borderless"
                className="name-input"
                aria-label="模块名称"
                value={selected.name}
                onChange={(e) => update({ name: e.target.value })}
              />
              <IconButton
                label="复制模块"
                icon="copy"
                onClick={()=>copyModule(selected)}
              />
              <IconButton
                label="删除模块"
                icon="delete"
                onClick={() => {
                  if (
                    confirm(
                      "删除模块？已使用的引用将保留快照并标记来源已删除。",
                    )
                  ) {
                    change(removeModule(document, selectedId));
                    onSelect(null);
                  }
                }}
              />
            </div>
            <div className="module-options">
              <Select
                aria-label="模块类型"
                value={selected.kind}
                onChange={(e) => update({ kind: e.target.value })}
              >
                {!kinds[selected.kind] && (
                  <option value={selected.kind}>{selected.kind}</option>
                )}
                {Object.entries(kinds).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={isGlobal(selected)}
                  onChange={(e) => update({ global: e.target.checked })}
                />
                应用到所有配方
              </label>
              <Button iconOnly icon="canvas"
                className="module-send"
                onClick={() => addToCanvas("module", selected.id)}
              >
                加入画布
              </Button>
            </div>
            <div className="prompt-paper">
              <TextArea
                aria-label="模块提示词"
                value={selected.text}
                onChange={(e) => update({ text: e.target.value })}
                placeholder="描述这个模块的内容与约束…"
              />
              <div className="editor-footer">{selected.text.length} 字</div>
            </div>
            {recipe && (
              <details className="complete-prompt">
                <summary>
                  完整提示词 <span>{recipe.name}</span>
                </summary>
                <PromptPreview
                  document={document}
                  result={compileRecipe(document, recipe)}
                />
              </details>
            )}
          </>
        ) : (
          <EmptyState
            icon="prompts"
            title="从一个模块开始"
            description="人物、动作、画风分别编辑，组合为配方。"
          >
            <Button primary onClick={add}>
              新建模块
            </Button>
          </EmptyState>
        )}
      </section>
      <RecipeWorkbench
        compact
        document={document}
        change={change}
        addToCanvas={addToCanvas}
        activeId={recipeId}
        onSelect={onRecipeSelect}
        generateRecipe={generateRecipe}
        openConnection={openConnection}
        busy={busy}
      />
    </div>
  );
}
