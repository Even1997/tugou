import {Select} from './select.jsx';
import React from "react";
import { Button, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";

export function GeometryControls({
  operation,
  value,
  source,
  update,
  disabled,
  scale,
  setScale,
  padding,
  setPadding,
}) {
  const resize = operation === "resize";
  const dimension = (key, label) => (
    <NumberField
      label={label}
      value={value[key]}
      min={1}
      max={30000}
      disabled={disabled}
      onChange={(n) => {
        const patch = { [key]: Math.round(n) };
        if (resize && value.lockRatio && source) {
          const other = key === "width" ? "height" : "width";
          patch[other] = Math.max(
            1,
            Math.round((n * source[other]) / source[key]),
          );
        }
        update(patch);
      }}
    />
  );
  return (
    <fieldset
      className="image-tool-parameters"
      disabled={disabled}
      aria-label="尺寸参数"
    >
      <label>
        方式
        <Select
          aria-label="尺寸方式"
          value={value.sizeMode}
          onChange={(e) => update({ sizeMode: e.target.value })}
        >
          <option value={resize ? "scale" : "padding"}>
            {resize ? "倍率" : "四边等宽"}
          </option>
          <option value="size">指定尺寸</option>
        </Select>
      </label>
      {value.sizeMode !== 'size' && (resize ? <label>倍率
        <Select aria-label="缩放倍率" value={scale} disabled={disabled} onChange={e=>setScale(Number(e.target.value))}>
          {[0.25,0.5,1,2,4].map(n=><option key={n} value={n}>{n}×</option>)}
        </Select>
      </label> : <NumberField label="扩边像素" value={padding} min={0} max={5000} disabled={disabled} onChange={n=>setPadding(Math.round(n))}/>)}
      {value.sizeMode === "size" && (
        <>
          {dimension("width", "输出宽度")}
          {dimension("height", "输出高度")}
          {resize ? (
            <label>
              <input
                type="checkbox"
                aria-label="锁定原图比例"
                checked={value.lockRatio}
                onChange={(e) => update({ lockRatio: e.target.checked })}
              />
              锁定原图比例
            </label>
          ) : (
            <ToolPopover className="tools-parameter-popover" showLabel label="原图位置" icon="fit">
              <div className="image-tool-detail">
                <NumberField
                  label="原图左侧"
                  value={value.left}
                  min={0}
                  max={30000}
                  disabled={disabled}
                  onChange={(left) => update({ left: Math.round(left) })}
                />
                <NumberField
                  label="原图顶部"
                  value={value.top}
                  min={0}
                  max={30000}
                  disabled={disabled}
                  onChange={(top) => update({ top: Math.round(top) })}
                />
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
          )}
        </>
      )}
      {source && <div className="tool-output-size"><span>预计输出</span><strong>{value.sizeMode === 'size' ? value.width : resize ? Math.round(source.width*scale) : source.width+padding*2} × {value.sizeMode === 'size' ? value.height : resize ? Math.round(source.height*scale) : source.height+padding*2} <small>px</small></strong></div>}
      <ToolPopover className="tools-parameter-popover" icon="info" showLabel label="尺寸说明">
        <p>
          {resize
            ? "指定宽高使用插值缩放。锁定比例按原图比例计算；关闭后可单独修改宽高。"
            : "新增画布保持透明。指定尺寸须容纳完整原图及偏移，原图像素不缩放。"}
        </p>
      </ToolPopover>
    </fieldset>
  );
}
