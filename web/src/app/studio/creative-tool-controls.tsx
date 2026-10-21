"use client";
import { Button, InputNumber, Popover, Select } from "antd";
import type { ImageTool, ToolOptions } from "./tool-schema";

export function CreativeToolControls({ tool, options: o, onChange }: { tool: ImageTool; options: ToolOptions; onChange: (patch: Partial<ToolOptions>) => void }) {
    const number = (key: keyof ToolOptions, label: string, min: number, max: number, step = 1) => <label className="flex items-center justify-between gap-3 text-sm">{label}<InputNumber aria-label={label} className="w-24" value={o[key] as number} min={min} max={max} step={step} onChange={value => { if (value !== null) onChange({ [key]: value }); }} /></label>;
    const container = (trigger: HTMLElement) => trigger.closest<HTMLElement>(".studio-ui") || document.body;
    if (tool === "pattern") return <>
        <Select aria-label="排列方式" className="w-36" value={o.pattern} options={[{ value: "repeat", label: "重复排列" }, { value: "mirror", label: "镜像排列" }, { value: "half-drop", label: "隔列错位" }]} onChange={pattern => onChange({ pattern })} />
        <Popover getPopupContainer={container} trigger="click" content={<div className="flex flex-col gap-4 p-1">{number("tileScale", "单元缩放", .05, 4, .05)}{number("gap", "透明间距", 0, 4096)}</div>}><Button type="text">更多参数</Button></Popover>
    </>;
    if (tool !== "relight") return null;
    return <>
        <Select aria-label="光照类型" className="w-32" value={o.lightType} options={[{ value: "linear", label: "方向光" }, { value: "radial", label: "径向光" }]} onChange={lightType => onChange({ lightType })} />
        {number("exposure", "曝光强度", -3, 3, .1)}
        <label className="flex items-center gap-2 text-sm">光色<input aria-label="光照颜色" type="color" className="h-9 w-10 cursor-pointer rounded border border-[var(--studio-line)] p-1" value={o.color} onChange={e => onChange({ color: e.target.value })} /></label>
        <Popover getPopupContainer={container} trigger="click" content={<div className="flex flex-col gap-4 p-1">{o.lightType === "linear" ? number("angle", "光照角度", -180, 180) : <>{number("lightX", "光源横向位置", 0, 1, .05)}{number("lightY", "光源纵向位置", 0, 1, .05)}{number("lightRadius", "光照半径", .05, 2, .05)}<span className="text-xs text-[var(--studio-muted)]">位置按画幅比例，半径按短边比例。</span></>}</div>}><Button type="text">更多参数</Button></Popover>
    </>;
}
