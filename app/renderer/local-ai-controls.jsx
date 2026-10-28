import {Select} from './select.jsx';
import React, { useEffect, useState } from "react";
import { Button, FormDialog, ToolPopover } from "./components.jsx";
import { RuntimeInstallControls } from "./runtime-install.jsx";

export function LocalAIControls({ operation, value, update, disabled }) {
  const [open, setOpen] = useState(false),
    [runtime, setRuntime] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [provider, setProvider] = useState("");
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setBusy(true);
    window.tugou
      .localToolsStatus()
      .then((r) => {
        if (active) {
          setRuntime(r);
          setProvider(r.provider || "");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [open]);
  return (
    <fieldset
      className="image-tool-parameters"
      disabled={disabled}
      aria-label="本地 AI 参数"
    >
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
      <Button onClick={() => setOpen(true)}>本地组件</Button>
      <ToolPopover label="本地 AI 说明">
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
          <p>安装一次，超分与主体抠图共用；图片处理在本机完成。</p>
          {runtime?.configured ? (
            <>
              <p style={{ overflowWrap: "anywhere" }}>{runtime.folder}</p>
              <p>
                超分：{runtime.models.length ? "可用" : "模型缺失"} · 主体抠图：
                {runtime.cutout ? "可用" : "模型缺失或校验不符"}
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
            provider={provider}
            onActive={setInstalling}
            onInstalled={async () => {
              const r = await window.tugou.localToolsStatus();
              setRuntime(r);
              setProvider(r.provider || "");
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
                    setProvider(r.provider);
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
