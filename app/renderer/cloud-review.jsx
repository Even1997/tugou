import React, { useEffect, useState } from "react";
import { Button, Checkbox, FormDialog } from "./components.jsx";
import { originalUrl, exportMaterial } from "./image-processing.js";
export function CloudReview({ taskId, close, refresh }) {
  const [review, setReview] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    window.tugou
      .cloudReview(taskId)
      .then((r) => {
        if (active) setReview(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [taskId]);
  const run = async (fn) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  const size = review?.job.size,
    asset = review?.asset;
  const exact =
    asset && asset.width === size.width && asset.height === size.height;
  const canFit =
    asset &&
    !exact &&
    asset.width >= size.width &&
    asset.height >= size.height &&
    asset.width * size.height === asset.height * size.width;
  return (
    <FormDialog title="模型原始返回" close={close} width={680}>
      {error && <p role="alert">{error}</p>}
      {!review ? (
        <p>读取中…</p>
      ) : (
        <>
          <p>
            请求 {size.width} × {size.height} · 返回 {asset.width} ×{" "}
            {asset.height}
          </p>
          <img
            className="cloud-original-preview"
            src={originalUrl(asset)}
            alt="模型原始返回图"
          />
          <p className="muted">
            原始图始终保留。这里的入库和合成都在本机完成，不会再次请求模型。
          </p>
          {!exact && !canFit && (
            <p>
              返回图更小或比例不同，无法保持原构图对齐。可以单独保存原始图。
            </p>
          )}
          {canFit && (
            <Checkbox
              aria-label="确认缩小返回图"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            >
              将返回图同比例缩小到请求尺寸，并保留原图保护区
            </Checkbox>
          )}
          <div className="dialog-actions">
            <Button
              disabled={busy}
              onClick={() => run(() => exportMaterial(asset))}
            >
              导出原始图
            </Button>
            <Button
              disabled={busy}
              onClick={() => run(() => window.tugou.keepCloudRaw(taskId))}
            >
              原始图入库
            </Button>
            <Button
              primary
              disabled={
                busy ||
                Boolean(review.resolvedTaskId) ||
                (!exact && !(canFit && confirm))
              }
              onClick={() =>
                run(async () => {
                  await window.tugou.resumeCloudTool(taskId, Boolean(canFit));
                  close();
                })
              }
            >
              {review.resolvedTaskId
                ? "已处理"
                : exact
                  ? "继续本地合成"
                  : "缩小并合成"}
            </Button>
          </div>
        </>
      )}
    </FormDialog>
  );
}
