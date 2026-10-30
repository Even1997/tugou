import {Select} from './select.jsx';
import React, { useEffect, useState } from "react";
import {
  bindingsFor,
  bindingStatus,
  refreshBinding,
  pinRecipe,
  newRecipe,
  compileRecipe,
  isGlobal,
} from "../core/prompts.cjs";
import "./workflow.css";
import {GenerationChoice,sizeDescription} from "./generation-choice.jsx";
import {imageSettingsError} from '../core/image-settings.cjs';
import { assetUrl } from './canvas.jsx';
import {
  Button,
  IconButton,
  Icon,
  PanelHeader,
  EmptyState,
  Input,
  TextArea,
  ToolPopover,
} from "./components.jsx";

export const statusLabels = {
  current: "已同步",
  local: "本地修改",
  outdated: "有新版",
  conflict: "修改冲突",
  missing: "来源已删除",
};

export function ReferenceEditor({ document, binding, change }) {
  const [editing, setEditing] = useState(binding.overrideText !== undefined);
  const status = bindingStatus(document, binding);
  return (
    <div className={`binding-row state-${status}`}>
      <div className="binding-heading">
        <strong>{binding.snapshot.name}</strong>
        <span>{statusLabels[status]}</span>
        <Button iconOnly icon="edit" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          {editing ? "收起" : "本地修改"}
        </Button>
        {status === "outdated" && (
          <Button iconOnly icon="sync" onClick={() => change(refreshBinding(document, binding))}>
            更新
          </Button>
        )}
      </div>
      {status === "conflict" && (
        <div className="binding-resolution">
          <p>共享模块已更新，本地文字也有修改。</p>
          <Button
            onClick={() => change(refreshBinding(document, binding, "keep"))}
          >
            保留本地并同步版本
          </Button>
          <Button
            onClick={() => change(refreshBinding(document, binding, "source"))}
          >
            采用新版文字
          </Button>
        </div>
      )}
      {status === "missing" && (
        <p className="muted">保留了引用时的内容，不会自动删除。</p>
      )}
      {editing && (
        <>
          <TextArea
            aria-label={`${binding.snapshot.name}本地提示词`}
            value={binding.overrideText ?? binding.snapshot.text}
            onChange={(event) =>
              change({ ...binding, overrideText: event.target.value })
            }
          />
          {binding.overrideText !== undefined && (
            <Button iconOnly icon="undo"
              onClick={() => {
                const next = { ...binding };
                delete next.overrideText;
                change(next);
              }}
            >
              撤销本地修改
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export function PromptPreview({ result, document }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => setCopied(false), [result.prompt]);
  const missing = result.references.filter(
    (reference) =>
      !document.assets.some((asset) => asset.id === reference.assetId),
  );
  return (
    <section className="prompt-preview">
      <div className="panel-heading">
        <h2>合成提示词</h2>
        <Button iconOnly icon={copied ? "check" : "copy"} aria-label={copied ? "已复制" : "复制"}
          onClick={async () => {
            try {
              await window.tugou.copyText(result.prompt);
              setCopied(true);
              setError("");
            } catch {
              setError("复制失败，请选中文字复制");
            }
          }}
        >
          {" "}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {missing.length > 0 && (
        <p role="alert">{missing.length} 张参考图缺失，需重新选择。</p>
      )}
      <TextArea readOnly aria-label="合成提示词" value={result.prompt} />
      {!!result.references.length && (
        <ol>
          {result.references.map((reference) => (
            <li key={reference.assetId}>
              {document.assets.find((asset) => asset.id === reference.assetId)
                ?.name || "缺失素材"}{" "}
              · {reference.role}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function RecipeWorkbench({
  document,
  change,
  addToCanvas,
  activeId,
  onSelect,
  generateRecipe,
  openConnection,
  busy,
}) {
  const selectedId = activeId ?? document.recipes[0]?.id,
    selected = document.recipes.find((r) => r.id === selectedId);
  const [submitting, setSubmitting] = useState(false),[sharedModel,setSharedModel]=useState('');
  const parameterError=selected?imageSettingsError(sharedModel,selected):'';
  const refreshModel=()=>window.tugou.connection().then(c=>setSharedModel(c.model||'')).catch(()=>setSharedModel(''));
  useEffect(()=>{refreshModel();window.addEventListener('focus',refreshModel);window.addEventListener('tugou-connection-changed',refreshModel);return()=>{window.removeEventListener('focus',refreshModel);window.removeEventListener('tugou-connection-changed',refreshModel);};},[]);
  const update = (next) =>
    change({
      ...document,
      recipes: document.recipes.map((r) => (r.id === next.id ? next : r)),
    });
  const patch = (fields) =>
    update({ ...pinRecipe(document, selected), ...fields });
  const add = () => {
    const recipe = newRecipe();
    change({ ...document, recipes: [...document.recipes, recipe] });
    onSelect(recipe.id);
  };
  const bindings = selected ? bindingsFor(document, selected) : [];
  return (
    <aside className="recipe-editor recipe-sidebar">
      <PanelHeader title="配方">
        {selected && <IconButton label="新建配方" icon="add" onClick={add} />}
      </PanelHeader>
      {selected ? (
        <>
          <div className="recipe-choice">
            <Select
              aria-label="当前配方"
              value={selected.id}
              onChange={(e) => onSelect(e.target.value)}
            >
              {document.recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
            <ToolPopover label="配方设置" icon="settings">
              <label>
                名称
                <Input
                  aria-label="配方名称"
                  value={selected.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </label>
              <Button
                onClick={() => {
                  if (confirm("删除配方？画布中已有快照会保留。")) {
                    change({
                      ...document,
                      recipes: document.recipes.filter(
                        (r) => r.id !== selectedId,
                      ),
                    });
                    onSelect(null);
                  }
                }}
              >
                删除配方
              </Button>
            </ToolPopover>
          </div>
          <div className="recipe-fields">
            <section>
              <h2>组合模块</h2>
              <div className="module-picker">
                {document.modules.map((module) => (
                  <label className="check module-tile" key={module.id} title={module.name+"\n"+module.text}>
                    <input
                      type="checkbox"
                      aria-label={module.name}
                      disabled={isGlobal(module)}
                      checked={
                        isGlobal(module) ||
                        selected.moduleIds.includes(module.id)
                      }
                      onChange={(e) => {
                        const moduleIds = e.target.checked
                          ? [...selected.moduleIds, module.id]
                          : selected.moduleIds.filter((id) => id !== module.id);
                        const recipe = {
                          ...pinRecipe(document, selected),
                          moduleIds,
                        };
                        update({
                          ...recipe,
                          moduleBindings: bindingsFor(document, recipe),
                        });
                      }}
                    />
                    <span>文本</span>
                    {isGlobal(module) && <small>全局</small>}
                  </label>
                ))}
              </div>
              <details className="binding-details">
                <summary>
                  引用与版本{" "}
                  {bindings.filter((b) =>
                    ["outdated", "conflict", "missing"].includes(
                      bindingStatus(document, b),
                    ),
                  ).length || ""}
                </summary>
                {bindings.map((binding, index) => (
                  <div className="recipe-binding" key={binding.moduleId}>
                    <ReferenceEditor
                      document={document}
                      binding={binding}
                      change={(next) =>
                        patch({
                          moduleBindings: bindings.map((b) =>
                            b.moduleId === next.moduleId ? next : b,
                          ),
                        })
                      }
                    />
                    <div className="binding-order">
                      <Button
                        aria-label={binding.snapshot.name + "上移"}
                        disabled={
                          index === 0 ||
                          !selected.moduleIds.includes(binding.moduleId)
                        }
                        onClick={() => {
                          const ids = [...selected.moduleIds],
                            i = ids.indexOf(binding.moduleId);
                          if (i > 0) {
                            [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
                            patch({ moduleIds: ids });
                          }
                        }}
                      >
                        上移
                      </Button>
                      {bindingStatus(document, binding) === "missing" && (
                        <Button
                          onClick={() =>
                            patch({
                              moduleIds: selected.moduleIds.filter(
                                (id) => id !== binding.moduleId,
                              ),
                              moduleBindings: bindings.filter(
                                (b) => b.moduleId !== binding.moduleId,
                              ),
                            })
                          }
                        >
                          移除失效引用
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </details>
            </section>
            <section>
              <h2>参考图与职责</h2>
              <div className="reference-list">
                {(selected.references||[]).map((reference,index)=>{const asset=document.assets.find(a=>a.id===reference.assetId);return <div className="recipe-reference" key={reference.assetId} title={(asset?.name||'缺失素材')+' · '+reference.role}>
                  {asset?<img src={assetUrl(asset)} alt={asset.name}/>:<span>缺失素材</span>}
                  <ToolPopover label={'参考图'+(index+1)+'设置'} icon="settings" className="desk-popover">
                    <strong>{asset?.name||'缺失素材'}</strong><label>参考职责<Input aria-label={'参考图'+(index+1)+'职责'} value={reference.role} list="reference-roles" onChange={e=>patch({references:selected.references.map((r,i)=>i===index?{...r,role:e.target.value}:r)})}/></label>
                    <div data-keep-open className="node-popup-actions">{[-1,1].map(direction=><Button key={direction} icon={direction<0?'up':'down'} aria-label={(direction<0?'上移':'下移')+'参考图'+(index+1)} disabled={index+direction<0||index+direction>=selected.references.length} onClick={()=>{const references=[...selected.references];[references[index],references[index+direction]]=[references[index+direction],references[index]];patch({references});}}>{direction<0?'前移':'后移'}</Button>)}</div>
                    <Button icon="close" aria-label={'移除参考图'+(index+1)} onClick={()=>patch({references:selected.references.filter((_,i)=>i!==index)})}>移除引用</Button>
                  </ToolPopover>
                </div>;})}
              </div>
              <datalist id="reference-roles">
                {['主体身份：保留人物或物体的可识别特征', '画风参考：仅参考线条、配色和上色方式', '动作参考：仅参考姿态与互动', '服饰参考：仅参考衣物款式与配饰', '构图参考：仅参考位置、比例和留白', '背景参考：仅参考环境与空间', '材质参考：仅参考表面质感'].map(role => <option key={role} value={role} />)}
              </datalist>
              <Select
                aria-label="添加参考图"
                value=""
                disabled={(selected.references || []).length >= 12}
                onChange={(e) => {
                  if (e.target.value)
                    patch({
                      references: [
                        ...(selected.references || []),
                        { assetId: e.target.value, role: "主体身份" },
                      ],
                    });
                }}
              >
                <option value="">从素材库选择</option>
                {document.assets
                  .filter(
                    (a) =>
                      !selected.references?.some((r) => r.assetId === a.id),
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </Select>
            </section>
            <label>
              构图与输出
              <TextArea
                aria-label="构图与输出"
                value={selected.output || ""}
                onChange={(e) => patch({ output: e.target.value })}
                placeholder="构图、留白、透明背景等要求"
                rows={4}
              />
            </label>
          </div>
          <div className="recipe-generation-controls" onFocus={refreshModel}>
            <Button icon="model" className="generation-model" aria-label="配方共享模型" onClick={openConnection}><span className="control-copy"><strong>{sharedModel||'选择模型'}</strong><small>共享模型 · 点击配置连接</small></span><Icon name="collapse" className="control-chevron"/></Button>
            <ToolPopover downward label={sizeDescription(selected.size)} description={(selected.size||'auto').replace('auto','自动').replace('x',' × ')} icon="selection" showLabel triggerClassName="generation-size" className="desk-popover"><h3>输出规格</h3><GenerationChoice kind="size" model={sharedModel} mode="image" aria-label="输出尺寸" value={selected.size} onChange={size=>patch({size})}/><label>质量<GenerationChoice kind="quality" model={sharedModel} aria-label="输出质量" value={selected.quality} onChange={quality=>patch({quality})}/></label></ToolPopover>
          </div>
          {parameterError&&<p className="node-warning" role="alert">{parameterError}</p>}
          <div className="recipe-footer editor-heading">
            <Button
              primary
              icon="generate"
              disabled={busy || submitting || !!parameterError}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await generateRecipe(selected.id);
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              {submitting ? "提交中" : "生成素材"}
            </Button>
            <Button iconOnly icon="canvas" onClick={() => addToCanvas("recipe", selected.id)}>
              加入画布
            </Button>
          </div>
        </>
      ) : (
        <EmptyState compact className="recipe-empty" icon="prompts" title="还没有配方" description="组合提示词模块，保存后重复使用。">
          <Button primary icon="add" onClick={add}>
            新建配方
          </Button>
        </EmptyState>
      )}
    </aside>
  );
}
