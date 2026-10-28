import {ColorControl} from './color-control.jsx';
import {Select} from './select.jsx';
import {FontPicker} from './font-picker.jsx';
import React, {useState} from "react";
import { Button, Input, TextArea } from "./components.jsx";
import { NumberField } from "./number-field.jsx";
import { nativeBlends, corners } from "../core/layers.cjs";
import {selectionMetrics} from '../core/workspace-geometry.cjs';
const blendLabels = [
  "正常",
  "变暗",
  "正片叠底",
  "颜色加深",
  "变亮",
  "滤色",
  "颜色减淡",
  "叠加",
  "柔光",
  "强光",
  "差值",
  "排除",
  "色相",
  "饱和度",
  "颜色",
  "明度",
];
function MaskRange({label,shortLabel,value,max,step=1,onChange}) {
  const [draft,setDraft]=useState(null);
  const commit=e=>{const next=Number(e.currentTarget.value);setDraft(null);if(next!==value)onChange(next)};
  return <div className="mask-range">
    <div><span>{shortLabel}</span><NumberField label={label} shortLabel={max===100?'%':'px'} value={value} min={0} max={max} step={step} onChange={onChange}/></div>
    <input type="range" aria-label={`${label}滑块`} min={0} max={max} step={step} value={draft??value} onChange={e=>setDraft(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} onPointerCancel={()=>setDraft(null)}/>
  </div>;
}
export function LayerAppearance({layer,patch,disabled}) {
  return <fieldset className="layer-appearance" disabled={!layer||disabled||layer.locked}>
    <Select aria-label="混合模式" value={layer?.blend||'source-over'} onChange={e=>patch({blend:e.target.value})}>
      {layer&&!nativeBlends.includes(layer.blend)&&<option value={layer.blend}>{layer.blend}（待接入）</option>}
      {nativeBlends.map((mode,i)=><option key={mode} value={mode}>{blendLabels[i]}</option>)}
    </Select>
    <NumberField label="不透明度 %" shortLabel="不透明度" value={(layer?.opacity??1)*100} min={0} max={100} onChange={value=>patch({opacity:value/100})}/>
  </fieldset>;
}
export function LayerProperties({ layer, patch, document, change, maskEditing, maskPreview='composite', onMaskView, onLoadMask, maskBusy, compact=false, boardName }) {
  const [linked,setLinked]=useState(false);
  const groupSize=layer?.kind==='group'?selectionMetrics(corners(document.layers,layer)):null;
  if(layer&&maskEditing){const mask=layer.mask||{x:0,y:0,width:1,height:1};return <fieldset disabled={layer.locked} className="layer-properties mask-properties">
    <h2>{layer.name} · 蒙版</h2>
    <p className={`inspector-caption ${mask.disabled?'mask-disabled-label':''}`}>{mask.disabled?'蒙版已停用': '蒙版已启用'} · {maskPreview==='overlay'?'红色仅提示隐藏区域':maskPreview==='original'?'原图预览暂时忽略蒙版':'黑色隐藏，白色恢复'}</p>
    <div className="mask-view-modes" role="group" aria-label="蒙版预览">{[['composite','合成','返回合成画面'],['original','原图','查看原图'],['alone','黑白','单独查看蒙版'],['overlay','叠加','叠加查看蒙版']].map(([mode,label,name])=><Button key={mode} disabled={!layer.mask} aria-label={name} aria-pressed={maskPreview===mode} onClick={()=>onMaskView(mode)}>{label}</Button>)}</div>
    <div className="property-grid"><Button disabled={!layer.mask||maskBusy} onClick={onLoadMask}>蒙版载入选区</Button><label className="check"><input type="checkbox" aria-label="启用蒙版" checked={!mask.disabled} onChange={e=>patch({mask:{...mask,disabled:!e.target.checked}})}/>启用蒙版</label></div>
    <MaskRange key={`${layer.id}-density`} label="蒙版浓度" shortLabel="浓度" value={mask.density??100} max={100} onChange={density=>patch({mask:{...mask,density}})}/>
    <MaskRange key={`${layer.id}-feather`} label="蒙版羽化" shortLabel="羽化" value={mask.feather||0} max={200} step={.5} onChange={feather=>patch({mask:{...mask,feather}})}/>
    <Button aria-label="反相蒙版" aria-pressed={Boolean(mask.inverted)} onClick={()=>patch({mask:{...mask,inverted:!mask.inverted}})}>反相</Button>
  </fieldset>}
  if (!layer)
    return (
      <div className="layer-properties">
        <h2>画布</h2>
        <div className="property-grid">
          <NumberField
            label="画布宽度"
            value={document.width}
            min={1}
            max={30000}
            onChange={(width) => {
              if (width * document.height <= 100000000)
                change({ ...document, width });
            }}
          />
          <NumberField
            label="画布高度"
            value={document.height}
            min={1}
            max={30000}
            onChange={(height) => {
              if (height * document.width <= 100000000)
                change({ ...document, height });
            }}
          />
        </div>
        <label>
          画布底色
          <ColorControl
            aria-label="画布底色"
            value={
              document.background === "transparent"
                ? "#ffffff"
                : document.background
            }
            onChange={(e) =>
              change({ ...document, background: e.target.value })
            }
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={document.background === "transparent"}
            onChange={(e) =>
              change({
                ...document,
                background: e.target.checked ? "transparent" : "#fffdf8",
              })
            }
          />
          透明画布
        </label>
      </div>
    );
  return (
    <div className="layer-properties">
      <Input
        className={compact?'inspector-name':undefined}
        aria-label="图层名称"
        value={layer.name}
        onChange={(e) => patch({ name: e.target.value })}
      />
      {compact&&<p className="inspector-caption">{({image:'图片图层',text:'文字图层',shape:'形状',group:'分组',adjustment:'调整图层'})[layer.kind]}{boardName&&` / ${boardName}`}</p>}
      <fieldset disabled={layer.locked}>
        <div className="property-grid transform-grid">
          <NumberField
            label="X"
            shortLabel={compact?'X':undefined}
            value={layer.x}
            onChange={(x) => patch({ x })}
          />
          <NumberField
            label="Y"
            shortLabel={compact?'Y':undefined}
            value={layer.y}
            onChange={(y) => patch({ y })}
          />
          <NumberField
            label="宽度"
            shortLabel={compact?'W':undefined}
            value={groupSize?.width??layer.width}
            min={linked?Math.max(1,layer.width/layer.height):1}
            max={linked?Math.min(30000,30000*layer.width/layer.height):30000}
            disabled={layer.kind === "group"}
            onChange={(width) => patch({ width, ...(linked?{height:layer.height*width/layer.width}:{}) })}
          />
          <NumberField
            label="高度"
            shortLabel={compact?'H':undefined}
            value={groupSize?.height??layer.height}
            min={linked?Math.max(1,layer.height/layer.width):1}
            max={linked?Math.min(30000,30000*layer.height/layer.width):30000}
            disabled={layer.kind === "group"}
            onChange={(height) => patch({ height, ...(linked?{width:layer.width*height/layer.height}:{}) })}
          />
          <NumberField
            label="旋转"
            shortLabel={compact?'角度':undefined}
            value={layer.rotation}
            onChange={(rotation) => patch({ rotation })}
          />
          {compact?<Button aria-pressed={linked} disabled={layer.kind==='group'} onClick={()=>setLinked(!linked)}>等比缩放</Button>:<NumberField
            label="不透明度 %"
            value={layer.opacity * 100}
            min={0}
            max={100}
            onChange={(value) => patch({ opacity: value / 100 })}
          />}
        </div>
        {compact&&<div className="property-grid flip-actions"><Button onClick={()=>patch({flipX:!layer.flipX})}>水平翻转</Button><Button onClick={()=>patch({flipY:!layer.flipY})}>垂直翻转</Button></div>}
        {!compact&&<label>
          混合
          <Select
            aria-label="混合模式"
            value={layer.blend}
            onChange={(e) => patch({ blend: e.target.value })}
          >
            {!nativeBlends.includes(layer.blend) && (
              <option value={layer.blend}>{layer.blend}（待接入）</option>
            )}
            {nativeBlends.map((mode, i) => (
              <option value={mode} key={mode}>
                {blendLabels[i]}
              </option>
            ))}
          </Select>
        </label>}
        {layer.kind === "text" && (
          <>
            <label>
              文字
              <TextArea
                aria-label="图层文字"
                value={layer.text}
                onChange={(e) => patch({ text: e.target.value })}
              />
            </label>
            <label>
              字体
              <FontPicker key={layer.id} layer={layer} onChange={patch}/>
            </label>
            <div className="property-grid">
              <NumberField
                label="字号"
                value={layer.fontSize || 32}
                min={1}
                max={1000}
                onChange={(fontSize) => patch({ fontSize })}
              />
              <NumberField
                label="行距"
                value={layer.lineHeight || 1.4}
                min={0.5}
                max={5}
                step={0.1}
                onChange={(lineHeight) => patch({ lineHeight })}
              />
              <NumberField
                label="字距"
                value={layer.letterSpacing || 0}
                min={-50}
                max={200}
                onChange={(letterSpacing) => patch({ letterSpacing })}
              />
              <label>
                颜色
                <ColorControl
                  aria-label="文字颜色"
                  value={layer.color || "#222222"}
                  onChange={(e) => patch({ color: e.target.value })}
                />
              </label>
            </div>
            <label>
              字形
              <Select
                aria-label="文字字形"
                value={layer.fontStyle || "normal"}
                onChange={(e) => patch({ fontStyle: e.target.value })}
              >
                {[
                  ["normal", "常规"],
                  ["bold", "粗体"],
                  ["italic", "斜体"],
                  ["bold italic", "粗斜体"],
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
            <label>
              对齐
              <Select
                aria-label="文字对齐"
                value={layer.align || "left"}
                onChange={(e) => patch({ align: e.target.value })}
              >
                {[
                  ["left", "左对齐"],
                  ["center", "居中"],
                  ["right", "右对齐"],
                  ["justify", "两端对齐"],
                ].map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </Select>
            </label>
          </>
        )}
        {layer.kind === "shape" && (
          <>
            <label className="check"><input type="checkbox" aria-label="形状填充开关" checked={layer.fill!==false} onChange={e=>patch({fill:e.target.checked})}/>填充</label>
            <div className="property-grid">
              <label>
                填充
                <ColorControl
                  aria-label="形状填充"
                  disabled={layer.fill===false}
                  value={layer.color || "#b0bff2"}
                  onChange={(e) => patch({ color: e.target.value })}
                />
              </label>
              <label>
                描边
                <ColorControl
                  aria-label="形状描边"
                  value={layer.stroke || "#222222"}
                  onChange={(e) => patch({ stroke: e.target.value })}
                />
              </label>
              <NumberField
                label="描边宽度"
                value={layer.strokeWidth || 0}
                min={0}
                max={500}
                onChange={(strokeWidth) => patch({ strokeWidth })}
              />
              {[undefined,"rect","rounded"].includes(layer.shape)&&<NumberField
                label="圆角"
                value={layer.radius || 0}
                min={0}
                max={10000}
                onChange={(radius) => patch({ radius })}
              />}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(layer.gradient)}
                onChange={(e) =>
                  patch({
                    gradient: e.target.checked
                      ? { endColor: "#ffffff", angle: 0 }
                      : undefined,
                  })
                }
              />
              渐变填充
            </label>
            {layer.gradient && (
              <div className="property-grid">
                <label>
                  结束颜色
                  <ColorControl
                    aria-label="渐变结束颜色"
                    value={layer.gradient.endColor}
                    onChange={(e) =>
                      patch({
                        gradient: {
                          ...layer.gradient,
                          endColor: e.target.value,
                        },
                      })
                    }
                  />
                </label>
                <NumberField
                  label="渐变角度"
                  value={layer.gradient.angle}
                  onChange={(angle) =>
                    patch({ gradient: { ...layer.gradient, angle } })
                  }
                />
              </div>
            )}
          </>
        )}
        <details>
          <summary>精确变换</summary>
          <div className="property-grid">
            <NumberField
              label="缩放 X"
              value={layer.scaleX ?? 1}
              step={0.1}
              min={0.001}
              max={1000}
              onChange={(scaleX) => patch({ scaleX })}
            />
            <NumberField
              label="缩放 Y"
              value={layer.scaleY ?? 1}
              step={0.1}
              min={0.001}
              max={1000}
              onChange={(scaleY) => patch({ scaleY })}
            />
            <NumberField
              label="倾斜"
              value={layer.skewX || 0}
              min={-80}
              max={80}
              onChange={(skewX) => patch({ skewX })}
            />
          </div>
        </details>
        {layer.mask && (
          <details open>
            <summary>蒙版</summary>
            <NumberField label="蒙版浓度" value={layer.mask.density??100} min={0} max={100} onChange={density=>patch({mask:{...layer.mask,density}})}/>
            <NumberField
              label="蒙版羽化"
              value={layer.mask.feather || 0}
              min={0}
              max={200}
              onChange={(feather) =>
                patch({ mask: { ...layer.mask, feather } })
              }
            />
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(layer.mask.inverted)}
                onChange={(e) =>
                  patch({ mask: { ...layer.mask, inverted: e.target.checked } })
                }
              />
              反相蒙版
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={!layer.mask.disabled}
                onChange={(e) =>
                  patch({
                    mask: { ...layer.mask, disabled: !e.target.checked },
                  })
                }
              />
              启用蒙版
            </label>
          </details>
        )}
      </fieldset>
    </div>
  );
}
