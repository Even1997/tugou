"use client";
import { useRef, type PointerEvent } from "react";
export type ToolRegion = { left: number; top: number; width: number; height: number };

export function ToolRegionPreview({ src, width, height, region, onChange }: { src: string; width: number; height: number; region: ToolRegion; onChange: (region: ToolRegion) => void }) {
    const start = useRef<{ x: number; y: number } | null>(null);
    const position = (e: PointerEvent<SVGSVGElement>) => {
        const matrix = e.currentTarget.getScreenCTM();
        if (!matrix) return null;
        const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
        return { x: Math.max(0, Math.min(width, Math.round(p.x))), y: Math.max(0, Math.min(height, Math.round(p.y))) };
    };
    return <div className="flex min-h-0 flex-1 flex-col gap-3">
        <p className="text-xs text-[var(--studio-muted)]">拖动框选范围，也可在顶部输入精确像素。</p>
        <svg aria-label="图片框选区域" className="checker min-h-0 w-full flex-1 touch-none rounded-lg" style={{ cursor: "crosshair" }} viewBox={`0 0 ${width} ${height}`}
            onPointerDown={e => { if (e.button !== 0) return; start.current = position(e); e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerMove={e => {
                const end = position(e), origin = start.current;
                if (!origin || !end || origin.x === end.x || origin.y === end.y) return;
                onChange({ left: Math.min(origin.x, end.x), top: Math.min(origin.y, end.y), width: Math.abs(end.x - origin.x), height: Math.abs(end.y - origin.y) });
            }}
            onPointerUp={e => { start.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }} onPointerCancel={() => { start.current = null; }}>
            <image href={src} width={width} height={height} />
            <rect x={region.left} y={region.top} width={region.width} height={region.height} fill="#809eff22" stroke="#809eff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
    </div>;
}
