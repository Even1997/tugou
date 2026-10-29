import {Select} from './select.jsx';
import React from "react";
import { Button, Checkbox, Input, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";
export function CloudControls({
  operation,
  value,
  source,
  update,
  disabled,
  assets,
  mask,
  selectionAvailable,
  selectionLayers,
  selectionLayerId,
  setSelectionLayerId,
  captureSelection,
  paintMask,
}) {
  const number = (key, label, min = 0, max = 30000) => (
    <NumberField
      label={label}
      value={value[key]}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(n) => update({ [key]: Math.round(n) })}
    />
  );
  return (
    <fieldset
      className="image-tool-parameters"
      aria-label="云端参数"
      disabled={disabled}
    >
      {operation === "cloudEdit" && <Button primary disabled={disabled || !source} onClick={paintMask}>涂画修改区域</Button>}
        <label className="tool-primary-input">
          修改要求{operation === 'cloudEdit' ? '（必填）' : '（可选）'}
          <Input.TextArea
            aria-label="云端修改要求"
            value={value.instruction}
            maxLength={4000}
            rows={4}
            placeholder={operation === 'cloudEdit' ? '例如：去掉选区内的杂物，补全背景' : '描述需要保留或补充的内容'}
            onChange={(e) => update({ instruction: e.target.value })}
          />
        </label>
      {operation === "cloudUpscale" && (
        <label>
          倍率
          <Select
            aria-label="创意放大倍率"
            value={value.scale}
            onChange={(e) => update({ scale: Number(e.target.value) })}
          >
            {[2, 3, 4].map((n) => (
              <option value={n} key={n}>
                {n}×
              </option>
            ))}
          </Select>
        </label>
      )}
      {operation === "cloudEdit" && (
        <>
          <label>
            区域
            <Select
              aria-label="修改区域来源"
              value={value.maskMode}
              onChange={(e) => update({ maskMode: e.target.value })}
            >
              <option value="rectangle">矩形框选</option>
              <option value="asset">蒙版素材</option>
            </Select>
          </label>
          {value.maskMode === "rectangle" ? (
            <ToolPopover className="tools-parameter-popover" icon="settings" label="修改区域" showLabel>
              <div className="image-tool-detail">
                {number("left", "选区左侧")}
                {number("top", "选区顶部")}
                {number("width", "选区宽度", 1)}
                {number("height", "选区高度", 1)}
                {number("feather", "选区羽化", 0, 1000)}
              </div>
            </ToolPopover>
          ) : (
            <>
              <label>
                蒙版
                <Select
                  aria-label="修改蒙版素材"
                  value={value.maskId}
                  onChange={(e) => update({ maskId: e.target.value })}
                >
                  <option value="">选择素材</option>
                  {mask && !assets.some((a) => a.id === mask.id) && (
                    <option value={mask.id}>{mask.name} · 历史蒙版</option>
                  )}
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </label>
            <ToolPopover icon="settings" label="蒙版规则" showLabel className="tools-parameter-popover cloud-mask-rules">
                <div className="image-tool-detail">
                  {number("feather", "蒙版向内羽化（px）", 0, 1000)}
                  <p>默认 0；增大可柔化修改边缘，不会扩大涂画范围。过大可能保留原有内容。</p>
                  <label>
                    读取
                    <Select
                      aria-label="蒙版读取通道"
                      value={value.maskChannel}
                      onChange={(e) => update({ maskChannel: e.target.value })}
                    >
                      <option value="alpha">透明度</option>
                      <option value="luminance">黑白亮度</option>
                    </Select>
                  </label>
                  <Checkbox
                    checked={value.invertMask}
                    onChange={(e) => update({ invertMask: e.target.checked })}
                  >
                    反转修改区域
                  </Checkbox>
                  <p>
                    {value.maskChannel === "alpha"
                      ? "不透明处修改，透明处保护；半透明处按强度混合。"
                      : "白色修改，黑色保护；灰色按亮度混合，透明度同时参与。"}
                    蓝色预览表示修改区。蒙版必须与原图等大。
                  </p>
                </div>
              </ToolPopover>
            </>
          )}
          <ToolPopover className="tools-parameter-popover" icon="settings" label="选区映射" showLabel>
            <label>映射到来源
              <Select aria-label="选区映射图层" value={selectionLayerId} onChange={e => setSelectionLayerId(e.target.value)}>
                <option value="">画布原坐标（同尺寸）</option>
                {selectionLayers.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            </label>
            <p>按所选图层的位置、旋转、翻转和透视映射到原图；画布外区域保持不修改。</p>
          </ToolPopover>
          <Button
            disabled={disabled || !selectionAvailable}
            title="将当前选区读取为原图尺寸的蒙版快照"
            onClick={captureSelection}
          >
            读取画面选区
          </Button>
        </>
      )}
      {operation === "cloudExtend" && (
        <>
          {number("width", "扩图宽度", 1)}
          {number("height", "扩图高度", 1)}
          <ToolPopover className="tools-parameter-popover" icon="settings" label="原图位置" showLabel>
            <div className="image-tool-detail">
              {number("left", "原图左侧")}
              {number("top", "原图顶部")}
              <Button
                disabled={
                  !source ||
                  value.width < source.width ||
                  value.height < source.height
                }
                onClick={() =>
                  update({
                    left: Math.floor((value.width - source.width) / 2),
                    top: Math.floor((value.height - source.height) / 2),
                  })
                }
              >
                原图居中
              </Button>
            </div>
          </ToolPopover>
        </>
      )}
      <span className="muted">原图和要求将发送至已配置模型</span>
    </fieldset>
  );
}
