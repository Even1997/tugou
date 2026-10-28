import React, { useEffect, useRef, useState } from "react";
import { Button, Checkbox } from "./components.jsx";

export function RuntimeInstallControls({
  provider,
  onInstalled,
  onActive,
  children,
}) {
  const [task, setTask] = useState(null),
    [cutout, setCutout] = useState(true),
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
        同时安装主体抠图模型
      </Checkbox>
      <p className="muted">
        {cutout
          ? "下载约 700 MB，安装位置需预留 3 GB。"
          : "下载约 200 MB，安装位置需预留 2 GB。"}
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
          disabled={busy || running}
          onClick={() =>
            act(() => window.tugou.installLocalTools({ cutout, provider }))
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
