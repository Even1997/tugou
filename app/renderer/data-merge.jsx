import React, { useMemo, useRef, useState } from "react";
import { Button, FormDialog, Icon } from "./components.jsx";
import { Compositor } from "./composite.js";
import { boards, duplicate as duplicateBoard, extract, update as updateBoard } from "../core/artboards.cjs";
import { descendants } from "../core/layers.cjs";
import "./data-merge.css";

function parseRows(raw) {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return { headers: [], rows: [] };
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const split = (line) => {
    const out = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === delimiter && !quoted) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  };
  const headers = split(lines[0]).filter(Boolean);
  const rows = lines.slice(1).map((line) => {
    const cells = split(line);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = cells[idx] ?? "";
    });
    return obj;
  });
  return { headers, rows };
}

function applyRowToLayers(layers, row) {
  const keys = Object.keys(row);
  if (!keys.length) return layers;
  return layers.map((layer) => {
    if (layer.kind !== "text") return layer;
    let nextText = String(layer.text || "");
    let changed = false;
    for (const key of keys) {
      const token = `{{${key}}}`;
      if (nextText.includes(token)) {
        nextText = nextText.split(token).join(row[key]);
        changed = true;
      }
    }
    if (!changed && Object.hasOwn(row, layer.name)) {
      nextText = row[layer.name];
      changed = true;
    }
    if (!changed) return layer;
    const updated = { ...layer, text: nextText };
    delete updated.runs;
    return updated;
  });
}

