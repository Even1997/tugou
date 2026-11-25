import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image } from "antd";
import { Button, StarRating } from "./components.jsx";
import { originalUrl } from "./image-processing.js";
import { copyAssetImage } from "./image-clipboard.js";
import "./canvas-image-viewer.css";

export function CanvasImageViewer({ asset, assets, close, onSave, onPin, onRate }) {
  const list = useMemo(() => {
    const images = (assets || []).filter((a) => a && (!a.kind || a.kind === "image"));
    if (!images.length) return asset ? [asset] : [];
    return images.some((a) => a.id === asset?.id) ? images : asset ? [asset, ...images] : images;
  }, [assets, asset]);

  const [index, setIndex] = useState(() => Math.max(0, list.findIndex((a) => a.id === asset?.id)));
  const lastInitialId = useRef(asset?.id);
  useEffect(() => {
    if (asset?.id !== lastInitialId.current) {
      lastInitialId.current = asset?.id;
      const next = list.findIndex((a) => a.id === asset?.id);
      if (next >= 0) setIndex(next);
    } else if (index >= list.length && list.length > 0) {
      setIndex(list.length - 1);
    }
  }, [asset?.id, list, index]);

  const current = list[index] || asset;
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [actual, setActual] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");
  const actionsRef = useRef(null);
  const copyTimerRef = useRef(null);

  useEffect(() => {
    clearTimeout(copyTimerRef.current);
    setFailed(false);
    setActual(false);
    setCopied(false);
    setStatus("");
    actionsRef.current?.onReset?.();
  }, [current?.id]);

  useEffect(() => () => clearTimeout(copyTimerRef.current), []);

  const fit = Math.min(
    1,
    Math.max(1, viewport.width - 140) / Math.max(1, current?.width || 1),
    Math.max(1, viewport.height - 180) / Math.max(1, current?.height || 1),
  );
  const ratio = actual ? 1 : fit;
  const reset = (value) => {
    setActual(value);
    actionsRef.current?.onReset();
  };
  const step = (delta) => {
    if (list.length <= 1) return;
    setIndex((i) => (i + delta + list.length) % list.length);
  };

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    const key = (e) => {
      if (e.altKey) return;
      if (e.key === "ArrowLeft" && list.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        step(-1);
        return;
      }
      if (e.key === "ArrowRight" && list.length > 1) {
        e.preventDefault();
        e.stopPropagation();
        step(1);
        return;
      }
      if (e.key === " " && !e.target?.closest?.("button,input,textarea,select,a")) {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      if (onRate && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^[0-5]$/.test(e.key) && !e.target?.closest?.("input,textarea,select")) {
        e.preventDefault();
        e.stopPropagation();
        const target = list[index] || asset;
        if (target) onRate(target.id, Number(e.key));
        return;
      }
      const action = {
        "+": () => actionsRef.current?.onZoomIn(),
        "=": () => actionsRef.current?.onZoomIn(),
        "-": () => actionsRef.current?.onZoomOut(),
      }[e.key];
      if (action) {
        e.preventDefault();
        e.stopPropagation();
        action();
      }
    };
    const onWheel = (e) => {
      if ((!e.ctrlKey && !e.metaKey) || !e.target?.closest?.(".canvas-image-viewer")) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.deltaY < 0) actionsRef.current?.onZoomIn?.();
      else if (e.deltaY > 0) actionsRef.current?.onZoomOut?.();
    };
    window.addEventListener("resize", resize);
    window.addEventListener("keydown", key, true);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, [list, index, asset, onRate, close]);

  if (!current) return null;

  const handleCopy = async () => {
    try {
      await copyAssetImage(current);
      setCopied(true);
      setStatus("");
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      setStatus(e.message || "复制图片失败");
    }
  };

  return (
    <Image
      src={originalUrl(current)}
      alt={current.name || "图片查看器"}
      styles={{ root: { display: "none" }, popup: { mask: { background: "rgba(12,14,18,.94)" } } }}
      onError={() => setFailed(true)}
      classNames={{ popup: { root: "canvas-image-viewer" } }}
      preview={{
        open: true,
        closeIcon: false,
        minScale: 0.1,
        maxScale: 50,
        scaleStep: 0.25,
        getContainer: () => document.getElementById("dialogs"),
        onOpenChange: (open) => {
          if (!open) close();
        },
        imageRender: (image) => (
          <>
            {React.cloneElement(image, {
              style: {
                ...image.props.style,
                width: (current.width || 1) * ratio,
                height: (current.height || 1) * ratio,
                maxWidth: "none",
                maxHeight: "none",
              },
            })}
            <div className="viewer-header">
              <strong title={current.name}>{current.name || "未命名图片"}</strong>
              <span>{current.width} × {current.height}</span>
              {list.length > 1 && <em>{index + 1} / {list.length}</em>}
            </div>
            <Button className="viewer-close" iconOnly icon="close" aria-label="关闭图片查看器" onClick={close} />
            {list.length > 1 && (
              <>
                <Button className="viewer-nav viewer-prev" iconOnly icon="expand" aria-label="上一张图片" onClick={() => step(-1)} />
                <Button className="viewer-nav viewer-next" iconOnly icon="expand" aria-label="下一张图片" onClick={() => step(1)} />
              </>
            )}
            {(failed || status) && (
              <p role="alert" className="viewer-error">
                {status || "图片加载失败，请关闭后重新打开。"}
              </p>
            )}
          </>
        ),
        actionsRender: (_, info) => {
          actionsRef.current = info.actions;
          return (
            <div className="viewer-controls" aria-label="图片缩放控件">
              <Button iconOnly icon="zoomOut" aria-label="缩小图片" disabled={info.transform.scale <= 0.1} onClick={info.actions.onZoomOut} />
              <span aria-label="图片缩放比例">{Math.round(ratio * info.transform.scale * 100)}%</span>
              <Button iconOnly icon="zoomIn" aria-label="放大图片" disabled={info.transform.scale >= 50} onClick={info.actions.onZoomIn} />
              <Button onClick={() => reset(false)}>适应窗口</Button>
              <Button onClick={() => reset(true)}>100%</Button>
              {onRate && (
                <>
                  <span className="viewer-sep" aria-hidden="true" />
                  <StarRating
                    className="viewer-rating"
                    value={current.rating || 0}
                    onChange={(r) => onRate(current.id, r)}
                    aria-label="给当前图片打星（数字键 0–5）"
                  />
                </>
              )}
              <span className="viewer-sep" aria-hidden="true" />
              <Button icon={copied ? "check" : "copy"} onClick={handleCopy}>{copied ? "已复制" : "复制图片"}</Button>
              {onPin && <Button icon="pin" onClick={() => { onPin(current.id); close(); }}>钉住参考</Button>}
              {onSave && <Button icon="export" onClick={() => onSave(current)}>保存图片</Button>}
            </div>
          );
        },
      }}
    />
  );
}
