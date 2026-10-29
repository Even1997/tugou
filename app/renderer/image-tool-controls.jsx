import {ColorControl} from './color-control.jsx';
import {Select} from './select.jsx';
import React from "react";
import { Button, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";

export function ImageToolControls({
  operation,
  value,
  update,
  luts,
  importLut,
  disabled,
}) {
  const number = (key, label, min, max, step = 1, unit) => (
    <NumberField
      label={label}
      shortLabel={unit ? `${label}（${unit}）` : undefined}
      value={value[key]}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onChange={(n) => update({ [key]: n })}
    />
  );
  if (!value) return <div className="tool-operation-note"><strong>无需设置参数</strong><p>{operation === 'mirror' ? '沿水平方向翻转整张图片，保留尺寸和透明度。' : '将整张图片顺时针旋转 90°，宽高互换。'}</p></div>;
  return (
    <fieldset
      className="image-tool-parameters"
      disabled={disabled}
      aria-label="图像工具参数"
    >
      {operation === "enhance" && (
        <>
          {number("strength", "质感强度", 0, 100, 1, "%")}
          <ToolPopover className="tools-parameter-popover" icon="info" showLabel label="质感调整说明">
            <p>
              增强局部细节与饱和度，保留原尺寸和透明度。强度为 0
              时不改变像素；可对照检查细线与半透明边缘。
            </p>
          </ToolPopover>
        </>
      )}
      {operation === "tile" && (
        <>
          {number("width", "输出宽度", 1, 30000)}
          {number("height", "输出高度", 1, 30000)}
          <ToolPopover className="tools-parameter-popover" icon="info" showLabel label="图片平铺说明">
            <p>
              从左上角按原尺寸重复排列，末行末列按输出边界裁切。透明区域保留；缩放、镜像和间距可在“重复图案”中设置。
            </p>
          </ToolPopover>
        </>
      )}
      {operation === "alpha" && (
        <>
          {number("shrink", "收缩", 0, 32, 1, "px")}
          {number("feather", "内侧羽化", 0, 32, 1, "px")}
          <label>
            去底色
            <Select
              aria-label="去底色"
              value={value.matte}
              onChange={(e) => update({ matte: e.target.value })}
            >
              <option value="none">不处理</option>
              <option value="white">去白边</option>
              <option value="black">去黑边</option>
            </Select>
          </label>
          <ToolPopover className="tools-parameter-popover" icon="info" showLabel label="透明边缘说明">
            <p>
              处理已有透明轮廓，保留孔洞和半透明层次。收缩与羽化向内作用；去底色只处理半透明像素。原图保留，可对照检查细发丝与薄纱。
            </p>
          </ToolPopover>
        </>
      )}
      {operation === "lut" && (
        <>
          <Select
            aria-label="LUT 预设"
            value={value.lutId}
            onChange={(e) => update({ lutId: e.target.value })}
          >
            <option value="">选择 LUT</option>
            {luts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <label className="lut-import">
            导入 .cube
            <input
              aria-label="导入 Cube LUT"
              type="file"
              accept=".cube"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) importLut(f);
              }}
            />
          </label>
          {number("strength", "强度", 0, 100, 1, "%")}
          <ToolPopover className="tools-parameter-popover" icon="info" showLabel label="LUT 说明">
            <p>
              支持独立 1D（2–65536 点）和 3D（2–65 点）Cube，含输入域与插值。LUT
              随工程保存，结果引用同一份预设。当前处理 8 位
              sRGB，导入预设须匹配原图色彩空间。
            </p>
          </ToolPopover>
        </>
      )}
      {operation === "light" && (
        <>
          <label>
            光型
            <Select
              aria-label="光型"
              value={value.kind}
              onChange={(e) => update({ kind: e.target.value })}
            >
              <option value="radial">径向光</option>
              <option value="directional">方向光</option>
            </Select>
          </label>
          {number("exposure", "曝光", -4, 4, 0.1, "EV")}
          <label>
            光色
            <ColorControl
              aria-label="光色"
              value={value.color}
              onChange={(e) => update({ color: e.target.value })}
            />
          </label>
          <ToolPopover className="tools-parameter-popover" icon="settings" showLabel label="光源位置">
            <div className="image-tool-detail">
              {number("centerX", "水平位置", 0, 100)}
              {number("centerY", "垂直位置", 0, 100)}
              {number("radius", "光照半径", 1, 200)}
              {number("angle", "方向角度", -180, 180)}
              <p>
                位置、半径单位为
                %。局部曝光在圆形范围内平滑衰减，保留原图透明度。
              </p>
            </div>
          </ToolPopover>
        </>
      )}
      {operation === "pattern" && (
        <>
          <label>
            排列
            <Select
              aria-label="图案排列"
              value={value.layout}
              onChange={(e) => update({ layout: e.target.value })}
            >
              <option value="repeat">重复</option>
              <option value="mirror">镜像</option>
              <option value="halfdrop">隔列错位</option>
            </Select>
          </label>
          {number("width", "输出宽度", 1, 30000)}
          {number("height", "输出高度", 1, 30000)}
          <ToolPopover className="tools-parameter-popover" icon="settings" showLabel label="图案参数">
            <div className="image-tool-detail">
              {number("motifScale", "图案倍率", 0.01, 4, 0.01)}
              {number("gap", "间距", 0, 5000)}
              <p>间距区域保持透明；不自动补画原图接缝。</p>
            </div>
          </ToolPopover>
        </>
      )}
      <Button disabled={disabled} onClick={() => update(null)}>
        重置参数
      </Button>
    </fieldset>
  );
}
