"use client";
import { thumbnailUrl } from "./resource-url.js";
import { useState } from "react";
import { AutoComplete, Button, Checkbox, Collapse, Input, Popover, Select, Switch, Tag } from "antd";
import { Plus, Shapes, Trash2, Copy, ArrowRight, ArrowUp, ArrowDown, WandSparkles, Search, ScanLine, Settings2 } from "lucide-react";
import { referenceRolePresets, uniqueReferences } from "./reference-roles.js";
import { useStudio } from "./store";
import { uid, buildPrompt, isGlobalModule, recipeIsStale, type PromptModule, type Recipe } from "./model";
import { Field, IconButton, ModuleMark, PanelHeader } from "./ui";

type WorkspaceProps = { generate: (recipe: Recipe) => void; openCanvas: (recipe: Recipe) => void; analyze: () => void; notify: (message: string) => void; busy: boolean };

export function PromptWorkspace({ generate, openCanvas, analyze, notify, busy }: WorkspaceProps) {
    const p = useStudio((s) => s.project);
    const edit = useStudio((s) => s.edit);
    const [moduleId, setModuleId] = useState(p.modules[0]?.id);
    const [recipeId, setRecipeId] = useState(p.recipes[0]?.id);
    const [search, setSearch] = useState("");
    const module = p.modules.find((m) => m.id === moduleId) || p.modules[0];
    const recipe = p.recipes.find((r) => r.id === recipeId) || p.recipes[0];
    const addModule = () => {
        const m = { id: uid(), name: "新模块", kind: "自定义", text: "", global: false };
        edit((p) => ({ ...p, modules: [...p.modules, m] }));
        setModuleId(m.id);
    };
    const addRecipe = () => {
        const r: Recipe = { id: uid(), name: "新素材配方", moduleIds: [], references: [], output: "完整呈现主体，四周适当留白，不含文字。需要透明素材时使用真实 alpha，不绘制棋盘格。", size: "1024x1536" };
        edit((p) => ({ ...p, recipes: [...p.recipes, r] }));
        setRecipeId(r.id);
    };
    const filtered = p.modules.filter((m) => `${m.name} ${m.kind}`.includes(search.trim()));
    return (
        <div className="studio-ui grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_320px] max-[1100px]:grid-cols-[180px_minmax(0,1fr)_290px] max-[800px]:grid-cols-1 max-[800px]:overflow-y-auto">
            <aside className="flex min-h-0 flex-col border-r border-[var(--studio-line)] bg-[var(--studio-panel)] max-[800px]:max-h-60">
                <PanelHeader
                    title="模块"
                    count={p.modules.length}
                    actions={
                        <IconButton label="添加模块" onClick={addModule}>
                            <Plus size={16} />
                        </IconButton>
                    }
                />
                <div className="px-4 pb-3">
                    <Input aria-label="搜索模块" prefix={<Search size={14} />} placeholder="搜索模块" allowClear value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <nav aria-label="提示词模块" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-4">
                    {filtered.map((m) => (
                        <button
                            key={m.id}
                            aria-label={`选择模块 ${m.name}`}
                            aria-pressed={module?.id === m.id}
                            onClick={() => setModuleId(m.id)}
                            className={`flex min-h-14 shrink-0 items-center gap-3 rounded-xl px-3 text-left transition-colors hover:bg-[var(--studio-fill)] focus-visible:outline-2 focus-visible:outline-[var(--studio-accent)] ${module?.id === m.id ? "bg-[var(--studio-fill)]" : ""}`}
                        >
                            <ModuleMark kind={m.kind} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium">{m.name}</span>
                            {isGlobalModule(m) && <span className="text-[10px] text-[var(--studio-accent)]">全局</span>}
                        </button>
                    ))}
                    {!filtered.length && <p className="py-8 text-center text-xs text-[var(--studio-muted)]">没有匹配的模块</p>}
                </nav>
                <div className="border-t border-[var(--studio-line)] p-4">
                    <Button block icon={<ScanLine size={15} />} onClick={analyze}>
                        从参考图提取
                    </Button>
                </div>
            </aside>
            <main className="min-w-0 overflow-y-auto px-8 py-8 max-[1100px]:px-5 max-[800px]:overflow-visible">
                <div className="mx-auto flex max-w-[840px] flex-col gap-6">
                    {module ? (
                        <ModuleEditor module={module} notify={notify} />
                    ) : (
                        <div className="flex min-h-80 flex-col items-center justify-center gap-4">
                            <Shapes size={32} />
                            <h2 className="text-lg">添加第一个模块</h2>
                            <Button type="primary" onClick={addModule}>
                                添加模块
                            </Button>
                        </div>
                    )}
                    <Collapse
                        ghost
                        items={[
                            {
                                key: "preview",
                                label: (
                                    <span className="text-sm">
                                        完整提示词<span className="ml-3 text-xs text-[var(--studio-muted)]">{recipe?.name}</span>
                                    </span>
                                ),
                                children: (
                                    <div className="flex flex-col gap-3">
                                        <div className="flex justify-end">
                                            <IconButton
                                                label="复制最终提示词"
                                                disabled={!recipe}
                                                onClick={async () => {
                                                    if (recipe) {
                                                        await navigator.clipboard.writeText(buildPrompt(p, recipe));
                                                        notify("已复制");
                                                    }
                                                }}
                                            >
                                                <Copy size={15} />
                                            </IconButton>
                                        </div>
                                        <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-sm leading-7 text-[var(--studio-muted)]">{recipe ? buildPrompt(p, recipe) : "创建配方后查看完整提示词。"}</pre>
                                    </div>
                                ),
                            },
                        ]}
                    />
                </div>
            </main>
            <aside className="flex min-h-0 flex-col border-l border-[var(--studio-line)] bg-[var(--studio-panel)] max-[800px]:min-h-[600px]">
                <PanelHeader
                    title="配方"
                    actions={
                        <IconButton label="添加配方" onClick={addRecipe}>
                            <Plus size={16} />
                        </IconButton>
                    }
                />
                <div className="flex items-center gap-2 px-5 pb-5">
                    <Select aria-label="当前配方" className="min-w-0 flex-1" value={recipe?.id} placeholder="选择配方" onChange={setRecipeId} options={p.recipes.map((r) => ({ value: r.id, label: r.name }))} />
                    {recipe && (
                        <Popover
                            title="配方设置"
                            trigger="click"
                            content={
                                <div className="studio-ui flex w-56 flex-col gap-3">
                                    <Input aria-label="配方名称" value={recipe.name} onChange={(e) => edit((p) => ({ ...p, recipes: p.recipes.map((r) => (r.id === recipe.id ? { ...r, name: e.target.value } : r)) }))} />
                                    <Button danger type="text" icon={<Trash2 size={14} />} onClick={() => edit((p) => ({ ...p, recipes: p.recipes.filter((r) => r.id !== recipe.id) }))}>
                                        删除配方（保留素材）
                                    </Button>
                                </div>
                            }
                        >
                            <Button type="text" aria-label="配方设置" icon={<Settings2 size={16} />} />
                        </Popover>
                    )}
                </div>
                {recipe ? (
                    <RecipeEditor key={recipe.id} recipe={recipe} generate={generate} openCanvas={openCanvas} busy={busy} />
                ) : (
                    <div className="p-5">
                        <Button block onClick={addRecipe}>
                            创建配方
                        </Button>
                    </div>
                )}
            </aside>
        </div>
    );
}

