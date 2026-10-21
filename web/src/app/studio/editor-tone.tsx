"use client";
import { useEffect, useState } from "react";
import { Dropdown, InputNumber, Popover } from "antd";
import { SlidersHorizontal, Sparkles } from "lucide-react";
import { useStudio } from "./store";
import { createLayer, type Adjustment, type Layer, type LayerEffect } from "./model";
import { adjustmentDefinitions, effectDefinitions, defaultAdjustment, defaultEffect, validAdjustment, validEffects } from "./tone-schema.js";
import { isLayerLocked, transformValues, worldTransform } from "./layer-operations";
import { selectionMask } from "./selection-edit";
import { CurveEditor } from "./curve-editor";

type Field = { label: string; min: number; max: number; step: number; value: number };
export function useEditorTone(notify: (text: string) => void, editMask: () => void) {
    const project = useStudio(s => s.project), ids = useStudio(s => s.selected);
    const layer = ids.length === 1 ? project.layers.find(l => l.id === ids[0]) : undefined;
    const [effect, setEffect] = useState<LayerEffect["kind"]>(), [adding, setAdding] = useState(false);
    const [intent, setIntent] = useState(0);
    const locked = !layer || isLayerLocked(layer, project.layers);
    useEffect(() => { setEffect(undefined); }, [project.id, ids.join()]);
    const patch = (value: Partial<Layer>, key?: string) => {
        if (!layer || locked) return;
        useStudio.getState().edit(p => ({ ...p, version: 5, layers: p.layers.map(l => l.id === layer.id ? { ...l, ...value } : l) }), key ? `tone:${layer.id}:${key}` : undefined);
    };
    const add = async (kind: Adjustment["kind"]) => {
        if (adding) return;
        if (project.layers.length >= 500) return notify("工程最多支持 500 个图层");
        if (layer && locked) return notify("请先解锁所选图层");
        setAdding(true);
        try {
            const parent = layer?.parentId && project.layers.find(l => l.id === layer.parentId);
            const next: Layer = { ...createLayer("adjustment", adjustmentDefinitions[kind].label), width: project.width, height: project.height, parentId: layer?.parentId,
                ...(parent ? transformValues(worldTransform(parent, project.layers).invert()) : {}), adjustment: defaultAdjustment(kind) as Adjustment };
            if (project.selection) {
                const s = project.selection;
                next.mask = s.paths && !s.grow && !s.inverted ? { x: 0, y: 0, width: 1, height: 1, feather: s.feather, paths: s.paths.map(p => ({ ...p, points: p.points.map((n, i) => n / (i % 2 ? project.height : project.width)) })) } : { x: 0, y: 0, width: 1, height: 1, bitmap: await selectionMask(project, next) };
            }
            if (useStudio.getState().project !== project) return;
            const layers = [...project.layers], index = layer ? layers.findIndex(l => l.id === layer.id) + 1 : layers.length;
            layers.splice(index, 0, next);
            useStudio.getState().edit(p => ({ ...p, version: 5, layers })); useStudio.getState().select([next.id]);
            setIntent(n => n + 1);
        } catch (error) { notify((error as Error).message); } finally { setAdding(false); }
    };
    const activateEffect = (kind: LayerEffect["kind"]) => {
        if (!layer || locked || layer.kind === "adjustment") return notify("请选择未锁定的图片、文字、形状或组");
        if (!layer.effects?.some(e => e.kind === kind)) patch({ effects: [...(layer.effects || []), defaultEffect(kind) as LayerEffect] });
        setEffect(kind);
        setIntent(n => n + 1);
    };
    const activeEffect = layer?.effects?.find(e => e.kind === effect);
    const adjustment = layer?.adjustment;
    const changeAdjustment = (a: Adjustment, key: string = a.kind) => { if (validAdjustment(a)) patch({ adjustment: a }, key); };
    const changeEffect = (e: LayerEffect, key: string = e.kind) => { if (validEffects([e])) patch({ effects: layer!.effects!.map(old => old.kind === e.kind ? e : old) }, key); };
    const fields = (values: Record<string, number>, definitions: Record<string, Field>, change: (values: Record<string, number>, key: string) => void) => Object.entries(definitions).map(([key, f]) =>
        <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {f.max === 1 && f.min === 0 && f.step === 1 ? <button disabled={locked} className={values[key] ? "active" : ""} aria-label={f.label} aria-pressed={!!values[key]} onClick={() => change({ ...values, [key]: values[key] ? 0 : 1 }, key)}>{f.label}</button> :
                <><span>{f.label}</span><InputNumber aria-label={f.label} disabled={locked} value={values[key]} min={f.min} max={f.max} step={f.step} precision={f.step === 1 ? 0 : undefined} onChange={v => { if (v !== null) change({ ...values, [key]: Math.max(f.min, Math.min(f.max, f.step === 1 ? Math.round(v) : v)) }, key); }} style={{ width: 76 }} /></>}
        </span>);
    let controls: React.ReactNode[] = [];
    if (adjustment) controls = fields(adjustment.values, adjustmentDefinitions[adjustment.kind].fields, (values, key) => changeAdjustment({ ...adjustment, values }, key));
    if (activeEffect) controls = fields(activeEffect.values, effectDefinitions[activeEffect.kind].fields, (values, key) => changeEffect({ ...activeEffect, values }, key));
    const toolbar = (adjustment || activeEffect) && <div className="editor-controls" aria-label="调整与特效参数" style={{ flexWrap: "nowrap", whiteSpace: "nowrap", paddingTop: 0, paddingBottom: 0 }}>
        <div style={{ flexShrink: 0 }}>
            <span>{adjustment ? adjustmentDefinitions[adjustment.kind].label : effectDefinitions[activeEffect!.kind].label}</span>
            {activeEffect && <input aria-label="特效颜色" type="color" value={activeEffect.color} disabled={locked} onChange={e => changeEffect({ ...activeEffect, color: e.target.value }, "color")} style={{ width: 30 }} />}
            {controls.slice(0, 3)}
            {controls.length > 3 && <Popover getPopupContainer={node => node.closest<HTMLElement>(".studio") || document.body} trigger="click" placement="bottom" content={<div style={{ display: "grid", gap: 12 }}>{controls.slice(3)}</div>}><button>更多参数</button></Popover>}
            {adjustment?.kind === "curves" && <Popover getPopupContainer={node => node.closest<HTMLElement>(".studio") || document.body} trigger="click" placement="bottom" content={<CurveEditor adjustment={adjustment} change={changeAdjustment} disabled={locked} />}><button aria-label="编辑曲线">编辑曲线</button></Popover>}
            {adjustment?.kind === "gradient" && adjustment.colors!.map((color, i) => <input key={i} aria-label={i ? "高光颜色" : "阴影颜色"} type="color" value={color} disabled={locked} onChange={e => changeAdjustment({ ...adjustment, colors: adjustment.colors!.map((c, index) => index === i ? e.target.value : c) }, `color${i}`)} style={{ width: 36 }} />)}
            <span>强度</span><InputNumber aria-label="调整特效强度" min={0} max={100} disabled={locked} value={Math.round((activeEffect?.opacity ?? layer!.opacity) * 100)} onChange={v => activeEffect ? changeEffect({ ...activeEffect, opacity: (v ?? 100) / 100 }, "opacity") : patch({ opacity: (v ?? 100) / 100 }, "opacity")} suffix="%" style={{ width: 78 }} />
            {adjustment && <button disabled={locked} aria-label="调整仅作用下层" aria-pressed={!!layer!.clipping} className={layer!.clipping ? "active" : ""} title="剪贴到紧邻的下方内容图层" onClick={() => patch({ clipping: !layer!.clipping })}>仅下层</button>}
            <button disabled={locked} onClick={editMask}>蒙版</button>
            <button disabled={locked} aria-label="切换调整特效" aria-pressed={activeEffect ? activeEffect.enabled : layer!.visible} onClick={() => activeEffect ? changeEffect({ ...activeEffect, enabled: !activeEffect.enabled }) : patch({ visible: !layer!.visible })}>{(activeEffect ? activeEffect.enabled : layer!.visible) ? "停用" : "启用"}</button>
            <button disabled={locked} onClick={() => adjustment ? patch({ adjustment: defaultAdjustment(adjustment.kind) as Adjustment }) : patch({ effects: layer!.effects!.map(e => e.kind === activeEffect!.kind ? defaultEffect(e.kind) as LayerEffect : e) })}>重置</button>
        </div>
        {activeEffect && <div><button disabled={locked} aria-label="移除当前特效" onClick={() => { patch({ effects: layer!.effects!.filter(e => e.kind !== activeEffect.kind) }); setEffect(undefined); }}>移除</button><button aria-label="完成特效编辑" onClick={() => setEffect(undefined)}>完成</button></div>}
    </div>;
    return {
        intent,
        toolbar,
        trigger: <>
            <Dropdown trigger={["click"]} menu={{ items: Object.entries(adjustmentDefinitions).map(([key, d]) => ({ key, label: d.label, disabled: adding })), onClick: ({ key }) => void add(key as Adjustment["kind"]) }}>
                <button aria-label="添加调整图层" title="添加调整图层；当前选区会成为蒙版"><SlidersHorizontal size={16} /><span className="tone-label">调整</span></button>
            </Dropdown>
            <Dropdown trigger={["click"]} menu={{ items: Object.entries(effectDefinitions).map(([key, d]) => ({ key, label: `${layer?.effects?.some(e => e.kind === key) ? "✓ " : ""}${d.label}`, disabled: locked || layer?.kind === "adjustment" })), onClick: ({ key }) => activateEffect(key as LayerEffect["kind"]) }}>
                <button aria-label="图层特效" title="可重调的图层特效" disabled={locked || layer?.kind === "adjustment"}><Sparkles size={16} /><span className="tone-label">特效</span></button>
            </Dropdown>
        </>,
    };
}
