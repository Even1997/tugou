"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Checkbox, InputNumber, Select, Slider } from "antd";
import { useStudio } from "./store";
import { studioRequest, readAsset } from "./client-api";
import { imageTools, type ImageTool, type ToolOptions, type ToolJob, type ToolOutput } from "./tool-schema";
import { uid, type Asset } from "./model";
import { ToolImagePreview } from "./tool-image-preview";
import { ToolRegionPreview } from "./tool-region-preview";
import { LocalToolSettings, type LocalToolCapability } from "./local-tool-settings";
import { ToolTaskList } from "./tool-task-list";
import type { ToolTasks } from "./use-tool-tasks";
import { CreativeToolControls } from "./creative-tool-controls";
import { SplitToolControls } from "./split-tool-controls";
import { collectToolResults } from "./collect-tool-results";
import { CloudImageToolPanel } from "./cloud-image-tool-panel";
import type { GenerationTasks } from "./generation-task-list";

const popupContainer = (trigger: HTMLElement) => trigger.closest("dialog") || trigger.parentElement!;
export function ImageToolPanel({ notify, tasks, cloudTasks, initialJob }: { notify: (message: string) => void; tasks: ToolTasks; cloudTasks: GenerationTasks; initialJob?: ToolJob }) {
    const [cloud, setCloud] = useState(false);
    const p = useStudio(s => s.project), selected = useStudio(s => s.selected);
    const [sourceId, setSource] = useState(initialJob?.sourceId || p.layers.find(l => l.id === selected[0])?.assetId || p.assets[0]?.id);
    const source = p.assets.find(a => a.id === sourceId);
    const [tool, setTool] = useState<ImageTool>(initialJob?.tool || "upscale");
    const [options, setOptions] = useState<ToolOptions>({ scale: 2, model: "illustration", intensity: .5, width: source?.width || 1024, height: source?.height || 1024, left: 0, top: 0, feather: 0, choke: 0, matte: "none", lightType: "linear", lightX: .5, lightY: .5, lightRadius: .75, angle: -45, exposure: .8, color: "#ffffff", pattern: "repeat", gap: 0, tileScale: 1, splitMode: "alpha", rows: 2, columns: 2, minArea: 16, ...initialJob?.options });
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false), [loading, setLoading] = useState(false);
    const [capability, setCapability] = useState<LocalToolCapability>();
    const [result, setResult] = useState<{ job: ToolJob; asset: Asset; source: string; index: number }>();
    const [batch, setBatch] = useState(false), [batchIds, setBatchIds] = useState<string[]>([]);
    const [secondaryId, setSecondary] = useState<string | undefined>(initialJob?.secondarySourceId);
    const [original, setOriginal] = useState(false);
    const regionTool = ["patch", "texture", "extract"].includes(tool);
    const cutoutModel = options.cutoutModel || (initialJob?.tool === "cutout" ? "standard" : capability?.cutoutDetail ? "detail" : "standard");
    const needsSecondary = ["mattePair", "patch", "texture"].includes(tool);
    const alive = useRef(true), request = useRef(0);
    const attempt = useRef(new Map<string, string>());
    useEffect(() => {
        alive.current = true;
        let stopped = false;
        void studioRequest<LocalToolCapability>("tool-capabilities").then(v => { if (!stopped) setCapability(v); }).catch(e => { if (!stopped) setError(e.message); });
        return () => { stopped = true; alive.current = false; };
    }, [p.id]);
    const patch = (values: Partial<ToolOptions>) => setOptions(o => ({ ...o, ...values }));
    const submit = async () => {
        const sources = batch ? p.assets.filter(a => batchIds.includes(a.id)) : source ? [source] : [];
        if (!sources.length || submitting) return;
        setSubmitting(true); setError("");
        try {
            for (const asset of sources) {
                if (!alive.current) break;
                const secondary = needsSecondary ? p.assets.find(a => a.id === secondaryId) : undefined;
                const submittedOptions = tool === "cutout" ? { ...options, cutoutModel } : options;
                const key = JSON.stringify([p.id, asset.id, tool, submittedOptions, secondary?.id]);
                const id = attempt.current.get(key) || uid(); attempt.current.set(key, id);
                const job = await studioRequest<ToolJob>("tool-submit", { id, projectId: p.id, sourceId: asset.id, name: asset.name, tool, options: submittedOptions, dataUrl: asset.dataUrl, secondarySourceId: secondary?.id, secondaryDataUrl: secondary?.dataUrl });
                tasks.upsert(job);
            }
            if (alive.current) notify("已加入本地处理队列，原素材保留");
        } catch (e) { if (alive.current) setError((e as Error).message); }
        finally { if (alive.current) setSubmitting(false); }
    };
    const preview = async (job: ToolJob, index = 0) => {
        const version = ++request.current;
        if (result?.job.id !== job.id) {
            setTool(job.tool); setSource(job.sourceId); setSecondary(job.secondarySourceId); setBatch(false);
            setOptions(previous => ({ ...previous, ...job.options, cutoutModel: job.options.cutoutModel || "standard" }));
        }
        setLoading(true); setError("");
        try {
            const [response, input] = await Promise.all([
                studioRequest<{ job: ToolJob; dataUrl: string }>("tool-result", { id: job.id, projectId: p.id, index }),
                result?.job.id === job.id ? Promise.resolve({ dataUrl: result.source }) : studioRequest<{ dataUrl: string }>("tool-source", { id: job.id, projectId: p.id }),
            ]);
            const asset = await readAsset(await (await fetch(response.dataUrl)).blob(), `${job.name} · ${response.job.outputs?.[index]?.name || imageTools[job.tool]}`);
            if (alive.current && request.current === version) { setResult({ job: response.job, asset, source: input.dataUrl, index }); setOriginal(false); }
        } catch (e) { if (alive.current && request.current === version) setError((e as Error).message); }
        finally { if (alive.current && request.current === version) setLoading(false); }
    };
    useEffect(() => { if (initialJob?.projectId === p.id) void preview(initialJob); }, [initialJob?.id, p.id]);
    const alignedSource = result && ["extract", "split"].includes(result.job.tool) ? p.layers.find(l => l.kind === "image" && l.assetId === result.job.sourceId && selected.includes(l.id)) || (p.layers.filter(l => l.kind === "image" && l.assetId === result.job.sourceId).length === 1 ? p.layers.find(l => l.assetId === result.job.sourceId) : undefined) : undefined;
    const collect = async (aligned = false, all = false) => {
        if (!result || useStudio.getState().project.id !== result.job.projectId) return;
        if (aligned && (!alignedSource || alignedSource.bitmap)) return;
        const { job, asset, index } = result;
        setLoading(true); setError("");
        try {
            let results = [{ asset, index }];
            if (all) {
                const response = await studioRequest<{ outputs: (ToolOutput & { index: number; dataUrl: string })[] }>("tool-results", { id: job.id, projectId: job.projectId });
                results = response.outputs.map(output => ({ index: output.index, asset: { id: uid(), name: `${job.name} · ${output.name}`, dataUrl: output.dataUrl, width: output.width, height: output.height, hasAlpha: output.hasAlpha, createdAt: new Date().toISOString() } }));
            }
            let ids: string[] = [];
            useStudio.getState().edit(current => {
                const collected = collectToolResults(current, job, results, aligned ? alignedSource!.id : undefined, aligned && all);
                ids = collected.selected; return collected.project;
            });
            if (aligned) useStudio.getState().select(ids);
            notify(aligned ? all ? "拆分图层已对齐加入，来源图层已隐藏；可一次撤销" : "已在来源图层上方对齐加入，可撤销" : "结果已保存到素材库，可作为新图层加入画面");
        } catch (e) { if (alive.current) setError((e as Error).message); }
        finally { if (alive.current) setLoading(false); }
    };
    const number = (key: "width" | "height" | "left" | "top", label: string) => <label className="flex items-center gap-2 text-sm">{label}<InputNumber aria-label={`工具${label}`} className="w-24" min={key === "left" || key === "top" ? 0 : 1} max={30000} precision={0} value={options[key]} onChange={value => { if (value !== null) patch({ [key]: value }); }} /></label>;
    if (cloud) return <CloudImageToolPanel tasks={cloudTasks} notify={notify} onLocal={() => setCloud(false)} />;
    return <section className="studio-ui flex min-h-0 flex-1 flex-col" aria-label="图片工具">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[var(--studio-line)] bg-[var(--studio-panel)] px-5 py-3" aria-label="图片工具参数">
            <Button type="text" onClick={() => setCloud(true)}>云端 AI</Button>
            <Checkbox checked={batch} disabled={needsSecondary} onChange={e => { setBatch(e.target.checked); if (!batchIds.length && sourceId) setBatchIds([sourceId]); }}>批量</Checkbox>
            {batch ? <Select mode="multiple" maxCount={20} maxTagCount={1} aria-label="批量素材" className="min-w-48 flex-1" value={batchIds} options={p.assets.map(a => ({ value: a.id, label: a.name }))} onChange={setBatchIds} /> :
            <Select getPopupContainer={popupContainer} aria-label="处理素材" className="min-w-48 flex-1" value={sourceId} placeholder="先导入素材" options={p.assets.map(a => ({ value: a.id, label: a.name }))} onChange={id => { request.current++; setLoading(false); setSource(id); setResult(undefined); const a = p.assets.find(a => a.id === id)!; patch({ width: a.width, height: a.height, left: 0, top: 0 }); }} />
            }
            <Select getPopupContainer={popupContainer} aria-label="图片处理工具" className="w-40" value={tool} options={Object.entries(imageTools).map(([value, label]) => ({ value, label }))} onChange={value => {
                request.current++; setLoading(false); setTool(value); setResult(undefined);
                if (["mattePair", "patch", "texture"].includes(value)) { setBatch(false); patch({ matte: "none" }); }
                if (source && ["crop", "patch", "texture", "extract"].includes(value) && ((options.left || 0) + (options.width || 0) > source.width || (options.top || 0) + (options.height || 0) > source.height)) patch({ left: 0, top: 0, width: source.width, height: source.height });
            }} />
            {needsSecondary && <Select aria-label={tool === "mattePair" ? "对应白底素材" : "替换素材"} className="w-48" placeholder={tool === "mattePair" ? "对应白底素材" : "选择辅助素材"} value={secondaryId} options={p.assets.filter(a => a.id !== sourceId).map(a => ({ value: a.id, label: a.name }))} onChange={setSecondary} />}
            {tool === "lut" && <label className="cursor-pointer rounded-lg border border-[var(--studio-line)] px-3 py-2 text-sm"><span>{options.lutName || "导入 .cube"}</span><input aria-label="LUT 文件" type="file" accept=".cube" className="sr-only" onChange={async e => {
                const file = e.target.files?.[0]; if (!file) return;
                try { if (file.size > 12_000_000) throw new Error("LUT 文件不能超过 12 MB"); patch({ lut: await file.text(), lutName: file.name }); setError(""); } catch (e) { setError((e as Error).message); }
            }} /></label>}
            {tool === "split" ? <SplitToolControls options={options} onChange={patch} /> : tool === "upscale" ? <>
                <Select getPopupContainer={popupContainer} aria-label="放大倍率" value={options.scale} options={[2, 4].map(value => ({ value, label: `${value} 倍` }))} onChange={scale => patch({ scale })} />
                <Select getPopupContainer={popupContainer} aria-label="超分模型" value={options.model} options={[{ value: "illustration", label: "插画" }, { value: "general", label: "通用" }]} onChange={model => patch({ model })} />
                {source && <span className="text-xs text-[var(--studio-muted)]">{source.width * options.scale!} × {source.height * options.scale!} px</span>}
            </> : tool === "cutout" || tool === "alpha" || tool === "mattePair" ? <>
                {tool === "cutout" && <Select aria-label="主体识别模式" value={cutoutModel} className="w-32" getPopupContainer={popupContainer} options={[{ value: "detail", label: "精细识别", disabled: !capability?.cutoutDetail }, { value: "standard", label: "轻量识别" }]} onChange={cutoutModel => patch({ cutoutModel })} />}
                <label className="flex items-center gap-2 text-sm">羽化<InputNumber aria-label="边缘羽化" className="w-20" min={0} max={10} step={.5} value={options.feather} onChange={v => patch({ feather: v ?? 0 })} /></label>
                <label className="flex items-center gap-2 text-sm">收缩<InputNumber aria-label="边缘收缩" className="w-20" min={-10} max={10} precision={0} value={options.choke} onChange={v => patch({ choke: v ?? 0 })} /></label>
                <Select aria-label="边缘去底色" value={options.matte} className="w-32" options={[{ value: "none", label: "保留边缘颜色" }, { value: "white", label: "去白色杂边" }, { value: "black", label: "去黑色杂边" }]} onChange={matte => patch({ matte })} />
            </> : tool === "relight" ? <CreativeToolControls tool={tool} options={options} onChange={patch} /> : tool === "enhance" || tool === "lut" ? <label className="flex flex-1 items-center gap-4 text-sm">强度<Slider aria-label="处理强度" className="min-w-40 flex-1" min={0} max={1} step={.05} value={options.intensity} onChange={intensity => patch({ intensity })} /></label> : <>{number("width", "宽度")}{number("height", "高度")}{(tool === "crop" || tool === "extend" || regionTool) && <>{number("left", "左边")}{number("top", "顶部")}</>}{regionTool && <label className="flex items-center gap-2 text-sm">内侧羽化<InputNumber aria-label="选区羽化" className="w-20" min={0} max={10} value={options.feather} onChange={v => patch({ feather: v ?? 0 })} /></label>}{tool === "pattern" && <CreativeToolControls tool={tool} options={options} onChange={patch} />}</>}
            <Button type="primary" loading={submitting} disabled={(batch ? !batchIds.length : !source) || (tool === "upscale" && !capability?.upscale) || (tool === "cutout" && !capability?.cutout) || (needsSecondary && (!secondaryId || secondaryId === sourceId)) || (tool === "lut" && !options.lut)} onClick={() => void submit()}>开始处理{batch && batchIds.length ? ` · ${batchIds.length}` : ""}</Button>
            <LocalToolSettings capability={capability} onSaved={setCapability} />
        </div>
        <div className="px-5 py-2"><p className="text-xs text-[var(--studio-muted)]">本地处理 · 保留原素材{tool === "enhance" ? " · 饱和度与锐度调整，不生成新细节" : ""}</p>
        {tool === "upscale" && capability && !capability.upscale && <p role="status">{capability.error}</p>}
        {tool === "cutout" && capability && !capability.cutout && <p role="status">请先安装本地抠图组件</p>}
        {tool === "cutout" && cutoutModel === "detail" && <p className="text-xs text-[var(--studio-muted)]">精细识别占用较多显存；资源紧张时可改用轻量识别。</p>}
        {tool === "mattePair" && <p className="text-xs text-[var(--studio-muted)]">左侧选择黑底原图，右侧选择同尺寸、同位置的白底版本。</p>}
        {regionTool && <p className="text-xs text-[var(--studio-muted)]">{tool === "extract" ? "保留原图尺寸，选区外变透明，便于图层对齐。" : tool === "texture" ? "按原尺寸平铺辅助素材，保留来源透明度；选区外像素不变。" : "将辅助素材铺满选区；选区外像素不变。"}</p>}
        {tool === "extend" && <p className="text-xs text-[var(--studio-muted)]">宽高为扩边后的尺寸，左边/顶部为原图偏移；新增区域透明。</p>}
        {tool === "relight" && <p className="text-xs text-[var(--studio-muted)]">二维光场调节曝光和光色，保留透明度，不推断物体深度或生成阴影。</p>}
        {tool === "pattern" && <p className="text-xs text-[var(--studio-muted)]">按原图案排列，保留透明间隙；可在更多参数中调整单元比例。</p>}
        {tool === "split" && <p className="text-xs text-[var(--studio-muted)]">{options.splitMode === "alpha" ? "分离透明底上互不相连的区域；小于最小面积的碎片归入“细小区域”，不按人物或物品语义识别。" : "按行列均分，完整覆盖边缘像素。"} 所有结果保留原画幅，最多 64 层。</p>}
        {error && <p role="alert" className="text-[var(--studio-danger)]">{error}</p>}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] max-[900px]:grid-cols-[minmax(0,1fr)_240px]">
        <div className="flex min-h-0 min-w-0 flex-col gap-3 p-5">
        {result ? <>
            <div className="flex flex-wrap items-center gap-3"><Button type="text" onClick={() => setOriginal(v => !v)}>{original ? "显示结果" : "对比原图"}</Button><span className="text-xs">{result.asset.width} × {result.asset.height}</span>{regionTool && <Button type="text" onClick={() => setResult(undefined)}>返回选区</Button>}
                {result.job.outputs && <Select aria-label="拆分结果" className="w-48" disabled={loading} value={result.index} options={result.job.outputs.map((output, index) => ({ value: index, label: `${index + 1}/${result.job.outputs!.length} · ${output.name}` }))} onChange={index => void preview(result.job, index)} />}
                <Button className="ml-auto" onClick={() => void collect()} disabled={loading || p.assets.some(a => a.toolJobId === result.job.id && (a.toolOutputIndex || 0) === result.index)}>存入素材库</Button>
                {result.job.outputs && <Button disabled={loading || result.job.outputs.every((_, index) => p.assets.some(a => a.toolJobId === result.job.id && (a.toolOutputIndex || 0) === index))} onClick={() => void collect(false, true)}>全部入库</Button>}
                {alignedSource && ["extract", "split"].includes(result.job.tool) && <Button disabled={loading || !!alignedSource.bitmap} title="按来源图层的变换加入；全部拆分入层会隐藏来源图层，可撤销" onClick={() => void collect(true, !!result.job.outputs)}>{result.job.outputs ? "全部对齐入层" : "对齐加入图层"}</Button>}
            </div>
            <ToolImagePreview alt={original ? "处理前" : "处理后"} src={original ? result.source : result.asset.dataUrl} />
        </> : source ? regionTool ? <ToolRegionPreview src={source.dataUrl} width={source.width} height={source.height} region={{ left: options.left || 0, top: options.top || 0, width: options.width || source.width, height: options.height || source.height }} onChange={patch} /> : <ToolImagePreview alt="输入素材" src={source.dataUrl} /> : <p className="m-auto text-sm text-[var(--studio-muted)]">从素材库导入图片后开始处理</p>}
        </div>
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-[var(--studio-line)] bg-[var(--studio-panel)] p-4">
            <h2 className="text-sm font-medium">处理记录</h2>
            <ToolTaskList tasks={tasks} onPreview={job => void preview(job)} loading={loading} />
        </div>
        </div>
    </section>;
}