function ModuleEditor({ module, notify }: { module: PromptModule; notify: (message: string) => void }) {
    const p = useStudio((s) => s.project);
    const edit = useStudio((s) => s.edit);
    const patch = (values: Partial<PromptModule>) => edit((p) => ({ ...p, modules: p.modules.map((m) => (m.id === module.id ? { ...m, ...values } : m)) }));
    const uses = isGlobalModule(module) ? p.recipes.length : p.recipes.filter((r) => r.moduleIds.includes(module.id)).length;
    return (
        <>
            <div className="flex items-center gap-3">
                <ModuleMark kind={module.kind} />
                <Input aria-label="模块名称" variant="borderless" className="min-w-0 flex-1" styles={{ input: { fontSize: 24, fontWeight: 600, letterSpacing: "-.5px" } }} value={module.name} onChange={(e) => patch({ name: e.target.value })} />
                <IconButton
                    label="复制模块提示词"
                    onClick={async () => {
                        await navigator.clipboard.writeText(module.text);
                        notify("已复制");
                    }}
                >
                    <Copy size={16} />
                </IconButton>
                <IconButton label="删除模块" onClick={() => edit((p) => ({ ...p, modules: p.modules.filter((m) => m.id !== module.id), recipes: p.recipes.map((r) => ({ ...r, moduleIds: r.moduleIds.filter((id) => id !== module.id) })) }))}>
                    <Trash2 size={16} />
                </IconButton>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--studio-muted)]">
                <AutoComplete
                    aria-label="模块类型"
                    className="w-36"
                    value={module.kind === "style" ? "公共画风" : module.kind}
                    options={["公共画风", "人物", "动作", "服饰", "背景", "装饰", "道具", "宠物", "文字", "材质"].map((value) => ({ value }))}
                    onChange={(value) => patch({ kind: value === "公共画风" ? "style" : value })}
                />
                <label className="flex items-center gap-2 text-[var(--studio-text)]">
                    <Switch size="small" aria-label="应用全局" checked={isGlobalModule(module)} onChange={(global) => patch({ global })} />
                    应用全局
                </label>
                <span>{isGlobalModule(module) ? "全部配方自动应用" : `${uses} 个配方引用`}</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[var(--studio-line)] bg-[var(--studio-panel)]">
                <Input.TextArea
                    aria-label="模块提示词"
                    variant="borderless"
                    value={module.text}
                    placeholder="描述这个模块的内容…"
                    onChange={(e) => patch({ text: e.target.value })}
                    style={{ minHeight: 320, height: "min(46vh, 520px)", padding: 24, fontSize: 15, lineHeight: 2, resize: "vertical" }}
                />
                <div className="flex justify-end border-t border-[var(--studio-line)] px-6 py-3 text-xs text-[var(--studio-muted)]">
                    <span className="font-mono tabular-nums">{module.text.length} 字</span>
                </div>
            </div>
        </>
    );
}

