import {Select} from './select.jsx';
import React, { useRef } from "react";
import { Button, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";
import { originalUrl } from "./image-processing.js";

export function CompositionControls({
  operation,
  value,
  update,
  source,
  secondary,
  assets,
  disabled,
}) {
  const number = (key, label, min, max) => (
    <NumberField
      label={label}
      shortLabel={key === "strength" ? `${label}（%）` : undefined}
      value={value[key]}
      min={min}
      max={max}
      step={1}
      disabled={disabled}
      onChange={(n) => update({ [key]: n })}
    />
  );
  return (
    <fieldset
      className="image-tool-parameters"
      disabled={disabled}
      aria-label="组合工具参数"
    >
      {["mattePair", "texture", "patch"].includes(operation) && (
        <label>
          {operation === "mattePair"
            ? "白底版本"
            : operation === "patch"
              ? "替换素材"
              : "材质素材"}
          <Select
            aria-label="第二张素材"
            value={value.secondaryId}
            onChange={(e) => update({ secondaryId: e.target.value })}
          >
            <option value="">选择素材</option>
            {secondary && !assets.some((a) => a.id === secondary.id) && (
              <option value={secondary.id}>{secondary.name} · 历史素材</option>
            )}
            {assets
              .filter((a) => a.id !== source?.id)
              .map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </label>
      )}
      {["texture", "crop", "extract", "patch"].includes(operation) && (
        <>
          {operation === "texture" ? (
            <>
              {number("strength", "强度", 0, 100)}
            </>
          ) : (
            <span>
              {value.width} × {value.height} px
            </span>
          )}
          <ToolPopover className="tools-parameter-popover" showLabel label="框选参数" icon="fit">
            <div className="image-tool-detail">
              {number(
                "left",
                "选区左侧",
                0,
                Math.max(0, (source?.width || 1) - 1),
              )}
              {number(
                "top",
                "选区顶部",
                0,
                Math.max(0, (source?.height || 1) - 1),
              )}
              {number("width", "选区宽度", 1, source?.width || 30000)}
              {number("height", "选区高度", 1, source?.height || 30000)}
              {operation !== "crop" && number("feather", "选区羽化", 0, 1000)}
              <Button
                disabled={!source || disabled}
                onClick={() =>
                  update({
                    left: 0,
                    top: 0,
                    width: source.width,
                    height: source.height,
                  })
                }
              >
                选择整图
              </Button>
            </div>
          </ToolPopover>
        </>
      )}
      {operation === "mattePair" && (
        <ToolPopover className="tools-parameter-popover" icon="settings" showLabel label="边缘参数">
          <div className="image-tool-detail">
            {number("shrink", "收缩", 0, 32)}
            {number("feather", "内侧羽化", 0, 32)}
          </div>
        </ToolPopover>
      )}
      {operation === "split" && (
        <>
          <label>
            方式
            <Select
              aria-label="拆分方式"
              value={value.splitMode}
              onChange={(e) => update({ splitMode: e.target.value })}
            >
              <option value="alpha">透明岛</option>
              <option value="grid">网格</option>
            </Select>
          </label>
          {value.splitMode === "grid" ? (
            <>
              {number("rows", "拆分行数", 1, 16)}
              {number("columns", "拆分列数", 1, 16)}
            </>
          ) : (
            number("minArea", "拆分最小面积", 1, 1000000)
          )}
        </>
      )}
      <ToolPopover className="tools-parameter-popover" icon="info" showLabel label="组合工具说明">
        <div className="image-tool-detail">
          <p>
            {operation === "mattePair"
              ? "处理来源选黑底，第二张选白底。必须是同一主体在纯黑、纯白背景下的两个不透明版本，尺寸、位置、颜色一致。不能使用分别生成、未对齐的两张图。"
              : operation === "crop"
                ? "在原图拖动框选，输出只保留选区，画幅缩小为选区尺寸。原素材不变。"
                : operation === "extract"
                  ? "在原图拖动框选，保留原画幅和选区位置，选区外透明。羽化向选区内侧作用。"
                  : operation === "patch"
                    ? "第二张素材缩放至选区大小，按透明度覆盖原图，可向选区内羽化。选区外不变；透明替换像素保留下面原图。"
                    : operation === "texture"
                      ? "在左侧原图拖动框选。材质从选区左上角重复排列，按透明度与强度混合，原图透明度及选区外像素保留。"
                      : "输出保留原画幅与位置；最多 64 张，可一键加入画面叠放。透明岛按相邻可见像素识别，面积小的碎片集中保留，不自动丢弃。"}
          </p>
          {secondary && (
            <img
              className="composition-reference"
              src={originalUrl(secondary)}
              alt={operation === "mattePair" ? "白底参考图" : "材质参考图"}
            />
          )}
        </div>
      </ToolPopover>
    </fieldset>
  );
}

export function RegionPreview({
  source,
  region,
  update,
  disabled,
  label = "材质框选区域",
}) {
  const drag = useRef(null);
  const position = (e) => {
    const matrix = e.currentTarget.getScreenCTM();
    if (!matrix) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      matrix.inverse(),
    );
    return {
      x: Math.max(0, Math.min(source.width, Math.round(p.x))),
      y: Math.max(0, Math.min(source.height, Math.round(p.y))),
    };
  };
  const move = (e) => {
    if (!drag.current) return;
    const end = position(e),
      start = drag.current.start;
    if (!end || end.x === start.x || end.y === start.y) return;
    update({
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    });
  };
  const cancel = () => {
    if (drag.current) update(drag.current.before);
    drag.current = null;
  };
  return (
    <svg
      className="tool-region"
      aria-label={label}
      tabIndex={0}
      viewBox={`0 0 ${source.width} ${source.height}`}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        const start = position(e);
        if (!start) return;
        e.currentTarget.focus();
        drag.current = { start, before: { ...region } };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={move}
      onPointerUp={(e) => {
        move(e);
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          cancel();
          e.preventDefault();
        }
      }}
    >
      <image
        href={originalUrl(source)}
        width={source.width}
        height={source.height}
      />
      <rect
        x={region.left}
        y={region.top}
        width={region.width}
        height={region.height}
        fill="var(--accent)"
        fillOpacity=".18"
        stroke="var(--accent)"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
