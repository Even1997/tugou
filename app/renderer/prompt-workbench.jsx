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
  busy,
}) {
  const [query, setQuery] = useState("");
  useUiView('prompts',{get:()=>({query}),restore:v=>setQuery(v.query)});
  const selectedId = activeId ?? document.modules[0]?.id,
    selected = document.modules.find((m) => m.id === selectedId),
    recipe = document.recipes.find(
      (r) => r.id === (recipeId ?? document.recipes[0]?.id),
    );
  const update = (patch) => change(editModule(document, selectedId, patch));
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
          <IconButton label="新建模块" icon="add" onClick={add} />
        </PanelHeader>
        <SearchField label="搜索模块" value={query} onChange={setQuery} />
        <div className="module-items">
          {query && !document.modules.some(m=>`${m.name} ${m.text}`.includes(query)) && <EmptyState compact icon="search" title="没有匹配的模块" description="试试其他关键词。" />}
          {document.modules
            .filter((m) => `${m.name} ${m.text}`.includes(query))
            .map((m) => (
              <Button
                key={m.id}
                className={`module ${m.id === selectedId ? "selected" : ""}`}
                onClick={() => onSelect(m.id)}
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
            ))}
        </div>
      </aside>
      <section className="module-editor">
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
                onClick={() => {
                  const copy = {
                    ...selected,
                    id: crypto.randomUUID(),
                    name: `${selected.name} 副本`,
                    global: false,
                  };
                  change({ ...document, modules: [...document.modules, copy] });
                  onSelect(copy.id);
                }}
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