export function DataMergeDialog({ document, boardId, change, close, complete }) {
  const board = useMemo(() => boards(document).find((b) => b.id === boardId) || boards(document)[0], [document, boardId]);
  const textLayers = useMemo(() => {
    if (!board) return [];
    const extracted = extract(document, board.id);
    return extracted.layers.filter((l) => l.kind === "text");
  }, [document, board?.id]);

  const detectedFields = useMemo(() => {
    const fields = [];
    const seen = new Set();
    for (const l of textLayers) {
      const matches = [...String(l.text || "").matchAll(/\{\{([^{}]+)\}\}/g)];
      if (matches.length) {
        for (const m of matches) {
          const key = m[1].trim();
          if (key && !seen.has(key)) {
            seen.add(key);
            fields.push(key);
          }
        }
      } else if (l.name && !seen.has(l.name)) {
        seen.add(l.name);
        fields.push(l.name);
      }
    }
    return fields;
  }, [textLayers]);

  const [csv, setCsv] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const fileInputRef = useRef(null);

  const parsed = useMemo(() => parseRows(csv), [csv]);
  const matchedCount = useMemo(
    () => parsed.headers.filter((h) => detectedFields.includes(h)).length,
    [parsed.headers, detectedFields],
  );

  const fillExample = () => {
    const cols = detectedFields.length ? detectedFields.slice(0, 4) : ["姓名", "桌号"];
    const header = cols.join(",");
    const sample1 = cols.map((c, i) => `${c}示例A${i + 1}`).join(",");
    const sample2 = cols.map((c, i) => `${c}示例B${i + 1}`).join(",");
    const sample3 = cols.map((c, i) => `${c}示例C${i + 1}`).join(",");
    setCsv(`${header}\n${sample1}\n${sample2}\n${sample3}`);
    setError("");
  };

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setCsv(await file.text());
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };

  const generateBoards = () => {
    if (!board || !parsed.rows.length) return;
    if (parsed.rows.length > 40) {
      setError("单次最多批量生成 40 个画板；大批量请使用「直接批量导出 PNG」。");
      return;
    }
    setError("");
    try {
      let nextDoc = document;
      const baseX = Math.max(...boards(document).map((b) => b.x + b.width)) + 100;
      const baseY = board.y;
      const cols = Math.min(4, parsed.rows.length);
      for (let i = 0; i < parsed.rows.length; i++) {
        const row = parsed.rows[i];
        const dup = duplicateBoard(nextDoc, board.id);
        const col = i % cols;
        const r = Math.floor(i / cols);
        const rowLabel = row[parsed.headers[0]] || `#${i + 1}`;
        nextDoc = updateBoard(dup.document, dup.id, {
          name: `${board.name} · ${rowLabel}`.slice(0, 60),
          x: baseX + col * (board.width + 80),
          y: baseY + r * (board.height + 80),
        });
        const ownIds = descendants(nextDoc.layers, [dup.id]);
        nextDoc = {
          ...nextDoc,
          layers: nextDoc.layers.map((l) =>
            ownIds.has(l.id) && l.id !== dup.id ? applyRowToLayers([l], row)[0] : l,
          ),
        };
      }
      change(nextDoc);
      complete?.(`已批量生成 ${parsed.rows.length} 个套版画板`);
      close();
    } catch (e) {
      setError(e.message);
    }
  };

  const exportPngBatch = async () => {
    if (!board || !parsed.rows.length || busy) return;
    setBusy(true);
    setError("");
    let files = [];
    let engine = null;
    try {
      const names = parsed.rows.map((row, idx) => {
        const label = String(row[parsed.headers[0]] || idx + 1).replace(/[\\/:*?"<>|]/g, "_");
        return `${board.name}_${label}`;
      });
      const choice = await window.tugou.chooseExport(names, "png");
      if (!choice) return;
      files = choice.files || [choice];
      engine = new Compositor();
      const baseExtracted = extract(document, board.id);
      for (let i = 0; i < parsed.rows.length; i++) {
        setProgress(`正在渲染导出 ${i + 1} / ${parsed.rows.length}…`);
        const rowDoc = { ...baseExtracted, layers: applyRowToLayers(baseExtracted.layers, parsed.rows[i]) };
        const bytes = await engine.export(rowDoc, { time: 0 });
        await window.tugou.writeExport(files[i].token, bytes);
      }
      complete?.(`已批量导出 ${parsed.rows.length} 张套版 PNG`);
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      engine?.dispose();
      await Promise.allSettled(files.map((f) => window.tugou.cancelExport(f.token)));
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <FormDialog title="批量套版生成（Data Merge）" className="data-merge-dialog" width={660} close={busy ? () => {} : close}>
      <div className="data-merge-body">
        <div className="data-merge-info">
          <span>当前模板画板：<strong>{board?.name || "未找到画板"}</strong></span>
          <small>
            支持匹配文字中的 <code>{"{{字段名}}"}</code> 占位符，或直接用表头匹配同名文字图层。
          </small>
          {detectedFields.length > 0 && (
            <div className="data-merge-tags">
              <span>可匹配字段：</span>
              {detectedFields.map((f) => (
                <code key={f} className={parsed.headers.includes(f) ? "is-matched" : ""}>{f}</code>
              ))}
            </div>
          )}
        </div>

        <div className="data-merge-input-head">
          <strong>粘贴名单数据（首行为表头，逗号或 Tab 分隔）</strong>
          <div>
            <input ref={fileInputRef} type="file" accept=".csv,.tsv,.txt" hidden onChange={handleFile} />
            <Button size="small" icon="import" disabled={busy} onClick={() => fileInputRef.current?.click()}>导入 CSV</Button>
            <Button size="small" disabled={busy} onClick={fillExample}>填入示例</Button>
          </div>
        </div>

        <textarea
          className="data-merge-textarea"
          rows={6}
          disabled={busy}
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          placeholder={"例如：\n姓名,桌号\n张三,VIP 1 桌\n李四,VIP 2 桌"}
        />

        {parsed.rows.length > 0 && (
          <div className="data-merge-preview">
            <div className="data-merge-preview-head">
              <span>已识别 <strong>{parsed.rows.length}</strong> 条记录 · 匹配 <strong>{matchedCount}</strong> / {parsed.headers.length} 列</span>
              {parsed.rows.length > 5 && <small>仅预览前 5 行</small>}
            </div>
            <table>
              <thead>
                <tr>
                  {parsed.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((row, idx) => (
                  <tr key={idx}>
                    {parsed.headers.map((h) => (
                      <td key={h}>{row[h]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {progress && <p className="muted" role="status">{progress}</p>}
        {error && <p className="message error" role="alert">{error}</p>}

        <div className="dialog-footer">
          <Button disabled={busy} onClick={close}>取消</Button>
          <Button icon="export" disabled={busy || !parsed.rows.length || !board} onClick={exportPngBatch}>
            直接批量导出 PNG（{parsed.rows.length}）
          </Button>
          <Button primary icon="layers" disabled={busy || !parsed.rows.length || !board} onClick={generateBoards}>
            生成套版画板（{parsed.rows.length}）
          </Button>
        </div>
      </div>
    </FormDialog>
  );
}
