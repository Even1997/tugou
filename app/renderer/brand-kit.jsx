import React, { createContext, useContext, useState } from "react";
import { Button, FormDialog, Icon, IconButton, Input } from "./components.jsx";
import { Select } from "./select.jsx";
import { originalUrl } from "./image-processing.js";
import "./brand-kit.css";

const BrandKitContext = createContext({
  brandKit: { colors: [], headingFont: "", bodyFont: "" },
  addColor: null,
  openBrandKit: null,
});

export function BrandKitProvider({ value, children }) {
  return <BrandKitContext.Provider value={value}>{children}</BrandKitContext.Provider>;
}

export function useBrandKit() {
  return useContext(BrandKitContext);
}

export function normalizeBrandKit(kit) {
  const colors = Array.isArray(kit?.colors)
    ? kit.colors
        .filter((c) => c && typeof c.hex === "string" && /^#[0-9a-fA-F]{6}$/.test(c.hex))
        .map((c) => ({ hex: c.hex.toUpperCase(), name: String(c.name || "").slice(0, 32) }))
        .slice(0, 24)
    : [];
  return {
    colors,
    headingFont: typeof kit?.headingFont === "string" ? kit.headingFont : "",
    bodyFont: typeof kit?.bodyFont === "string" ? kit.bodyFont : "",
  };
}

const rgbToHex = (r, g, b) =>
  "#" +
  [r, g, b]
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();

const distSq = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export async function extractPaletteFromAsset(asset, count = 6) {
  if (!asset) throw new Error("请先选择参考图片");
  const response = await fetch(originalUrl(asset));
  if (!response.ok) throw new Error("读取图片失败");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = window.document.createElement("canvas");
  const maxSide = 88;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width || 1, bitmap.height || 1));
  canvas.width = Math.max(1, Math.round((bitmap.width || 1) * scale));
  canvas.height = Math.max(1, Math.round((bitmap.height || 1) * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] >= 160) pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  if (!pixels.length) return [];

  // Deterministic farthest-point seeding + 8 k-means iterations.
  const k = Math.min(count, pixels.length);
  const centers = [pixels[Math.floor(pixels.length / 2)].slice()];
  while (centers.length < k) {
    let best = pixels[0];
    let bestDist = -1;
    for (let i = 0; i < pixels.length; i += 2) {
      let minD = Infinity;
      for (const c of centers) minD = Math.min(minD, distSq(pixels[i], c));
      if (minD > bestDist) {
        bestDist = minD;
        best = pixels[i];
      }
    }
    centers.push(best.slice());
  }

  let weights = new Array(k).fill(0);
  for (let iter = 0; iter < 8; iter++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0]);
    weights = new Array(k).fill(0);
    for (const p of pixels) {
      let idx = 0;
      let minD = Infinity;
      for (let j = 0; j < k; j++) {
        const d = distSq(p, centers[j]);
        if (d < minD) {
          minD = d;
          idx = j;
        }
      }
      sums[idx][0] += p[0];
      sums[idx][1] += p[1];
      sums[idx][2] += p[2];
      weights[idx]++;
    }
    for (let j = 0; j < k; j++) {
      if (weights[j] > 0) {
        centers[j] = [sums[j][0] / weights[j], sums[j][1] / weights[j], sums[j][2] / weights[j]];
      }
    }
  }

  const seen = new Set();
  return centers
    .map((c, idx) => ({ hex: rgbToHex(c[0], c[1], c[2]), weight: weights[idx] }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .filter((entry) => {
      if (seen.has(entry.hex)) return false;
      seen.add(entry.hex);
      return true;
    })
    .map((entry, idx) => ({ hex: entry.hex, name: idx === 0 ? "主色" : idx === 1 ? "辅色" : `色 ${idx + 1}` }));
}

export function BrandKitDialog({ document, change, close, onNotice }) {
  const kit = normalizeBrandKit(document?.brandKit);
  const imageAssets = (document?.assets || []).filter((a) => !a.kind || a.kind === "image");
  const [sourceAssetId, setSourceAssetId] = useState(imageAssets[0]?.id || "");
  const [newHex, setNewHex] = useState("#2563EB");
  const [newName, setNewName] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState("");

  const saveKit = (next) => {
    change({ ...document, brandKit: normalizeBrandKit(next) });
  };

  const addSwatch = () => {
    const hex = newHex.trim().toUpperCase();
    if (!/^#[0-9A-F]{6}$/.test(hex)) {
      setError("请输入 6 位 HEX 色值，例如 #2563EB");
      return;
    }
    setError("");
    if (kit.colors.some((c) => c.hex === hex)) return;
    saveKit({ ...kit, colors: [...kit.colors, { hex, name: newName.trim() || `色 ${kit.colors.length + 1}` }] });
    setNewName("");
  };

  const removeSwatch = (hex) => {
    saveKit({ ...kit, colors: kit.colors.filter((c) => c.hex !== hex) });
  };

  const handleExtract = async (replace = false) => {
    const asset = imageAssets.find((a) => a.id === sourceAssetId);
    if (!asset) return;
    setExtracting(true);
    setError("");
    try {
      const extracted = await extractPaletteFromAsset(asset, 6);
      const merged = replace
        ? extracted
        : [...kit.colors, ...extracted.filter((e) => !kit.colors.some((c) => c.hex === e.hex))];
      saveKit({ ...kit, colors: merged.slice(0, 24) });
      onNotice?.(`已从「${asset.name}」提取 ${extracted.length} 个主题色`);
    } catch (e) {
      setError(e.message);
    } finally {
      setExtracting(false);
    }
  };

  const copyForMcp = async () => {
    const lines = [
      `当前工程「${document.name}」视觉规范（Brand Kit）：`,
      kit.colors.length
        ? `- 配色板：${kit.colors.map((c) => `${c.name ? c.name + " " : ""}${c.hex}`).join(" / ")}`
        : "- 配色板：未设定",
      kit.headingFont ? `- 主标题字体：${kit.headingFont}` : null,
      kit.bodyFont ? `- 正文字体：${kit.bodyFont}` : null,
      "请在后续画布、图层与 PPT 创作中优先沿用以上配色与字体。",
    ].filter(Boolean);
    await window.tugou.copyText(lines.join("\n"));
    onNotice?.("已复制工程视觉规范，可粘贴给 AI / MCP 客户端");
  };

  return (
    <FormDialog title="工程视觉规范 / 配色板" className="brand-kit-dialog" width={620} close={close}>
      <div className="brand-kit-body">
        <section className="brand-kit-section">
          <div className="brand-kit-section-head">
            <h3>工程色板（{kit.colors.length}）</h3>
            <small>在图层与 PPT 的取色器中置顶复用，点击色块可复制 HEX</small>
          </div>
          {kit.colors.length > 0 ? (
            <div className="brand-kit-grid">
              {kit.colors.map((swatch) => (
                <div className="brand-kit-chip" key={swatch.hex}>
                  <button
                    type="button"
                    className="brand-kit-chip-main"
                    title={`点击复制 ${swatch.hex}`}
                    onClick={() => {
                      window.tugou?.copyText?.(swatch.hex);
                      onNotice?.(`已复制 ${swatch.hex}`);
                    }}
                  >
                    <i style={{ background: swatch.hex }} />
                    <span>
                      <strong>{swatch.name || swatch.hex}</strong>
                      <small>{swatch.hex}</small>
                    </span>
                  </button>
                  <IconButton label={`移除 ${swatch.hex}`} icon="close" onClick={() => removeSwatch(swatch.hex)} />
                </div>
              ))}
            </div>
          ) : (
            <p className="muted">尚未添加工程色板，可手动添加或从下方参考图一键提取。</p>
          )}
          <div className="brand-kit-add-row">
            <input
              type="color"
              aria-label="选择颜色"
              value={/^#[0-9a-fA-F]{6}$/.test(newHex) ? newHex : "#2563EB"}
              onChange={(e) => setNewHex(e.target.value.toUpperCase())}
            />
            <Input aria-label="HEX 色值" value={newHex} onChange={(e) => setNewHex(e.target.value)} placeholder="#2563EB" />
            <Input aria-label="颜色名称" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="名称（如 主题蓝）" />
            <Button primary icon="add" onClick={addSwatch}>添加</Button>
          </div>
        </section>

        {imageAssets.length > 0 && (
          <section className="brand-kit-section">
            <div className="brand-kit-section-head">
              <h3>从素材自动提取主题色</h3>
              <small>基于像素聚类提取 6 个代表色</small>
            </div>
            <div className="brand-kit-extract-row">
              <Select aria-label="选择参考图片" value={sourceAssetId} onChange={(e) => setSourceAssetId(e.target.value)}>
                {imageAssets.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </Select>
              <Button icon="style" loading={extracting} onClick={() => handleExtract(false)}>追加提取</Button>
              <Button loading={extracting} onClick={() => handleExtract(true)}>替换色板</Button>
            </div>
          </section>
        )}

        <section className="brand-kit-section">
          <div className="brand-kit-section-head">
            <h3>工程字体约定</h3>
            <small>记录当前工程推荐的主/副字体，供排版与 MCP 协作参考</small>
          </div>
          <div className="brand-kit-fonts-row">
            <label>
              <span>主标题字体</span>
              <Input
                value={kit.headingFont}
                placeholder="如 思源宋体 / PingFang SC"
                onChange={(e) => saveKit({ ...kit, headingFont: e.target.value })}
              />
            </label>
            <label>
              <span>正文字体</span>
              <Input
                value={kit.bodyFont}
                placeholder="如 思源黑体 / Microsoft YaHei"
                onChange={(e) => saveKit({ ...kit, bodyFont: e.target.value })}
              />
            </label>
          </div>
        </section>

        {error && <p className="message error" role="alert">{error}</p>}

        <div className="dialog-footer">
          <Button icon="copy" onClick={copyForMcp}>复制给 MCP 的视觉规范</Button>
          <Button primary onClick={close}>完成</Button>
        </div>
      </div>
    </FormDialog>
  );
}
