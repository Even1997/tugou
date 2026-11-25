async function loadImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error("读取图片失败");
  return createImageBitmap(await response.blob());
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function renderContactSheet({
  title = "审稿拼图",
  items = [],
  columns = 3,
  theme = "light",
  cellWidth = 560,
}) {
  if (!items.length) throw new Error("没有可拼图的内容");
  const cols = Math.max(1, Math.min(columns, items.length));
  const rows = Math.ceil(items.length / cols);
  const pad = 44;
  const gap = 24;
  const headerH = 74;
  const imgH = Math.round(cellWidth * 0.68);
  const captionH = 56;
  const cellH = imgH + captionH;
  const width = pad * 2 + cols * cellWidth + (cols - 1) * gap;
  const height = pad * 2 + headerH + rows * cellH + (rows - 1) * gap;

  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  const dark = theme === "dark";
  ctx.fillStyle = dark ? "#14161a" : "#f4f5f7";
  ctx.fillRect(0, 0, width, height);

  // Header
  ctx.fillStyle = dark ? "#f3f4f6" : "#111827";
  ctx.font = '600 28px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.textBaseline = "middle";
  ctx.fillText(title, pad, pad + 20);

  ctx.fillStyle = dark ? "#9ca3af" : "#6b7280";
  ctx.font = '400 15px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
  ctx.fillText(`共 ${items.length} 项 · 土狗审稿拼图`, pad, pad + 50);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (cellWidth + gap);
    const y = pad + headerH + row * (cellH + gap);

    // Card container
    drawRoundedRect(ctx, x, y, cellWidth, cellH, 14);
    ctx.fillStyle = dark ? "#1d2026" : "#ffffff";
    ctx.fill();
    ctx.strokeStyle = dark ? "#2d323b" : "#e2e6ec";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Image area
    const stagePad = 14;
    const sw = cellWidth - stagePad * 2;
    const sh = imgH - stagePad * 2;
    drawRoundedRect(ctx, x + stagePad, y + stagePad, sw, sh, 8);
    ctx.fillStyle = dark ? "#131519" : "#f8f9fb";
    ctx.fill();

    const loadedBitmap = !item.canvas && !item.image && item.url ? await loadImage(item.url) : null;
    const drawable = item.canvas || item.image || loadedBitmap;
    if (drawable) {
      const dw = drawable.naturalWidth || drawable.width || 1;
      const dh = drawable.naturalHeight || drawable.height || 1;
      const scale = Math.min(sw / dw, sh / dh);
      const rw = dw * scale;
      const rh = dh * scale;
      ctx.drawImage(drawable, x + stagePad + (sw - rw) / 2, y + stagePad + (sh - rh) / 2, rw, rh);
      loadedBitmap?.close?.();
    }

    // Index badge
    const badge = `#${String(i + 1).padStart(2, "0")}`;
    drawRoundedRect(ctx, x + 22, y + 22, 46, 24, 6);
    ctx.fillStyle = "rgba(15, 23, 42, 0.78)";
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = '600 12px ui-monospace, SFMono-Regular, Consolas, monospace';
    ctx.fillText(badge, x + 31, y + 34);

    // Caption
    const cy = y + imgH;
    ctx.fillStyle = dark ? "#f3f4f6" : "#111827";
    ctx.font = '600 15px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif';
    const name = String(item.title || `项目 ${i + 1}`);
    ctx.fillText(name.length > 30 ? name.slice(0, 29) + "…" : name, x + 16, cy + 20);

    if (item.subtitle) {
      ctx.fillStyle = dark ? "#9ca3af" : "#6b7280";
      ctx.font = '400 12px ui-monospace, SFMono-Regular, Consolas, monospace';
      ctx.fillText(item.subtitle, x + 16, cy + 41);
    }
  }

  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("编码审稿拼图失败"))), "image/png"),
  );
  canvas.width = canvas.height = 1;
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportContactSheet({ filename, title, items, columns = 3, theme = "light" }) {
  const choice = await window.tugou.chooseExport(filename || title || "审稿拼图", "png");
  if (!choice) return false;
  try {
    const bytes = await renderContactSheet({ title, items, columns, theme });
    await window.tugou.writeExport(choice.token, bytes);
    return true;
  } finally {
    await window.tugou.cancelExport(choice.token).catch(() => {});
  }
}
