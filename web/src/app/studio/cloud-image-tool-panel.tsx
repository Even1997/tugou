"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Input, InputNumber, Select } from "antd";
import { useStudio } from "./store";
import { studioRequest } from "./client-api";
import { uid } from "./model";
import type { GenerationInput, GenerationJob } from "./generation-schema";
import { cloudImageTools, cloudOperation, cloudOutputSize, splitTargets } from "./cloud-tool-input.js";
import { GenerationTaskList, type GenerationTasks } from "./generation-task-list";
import { collectGeneration, alignGeneration } from "./collect-generation";
import { ToolImagePreview } from "./tool-image-preview";
import { ToolRegionPreview } from "./tool-region-preview";
import { selectionOnLayer } from "./selection-raster";

type Kind = NonNullable<GenerationInput["operation"]>["kind"];
export function CloudImageToolPanel({ tasks, notify, onLocal }: { tasks: GenerationTasks; notify: (message: string) => void; onLocal: () => void }) {
    const p = useStudio(s => s.project), selected = useStudio(s => s.selected);
    const [sourceId, setSource] = useState(p.layers.find(l => l.id === selected[0])?.assetId || p.assets[0]?.id);
    const source = p.assets.find(a => a.id === sourceId);
    const sourceLayer = selected.length === 1 ? p.layers.find(l => l.id === selected[0] && l.kind === "image" && l.assetId === sourceId && !l.bitmap) : undefined;
    const [kind, setKind] = useState<Kind>("enhance"), [instruction, setInstruction] = useState("");
    const [scale, setScale] = useState(2), [region, setRegion] = useState({ left: 0, top: 0, width: source?.width || 1024, height: source?.height || 1024 });
    const [previewId, setPreview] = useState(""), [original, setOriginal] = useState(false);
    const [error, setError] = useState(""), [submitting, setSubmitting] = useState(false);
    const [selectionMask, setSelectionMask] = useState<string>(), [preparingMask, setPreparingMask] = useState(false);
    const [analysing, setAnalysing] = useState(false), analysisController = useRef<AbortController>(undefined);
    const maskController = useRef<AbortController>(undefined), overlayId = useId();
    const alive = useRef(true), attempt = useRef(new Map<string, string>());
    useEffect(() => {
        alive.current = true;
        return () => { alive.current = false; maskController.current?.abort(); analysisController.current?.abort(); };
    }, [p.id]);
    const reset = (id: string, mode = kind) => {
        const a = p.assets.find(a => a.id === id);
        maskController.current?.abort(); setPreparingMask(false); setSelectionMask(undefined);
        analysisController.current?.abort(); setAnalysing(false);
        setSource(id); setPreview(""); setError(""); setKind(mode);
        if (mode === "segment") setInstruction(p.splitPlans?.find(s => s.sourceId === id)?.targets || "");
        else if (kind === "segment") setInstruction("");
        if (a) setRegion({ left: 0, top: 0, width: a.width + (mode === "outpaint" ? Math.round(a.width / 4) : 0), height: a.height + (mode === "outpaint" ? Math.round(a.height / 4) : 0) });
    };
    const job = tasks.jobs.find(j => j.id === previewId), result = job?.result;
    const matchingLayers = job?.operation?.kind === "segment" ? p.layers.filter(l => l.kind === "image" && l.assetId === job.operation!.sourceId && !l.bitmap) : [];
    const alignedSource = matchingLayers.find(l => selected.includes(l.id)) || (matchingLayers.length === 1 ? matchingLayers[0] : undefined);
    const changeInstruction = (value: string) => {
        setInstruction(value);
        if (kind === "segment" && source) useStudio.getState().edit(current => ({ ...current, splitPlans: [...(current.splitPlans || []).filter(s => s.sourceId !== source.id && current.assets.some(a => a.id === s.sourceId)), { sourceId: source.id, targets: value }] }));
    };
    const identify = async () => {
        if (!source || analysing) return;
        const controller = analysisController.current = new AbortController(); setAnalysing(true); setError("");
        try {
            const result = await studioRequest<{ targets: string[] }>("split-categories", { image: source.dataUrl }, controller.signal);
            if (alive.current && !controller.signal.aborted) changeInstruction(result.targets.join("\n"));
        } catch (e) { if (alive.current && !controller.signal.aborted) setError((e as Error).message); }
        finally { if (alive.current && analysisController.current === controller) setAnalysing(false); }
    };
    const operation = source ? { kind, sourceId: source.id, sourceWidth: source.width, sourceHeight: source.height,
        ...(kind === "edit" && selectionMask ? { left: 0, top: 0, width: source.width, height: source.height } : kind === "edit" || kind === "outpaint" ? region : { left: 0, top: 0, width: source.width * (kind === "upscale" ? scale : 1), height: source.height * (kind === "upscale" ? scale : 1) }) } : undefined;
    const captureSelection = async () => {
        if (!source || !sourceLayer || !p.selection) return;
        maskController.current?.abort(); const controller = maskController.current = new AbortController();
        setPreparingMask(true); setError(""); let surface: HTMLCanvasElement | undefined;
        try {
            surface = await selectionOnLayer(p, sourceLayer, source.width, source.height, controller.signal);
            controller.signal.throwIfAborted();
            const stored = await studioRequest<{ dataUrl: string }>("resource-store", { dataUrl: surface.toDataURL("image/png") });
            controller.signal.throwIfAborted();
            if (alive.current) { setSelectionMask(stored.dataUrl); setPreview(""); }
        } catch (e) { if (alive.current && !controller.signal.aborted) setError((e as Error).message); }
        finally { if (surface) surface.width = surface.height = 0; if (alive.current && maskController.current === controller) setPreparingMask(false); }
    };
    const submit = async () => {
        if (!source || !operation || submitting) return;
        setSubmitting(true); setError("");
        try {
            const op = cloudOperation(operation), size = cloudOutputSize(op);
            if (kind === "edit" && !instruction.trim()) throw new Error("请描述选区内需要修改的内容");
            const targets = kind === "segment" ? splitTargets(instruction) : [instruction];
            for (const target of targets) {
                if (!alive.current) break;
                const key = JSON.stringify([p.id, source.dataUrl, op, target, selectionMask]);
                const id = attempt.current.get(key) || uid(); attempt.current.set(key, id);
                const submitted = await studioRequest<GenerationJob>("generation-submit", { id, projectId: p.id, name: `${source.name} · ${kind === "segment" ? target : cloudImageTools[kind]}`.slice(0, 200), prompt: target, size: `${size.width}x${size.height}`, references: [source.dataUrl], operation: op, selectionMask });
                tasks.upsert(submitted);
                if (alive.current) { setPreview(id); setOriginal(false); }
            }
            if (alive.current) notify("已加入云端队列，完成后可对比并存入素材库");
        } catch (e) { if (alive.current) setError((e as Error).message); }
        finally { if (alive.current) setSubmitting(false); }
    };
    const collect = (item: GenerationJob) => { useStudio.getState().edit(current => collectGeneration(current, item)); notify("结果已存入素材库，原素材保留"); };
    const align = () => {
        if (!job || !alignedSource) return;
        try { useStudio.getState().edit(current => alignGeneration(current, job, alignedSource.id)); notify("已对齐加入图层；原图层保留，可手动隐藏。支持撤销"); }
        catch (e) { setError((e as Error).message); }
    };
    const number = (key: keyof typeof region, label: string) => <label className="flex items-center gap-2 text-sm">{label}<InputNumber aria-label={`AI${label}`} className="w-24" min={key === "left" || key === "top" ? 0 : 1} max={30000} precision={0} value={region[key]} onChange={v => { if (v !== null) { setRegion(r => ({ ...r, [key]: v })); setPreview(""); } }} /></label>;
    const renderPreview = () => {
        if (result && job) return <>
            <div className="flex flex-wrap items-center gap-3"><Button type="text" onClick={() => setOriginal(v => !v)}>{original ? "显示结果" : "对比原图"}</Button><span className="text-sm">{result.width} × {result.height}</span>{job.operation?.kind === "segment" && <Button disabled={!alignedSource || p.layers.some(l => l.assetId === result.id)} title="按选中的来源图层对齐；有多个来源实例时请先选择一个" onClick={align}>对齐加入图层</Button>}<Button className="ml-auto" onClick={() => setPreview("")}>返回参数</Button></div>
            <ToolImagePreview src={original ? job.references[0] : result.dataUrl} alt={original ? "AI处理前" : "AI处理后"} />
        </>;
        if (!source) return <p className="m-auto text-[var(--studio-muted)]">先导入一张素材</p>;
        if (kind === "outpaint") return <svg role="img" aria-label="扩图画幅预览" viewBox={`0 0 ${region.width} ${region.height}`} className="checker min-h-0 w-full flex-1 rounded-lg"><image href={source.dataUrl} x={region.left} y={region.top} width={source.width} height={source.height} /></svg>;
        if (kind !== "edit") return <ToolImagePreview src={source.dataUrl} alt="AI原素材" />;
        if (!selectionMask) return <ToolRegionPreview src={source.dataUrl} width={source.width} height={source.height} region={region} onChange={r => { setRegion(r); setPreview(""); }} />;
        return <svg role="img" aria-label="画面选区预览" className="checker min-h-0 w-full flex-1 rounded-lg" viewBox={`0 0 ${source.width} ${source.height}`}>
            <defs><mask id={overlayId} maskUnits="userSpaceOnUse" style={{ maskType: "alpha" }} x={0} y={0} width={source.width} height={source.height}><image href={selectionMask} width={source.width} height={source.height} /></mask></defs>
            <image href={source.dataUrl} width={source.width} height={source.height} /><rect width={source.width} height={source.height} fill="var(--studio-accent)" opacity={.4} mask={`url(#${overlayId})`} />
        </svg>;
    };
    return <section className="studio-ui flex min-h-0 flex-1 flex-col" aria-label="云端图片工具">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-panel)] px-5 py-3" aria-label="云端图片参数">
            <Button type="text" onClick={onLocal}>本地工具</Button>
            <Select aria-label="AI处理素材" disabled={submitting} className="min-w-48 flex-1" value={sourceId} placeholder="先导入素材" options={p.assets.map(a => ({ value: a.id, label: a.name }))} onChange={id => reset(id)} />
            <Select aria-label="AI处理方式" disabled={submitting} className="w-40" value={kind} options={Object.entries(cloudImageTools).map(([value, label]) => ({ value, label }))} onChange={value => reset(sourceId!, value)} />
            {kind === "segment" && <Button disabled={!source || submitting} loading={analysing} onClick={() => void identify()}>识别类别</Button>}
            {kind === "upscale" && <Select aria-label="创意放大倍率" value={scale} options={[2, 4].map(value => ({ value, label: `${value} 倍` }))} onChange={v => { setScale(v); setPreview(""); }} />}
            {kind === "edit" && <><Button disabled={!p.selection || !sourceLayer || submitting} loading={preparingMask} title="使用选中图片图层上的画面选区；已绘制修改的图层需先另存素材" onClick={() => void captureSelection()}>{selectionMask ? "更新画面选区" : "使用画面选区"}</Button>{selectionMask && <Button type="text" onClick={() => { setSelectionMask(undefined); setPreview(""); }}>改用矩形</Button>}</>}
            {(kind === "edit" && !selectionMask) || kind === "outpaint" ? <>{number("width", "宽度")}{number("height", "高度")}{number("left", "左边")}{number("top", "顶部")}</> : operation && <span className="text-xs text-[var(--studio-muted)]">{operation.width} × {operation.height} px</span>}
            <Button type="primary" disabled={!source || preparingMask || analysing} loading={submitting} onClick={() => void submit()}>{kind === "segment" ? "按类别拆分" : "开始 AI 处理"}</Button>
            <Input.TextArea aria-label="AI处理要求" disabled={analysing || submitting} className="w-full" autoSize={{ minRows: kind === "segment" ? 2 : 1, maxRows: 4 }} maxLength={kind === "segment" ? 3600 : 30000} placeholder={kind === "segment" ? "每行一个对象，可直接填写或识别后修改，例如：左侧的新娘与婚纱\n前景的蓝白花束" : kind === "edit" ? "描述选区内要修改的内容" : "补充处理要求（可选）"} value={instruction} onChange={e => changeInstruction(e.target.value)} />
        </div>
        <div className="px-5 py-2 text-xs text-[var(--studio-muted)]"><p>原图和处理要求将发送到“模型连接”中的 API，可能计费；模型须支持图片编辑和请求尺寸。</p>
            <p>{kind === "segment" ? "最多12类，每类调用一次生成模型。模型需支持原尺寸黑白蒙版；本机保留原图颜色，仅提取可见部分，不补全遮挡。识别类别使用视觉分析模型。" : kind === "edit" ? selectionMask ? "蓝色区域为已捕获的画面选区；保留羽化，选区外像素由本机保护。" : "拖动框选，或捕获选中图片图层的画面选区；选区外像素由本机保护。" : kind === "outpaint" ? "宽高为最终画幅，左边/顶部为原图偏移；原图区域保持不变。" : "保留来源透明度；必须由模型返回请求尺寸，不会自动插值放大。"}</p>
            {error && <p role="alert" className="text-[var(--studio-danger)]">{error}</p>}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] max-[900px]:grid-cols-[minmax(0,1fr)_240px]">
            <div className="flex min-h-0 min-w-0 flex-col gap-3 p-5">
                {renderPreview()}
            </div>
            <aside className="overflow-auto border-l border-[var(--studio-line)] p-4"><GenerationTaskList tasks={{ ...tasks, jobs: tasks.jobs.filter(j => j.operation) }} onCollect={collect} onPreview={item => {
                analysisController.current?.abort(); setAnalysing(false);
                const op = item.operation!; setSource(op.sourceId); setKind(op.kind); setRegion({ left: op.left, top: op.top, width: op.width, height: op.height });
                if (op.kind === "upscale") setScale(op.width / op.sourceWidth);
                maskController.current?.abort(); setPreparingMask(false); setSelectionMask(item.selectionMask);
                setInstruction(item.instruction || ""); setPreview(item.id); setOriginal(false); setError("");
            }} /></aside>
        </div>
    </section>;
}
