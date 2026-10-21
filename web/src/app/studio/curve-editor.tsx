"use client";
import { useRef, useState } from "react";
import type { Adjustment } from "./model";
import { curveLut } from "./tone-pixels";

export function CurveEditor({ adjustment, change, disabled }: { adjustment: Adjustment; change: (value: Adjustment) => void; disabled: boolean }) {
    const [channel, setChannel] = useState(0), [selected, setSelected] = useState(0), drag = useRef<number | undefined>(undefined);
    const curves = adjustment.curves!, points = curves[channel], lut = curveLut(points);
    const save = (next: number[][]) => change({ ...adjustment, curves: curves.map((p, i) => i === channel ? next : p) });
    const move = (index: number, x: number, y: number) => save(points.map((p, i) => i !== index ? p : [index === 0 ? 0 : index === points.length - 1 ? 1 : Math.max(points[index - 1][0] + .001, Math.min(points[index + 1][0] - .001, x)), Math.max(0, Math.min(1, y))]));
    const remove = () => { if (!disabled && selected > 0 && selected < points.length - 1) { save(points.filter((_, i) => i !== selected)); setSelected(0); } };
    return <div data-editor-input style={{ width: 268, color: "var(--studio-text)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <select aria-label="曲线通道" value={channel} onChange={e => { setChannel(+e.target.value); setSelected(0); }}>
                {["RGB", "红", "绿", "蓝"].map((label, i) => <option key={label} value={i}>{label}</option>)}
            </select>
            <button disabled={disabled} onClick={() => { save([[0, 0], [1, 1]]); setSelected(0); }}>重置通道</button>
        </div>
        <svg viewBox="-8 -8 272 272" aria-label="曲线编辑区" style={{ width: "100%", touchAction: "none", background: "var(--studio-bg)", border: "1px solid var(--studio-line)" }}
            onPointerDown={e => {
                if (disabled) return;
                const bounds = e.currentTarget.getBoundingClientRect(), x = Math.max(.001, Math.min(.999, ((e.clientX - bounds.left) / bounds.width * 272 - 8) / 256)), y = Math.max(0, Math.min(1, 1 - ((e.clientY - bounds.top) / bounds.height * 272 - 8) / 256));
                const index = (e.target as SVGElement).getAttribute("data-index");
                if (index !== null) drag.current = +index;
                else if (points.length < 16 && points.every(p => Math.abs(p[0] - x) >= .001)) {
                    const next = [...points, [x, y]].sort((a, b) => a[0] - b[0]); drag.current = next.findIndex(p => p[0] === x); save(next);
                }
                if (drag.current !== undefined) { setSelected(drag.current); e.currentTarget.setPointerCapture(e.pointerId); }
            }}
            onPointerMove={e => {
                if (drag.current === undefined || disabled) return;
                const b = e.currentTarget.getBoundingClientRect();
                move(drag.current, ((e.clientX - b.left) / b.width * 272 - 8) / 256, 1 - ((e.clientY - b.top) / b.height * 272 - 8) / 256);
            }}
            onPointerUp={() => { drag.current = undefined; }} onPointerCancel={() => { drag.current = undefined; }}>
            {[0, 64, 128, 192, 256].map(n => <path key={n} d={`M ${n} 0 V 256 M 0 ${n} H 256`} fill="none" stroke="var(--studio-line)" />)}
            <path d="M 0 256 L 256 0" stroke="var(--studio-muted)" strokeDasharray="4 4" />
            <polyline points={[...lut].map((y, x) => `${x * 256 / 255},${256 - y * 256}`).join(" ")} fill="none" stroke="var(--studio-accent)" strokeWidth="2" />
            {points.map(([x, y], i) => <circle key={i} data-index={i} cx={x * 256} cy={(1 - y) * 256} r={selected === i ? 5 : 4} fill="var(--studio-text)" stroke="var(--studio-bg)" tabIndex={disabled ? -1 : 0} aria-label={`曲线控制点 ${i + 1}`} onFocus={() => setSelected(i)}
                onKeyDown={e => {
                    if (["Delete", "Backspace", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) e.stopPropagation();
                    if (disabled) return;
                    if (e.key === "Delete") { e.preventDefault(); remove(); }
                    const d = 1 / 255;
                    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) { e.preventDefault(); move(i, x + (e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0), y + (e.key === "ArrowDown" ? -d : e.key === "ArrowUp" ? d : 0)); }
                }} />)}
        </svg>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10 }}><span style={{ fontSize: 12, color: "var(--studio-muted)" }}>点击加点，拖动调节</span><button disabled={disabled || selected === 0 || selected === points.length - 1} onClick={remove}>删除点</button></div>
    </div>;
}
