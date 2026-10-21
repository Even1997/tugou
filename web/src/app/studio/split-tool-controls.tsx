"use client";
import { InputNumber, Select } from "antd";
import type { ToolOptions } from "./tool-schema";

export function SplitToolControls({ options, onChange }: { options: ToolOptions; onChange: (value: Partial<ToolOptions>) => void }) {
    return <><Select aria-label="拆分方式" className="w-36" value={options.splitMode} options={[{ value: "alpha", label: "透明岛自动拆分" }, { value: "grid", label: "网格拆分" }]} onChange={splitMode => onChange({ splitMode })} />
        {options.splitMode === "alpha" ? <label className="flex items-center gap-2 text-sm">最小面积<InputNumber aria-label="拆分最小面积" className="w-24" min={1} max={1000000} precision={0} value={options.minArea} onChange={minArea => onChange({ minArea: minArea || 1 })} /><span className="text-xs text-[var(--studio-muted)]">px</span></label> : <>
            <label className="flex items-center gap-2 text-sm">行<InputNumber aria-label="拆分行数" className="w-20" min={1} max={16} precision={0} value={options.rows} onChange={rows => onChange({ rows: rows || 1 })} /></label>
            <label className="flex items-center gap-2 text-sm">列<InputNumber aria-label="拆分列数" className="w-20" min={1} max={16} precision={0} value={options.columns} onChange={columns => onChange({ columns: columns || 1 })} /></label>
        </>}
    </>;
}
