import {AssetTime} from './asset-time.jsx';
import React, { useEffect, useRef, useState } from "react";
import {
  Button,
  FormDialog,
  Input,
  StarRating,
  TextArea,
  ToolPopover,
} from "./components.jsx";
import { originalUrl } from "./image-processing.js";
import {MediaPreview} from './media-preview.jsx';

const clampZoom = (s) => Math.max(0.25, Math.min(8, s));

export async function copyAssetPrompt(details) {
  if (!details?.prompt) throw Error(details?.reason || "没有可复制的提示词");
  await window.tugou.copyText(details.prompt);
}

export function MaterialDetails({
  projectId,
  document,
  assetId,
  nodeId,
  change,
  close,
  editImages,
  analyzeImage,
  addToLayers,
  addToCanvas,
  rateAsset,
}) {
  const asset = document.assets.find((a) => a.id === assetId);
  const isImage = Boolean(asset && (!asset.kind || asset.kind === "image"));
  const [details, setDetails] = useState(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [view, setView] = useState({ scale: 1, x: 0, y: 0 }),
    [dragging, setDragging] = useState(false);
  const stageRef = useRef(null),
    dragRef = useRef(null);
  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, [assetId]);
  useEffect(() => {
    const el = stageRef.current;
    if (!el || !isImage) return;
    const onWheel = (event) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      const rect = el.getBoundingClientRect();
      const px = event.clientX - (rect.left + rect.width / 2);
      const py = event.clientY - (rect.top + rect.height / 2);
      const scaleMode = event.deltaMode === 1 ? 20 : 1;
      const dy = event.deltaY * scaleMode;
      setView((prev) => {
        const nextScale = clampZoom(prev.scale * Math.exp(-dy * 0.0022));
        if (nextScale <= 1) return { scale: nextScale, x: 0, y: 0 };
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          x: px - (px - prev.x) * ratio,
          y: py - (py - prev.y) * ratio,
        };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isImage, assetId]);
  const stepZoom = (factor) =>
    setView((prev) => {
      const nextScale = clampZoom(prev.scale * factor);
      return nextScale <= 1
        ? { scale: nextScale, x: 0, y: 0 }
        : { scale: nextScale, x: prev.x * (nextScale / prev.scale), y: prev.y * (nextScale / prev.scale) };
    });
  const resetZoom = () => setView({ scale: 1, x: 0, y: 0 });
  useEffect(() => {
    let stopped = false;
    setDetails(null);
    setError("");
    setNotice("");
    window.tugou
      .assetDetails(projectId, document, assetId, nodeId)
      .then((value) => {
        if (!stopped) setDetails(value);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, [projectId, assetId, nodeId, asset?.resource]);
  const run = async (operation) => {
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (e) {
      setError(e.message);
    }
  };
  if (!asset)
    return (
      <FormDialog title="素材详情" close={close}>
        <p>素材已移除。</p>
      </FormDialog>
    );
  return (
    <FormDialog title="素材详情" className="material-details-dialog" close={close} width={920}>
      <div className="material-details-layout">
        <div
          ref={stageRef}
          className={`material-details-stage${isImage && view.scale > 1 ? " is-pannable" : ""}${dragging ? " is-dragging" : ""}`}
          title={isImage ? "Ctrl/⌘ + 滚轮缩放，放大后可拖拽平移，双击复位" : undefined}
          onDoubleClick={(e) => {
            if (!isImage || e.target.closest("button")) return;
            setView((prev) => (prev.scale === 1 ? { scale: 2, x: 0, y: 0 } : { scale: 1, x: 0, y: 0 }));
          }}
          onPointerDown={(e) => {
            if (!isImage || e.button !== 0 || view.scale <= 1 || e.target.closest("button")) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
            setDragging(true);
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
            setView((prev) => ({ ...prev, x: d.ox + (e.clientX - d.x), y: d.oy + (e.clientY - d.y) }));
          }}
          onPointerUp={(e) => {
            if (dragRef.current) {
              dragRef.current = null;
              setDragging(false);
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }
          }}
          onLostPointerCapture={() => {
            dragRef.current = null;
            setDragging(false);
          }}
        >
          <div
            className="material-details-viewport"
            style={
              isImage
                ? { transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }
                : undefined
            }
          >
            <MediaPreview asset={asset} full
              className="material-preview"
              src={originalUrl(asset)}
              alt={asset.name}
              draggable={false}
            />
          </div>
          {isImage && (
            <div className="material-details-zoom" role="group" aria-label="图片缩放控制" onPointerDown={(e) => e.stopPropagation()}>
              <Button iconOnly size="small" icon="zoomOut" aria-label="缩小图片" disabled={view.scale <= 0.25} onClick={() => stepZoom(0.8)} />
              <button type="button" className="material-details-zoom-pct" title="点击复位 100%" onClick={resetZoom}>
                {Math.round(view.scale * 100)}%
              </button>
              <Button iconOnly size="small" icon="zoomIn" aria-label="放大图片" disabled={view.scale >= 8} onClick={() => stepZoom(1.25)} />
            </div>
          )}
          {asset.width && asset.height && (
            <span className="material-details-dims">{asset.width} × {asset.height} px</span>
          )}
        </div>
        <div className="material-details-side">
          <div className="material-details-actions">
            <Button iconOnly
              icon="copy"
              disabled={!details?.prompt}
              onClick={() =>
                run(async () => {
                  await copyAssetPrompt(details);
                  setNotice("提示词已复制");
                })
              }
            >
              复制提示词
            </Button>
            <Button iconOnly icon="analyze"
              disabled={asset.kind&&asset.kind!=='image'}
              onClick={() => {
                close();
                analyzeImage(asset.id, nodeId);
              }}
            >
              图片反推
            </Button>
            <Button iconOnly
              icon="tools"
              disabled={asset.kind&&asset.kind!=='image'}
              onClick={() => {
                close();
                editImages([asset.id]);
              }}
            >
              处理图片
            </Button>
            <ToolPopover label="素材操作">
              <div className="image-tool-detail">
                <Button
                  icon="export"
                  onClick={() => run(async() => {if(await window.tugou.exportAsset(projectId,document,asset.id))setNotice(asset.kind&&asset.kind!=='image'?'已导出原文件':'已保存图片');})}
                >
                  {asset.kind&&asset.kind!=='image'?'导出原文件':'保存图片'}
                </Button>
                <Button
                  disabled={asset.kind&&asset.kind!=='image'}
                  onClick={() => {
                    addToLayers(asset);
                    close();
                  }}
                >
                  加入图层
                </Button>
                <Button
                  onClick={() => {
                    addToCanvas("asset", asset.id);
                    close();
                  }}
                >
                  加入画布
                </Button>
              </div>
            </ToolPopover>
          </div>
          {error && (
            <p role="alert" className="message error">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="message">
              {notice}
            </p>
          )}
          <label>
            名称
            <Input
              aria-label="素材名称"
              value={asset.name}
              onChange={(e) =>
                change({
                  ...document,
                  assets: document.assets.map((a) =>
                    a.id === asset.id ? { ...a, name: e.target.value } : a,
                  ),
                })
              }
            />
          </label>
          <div className="material-identity-meta">
            <AssetTime asset={asset}/>
            {rateAsset && (
              <StarRating
                value={asset.rating || 0}
                onChange={(r) => rateAsset(asset.id, r)}
                aria-label="素材星级评分"
              />
            )}
          </div>
          <label className="material-details-prompt">
            {details?.label || "生成提示词"}
            <TextArea
              aria-label="素材提示词"
              readOnly
              rows={7}
              value={details?.prompt || ""}
              placeholder={details?.reason || (error ? "读取失败" : "正在读取…")}
            />
          </label>
          {details?.model && (
            <p className="muted">
              {details.model}
              {details.requestedSize ? ` · 请求尺寸 ${details.requestedSize}` : ""}
            </p>
          )}
          {details?.label?.startsWith("来源素材") && (
            <p className="muted">
              来源：{details.sourceName}。后续处理不改变这条原始记录。
            </p>
          )}
        </div>
      </div>
    </FormDialog>
  );
}
