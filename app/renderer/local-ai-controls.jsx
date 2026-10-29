import {Select} from './select.jsx';
import React, { useEffect, useState } from "react";
import { Button, FormDialog, ToolPopover } from "./components.jsx";
import { RuntimeInstallControls } from "./runtime-install.jsx";
import { localToolReadiness } from "../core/local-readiness.cjs";
import cutoutModels from '../runtime/cutout-models.json';
import { NumberField } from './number-field.jsx';
import { ToolDownload } from './tool-download.jsx';

export function LocalAIControls({ operation, value, update, disabled, onStatus, source }) {
  const [open, setOpen] = useState(false),
    [runtime, setRuntime] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const [installing, setInstalling] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setBusy(true);
    window.tugou
      .localToolsStatus()
      .then((r) => {
        if (active) {
          setRuntime(r);
          setProvider(r.cutout ? r.provider || "" : "");
        }
      })
      .catch((e) => {
        if (active) { setError(e.message); setRuntime({configured:false, message:e.message}); }
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [open, operation, refresh]);
  useEffect(() => { onStatus?.(runtime); }, [runtime, onStatus]);
  const readiness = localToolReadiness(runtime, { operation, ...value }, source);
  return (
    <fieldset
      className="image-tool-parameters"
      disabled={disabled}
      aria-label="本地 AI 参数"
    >
      <ToolDownload operation={operation} model={value.model} runtime={runtime} provider={provider} disabled={disabled||busy} onInstalled={()=>setRefresh(n=>n+1)}/>
      {operation === 'cutout' && <>
        <label>抠图模型<Select aria-label="抠图模型" value={value.model || 'birefnet'} onChange={e => update({model:e.target.value})}>
          {Object.entries(cutoutModels).map(([key, model]) => <option key={key} value={key}>{model.name}</option>)}
        </Select></label>
        <p className="muted">{value.model === 'u2netp' ? '低内存、CPU 离线处理。适合普通主体；发丝、薄纱和复杂背景建议使用精细模型并检查边缘。' : '精细主体模型需要更多内存；不足时可切换轻量模型。'}</p>
        <NumberField label="边缘收缩（px）" min={0} max={4} value={value.edgeShrink ?? 0} disabled={disabled} onChange={n => update({edgeShrink:Math.round(n)})}/>
        <NumberField label="向内羽化（px）" min={0} max={4} step={0.5} value={value.edgeFeather ?? 0} disabled={disabled} onChange={n => update({edgeFeather:n})}/>
        <p className="muted">按原图像素调整，0 表示关闭。白边可先尝试收缩 1 px；过大会损失发丝和薄纱。调整后需重新处理。</p>
      </>}
      {operation === "upscale" && (
        <>
          <label>
            模型
            <Select
              aria-label="超分模型"
              value={value.model}
              onChange={(e) =>
                update({
                  model: e.target.value,
                  scale: e.target.value === "anime" ? 2 : 4,
                })
              }
            >
              <option value="general">通用 · 4×</option>
              <option value="illustration">插画 · 4×</option>
              <option value="anime">动漫 · 2–4×</option>
            </Select>
          </label>
          {value.model === "anime" && (
            <label>
              倍率
              <Select
                aria-label="AI 超分倍率"
                value={value.scale}
                onChange={(e) => update({ scale: Number(e.target.value) })}
              >
                {[2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}×
                  </option>
                ))}
              </Select>
            </label>
          )}
        </>
      )}
      <p className="local-tool-status" role="status">{error || readiness.reason}</p>
      <div className="tool-maintenance-actions"><Button onClick={() => setOpen(true)}>管理本地组件</Button>
      <Button disabled={busy} onClick={() => {setError(""); setRefresh(n => n + 1);}}>刷新状态</Button></div>
      <ToolPopover className="tools-parameter-popover" icon="info" showLabel label="本地 AI 说明">
        <p>
          图片在本机逐张处理，可切换工作区。整批完成后进入素材库，可撤销入库；取消或中断后，可在任务面板按原参数重试。
        </p>
        <p>
          {operation === "upscale"
            ? "AI 增强颜色细节，透明通道按原图插值保留。最大输出 1 亿像素，实际受可用内存限制。"
            : "自动识别显著主体，保留原图颜色和已有透明度。精细模型有较高内存需求，细发丝、薄纱与复杂背景仍需检查轮廓。"}
        </p>
      </ToolPopover>
      {open && (
        <FormDialog title="本地组件" close={() => setOpen(false)}>
          <p>按需安装，下载后可离线使用。超分和抠图可分别安装，图片在本机处理。</p>
          {runtime?.configured ? (
            <>
              <p style={{ overflowWrap: "anywhere" }}>{runtime.folder}</p>
              <p>
                超分：{runtime.models.length ? "组件已安装" : "模型缺失"} · 主体抠图：
                {runtime.cutout ? (runtime.cutoutModels || []).map(key => cutoutModels[key]?.name).join('、') || "可用" : "模型缺失或校验不符"}
              </p>
            </>
          ) : (
            <p>{runtime?.message || "正在检查组件…"}</p>
          )}
          <label>
            抠图计算设备
            <Select
              aria-label="抠图计算设备"
              value={provider}
              disabled={busy || installing}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">自动选择可用设备</option>
              <option value="DmlExecutionProvider">Windows GPU</option>
              <option value="CoreMLExecutionProvider">Mac Core ML</option>
              <option value="CPUExecutionProvider">CPU（较慢）</option>
            </Select>
          </label>
          {error && <p role="alert">{error}</p>}
          <RuntimeInstallControls
            operation={operation}
            provider={provider}
            onActive={setInstalling}
            onInstalled={async () => {
              const r = await window.tugou.localToolsStatus();
              setRuntime(r);
              setProvider(r.cutout ? r.provider || "" : "");
            }}
          >
            <Button
              type="default"
              disabled={busy || installing}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const r = await window.tugou.configureLocalTools(
                    provider || undefined,
                  );
                  if (r) {
                    setRuntime(r);
                    setProvider(r.cutout ? r.provider : "");
                  }
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "检查中" : "使用已安装的组件"}
            </Button>
          </RuntimeInstallControls>
        </FormDialog>
      )}
    </fieldset>
  );
}
