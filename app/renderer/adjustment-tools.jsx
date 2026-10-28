import {ColorControl} from './color-control.jsx';
import {Select} from './select.jsx';
import React, { useEffect, useState, useRef } from "react";
import { Button, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";
import { fields, defaults, curveTable } from "../core/adjustments.cjs";

function CurveEditor({ value, onChange }) {
  const [channel, setChannel] = useState("rgb"),
    [selected, setSelected] = useState(0),
    [draft, setDraft] = useState(null);
  const drag = useRef(null),
    points = draft || value.channels[channel];
  useEffect(() => {
    setDraft(null);
    setSelected(0);
  }, [channel]);
  useEffect(() => {
    setDraft(null);
    setSelected((i) => Math.min(i, value.channels[channel].length - 1));
  }, [value, channel]);
  const update = (index, x, y, commit = true) => {
    const next = points.map((p, i) =>
      i === index
        ? [
            index === 0
              ? 0
              : index === points.length - 1
                ? 255
                : Math.max(
                    points[index - 1][0] + 1,
                    Math.min(points[index + 1][0] - 1, Math.round(x)),
                  ),
            Math.max(0, Math.min(255, Math.round(y))),
          ]
        : p,
    );
    if (commit)
      onChange({ ...value, channels: { ...value.channels, [channel]: next } });
    else setDraft(next);
    return next;
  };
  const at = (e) => {
    const b = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - b.left) / b.width) * 255,
      y: 255 - ((e.clientY - b.top) / b.height) * 255,
    };
  };
  const remove = () => {
    if (selected > 0 && selected < points.length - 1)
      onChange({
        ...value,
        channels: {
          ...value.channels,
          [channel]: points.filter((_, i) => i !== selected),
        },
      });
  };
  return (
    <div data-keep-open onKeyDown={(e) => e.stopPropagation()} style={{ width: 300 }}>
      <label>
        通道{" "}
        <Select
          aria-label="曲线通道"
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
        >
          {[
            ["rgb", "RGB"],
            ["red", "红"],
            ["green", "绿"],
            ["blue", "蓝"],
          ].map(([k, n]) => (
            <option key={k} value={k}>
              {n}
            </option>
          ))}
        </Select>
      </label>
      <svg
        role="application"
        aria-label="曲线控制点编辑器"
        tabIndex={0}
        viewBox="0 0 255 255"
        preserveAspectRatio="none"
        style={{
          width: 280,
          height: 220,
          display: "block",
          background: "var(--panel)",
          touchAction: "none",
          overflow: "visible",
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.focus();
          const p = at(e);
          let i = points.findIndex(
            (q) => Math.hypot(q[0] - p.x, q[1] - p.y) < 12,
          );
          if (i < 0) return;
          setSelected(i);
          drag.current = i;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onDoubleClick={(e) => {
          const p = at(e),
            x = Math.max(1, Math.min(254, Math.round(p.x)));
          if (points.length >= 32 || points.some((q) => Math.abs(q[0] - x) < 2))
            return;
          onChange({
            ...value,
            channels: {
              ...value.channels,
              [channel]: [
                ...points,
                [x, Math.max(0, Math.min(255, Math.round(p.y)))],
              ].sort((a, b) => a[0] - b[0]),
            },
          });
        }}
        onPointerMove={(e) => {
          if (drag.current === null) return;
          const p = at(e);
          update(drag.current, p.x, p.y, false);
        }}
        onPointerUp={(e) => {
          if (drag.current === null) return;
          const p = at(e);
          update(drag.current, p.x, p.y);
          drag.current = null;
          setDraft(null);
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            remove();
          } else if (e.key.startsWith("Arrow")) {
            e.preventDefault();
            const p = points[selected],
              step = e.shiftKey ? 10 : 1;
            update(
              selected,
              p[0] +
                (e.key === "ArrowRight"
                  ? step
                  : e.key === "ArrowLeft"
                    ? -step
                    : 0),
              p[1] +
                (e.key === "ArrowUp"
                  ? step
                  : e.key === "ArrowDown"
                    ? -step
                    : 0),
            );
          }
        }}
      >
        {[0, 64, 128, 192, 255].map((v) => (
          <g key={v} stroke="var(--line)" strokeWidth=".5">
            <line x1={v} y1="0" x2={v} y2="255" />
            <line x1="0" y1={v} x2="255" y2={v} />
          </g>
        ))}
        <polyline
          points={[...curveTable(points)]
            .map((y, x) => `${x},${255 - y}`)
            .join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p[0]}
            cy={255 - p[1]}
            r={i === selected ? 5 : 3}
            fill="var(--accent)"
          />
        ))}
      </svg>
      <div style={{ display: "grid", gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap: 8 }}>
        <NumberField
          label="曲线输入"
          value={points[selected]?.[0] || 0}
          min={0}
          max={255}
          onChange={(x) => update(selected, x, points[selected][1])}
        />
        <NumberField
          label="曲线输出"
          value={points[selected]?.[1] || 0}
          min={0}
          max={255}
          onChange={(y) => update(selected, points[selected][0], y)}
        />
      </div>
      <Button
        disabled={selected === 0 || selected === points.length - 1}
        onClick={remove}
      >
        删除控制点
      </Button>
      <span className="muted">双击加点 · 方向键微调</span>
    </div>
  );
}
export function AdjustmentTools({ layer, patch, onDone }) {
  const a = layer.adjustment,
    spec = fields[a.type],
    update = (values) => patch({ adjustment: { ...a, ...values } });
  const controls = Object.entries(spec.values).map(
    ([key, [label, , min, max, step = 1]]) => (
      <NumberField
        key={key}
        label={label}
        value={a[key]}
        min={min}
        max={max}
        step={step}
        onChange={(value) => update({ [key]: value })}
      />
    ),
  );
  return (
    <fieldset disabled={layer.locked} style={{ display: "contents" }}>
      <span>{spec.label}</span>
      <NumberField
        label="调整强度"
        value={Math.round(layer.opacity * 100)}
        min={0}
        max={100}
        onChange={(v) => patch({ opacity: v / 100 })}
      />
      {controls.slice(0, 1)}
      {a.type === "curves" && (
        <ToolPopover label="编辑曲线" className="curve-popover">
          <CurveEditor
            value={a}
            onChange={(adjustment) => patch({ adjustment })}
          />
        </ToolPopover>
      )}
      {a.type === "gradientMap" &&
        [
          ["dark", "暗部颜色"],
          ["light", "亮部颜色"],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <ColorControl
              aria-label={label}
              value={a[key]}
              onChange={(e) => update({ [key]: e.target.value })}
            />
          </label>
        ))}
      <ToolPopover label="调整选项">
        {controls.slice(1)}
        <label className="check">
          <input
            aria-label="调整剪贴"
            type="checkbox"
            checked={Boolean(layer.clipping)}
            onChange={(e) => patch({ clipping: e.target.checked })}
          />
          仅作用于剪贴图层
        </label>
        {a.type === "colorBalance" && (
          <>
            <label>
              色调范围{" "}
              <Select
                aria-label="色调范围"
                value={a.range}
                onChange={(e) => update({ range: e.target.value })}
              >
                {[
                  ["shadows", "阴影"],
                  ["midtones", "中间调"],
                  ["highlights", "高光"],
                ].map(([k, n]) => (
                  <option key={k} value={k}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={a.preserveLightness}
                onChange={(e) =>
                  update({ preserveLightness: e.target.checked })
                }
              />
              保留亮度
            </label>
          </>
        )}
        {["grain", "noise"].includes(a.type) && (
          <>
            <label className="check">
              <input
                type="checkbox"
                checked={a.monochrome}
                onChange={(e) => update({ monochrome: e.target.checked })}
              />
              单色
            </label>
            <NumberField
              label="噪点种子"
              value={a.seed}
              min={0}
              max={2147483647}
              onChange={(seed) => update({ seed })}
            />
          </>
        )}
        <Button
          onClick={() => patch({ adjustment: { ...a, ...defaults(a.type) } })}
        >
          重置调整
        </Button>
      </ToolPopover>
      <Button onClick={() => patch({ visible: layer.visible === false })}>
        {layer.visible === false ? "启用调整" : "停用调整"}
      </Button>
      <Button onClick={onDone}>完成</Button>
    </fieldset>
  );
}
