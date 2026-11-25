import React, { useEffect, useRef, useState } from "react";
import { Button, Icon, IconButton } from "./components.jsx";
import { originalUrl } from "./image-processing.js";
import "./pin-reference.css";

const OPACITIES = [1, 0.72, 0.44];
const toHex = (r, g, b) =>
  "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

export function PinReference({ asset, close, onPickColor, onAddBrandColor }) {
  const [box, setBox] = useState(() => ({
    x: Math.max(84, window.innerWidth - 360),
    y: 74,
    w: 310,
    h: 260,
  }));
  const [opacityIndex, setOpacityIndex] = useState(0);
  const [picking, setPicking] = useState(false);
  const [pickedHex, setPickedHex] = useState("");
  const imgRef = useRef(null);
  const sampleCanvasRef = useRef(null);
  const gestureRef = useRef(null);

  useEffect(() => {
    sampleCanvasRef.current = null;
    setPickedHex("");
  }, [asset?.id]);

  if (!asset) return null;

  const startGesture = (mode, event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...box },
    };
  };

  const moveGesture = (event) => {
    const g = gestureRef.current;
    if (!g) return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;
    if (g.mode === "move") {
      setBox({
        ...g.origin,
        x: Math.max(8, Math.min(window.innerWidth - 80, g.origin.x + dx)),
        y: Math.max(48, Math.min(window.innerHeight - 60, g.origin.y + dy)),
      });
    } else {
      setBox({
        ...g.origin,
        w: Math.max(200, Math.min(720, g.origin.w + dx)),
        h: Math.max(150, Math.min(640, g.origin.h + dy)),
      });
    }
  };

  const endGesture = (event) => {
    if (!gestureRef.current) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleSample = async (event) => {
    if (!picking) return;
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;
    const rect = img.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    const offsetX = rect.left + (rect.width - drawW) / 2;
    const offsetY = rect.top + (rect.height - drawH) / 2;
    const px = Math.floor((event.clientX - offsetX) / scale);
    const py = Math.floor((event.clientY - offsetY) / scale);
    if (px < 0 || py < 0 || px >= img.naturalWidth || py >= img.naturalHeight) return;
    try {
      if (!sampleCanvasRef.current) {
        const response = await fetch(originalUrl(asset));
        if (!response.ok) return;
        const bitmap = await createImageBitmap(await response.blob());
        const c = window.document.createElement("canvas");
        c.width = bitmap.width;
        c.height = bitmap.height;
        c.getContext("2d", { willReadFrequently: true }).drawImage(bitmap, 0, 0);
        bitmap.close();
        sampleCanvasRef.current = c;
      }
      const [r, g, b] = sampleCanvasRef.current
        .getContext("2d", { willReadFrequently: true })
        .getImageData(px, py, 1, 1).data;
      const hex = toHex(r, g, b);
      setPickedHex(hex);
      window.tugou?.copyText?.(hex).catch(() => {});
      onPickColor?.(hex);
    } catch {}
  };

  return (
    <aside
      className={`pin-reference${picking ? " is-picking" : ""}`}
      role="region"
      aria-label="钉住参考图"
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        opacity: OPACITIES[opacityIndex],
      }}
    >
      <header
        className="pin-reference-head"
        onPointerDown={(e) => startGesture("move", e)}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onLostPointerCapture={() => {
          gestureRef.current = null;
        }}
      >
        <Icon name="pin" />
        <span title={asset.name}>{asset.name || "参考图"}</span>
        <div className="pin-reference-actions" onPointerDown={(e) => e.stopPropagation()}>
          <IconButton
            label={picking ? "退出吸色" : "吸取参考图颜色"}
            icon="eyedropper"
            aria-pressed={picking}
            onClick={() => setPicking((v) => !v)}
          />
          <button
            type="button"
            className="pin-opacity-btn"
            title="切换透明度"
            onClick={() => setOpacityIndex((i) => (i + 1) % OPACITIES.length)}
          >
            {Math.round(OPACITIES[opacityIndex] * 100)}%
          </button>
          <IconButton label="关闭参考浮窗" icon="close" onClick={close} />
        </div>
      </header>
      <div className="pin-reference-stage" onClick={handleSample}>
        <img
          ref={imgRef}
          src={originalUrl(asset)}
          alt={asset.name || "参考图"}
          draggable={false}
        />
        {picking && (
          <span className="pin-picking-hint">点击图片任意位置吸取颜色并复制</span>
        )}
      </div>
      {pickedHex && (
        <footer className="pin-reference-foot">
          <i className="pin-swatch" style={{ background: pickedHex }} />
          <code>{pickedHex}</code>
          <Button size="small" onClick={() => window.tugou?.copyText?.(pickedHex)}>
            复制
          </Button>
          {onAddBrandColor && (
            <Button size="small" icon="add" onClick={() => onAddBrandColor(pickedHex)}>
              加入色板
            </Button>
          )}
        </footer>
      )}
      <button
        type="button"
        className="pin-reference-resize"
        aria-label="调整参考浮窗尺寸"
        onPointerDown={(e) => startGesture("resize", e)}
        onPointerMove={moveGesture}
        onPointerUp={endGesture}
        onLostPointerCapture={() => {
          gestureRef.current = null;
        }}
      />
    </aside>
  );
}
