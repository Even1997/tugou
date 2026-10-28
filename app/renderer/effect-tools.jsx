import {ColorControl} from './color-control.jsx';
import {Select} from './select.jsx';
import React from "react";
import { Button, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";
import { types, defaults, blends } from "../core/effects.cjs";
const blendLabels = [
  "正常",
  "正片叠底",
  "滤色",
  "叠加",
  "柔光",
  "强光",
  "变暗",
  "变亮",
  "颜色减淡",
  "颜色加深",
  "差值",
  "排除",
  "色相",
  "饱和度",
  "颜色",
  "明度",
];
export function EffectTools({ layer, effectId, onSelect, patch, onDone }) {
  const effect =
    layer.effects.find((e) => e.id === effectId) || layer.effects[0];
  if (!effect || !types[effect.type]) return null;
  const update = (values) =>
    patch({
      effects: layer.effects.map((e) =>
        e.id === effect.id ? { ...e, ...values } : e,
      ),
    });
  const controls = Object.entries(types[effect.type].values).map(
    ([key, [label, , min, max, step = 1]]) => (
      <NumberField
        key={key}
        label={label}
        value={effect[key]}
        min={min}
        max={max}
        step={step}
        onChange={(v) => update({ [key]: v })}
      />
    ),
  );
  return (
    <fieldset
      className="effect-parameters"
      disabled={layer.locked}
      style={{ display: "contents" }}
    >
      <label>
        特效
        <Select
          aria-label="当前图层特效"
          value={effect.id}
          onChange={(e) => onSelect(e.target.value)}
          style={{ maxWidth: 130 }}
        >
          {layer.effects.map((e, i) => (
            <option key={e.id} value={e.id}>
              {types[e.type]?.label || "未知特效"} {i + 1}
              {e.enabled ? "" : " · 停用"}
            </option>
          ))}
        </Select>
      </label>
      <label>
        颜色
        <ColorControl
          aria-label="特效颜色"
          value={effect.color}
          onChange={(e) => update({ color: e.target.value })}
        />
      </label>
      <NumberField
        label="特效强度"
        value={effect.opacity}
        min={0}
        max={100}
        onChange={(opacity) => update({ opacity })}
      />
      {controls.slice(0, 1)}
      <ToolPopover label="特效选项">
        {controls.slice(1)}
        {effect.type === "stroke" && (
          <label>
            位置
            <Select
              aria-label="描边位置"
              value={effect.position}
              onChange={(e) => update({ position: e.target.value })}
            >
              {[
                ["outside", "外侧"],
                ["inside", "内侧"],
                ["center", "居中"],
              ].map(([v, n]) => (
                <option key={v} value={v}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        )}
        <label>
          混合
          <Select
            aria-label="特效混合"
            value={effect.blend}
            onChange={(e) => update({ blend: e.target.value })}
          >
            {blends.map((v, i) => (
              <option key={v} value={v}>
                {blendLabels[i]}
              </option>
            ))}
          </Select>
        </label>
        <Button
          onClick={() => update({ ...defaults(effect.type), id: effect.id })}
        >
          重置特效
        </Button>
        <Button
          onClick={() =>
            patch({ effects: layer.effects.filter((e) => e.id !== effect.id) })
          }
        >
          移除特效
        </Button>
      </ToolPopover>
      <Button onClick={() => update({ enabled: !effect.enabled })}>
        {effect.enabled ? "停用特效" : "启用特效"}
      </Button>
      <Button onClick={onDone}>完成</Button>
    </fieldset>
  );
}
