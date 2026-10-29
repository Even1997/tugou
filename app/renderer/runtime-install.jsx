import React, { useEffect, useRef, useState } from "react";
import { Button, Checkbox } from "./components.jsx";

export function RuntimeInstallControls({
  provider,
  operation = "upscale",
  onInstalled,
  onActive,
  children,
}) {
  const [task, setTask] = useState(null),
    [cutout, setCutout] = useState(operation === "cutout"),
    [upscale, setUpscale] = useState(operation === "upscale"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const callbacks = useRef({ onInstalled, onActive }),
    completed = useRef(null);
  callbacks.current = { onInstalled, onActive };
  const running = task && ["queued", "running"].includes(task.status);
  useEffect(() => {
    let active = true,
      timer;
    const poll = async () => {
      try {
        const latest = (await window.tugou.tasks())
          .filter((t) => t.context?.kind === "runtime-install")
          .at(-1);
        if (!active) return;
        setTask(latest || null);
        callbacks.current.onActive(
          Boolean(latest && ["queued", "running"].includes(latest.status)),
        );
        if (latest?.status === "completed" && completed.current !== latest.id) {
          completed.current = latest.id;
          await callbacks.current.onInstalled();
        }
      } catch (e) {
        if (active) setError(e.message);
      }
      if (active) timer = setTimeout(poll, 900);
    };
    poll();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  async function act(action) {
    setBusy(true);
    setError("");
    try {
      await action();
      setTask(
        (await window.tugou.tasks())
          .filter((t) => t.context?.kind === "runtime-install")
          .at(-1) || null,
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="组件安装">
      <Checkbox
        checked={cutout}
        disabled={busy || running}
        onChange={(e) => setCutout(e.target.checked)}
      >
        主体抠图组件
      </Checkbox>
      <Checkbox checked={upscale} disabled={busy || running} onChange={e => setUpscale(e.target.checked)}>AI 超分组件</Checkbox>
      <p className="muted">
        {cutout
          ? "包含独立运行环境、轻量与精细两种模型，需预留 3 GB；模型合计约 495 MB。"
          : "超分组件约 46–52 MB，需预留 256 MB，无需 Python。"}
        安装完成后自动启用。
      </p>
      {task && (
        <div role="status" aria-live="polite">
          <p>
            {task.message ||
              (task.status === "queued" ? "等待其他任务完成" : "准备安装")}
          </p>
          {running && (
            <progress
              aria-label="组件安装进度"
              max="100"
              value={task.progress || 0}
              style={{ width: "100%" }}
            />
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        {children}
        <Button
          primary
          disabled={busy || running || (!cutout && !upscale)}
          onClick={() =>
            act(() => window.tugou.installLocalTools({ cutout, upscale, provider }))
          }
        >
          选择位置并安装
        </Button>
        {running && (
          <Button
            disabled={busy}
            onClick={() => act(() => window.tugou.cancelTask(task.id))}
          >
            取消安装
          </Button>
        )}
        {task &&
          ["failed", "interrupted", "cancelled"].includes(task.status) && (
            <Button
              disabled={busy}
              onClick={() =>
                act(() => window.tugou.retryRuntimeInstall(task.id))
              }
            >
              继续安装
            </Button>
          )}
      </footer>
    </section>
  );
}
