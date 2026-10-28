import {ColorControl} from './color-control.jsx';
import {Select} from './select.jsx';
import React from "react";
import { Button, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";

export const paintDefaults = {
  size: 32,
  opacity: 100,
  hardness: 80,
  smoothing: 20,
  color: "#353535",
  line: false,
  pressure: true,
  aligned: true,
  blurRadius: 8,
  target: "image",
  maskMode: "hide",
};
export function MaskInk({value,onChange,disabled}) {
  return <div className="mask-ink" role="group" aria-label="蒙版颜色">{[['hide','黑色 · 隐藏'],['reveal','白色 · 恢复']].map(([mode,label])=><Button key={mode} disabled={disabled} aria-label={`蒙版${label}`} aria-pressed={value===mode} onClick={()=>onChange(mode)}><span className={`mask-ink-swatch ${mode}`} aria-hidden="true"/>{label}</Button>)}</div>;
}
export function PaintTools({
  options,
  onChange,
  onNew,
  busy,
  maskDisabled=false,
  tool = "brush",
  source,
  onSample,
  onClear,
  compact=false,
}) {
  const patch = (value) => onChange({ ...options, ...value });
  const paint = ["brush", "eraser"].includes(tool);
  return (
    <>
      {paint && (
        <label>
          目标
          <Select
            aria-label="绘制目标"
            value={options.target || "image"}
            onChange={(e) => patch({ target: e.target.value })}
          >
            <option value="image">图像</option>
            <option value="mask">蒙版</option>
          </Select>
        </label>
      )}
      {paint && options.target === "mask" && (
        <MaskInk value={options.maskMode||'hide'} onChange={maskMode=>patch({maskMode})} disabled={busy||maskDisabled}/>
      )}
      {paint && options.target !== "mask" && (
        <Button onClick={onNew} disabled={busy}>
          新建绘画图层
        </Button>
      )}
      {tool === "brush" && options.target !== "mask" && (
        <label>
          颜色
          <ColorControl
            aria-label="画笔颜色"
            value={options.color}
            onChange={(e) => patch({ color: e.target.value })}
          />
        </label>
      )}
      {["clone", "heal"].includes(tool) && (
        <>
          <Button aria-label="设置来源" onClick={onSample}>
            {source ? "重新取样" : "设置来源"}
          </Button>
          {tool === "heal" && source && (
            <Button onClick={onClear}>恢复自动</Button>
          )}
        </>
      )}
      <NumberField
        label="笔刷大小"
        shortLabel={compact?'大小':undefined}
        value={options.size}
        min={1}
        max={2000}
        onChange={(size) => patch({ size })}
      />
      <NumberField
        label={paint ? "笔刷不透明度" : "强度"}
        shortLabel={compact?(paint?'不透明度':'强度'):undefined}
        value={options.opacity}
        min={1}
        max={100}
        onChange={(opacity) => patch({ opacity })}
      />
      {tool === "blur" && (
        <NumberField
          label="模糊半径"
          value={options.blurRadius}
          min={1}
          max={100}
          onChange={(blurRadius) => patch({ blurRadius })}
        />
      )}
      <ToolPopover label="笔刷设置" showLabel className="paint-settings">
        <NumberField
          label="硬度"
          value={options.hardness}
          min={0}
          max={100}
          onChange={(hardness) => patch({ hardness })}
        />
        <NumberField
          label={paint ? "平滑（屏幕像素）" : "平滑"}
          value={options.smoothing}
          min={0}
          max={100}
          onChange={(smoothing) => patch({ smoothing })}
        />
        {paint && (
          <label>
            <input
              type="checkbox"
              checked={options.line}
              onChange={(e) => patch({ line: e.target.checked })}
            />
            直线
          </label>
        )}
        {["clone", "heal"].includes(tool) && (
          <label>
            <input
              type="checkbox"
              checked={options.aligned}
              onChange={(e) => patch({ aligned: e.target.checked })}
            />
            跨笔对齐
          </label>
        )}
        <label>
          <input
            type="checkbox"
            checked={options.pressure}
            onChange={(e) => patch({ pressure: e.target.checked })}
          />
          压感
        </label>
      </ToolPopover>
    </>
  );
}