function RecipeEditor({ recipe, generate, openCanvas, busy }: Pick<WorkspaceProps, "generate" | "openCanvas" | "busy"> & { recipe: Recipe }) {
    const p = useStudio((s) => s.project);
    const edit = useStudio((s) => s.edit);
    const patch = (values: Partial<Recipe>) => edit((p) => ({ ...p, recipes: p.recipes.map((r) => (r.id === recipe.id ? { ...r, ...values } : r)) }));
    return (
        <>
            <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6">
                <Field label="组合模块">
                    <div className="flex flex-col gap-3">
                        {p.modules.map((m) => (
                            <Checkbox key={m.id} checked={isGlobalModule(m) || recipe.moduleIds.includes(m.id)} disabled={isGlobalModule(m)} onChange={(e) => patch({ moduleIds: e.target.checked ? [...recipe.moduleIds, m.id] : recipe.moduleIds.filter((id) => id !== m.id) })}>
                                {m.name}
                                {isGlobalModule(m) && <span className="ml-2 text-xs text-[var(--studio-muted)]">全局</span>}
                            </Checkbox>
                        ))}
                    </div>
                </Field>
                <Field label="参考图">
                    {uniqueReferences(recipe.references).map((ref, i, references) => (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--studio-fill)] p-2" key={ref.assetId}>
                            <img alt={`参考图 ${i + 1}`} src={thumbnailUrl(p.assets.find((a) => a.id === ref.assetId)?.dataUrl)} loading="lazy" decoding="async" className="size-10 rounded-md object-contain bg-[var(--studio-fill)]" />
                            <span className="mr-auto text-xs">图片 {i + 1}</span>
                            {([-1, 1] as const).map(direction => <IconButton key={direction} label={`${direction < 0 ? "上移" : "下移"}参考图 ${i + 1}`} disabled={i + direction < 0 || i + direction >= references.length} onClick={() => {
                                const next = [...references]; [next[i], next[i + direction]] = [next[i + direction], next[i]]; patch({ references: next });
                            }}>{direction < 0 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}</IconButton>)}
                            <IconButton label={`移除参考图 ${i + 1}`} onClick={() => patch({ references: references.filter((_, n) => n !== i) })}>
                                <Trash2 size={14} />
                            </IconButton>
                            <AutoComplete className="w-full" aria-label={`图${i + 1}职责`} value={ref.role} options={referenceRolePresets} placeholder="选择或输入参考职责" onChange={role => patch({ references: references.map((r, n) => n === i ? { ...r, role } : r) })} />
                        </div>
                    ))}
                    <Select
                        aria-label="添加参考图"
                        value={null}
                        placeholder="从素材库选择"
                        disabled={uniqueReferences(recipe.references).length >= 12}
                        onChange={(assetId: string) => patch({ references: uniqueReferences([...recipe.references, { assetId, role: referenceRolePresets[0].value }]) })}
                        options={p.assets.filter(a => !recipe.references.some(r => r.assetId === a.id)).map((a) => ({ value: a.id, label: a.name }))}
                    />
                </Field>
                <Field label="构图与输出">
                    <Input.TextArea aria-label="构图与输出" autoSize={{ minRows: 3, maxRows: 6 }} value={recipe.output} onChange={(e) => patch({ output: e.target.value })} />
                </Field>
                <Field label="尺寸">
                    <Select
                        aria-label="生成尺寸"
                        value={recipe.size}
                        onChange={(size) => patch({ size })}
                        options={[
                            { value: "1024x1536", label: "竖版 · 1024 × 1536" },
                            { value: "1536x1024", label: "横版 · 1536 × 1024" },
                            { value: "1024x1024", label: "方形 · 1024 × 1024" },
                        ]}
                    />
                </Field>
            </div>
            <div className="flex shrink-0 flex-col gap-3 border-t border-[var(--studio-line)] p-5">
                {recipeIsStale(p, recipe) && (
                    <Tag className="self-start" color="gold">
                        提示词已更新
                    </Tag>
                )}
                <Button type="primary" block size="large" loading={busy} icon={<WandSparkles size={16} />} onClick={() => generate(recipe)}>
                    生成素材
                </Button>
                <span className="text-center text-xs text-[var(--studio-muted)]">提示词与参考图将发送到已配置的模型接口</span>
                <Button type="text" block icon={<ArrowRight size={15} />} onClick={() => openCanvas(recipe)}>
                    发送到画布
                </Button>
            </div>
        </>
    );
}
