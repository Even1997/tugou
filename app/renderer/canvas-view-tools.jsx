import React, { useState } from "react";
import { Button, FormDialog, ToolPopover } from "./components.jsx";
import { NumberField } from "./number-field.jsx";
import { angleDefaults } from "../core/canvas-view.cjs";

export function DisplayControls({ node, resize, patch, disabled }) {
  const width = node.width || node.measured?.width || 230;
  const height = node.height || node.measured?.height || 240;
  const free = Boolean(node.data.freeResize);
  const dimension = (key, label) => (
    <NumberField
      label={label}
      value={key === "width" ? width : height}
      min={key === "width" ? 160 : 140}
      max={10000}
      disabled={disabled}
      onChange={(n) => {
        const rect = { width, height, ...node.position, [key]: n };
        if (!free)
          rect[key === "width" ? "height" : "width"] =
            key === "width" ? (n * height) / width : (n * width) / height;
        resize(node.id, rect);
      }}
    />
  );
  return (
    <ToolPopover label="节点尺寸" icon="transform">
      <div className="image-tool-detail">
        <label style={{ justifyContent: "flex-start" }}>
          <input
            style={{ width: "auto" }}
            type="checkbox"
            checked={free}
            disabled={disabled}
            onChange={(e) => patch({ freeResize: e.target.checked })}
          />{" "}
          自由比例
        </label>
        {dimension("width", "显示宽度")}
        {dimension("height", "显示高度")}
        <p className="muted">拖动节点边角调整大小；原图像素保持不变。</p>
      </div>
    </ToolPopover>
  );
}

export function AngleDialog({ source, sourceUrl, submit, close }) {
  const [params, setParams] = useState({ ...angleDefaults });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const field = (key, label, min, max, step = 1) => (
    <NumberField
      label={label}
      value={params[key]}
      min={min}
      max={max}
      step={step}
      disabled={busy}
      onChange={(n) => setParams((p) => ({ ...p, [key]: n }))}
    />
  );
  return (
    <FormDialog
      title="AI 多角度"
      close={() => {
        if (!busy) close();
      }}
      width={620}
    >
      <div className="dialog-footer" style={{ marginTop: 0, marginBottom: 16 }}>
        <Button disabled={busy} onClick={() => setParams({ ...angleDefaults })}>
          重置视角
        </Button>
        <Button
          className="primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await submit(params);
              close();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "正在提交" : "生成新视角"}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      <div
        style={{
          height: 260,
          display: "grid",
          placeItems: "center",
          overflow: "hidden",
          perspective: 800,
          background: "var(--bg)",
          borderRadius: 8,
          marginBottom: 16,
        }}
      >
        <img
          src={sourceUrl}
          alt={source.name}
          style={{
            width: "auto",
            height: "auto",
            maxWidth: "70%",
            maxHeight: 180,
            objectFit: "contain",
            transform: `rotateX(${params.pitchAngle}deg) rotateY(${params.horizontalAngle}deg) scale(${1.2 - params.cameraDistance * 0.05})`,
          }}
        />
      </div>
      <p className="muted">
        这里只示意镜头方向。模型将基于原图重绘，结果取决于所选模型。
      </p>
      <div
        className="image-tool-detail"
        style={{ maxWidth: "none", gridTemplateColumns: "1fr 1fr", gap: 16 }}
      >
        {field("horizontalAngle", "水平角度", -60, 60)}
        {field("pitchAngle", "俯仰角度", -45, 45)}
        {field("cameraDistance", "镜头距离", 1, 10, 0.1)}
        <label style={{ justifyContent: "flex-start" }}>
          <input
            style={{ width: "auto" }}
            type="checkbox"
            checked={params.wideAngle}
            disabled={busy}
            onChange={(e) =>
              setParams((p) => ({ ...p, wideAngle: e.target.checked }))
            }
          />{" "}
          广角镜头
        </label>
      </div>
    </FormDialog>
  );
}
